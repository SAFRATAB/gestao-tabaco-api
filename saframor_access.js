const crypto = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { issueServiceToken } = require('./service_auth');

// Acesso privado do piloto SAFRAMOR, independente das assinaturas SAFRATAB.
function saframorAccessRouter({ codigo = process.env.SAFRAMOR_ACCESS_CODE || '', now = Date.now } = {}) {
  const router = express.Router();
  router.post('/acesso', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10,
    standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Aguarde antes de tentar autorizar novamente.' },
  }), (req, res) => {
    if (codigo.length < 16 || codigo.length > 512 || codigo !== codigo.trim()) return res.status(503).json({ error: 'Configure SAFRAMOR_ACCESS_CODE no servidor para autorizar o SAFRAMOR.' });
    const recebido = req.body?.codigo;
    if (typeof recebido !== 'string' || recebido.length > 512) return res.status(401).json({ error: 'Código de acesso do SAFRAMOR inválido.' });
    const hash = v => crypto.createHash('sha256').update(v).digest();
    if (!crypto.timingSafeEqual(hash(recebido), hash(codigo))) return res.status(401).json({ error: 'Código de acesso do SAFRAMOR inválido.' });
    const instante = now();
    res.json({ serviceToken: issueServiceToken({ now: instante, aplicativo: 'saframor' }),
      expiraEm: new Date(instante + 60 * 60 * 1000).toISOString() });
  });
  return router;
}
module.exports = { saframorAccessRouter };
