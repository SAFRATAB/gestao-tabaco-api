process.env.OPENAI_API_KEY = 'test-only-not-a-real-key';
const test = require('node:test');
const assert = require('node:assert/strict');
const { issueServiceToken, verifyServiceToken, requireServiceAccess } = require('../service_auth');

test('sessão válida, expiração e chave incorreta', () => {
  const token = issueServiceToken({ now: 1000, key: 'a'.repeat(32) });
  assert.equal(verifyServiceToken(token, { now: 2000, key: 'a'.repeat(32) }), true);
  assert.equal(verifyServiceToken(token, { now: 3601000, key: 'a'.repeat(32) }), false);
  assert.equal(verifyServiceToken(token, { now: 2000, key: 'b'.repeat(32) }), false);
});
test('token alterado ou malformado não autoriza', () => {
  const token = issueServiceToken();
  for (const value of [null, '', 'abc', token + 'x', token.replace(/^./, 'x')]) {
    assert.equal(verifyServiceToken(value), false);
  }
});
test('middleware não consome IA sem autorização', () => {
  let called = false;
  const res = { status(code) { assert.equal(code, 401); return this; }, json(body) { assert.ok(body.error); } };
  requireServiceAccess({ get: () => '' }, res, () => called = true);
  assert.equal(called, false);
  requireServiceAccess({ get: () => `Bearer ${issueServiceToken()}` }, res, () => called = true);
  assert.equal(called, true);
});
test('rota HTTP rejeita requisição sem autorização antes de processar arquivo', async () => {
  const app = require('../server');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ler-nota-fiscal`, { method: 'POST' });
    assert.equal(response.status, 401);
    assert.match((await response.json()).error, /assinatura/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('leitura autorizada aceita JSON estruturado e informa falha do provedor', async () => {
  const app = require('../server');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const realFetch = global.fetch;
  let providerResponse = { output_text: JSON.stringify({ fornecedor: 'Fornecedor teste', itens: [{ produto: 'Adubo', quantidade: '2' }] }) };
  global.fetch = async (url, options) => {
    if (String(url).startsWith('https://api.openai.com/')) {
      if (providerResponse === 'timeout') throw new DOMException('tempo excedido', 'TimeoutError');
      return new Response(JSON.stringify(providerResponse), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(url, options);
  };
  async function request() {
    const form = new FormData();
    form.append('file', new Blob(['documento fictício'], { type: 'application/pdf' }), 'nota.pdf');
    return realFetch(`http://127.0.0.1:${server.address().port}/api/ler-nota-fiscal`, {
      method: 'POST', headers: { Authorization: `Bearer ${issueServiceToken()}` }, body: form,
    });
  }
  try {
    const ok = await request();
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).itens[0].produto, 'Adubo');
    providerResponse = { output_text: 'resposta inválida' };
    const invalid = await request();
    assert.equal(invalid.status, 502);
    assert.match((await invalid.json()).error, /formato inesperado/);
    providerResponse = 'timeout';
    const timeout = await request();
    assert.equal(timeout.status, 504);
  } finally {
    global.fetch = realFetch;
    await new Promise(resolve => server.close(resolve));
  }
});
