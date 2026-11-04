const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { SupabaseBackupStore, validateArchive } = require('./backup_access');
const { buildManagementReport } = require('./management_report');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
class ManagementStore extends SupabaseBackupStore {
  async role(userId) {
    let rows;
    try { rows = await (await this.call(`/rest/v1/safratab_admin_roles?user_id=eq.${userId}&active=eq.true&select=user_id&limit=1`)).json(); }
    catch (_) { const e = new Error('Não foi possível consultar a configuração administrativa. Confira se o SQL do painel foi executado no Supabase.'); e.status = 503; throw e; }
    if (rows.length !== 1) { const e = new Error('Sua conta ainda não está autorizada para o painel de gestão.'); e.status = 403; throw e; }
  }
  async audit(admin, producer, action) {
    await this.call('/rest/v1/safratab_management_audit', { method: 'POST', body: { admin_user_id: admin, producer_user_id: producer, action } });
  }
  async producers(admin) {
    await this.role(admin);
    const rows = await (await this.call('/rest/v1/rpc/safratab_management_producers', { method: 'POST', body: { p_admin: admin } })).json();
    await this.audit(admin, null, 'list');
    return rows;
  }
  async report(admin, producer, safraId) {
    await this.role(admin);
    const copies = await this.list(producer);
    if (!copies.length) { const e = new Error('Este produtor ainda não enviou um backup.'); e.status = 404; throw e; }
    const snapshot = copies[0];
    const { bytes } = await this.download(producer, snapshot.id);
    const archive = await validateArchive(bytes);
    const report = buildManagementReport(archive, safraId);
    // Remoção do papel administrativo durante o download impede a entrega dos dados.
    await this.role(admin);
    await this.audit(admin, producer, 'report');
    return { ...report, producerId: producer, backup: { id: snapshot.id, createdAt: snapshot.created_at, bytes: snapshot.bytes } };
  }
}
function managementRouter(getStore = () => new ManagementStore()) {
  const router = express.Router();
  router.use(rateLimit({ windowMs: 60 * 1000, limit: 40, standardHeaders: 'draft-8', legacyHeaders: false }));
  router.use(async (req,res,next) => {
    res.set('Cache-Control','no-store');
    try {
      const token = /^Bearer ([^\s]{20,4096})$/.exec(req.headers.authorization || '')?.[1];
      if (!token) return res.status(401).json({ error: 'Confirme sua conta para acessar o serviço.' });
      req.managementUser = await getStore().identify(token); next();
    } catch (error) {
      const expired = error.status === 401;
      res.status(expired ? 401 : 503).json({ error: expired ? 'Sua sessão não foi reconhecida. Solicite um novo código de acesso.' : 'Não foi possível validar a sessão no servidor. Tente novamente em instantes.' });
    }
  });
  const safe = fn => async (req,res) => { try { await fn(req,res); } catch(e) { res.status(e.status || 503).json({ error: e.status ? e.message : 'Não foi possível consultar o acompanhamento. Tente novamente.' }); } };
  router.get('/sessao', safe(async (req,res) => { await getStore().role(req.managementUser); res.json({ authorized:true }); }));
  router.get('/produtores', safe(async (req,res) => res.json({ produtores: await getStore().producers(req.managementUser) })));
  let lendo = false;
  router.get('/produtores/:id', safe(async (req,res) => {
    if (!uuid.test(req.params.id) || (req.query.safra && (typeof req.query.safra !== 'string' || req.query.safra.length > 100))) return res.status(400).json({ error:'Produtor ou safra inválidos.' });
    if (lendo) return res.status(503).json({ error:'Outra consulta está sendo concluída. Tente novamente em instantes.' });
    lendo = true;
    try { res.json(await getStore().report(req.managementUser, req.params.id, req.query.safra)); }
    finally { lendo = false; }
  }));
  return router;
}
module.exports = { managementRouter, ManagementStore };
