const express = require('express');
const { rateLimit } = require('express-rate-limit');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const gunzip = promisify(zlib.gunzip);
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_RAW = 48 * 1024 * 1024;
const BUCKET = 'safratab-backups';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function dataKey(key) {
  return typeof key === 'string' && key.length <= 200 && key !== 'safra_selecionada_id' &&
    (/^(safra_|patrimonio_|uso_producao_|despesas_)/.test(key) || new Set(['safras','propriedade','compras_insumos','lavouras','receitas_tabaco','estufadas_tabaco','mao_obra_familiar','canteiros_mudas','producao_tabaco','saidas_estoque','diario_campo','ocorrencias_pragas_doencas','controle_pluviometrico']).has(key));
}
async function validateArchive(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 10 || bytes.length > MAX_BYTES) throw new Error('Backup inválido ou maior que 32 MB.');
  let data;
  try { data = JSON.parse((await gunzip(bytes, { maxOutputLength: MAX_RAW })).toString('utf8')); }
  catch (_) { throw new Error('O arquivo de backup está incompleto ou inválido.'); }
  if (!data || data.app !== 'SafraTab' || data.version !== 1 || !data.records || Array.isArray(data.records) || typeof data.records !== 'object' || !data.files || Array.isArray(data.files) || typeof data.files !== 'object') throw new Error('Formato de backup não reconhecido.');
  const keys = Object.keys(data.records);
  if (keys.length > 10000) throw new Error('Backup contém registros demais.');
  for (const key of keys) {
    if (!dataKey(key) || !Array.isArray(data.records[key]) || data.records[key].some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Backup contém dados inválidos.');
  }
  for (const [hash, encoded] of Object.entries(data.files)) {
    if (!/^[a-f0-9]{64}$/.test(hash) || typeof encoded !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Foto inválida no backup.');
    const photo = Buffer.from(encoded, 'base64');
    if (photo.length === 0 || photo.length > 15 * 1024 * 1024 || crypto.createHash('sha256').update(photo).digest('hex') !== hash) throw new Error('Foto incompleta no backup.');
  }
  function check(value) {
    if (Array.isArray(value)) return value.forEach(check);
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'fotos') {
        if (!Array.isArray(child) || child.some(p => typeof p !== 'string' || !p.startsWith('backup://') || !Object.hasOwn(data.files, p.slice(9)))) throw new Error('O backup não contém todas as fotos.');
      } else check(child);
    }
  }
  check(data.records);
  return data;
}
class SupabaseBackupStore {
  constructor({ url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, request = fetch } = {}) {
    let parsed; try { parsed = new URL(url); } catch (_) {}
    if (!parsed || parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password || !key?.trim()) throw new Error('Configure o Supabase no servidor para usar o backup.');
    this.url = parsed.origin; this.key = key.trim(); this.request = request;
  }
  async call(path, { method = 'GET', body, token, binary = false, headers = {} } = {}) {
    const response = await this.request(`${this.url}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { apikey: this.key, Authorization: `Bearer ${token || this.key}`, ...(!binary ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body === undefined ? {} : { body: binary ? body : JSON.stringify(body) }),
    });
    if (!response.ok && !(method === 'DELETE' && response.status === 404)) {
      if (path === '/auth/v1/verify' && response.status === 400) { const e = new Error('Código inválido ou expirado. Solicite outro código.'); e.status = 400; throw e; }
      if (path === '/auth/v1/otp' && response.status === 429) { const e = new Error('Aguarde alguns minutos antes de pedir outro código.'); e.status = 429; throw e; }
      const e = new Error(response.status === 401 || response.status === 403 ? 'Confirme seu e-mail novamente para continuar.' : 'O serviço de backup está indisponível. Tente novamente.');
      e.status = response.status === 401 || response.status === 403 ? 401 : 503;
      throw e;
    }
    return response;
  }
  async sendCode(email) { await this.call('/auth/v1/otp', { method: 'POST', body: { email, create_user: true } }); }
  async verifyCode(email, code) {
    const result = await (await this.call('/auth/v1/verify', { method: 'POST', body: { email, token: code, type: 'email' } })).json();
    if (!result.access_token || !uuid.test(result.user?.id || '')) throw new Error('Não foi possível confirmar o código.');
    return { accessToken: result.access_token, refreshToken: result.refresh_token, expiresIn: result.expires_in, userId: result.user.id, email: result.user.email };
  }
  async refresh(refreshToken) {
    const result = await (await this.call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: refreshToken } })).json();
    if (!result.access_token || !uuid.test(result.user?.id || '')) throw new Error('Confirme o e-mail novamente.');
    return { accessToken: result.access_token, refreshToken: result.refresh_token, expiresIn: result.expires_in, userId: result.user.id, email: result.user.email };
  }
  async identify(token) {
    const user = await (await this.call('/auth/v1/user', { token })).json();
    if (!uuid.test(user.id || '') || !user.email_confirmed_at) { const e = new Error('Confirme seu e-mail antes de continuar.'); e.status = 401; throw e; }
    return user.id;
  }
  async list(userId) {
    return (await this.call(`/rest/v1/safratab_backups?user_id=eq.${userId}&select=id,created_at,bytes,sha256&order=created_at.desc&limit=20`)).json();
  }
  async save(userId, bytes) {
    await validateArchive(bytes);
    const id = crypto.randomUUID(); const path = `${userId}/${id}.safratab`;
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    await this.call(`/storage/v1/object/${BUCKET}/${path}`, { method: 'POST', binary: true, body: bytes, headers: { 'Content-Type': 'application/gzip', 'x-upsert': 'false' } });
    try {
      const response = await this.call('/rest/v1/safratab_backups', { method: 'POST', body: { id, user_id: userId, object_path: path, bytes: bytes.length, sha256 }, headers: { Prefer: 'return=representation' } });
      const row = (await response.json())[0];
      if (!row?.id || !row.created_at) throw new Error('O servidor não confirmou o backup.');
      // A manutenção de retenção é independente da confirmação do novo backup.
      await this.prune(userId).catch(() => {});
      return { id: row.id, created_at: row.created_at, bytes: row.bytes, sha256: row.sha256 };
    } catch (e) {
      await this.call(`/rest/v1/safratab_backups?user_id=eq.${userId}&id=eq.${id}`, { method: 'DELETE' }).catch(() => {});
      await this.deleteObject(path).catch(() => {});
      throw e;
    }
  }
  async deleteObject(path) {
    return this.call(`/storage/v1/object/${BUCKET}`, { method: 'DELETE', body: { prefixes: [path] } });
  }
  async prune(userId) {
    const rows = await (await this.call(`/rest/v1/safratab_backups?user_id=eq.${userId}&select=id,object_path&order=created_at.desc&offset=5&limit=100`)).json();
    for (const row of rows) {
      if (row.object_path !== `${userId}/${row.id}.safratab` || !uuid.test(row.id)) continue;
      await this.deleteObject(row.object_path);
      await this.call(`/rest/v1/safratab_backups?user_id=eq.${userId}&id=eq.${row.id}`, { method: 'DELETE' });
    }
  }
  async deleteAccount(userId) {
    // Objetos são removidos antes do usuário: a exclusão em cascata não deixa arquivos órfãos.
    for (;;) {
      const rows = await (await this.call(`/rest/v1/safratab_backups?user_id=eq.${userId}&select=id,object_path&limit=100`)).json();
      if (rows.length === 0) break;
      for (const row of rows) {
        if (!uuid.test(row.id) || row.object_path !== `${userId}/${row.id}.safratab`) throw new Error('Não foi possível conferir os arquivos da conta.');
        await this.deleteObject(row.object_path);
        await this.call(`/rest/v1/safratab_backups?user_id=eq.${userId}&id=eq.${row.id}`, { method: 'DELETE' });
      }
    }
    await this.call(`/auth/v1/admin/users/${userId}`, { method: 'DELETE' });
  }
  async download(userId, id) {
    const rows = await (await this.call(`/rest/v1/safratab_backups?user_id=eq.${userId}&id=eq.${id}&select=object_path,sha256,bytes`)).json();
    if (rows.length !== 1) { const e = new Error('Backup não encontrado nesta conta.'); e.status = 404; throw e; }
    const row = rows[0];
    if (row.object_path !== `${userId}/${id}.safratab` || row.bytes > MAX_BYTES) throw new Error('Backup inválido.');
    const response = await this.call(`/storage/v1/object/${BUCKET}/${row.object_path}`);
    if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Backup excede o tamanho permitido.');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== row.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new Error('O backup não passou na verificação de integridade.');
    return { bytes, sha256: row.sha256 };
  }
}
function backupRouter(getStore = () => new SupabaseBackupStore()) {
  const router = express.Router();
  const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
  const backupLimit = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });
  let transferindo = false;
  const reservarTransferencia = (req, res, next) => {
    if (transferindo) return res.status(503).json({ error: 'O serviço está concluindo outro backup. Tente novamente em instantes.' });
    transferindo = true;
    let liberado = false;
    req.liberarBackup = () => { if (!liberado) { liberado = true; transferindo = false; } };
    res.once('close', () => { if (!req.processandoBackup) req.liberarBackup(); });
    next();
  };
  const safe = fn => async (req, res) => {
    req.processandoBackup = true;
    try { await fn(req, res); }
    catch (e) { if (!res.headersSent && !res.destroyed) res.status(e.status || 400).json({ error: e.message || 'Não foi possível concluir o backup.' }); }
    finally {
      req.processandoBackup = false;
      if (req.liberarBackup) {
        if (res.writableFinished || res.destroyed) req.liberarBackup();
        else res.once('finish', req.liberarBackup);
      }
    }
  };
  const email = value => typeof value === 'string' && value.length < 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  router.post('/codigo', authLimit, express.json({ limit: '8kb' }), safe(async (req, res) => {
    if (!email(req.body?.email)) return res.status(400).json({ error: 'Informe um e-mail válido.' });
    await getStore().sendCode(req.body.email.trim().toLowerCase()); res.json({ ok: true });
  }));
  router.post('/entrar', authLimit, express.json({ limit: '8kb' }), safe(async (req, res) => {
    if (!email(req.body?.email) || !/^\d{6,8}$/.test(req.body?.code || '')) return res.status(400).json({ error: 'Confira o e-mail e o código recebido.' });
    res.set('Cache-Control', 'no-store').json(await getStore().verifyCode(req.body.email.trim().toLowerCase(), req.body.code));
  }));
  router.post('/renovar', authLimit, express.json({ limit: '8kb' }), safe(async (req, res) => {
    if (typeof req.body?.refreshToken !== 'string' || req.body.refreshToken.length > 4096) return res.status(400).json({ error: 'Sessão inválida.' });
    res.set('Cache-Control', 'no-store').json(await getStore().refresh(req.body.refreshToken));
  }));
  router.use(backupLimit, async (req, res, next) => {
    try {
      const token = /^Bearer ([^\s]{20,4096})$/.exec(req.headers.authorization || '')?.[1];
      if (!token) return res.status(401).json({ error: 'Entre com seu e-mail para acessar o backup.' });
      req.backupUserId = await getStore().identify(token); next();
    } catch (e) { res.status(e.status || 503).json({ error: 'Não foi possível confirmar seu acesso ao backup.' }); }
  });
  router.get('/', safe(async (req, res) => res.set('Cache-Control', 'no-store').json({ backups: await getStore().list(req.backupUserId) })));
  router.post('/', reservarTransferencia, express.raw({ type: 'application/octet-stream', limit: MAX_BYTES }), safe(async (req, res) => {
    res.set('Cache-Control', 'no-store').status(201).json(await getStore().save(req.backupUserId, req.body));
  }));
  router.delete('/conta', safe(async (req, res) => {
    await getStore().deleteAccount(req.backupUserId);
    res.set('Cache-Control', 'no-store').json({ ok: true });
  }));
  router.get('/:id', reservarTransferencia, safe(async (req, res) => {
    if (!uuid.test(req.params.id)) return res.status(400).json({ error: 'Identificador inválido.' });
    const result = await getStore().download(req.backupUserId, req.params.id);
    res.set({ 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Backup-Sha256': result.sha256 }).send(result.bytes);
  }));
  router.use((error, req, res, next) => {
    req.liberarBackup?.();
    res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: error.type === 'entity.too.large' ? 'Arquivo ou solicitação maior que o permitido.' : 'Solicitação de backup inválida.' });
  });
  return router;
}
module.exports = { SupabaseBackupStore, backupRouter, validateArchive, dataKey, MAX_BYTES };
