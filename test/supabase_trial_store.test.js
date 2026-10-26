const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { SupabaseTrialStore, createTrialStore } = require('../supabase_trial_store');
const { trialRouter, TRIAL_MS } = require('../trial_access');
const { verifyServiceToken } = require('../service_auth');
const device = 'a'.repeat(64);

// Simula somente o contrato HTTP do Supabase; o SQL tem verificação PostgreSQL separada.
function database() {
  const devices = new Map();
  let privateKey;
  let now = Date.parse('2026-10-26T00:00:00Z');
  let fail = false;
  return {
    advance(ms) { now += ms; },
    setFail(value) { fail = value; },
    async request(url, options) {
      assert.equal(options.headers.apikey, 'test-only-secret');
      assert.equal(options.headers.Authorization, 'Bearer test-only-secret');
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal);
      if (fail) return new Response('secret-must-not-leak', { status: 503 });
      const body = JSON.parse(options.body);
      if (url.endsWith('/safratab_activate_trial')) {
        privateKey ??= body.p_signing_private_key;
        if (!devices.has(body.p_device_hash)) devices.set(body.p_device_hash, {
          device_hash: body.p_device_hash, started_at: now, expires_at: now + TRIAL_MS,
        });
      } else assert.ok(url.endsWith('/safratab_get_trial'));
      const row = devices.get(body.p_device_hash);
      return Response.json(row ? { ...row, server_now: now, signing_private_key: privateKey } : null);
    },
  };
}
function store(db) {
  return new SupabaseTrialStore({ url: 'https://example.supabase.co', key: 'test-only-secret', request: db.request });
}

test('Supabase preserva prazo e chave entre instâncias e ativações concorrentes', async () => {
  const db = database();
  const [initial, concurrent] = await Promise.all([store(db).activate(device), store(db).activate(device)]);
  assert.equal(initial.inicio, concurrent.inicio);
  assert.equal(initial.chavePublica, concurrent.chavePublica);
  assert.equal(initial.expiraEm - initial.inicio, TRIAL_MS);
  db.advance(5 * 86400000);
  const reopened = store(db);
  const fresh = await reopened.verify(device, initial.comprovante);
  assert.equal(fresh.inicio, initial.inicio);
  assert.equal(fresh.expiraEm, initial.expiraEm);
  assert.equal(fresh.chavePublica, initial.chavePublica);
  assert.equal((await reopened.activate(device)).inicio, initial.inicio);
  const bytes = Buffer.from(fresh.chavePublica, 'base64url');
  const publicKey = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), bytes]), format: 'der', type: 'spki' });
  const [payload, signature] = fresh.comprovante.split('.');
  assert.equal(crypto.verify(null, Buffer.from(payload), publicKey, Buffer.from(signature, 'base64url')), true);
  assert.equal(JSON.parse(Buffer.from(payload, 'base64url')).aud, 'safratab-teste-gratuito-v1');
  assert.equal(JSON.stringify(fresh).includes('PRIVATE KEY'), false);
  db.advance(10 * 86400000 - 1000);
  const ending = await reopened.verify(device, initial.comprovante);
  assert.equal(verifyServiceToken(ending.serviceToken, { now: initial.expiraEm - 1 }), true);
  assert.equal(verifyServiceToken(ending.serviceToken, { now: initial.expiraEm }), false);
  db.advance(1000);
  const expired = await store(db).activate(device);
  assert.equal(expired.ativo, false);
  assert.equal(expired.serviceToken, undefined);
  assert.equal(expired.expiraEm, initial.expiraEm);
});

test('Supabase rejeita adulteração, outro aparelho e não inicia teste ao verificar', async () => {
  const db = database(); const s = store(db);
  const initial = await s.activate(device);
  assert.equal(await s.verify('b'.repeat(64), initial.comprovante), null);
  assert.equal(await s.verify(device, initial.comprovante + 'x'), null);
  const [payload, signature] = initial.comprovante.split('.');
  const data = JSON.parse(Buffer.from(payload, 'base64url'));
  data.expiraEm += 86400000;
  assert.equal(await s.verify(device, Buffer.from(JSON.stringify(data)).toString('base64url') + '.' + signature), null);
});

test('configuração incompleta não cai em disco temporário; erros não expõem segredo', async () => {
  assert.throws(() => createTrialStore({}), /Supabase/);
  assert.throws(() => createTrialStore({ SUPABASE_URL: 'https://example.supabase.co', SAFRATAB_TRIAL_DB_PATH: '/tmp/nao-criar.sqlite' }), /SUPABASE_SERVICE_ROLE_KEY/);
  assert.throws(() => new SupabaseTrialStore({ url: 'http://example.supabase.co', key: 'test' }), /Configure/);
  const db = database(); const s = store(db);
  const initial = await s.activate(device);
  db.setFail(true);
  await assert.rejects(s.verify(device, initial.comprovante), error => !error.message.includes('secret') && /banco/.test(error.message));
  db.setFail(false);
  assert.equal((await s.activate(device)).inicio, initial.inicio);
});

test('rotas aguardam banco remoto e retornam 503 em falha assíncrona', async () => {
  const db = database(); const s = store(db);
  const app = express(); app.use(express.json()); app.use('/trial', trialRouter(() => s));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const post = () => fetch(`http://127.0.0.1:${server.address().port}/trial/ativar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dispositivo: device }),
  });
  try {
    const response = await post();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).dias, 15);
    db.setFail(true);
    const failed = await post();
    assert.equal(failed.status, 503);
    assert.equal((await failed.json()).comprovante, undefined);
  } finally { await new Promise(r => server.close(r)); }
});
