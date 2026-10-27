const express = require('express');
const cors = require('cors');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const crypto = require('node:crypto');
const { issueServiceToken, requireServiceAccess } = require('./service_auth');
const { saframorAccessRouter, saframorUsageLimiter } = require('./saframor_access');
const { perfilMorango } = require('./nota_morango');
const { subscriptionStatus } = require('./subscription_policy');
const { trialRouter } = require('./trial_access');
const { createTrialStore } = require('./supabase_trial_store');

const app = express();
// Reconhecer o proxy reverso do Render
app.set('trust proxy', 1);
const PORT = process.env.PORT || 10000;
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();
const OPENAI_MODEL = (process.env.OPENAI_MODEL || 'gpt-5.6-luna').trim();

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use('/api/saframor', saframorAccessRouter());
let trialStore;
const trialLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
app.use('/api/teste-gratuito', trialLimiter, trialRouter(() => {
  if (!trialStore) trialStore = createTrialStore();
  return trialStore;
}));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
});

const nfLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    error: 'Limite temporário de análises atingido. Tente novamente mais tarde.',
  },
});

const notaFiscalSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tipo_documento: { type: 'string' },
    fornecedor: { type: 'string' },
    cnpj_fornecedor: { type: 'string' },
    numero_nf: { type: 'string' },
    serie: { type: 'string' },
    data_emissao: { type: 'string' },
    total_nota: { type: 'string' },
    itens: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          produto: { type: 'string' },
          quantidade: { type: 'string' },
          unidade: { type: 'string' },
          preco_unitario: { type: 'string' },
          valor_total: { type: 'string' },
          ncm: { type: 'string' },
          cfop: { type: 'string' },
          categoria: {
            type: 'string',
            enum: ['Defensivos', 'Fertilizantes', 'Lenha', 'Outros'],
          },
        },
        required: [
          'produto',
          'quantidade',
          'unidade',
          'preco_unitario',
          'valor_total',
          'ncm',
          'cfop',
          'categoria',
        ],
      },
    },
    observacoes: { type: 'string' },
  },
  required: [
    'tipo_documento',
    'fornecedor',
    'cnpj_fornecedor',
    'numero_nf',
    'serie',
    'data_emissao',
    'total_nota',
    'itens',
    'observacoes',
  ],
};

