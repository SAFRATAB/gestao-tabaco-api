const crypto = require('node:crypto');
const audiences = { safratab: 'safratab-notas-fiscais', saframor: 'saframor-notas-fiscais' };
// Uma chave efêmera continua segura. Uma chave estável evita renovar sessões
// após reinício. SAFRATAB usa assinatura/avaliação/teste; SAFRAMOR usa acesso privado.
const configuredKey = process.env.SAFRATAB_SERVICE_SIGNING_KEY;
if (configuredKey && configuredKey.length < 32) throw new Error('SAFRATAB_SERVICE_SIGNING_KEY deve ter pelo menos 32 caracteres.');
const signingKey = configuredKey || crypto.randomBytes(32).toString('hex');
function sign(value, key = signingKey) {
  return crypto.createHmac('sha256', key).update(value).digest('base64url');
}
function issueServiceToken({ now = Date.now(), key = signingKey, expiresAt = Infinity, aplicativo = 'safratab' } = {}) {
  if (!audiences[aplicativo]) throw new Error('Aplicativo inválido.');
  const payload = Buffer.from(JSON.stringify({ aud: audiences[aplicativo], exp: Math.min(now + 60 * 60 * 1000, expiresAt) })).toString('base64url');
  return `${payload}.${sign(payload, key)}`;
}
function verifyServiceToken(token, { now = Date.now(), key = signingKey, aplicativo = 'safratab' } = {}) {
  if (!audiences[aplicativo]) return false;
  if (typeof token !== 'string' || token.length > 4096) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const actual = Buffer.from(parts[1]);
  const expected = Buffer.from(sign(parts[0], key));
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;
  try {
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    return data.aud === audiences[aplicativo] && Number.isFinite(data.exp) && data.exp > now;
  } catch (_) { return false; }
}
function requireServiceAccess(req, res, next) {
  const header = req.get('authorization') || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Confirme sua assinatura ou acesso de avaliação antes de ler uma nota fiscal.' });
  }
  const token = header.slice(7);
  if (verifyServiceToken(token)) req.notaFiscalApp = 'safratab';
  else if (verifyServiceToken(token, { aplicativo: 'saframor' })) req.notaFiscalApp = 'saframor';
  else return res.status(401).json({ error: 'Confirme sua assinatura ou acesso de avaliação; no SAFRAMOR, autorize em Configurar IA.' });
  next();
}
module.exports = { issueServiceToken, verifyServiceToken, requireServiceAccess };
