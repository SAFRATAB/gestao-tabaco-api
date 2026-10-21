const crypto = require('node:crypto');
const audience = 'safratab-notas-fiscais';
// Uma chave efêmera continua segura. Uma chave estável evita renovar sessões
// após reinício; a autorização sempre deriva da validação de assinatura/avaliação.
const configuredKey = process.env.SAFRATAB_SERVICE_SIGNING_KEY;
if (configuredKey && configuredKey.length < 32) throw new Error('SAFRATAB_SERVICE_SIGNING_KEY deve ter pelo menos 32 caracteres.');
const signingKey = configuredKey || crypto.randomBytes(32).toString('hex');
function sign(value, key = signingKey) {
  return crypto.createHmac('sha256', key).update(value).digest('base64url');
}
function issueServiceToken({ now = Date.now(), key = signingKey } = {}) {
  const payload = Buffer.from(JSON.stringify({ aud: audience, exp: now + 60 * 60 * 1000 })).toString('base64url');
  return `${payload}.${sign(payload, key)}`;
}
function verifyServiceToken(token, { now = Date.now(), key = signingKey } = {}) {
  if (typeof token !== 'string' || token.length > 4096) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const actual = Buffer.from(parts[1]);
  const expected = Buffer.from(sign(parts[0], key));
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;
  try {
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    return data.aud === audience && Number.isFinite(data.exp) && data.exp > now;
  } catch (_) { return false; }
}
function requireServiceAccess(req, res, next) {
  const header = req.get('authorization') || '';
  if (!header.startsWith('Bearer ') || !verifyServiceToken(header.slice(7))) {
    return res.status(401).json({ error: 'Confirme sua assinatura ou acesso de avaliação antes de ler uma nota fiscal.' });
  }
  next();
}
module.exports = { issueServiceToken, verifyServiceToken, requireServiceAccess };