const instrucaoNotaFiscal = `
Você é o módulo de leitura documental e classificação de produtos agrícolas do aplicativo Gestão Tabaco.
Sua tarefa é ler uma NF-e/DANFE e transformar o conteúdo em dados estruturados.

Além de extrair os dados fiscais, você DEVE classificar cada produto individualmente em uma das quatro categorias permitidas:
- Defensivos
- Fertilizantes
- Lenha
- Outros

REGRAS DE CLASSIFICAÇÃO:
1. DEFENSIVOS:
   Classifique como "Defensivos" produtos destinados ao controle de pragas, doenças, plantas daninhas ou outros agentes prejudiciais às culturas.
   Inclua fungicidas, inseticidas, herbicidas, acaricidas, bactericidas, nematicidas, reguladores/antibrotantes quando claramente comercializados como defensivos agrícolas e produtos fitossanitários.
   Inclua também produtos biológicos destinados ao controle fitossanitário, como produtos à base de Bacillus, Trichoderma, Beauveria e outros agentes de controle biológico.
   Não classifique um produto como fertilizante apenas porque possui micronutrientes se a finalidade principal indicada pelo produto for controle fitossanitário.

2. FERTILIZANTES:
   Classifique como "Fertilizantes" adubos e produtos cuja finalidade principal seja fornecer nutrientes às plantas.
   Inclua adubos de base, adubos de cobertura, NPK, MAP, MKP, ureia, nitrato, sulfato, fosfato, cloreto de potássio, sulfato de potássio, sulfato de magnésio, nitrato de cálcio, micronutrientes e fertilizantes foliares.
   Se a descrição indicar claramente "adubo foliar", "fertilizante foliar", "fertilizante", "adubo" ou finalidade de nutrição vegetal, use "Fertilizantes".

3. LENHA:
   Classifique como "Lenha" madeira ou combustível lenhoso destinado à queima, secagem ou cura, como lenha de eucalipto.

4. OUTROS:
   Use "Outros" quando o produto não se enquadrar nas três categorias acima, como sementes, mudas, substratos, EPIs, ferramentas, materiais de embalagem, peças, equipamentos, serviços ou outros materiais.

5. A classificação deve considerar a finalidade principal do produto e, quando disponível, o nome comercial, princípio ativo, composição, descrição e contexto da NF-e.
6. Não classifique apenas pela palavra isolada do nome quando houver informação suficiente para identificar a finalidade do produto.
7. Em caso de dúvida real entre categorias, use "Outros" em vez de inventar uma finalidade.
8. Retorne exatamente uma categoria para cada item da NF.

REGRAS DE EXTRAÇÃO:
1. Leia o documento visualmente e também considere o texto extraído do PDF.
2. Extraia TODOS os produtos/serviços da tabela de itens, não apenas o primeiro.
3. Em DANFEs, a descrição do produto pode estar em uma ou mais linhas e a linha fiscal seguinte pode conter NCM, CST, CFOP, unidade, quantidade, valor unitário e valor total. Relacione corretamente essas linhas.
4. NÃO invente dados. Se um campo não puder ser lido com segurança, deixe a string vazia.
5. Preserve os valores numéricos encontrados no documento. Para números decimais, use ponto como separador decimal no JSON, por exemplo 88.5828.
6. Para a data, use DD/MM/AAAA quando essa forma estiver visível no documento.
7. A unidade deve ser exatamente a unidade de comercialização quando possível, por exemplo kg, g, L, mL, LT1, GL5, KG, UN, saco ou outra unidade visível.
8. Não confunda NCM, CFOP ou CST com quantidade ou preço.
9. Se houver várias páginas, considere todas elas.
10. Confira se a quantidade x preço unitário é compatível com o valor total. Não altere o valor do documento para fazer a conta fechar; se houver diferença, mantenha os valores lidos e informe em observacoes.
11. A resposta deve conter somente o JSON exigido pelo esquema.
`;

function mimeFromName(filename) {
  const ext = String(filename || '').toLowerCase().split('.').pop();
  switch (ext) {
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'heic': return 'image/heic';
    case 'heif': return 'image/heif';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'pdf': return 'application/pdf';
    default: return '';
  }
}

function extractResponseText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text;
  }

  const parts = [];
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (typeof part?.text === 'string' && part.text.trim()) {
        parts.push(part.text);
      }
    }
  }
  return parts.join('\n');
}

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'gestao-tabaco-api',
    model: OPENAI_MODEL,
  });
});

