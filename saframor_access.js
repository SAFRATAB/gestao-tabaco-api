const crypto = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { issueServiceToken } = require('./service_auth');

// Acesso privado do piloto SAFRAMOR, independente das assinaturas SAFRATAB.
function saframorAccessRouter({ codigo = process.env.SAFRAMOR_ACCESS_CODE || '', now = Date.now, automatico = process.env.SAFRAMOR_AUTO_ACCESS === 'true' } = {}) {
  const router = express.Router();
  // Sessão anônima de piloto, habilitada explicitamente pelo administrador.
  // Não identifica usuário nem comprova instalação; cotas limitam o consumo.
  router.post('/sessao', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10,
    standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Aguarde antes de tentar ler outra nota.' },
  }), (_req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!automatico) return res.status(503).json({ error: 'A leitura de notas ainda não foi habilitada pelo administrador.' });
    const instante = now(), expira = instante + 15 * 60 * 1000;
    return res.json({ serviceToken: issueServiceToken({ now: instante, expiresAt: expira, aplicativo: 'saframor' }),
      expiraEm: new Date(expira).toISOString() });
  });
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
function saframorUsageLimiter({ limit = 30 } = {}) {
  const limiter = rateLimit({ windowMs: 24 * 60 * 60 * 1000, limit,
    keyGenerator: () => 'saframor-piloto', standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'O limite diário de leitura de notas do SAFRAMOR foi atingido. Tente novamente amanhã.' },
  });
  return (req, res, next) => req.notaFiscalApp === 'saframor' ? limiter(req, res, next) : next();
}
module.exports = { saframorAccessRouter, saframorUsageLimiter };