app.post('/api/ler-nota-fiscal', requireServiceAccess, saframorUsageLimiter(), nfLimiter, upload.single('file'), async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({
        error: 'OPENAI_API_KEY não configurada no servidor.',
      });
    }

    if (!req.file || !req.file.buffer?.length) {
      return res.status(400).json({
        error: 'Nenhum arquivo foi enviado.',
      });
    }

    const mime = mimeFromName(req.file.originalname);
    if (![
      'application/pdf',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
      'image/jpeg'
    ].includes(mime)) {
      return res.status(400).json({
        error: 'Formato não suportado. Envie PDF, JPG, JPEG, PNG, WEBP, HEIC ou HEIF.',
      });
    }

    const perfil = req.notaFiscalApp === 'saframor'
      ? perfilMorango(notaFiscalSchema)
      : { schema: notaFiscalSchema, instrucao: instrucaoNotaFiscal };
    const base64 = req.file.buffer.toString('base64');

    const content = [
      {
        type: 'input_text',
        text: `${perfil.instrucao}

O arquivo recebido é do tipo ${
          mime === 'application/pdf' ? 'pdf' : 'imagem'
        }.

Analise o documento inteiro e retorne os dados da nota fiscal, classificando cada item conforme as regras acima.`,
      },
    ];

    if (mime === 'application/pdf') {
      content.push({
        type: 'input_file',
        filename: req.file.originalname || 'nota_fiscal.pdf',
        file_data: `data:application/pdf;base64,${base64}`,
      });
    } else {
      content.push({
        type: 'input_image',
        image_url: `data:${mime};base64,${base64}`,
        detail: 'high',
      });
    }

    const body = {
      model: OPENAI_MODEL,
      input: [
        {
          role: 'user',
          content,
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'nota_fiscal_extraction',
          strict: true,
          schema: perfil.schema,
        },
      },
      max_output_tokens: 12000,
    };

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });

    const raw = await response.text();

    if (!response.ok) {
      let message = `HTTP ${response.status}`;

      try {
        const errorBody = JSON.parse(raw);

        if (errorBody?.error?.message) {
          message = errorBody.error.message;
        }
      } catch (_) {}

      return res.status(502).json({
        error: `A OpenAI recusou a solicitação: ${message}`,
      });
    }

    let decoded;

    try {
      decoded = JSON.parse(raw);
    } catch (_) {
      return res.status(502).json({
        error: 'A resposta da OpenAI não veio em JSON válido.',
      });
    }

    const text = extractResponseText(decoded);

    if (!text.trim()) {
      return res.status(502).json({
        error: 'A OpenAI não retornou dados estruturados para a nota fiscal.',
      });
    }

    let result;

    try {
      result = JSON.parse(text);
    } catch (_) {
      return res.status(502).json({
        error: 'A OpenAI retornou um formato inesperado ao ler a nota fiscal.',
      });
    }

    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return res.status(502).json({
        error: 'A OpenAI não retornou um objeto de dados para a nota fiscal.',
      });
    }

    if (req.notaFiscalApp === 'saframor' &&
        (!Array.isArray(result.itens) || result.itens.length > 200 ||
         result.itens.some(i => !i || typeof i.produto !== 'string' || !['Defensivos', 'Adubos', 'Outros'].includes(i.categoria)))) {
      return res.status(502).json({ error: 'A IA retornou itens incompatíveis com o SAFRAMOR. Tente novamente.' });
    }
    return res.json(result);

  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return res.status(504).json({ error: 'A leitura demorou além do tempo de espera. Tente novamente.' });
    }
    console.error('Erro em /api/ler-nota-fiscal:', error);

    return res.status(500).json({
      error: 'Erro interno ao processar a nota fiscal.',
    });
  }
});


// Validação de assinatura exclusivamente no servidor. Nunca envie esta credencial ao aplicativo.
const GOOGLE_PACKAGE_NAME = 'br.com.safratab.app';
const GOOGLE_SUBSCRIPTION_ID = 'gestao_tabaco_premium';
const subscriptionLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

async function googleAccessToken() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Credencial Google não configurada');
  const credentials = JSON.parse(raw);
  if (credentials.type !== 'service_account' || !credentials.client_email || !credentials.private_key) {
    throw new Error('Credencial Google inválida');
  }
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify(payload))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), credentials.private_key).toString('base64url');
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
    signal: AbortSignal.timeout(12000),
  });
  if (!tokenResponse.ok) throw new Error(`Autenticação Google falhou: HTTP ${tokenResponse.status}`);
  const result = await tokenResponse.json();
  if (!result.access_token) throw new Error('Google não retornou access token');
  return result.access_token;
}

// Recebe o purchaseToken retornado pelo Google Play Billing no dispositivo.
// O produto e o pacote são fixos no servidor para impedir consultas arbitrárias.
app.post('/api/assinatura/verificar', subscriptionLimiter, async (req, res) => {
  const purchaseToken = req.body?.purchaseToken;
  if (typeof purchaseToken !== 'string' || purchaseToken.length < 10 || purchaseToken.length > 4096) {
    return res.status(400).json({ ativa: false, error: 'Token de compra inválido.' });
  }
  try {
    const accessToken = await googleAccessToken();
    const endpoint = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(GOOGLE_PACKAGE_NAME)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(12000),
    });
    if (response.status === 404 || response.status === 400) {
      return res.json({ ativa: false });
    }
    if (!response.ok) {
      console.error('Google Play subscription API HTTP', response.status);
      return res.status(503).json({ error: 'Não foi possível validar a assinatura no Google Play.' });
    }
    const purchase = await response.json();
    const status = subscriptionStatus(purchase, GOOGLE_SUBSCRIPTION_ID);
    return res.json({ ...status, ...(status.ativa ? { serviceToken: issueServiceToken() } : {}) });
  } catch (error) {
    console.error('Falha ao verificar assinatura:', error.message);
    return res.status(503).json({ error: 'Validação de assinatura temporariamente indisponível.' });
  }
});

// Acesso temporário de avaliação. Configure SAFRATAB_REVIEW_CODE e
// SAFRATAB_REVIEW_SIGNING_KEY (segredos distintos) nas variáveis do Render.
const reviewLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10,
  standardHeaders: 'draft-8', legacyHeaders: false });
const REVIEW_TTL_DAYS = 30;
function reviewSign(payload) {
  return crypto.createHmac('sha256', process.env.SAFRATAB_REVIEW_SIGNING_KEY)
    .update(payload).digest('base64url');
}
function safeEqual(a, b) {
  const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
app.post('/api/avaliacao/ativar', reviewLimiter, (req, res) => {
  const configured = process.env.SAFRATAB_REVIEW_CODE;
  const signingKey = process.env.SAFRATAB_REVIEW_SIGNING_KEY;
  const code = req.body?.codigo;
  if (!configured || !signingKey || signingKey.length < 32) {
    return res.status(503).json({ error: 'Acesso de avaliação indisponível.' });
  }
  if (typeof code !== 'string' || code.length > 200 || !safeEqual(code, configured)) {
    return res.status(403).json({ error: 'Código de avaliação inválido.' });
  }
  const expiraEm = new Date(Date.now() + REVIEW_TTL_DAYS * 86400000).toISOString();
  const payload = Buffer.from(JSON.stringify({ type: 'review', expiraEm })).toString('base64url');
  return res.json({ token: `${payload}.${reviewSign(payload)}`, expiraEm });
});
app.post('/api/avaliacao/verificar', reviewLimiter, (req, res) => {
  const signingKey = process.env.SAFRATAB_REVIEW_SIGNING_KEY;
  const token = req.body?.token;
  if (!signingKey || signingKey.length < 32 || typeof token !== 'string' || token.length > 2000) {
    return res.json({ autorizado: false });
  }
  const parts = token.split('.');
  if (parts.length !== 2 || !safeEqual(parts[1], reviewSign(parts[0]))) {
    return res.json({ autorizado: false });
  }
  try {
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const autorizado = data.type === 'review' && Number.isFinite(Date.parse(data.expiraEm))
      && Date.parse(data.expiraEm) > Date.now();
    return res.json({ autorizado, expiraEm: autorizado ? data.expiraEm : null,
      ...(autorizado ? { serviceToken: issueServiceToken() } : {}) });
  } catch (_) { return res.json({ autorizado: false }); }
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: 'Arquivo muito grande. O limite é de 15 MB.',
    });
  }

  console.error('Erro não tratado:', error);

  return res.status(500).json({
    error: 'Erro interno do servidor.',
  });
});

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Gestão Tabaco API rodando na porta ${PORT}`);
  });
}
module.exports = app;
