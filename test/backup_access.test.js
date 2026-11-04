const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const express = require('express');
const { SupabaseBackupStore, backupRouter, validateArchive } = require('../backup_access');
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333';
const archive = obj => zlib.gzipSync(JSON.stringify({ app: 'SafraTab', version: 1, records: { propriedade: [{ nome: 'Sítio' }] }, files: {}, ...obj }));
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
test('valida integridade e não aceita credenciais nem fotos incompletas', async () => {
  assert.equal((await validateArchive(archive())).records.propriedade[0].nome, 'Sítio');
  await assert.rejects(validateArchive(archive({ records: { OPENAI_API_KEY: [{ value: 'segredo' }] } })));
  await assert.rejects(validateArchive(archive({ records: { ocorrencias_pragas_doencas: [{ fotos: ['backup://inexistente'] }] } })));
  await assert.rejects(validateArchive(Buffer.from('arquivo truncado')));
  const photo = Buffer.from('foto-de-teste'); const hash = crypto.createHash('sha256').update(photo).digest('hex');
  const valid = archive({ records: { ocorrencias_pragas_doencas: [{ fotos: [`backup://${hash}`] }] }, files: { [hash]: photo.toString('base64') } });
  assert.ok(await validateArchive(valid));
  await assert.rejects(validateArchive(archive({ files: { [hash]: Buffer.from('alterada').toString('base64') } })));
});
test('listagem usa identidade validada e nunca um userId escolhido pelo cliente', async t => {
  const accesses = [];
  const store = { identify: async token => { assert.equal(token, 'token-de-sessao-valido-123'); return owner; }, list: async user => { accesses.push(user); return [{ id }]; } };
  const app = express(); app.use('/api/backups', backupRouter(() => store));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(() => server.close()); const url = `http://127.0.0.1:${server.address().port}/api/backups`;
  assert.equal((await fetch(url)).status, 401);
  const response = await fetch(`${url}?userId=${other}`, { headers: { authorization: 'Bearer token-de-sessao-valido-123' } });
  assert.equal(response.status, 200); assert.deepEqual(accesses, [owner]);
});
test('não baixa arquivo de outro produtor, nem aceita caminho fora da conta', async () => {
  const calls = [];
  const store = new SupabaseBackupStore({ url: 'https://teste.supabase.co', key: 'somente-servidor', request: async url => { calls.push(url); return json([]); } });
  await assert.rejects(store.download(owner, id), /não encontrado/);
  assert.match(calls[0], new RegExp(`user_id=eq.${owner}`)); assert.equal(calls.length, 1);
  store.request = async () => json([{ object_path: `${other}/${id}.safratab`, bytes: 20, sha256: '0'.repeat(64) }]);
  await assert.rejects(store.download(owner, id), /inválido/);
});
test('backup só é confirmado após objeto e metadados; remove objeto órfão se o banco falhar', async () => {
  const calls = [];
  const bytes = archive(); const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const store = new SupabaseBackupStore({ url: 'https://teste.supabase.co', key: 'somente-servidor', request: async (url, opts) => {
    calls.push([url, opts.method]);
    if (url.includes('/storage/')) return json({ ok: true });
    if (opts.method === 'POST') { const row = JSON.parse(opts.body); assert.equal(row.user_id, owner); assert.equal(row.sha256, hash); return json([{ ...row, created_at: new Date().toISOString() }]); }
    return json([]);
  } });
  const result = await store.save(owner, bytes); assert.equal(result.sha256, hash); assert.equal(result.bytes, bytes.length);
  assert.match(calls[0][0], new RegExp(`/storage/v1/object/safratab-backups/${owner}/`));
  calls.length = 0;
  store.request = async (url, opts) => { calls.push([url, opts.method]); return url.includes('/rest/') ? json({}, 500) : json({}); };
  await assert.rejects(store.save(owner, bytes)); assert.ok(calls.some(([url, method]) => url.includes('/storage/') && method === 'DELETE'));
});
test('download confere SHA e tamanho e nunca retorna arquivo truncado', async () => {
  const bytes = archive(); const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const store = new SupabaseBackupStore({ url: 'https://teste.supabase.co', key: 'somente-servidor', request: async url => url.includes('/rest/') ? json([{ object_path: `${owner}/${id}.safratab`, bytes: bytes.length, sha256: hash }]) : new Response(bytes) });
  assert.deepEqual((await store.download(owner, id)).bytes, bytes);
  store.request = async url => url.includes('/rest/') ? json([{ object_path: `${owner}/${id}.safratab`, bytes: bytes.length, sha256: '0'.repeat(64) }]) : new Response(bytes);
  await assert.rejects(store.download(owner, id), /integridade/);
});
test('login e confirmação nunca retornam a chave administrativa', async () => {
  const calls = [];
  const store = new SupabaseBackupStore({ url: 'https://teste.supabase.co', key: 'chave-administrativa', request: async (url, opts) => {
    calls.push([url, JSON.parse(opts.body)]);
    return url.endsWith('/otp') ? json({}) : json({ access_token: 'usuario-token', refresh_token: 'renovar', expires_in: 3600, user: { id: owner, email: 'produtor@example.com' } });
  } });
  await store.sendCode('produtor@example.com'); const result = await store.verifyCode('produtor@example.com', '123456');
  assert.equal(result.userId, owner); assert.ok(!JSON.stringify(result).includes('chave-administrativa')); assert.equal(calls[1][1].type, 'email');
});
test('exclusão remove só arquivos do titular antes de apagar sua conta; tolera objeto já removido', async () => {
  const calls = []; let listed = false;
  const store = new SupabaseBackupStore({ url: 'https://teste.supabase.co', key: 'somente-servidor', request: async (url, options) => {
    calls.push([url, options.method, options.body ? JSON.parse(options.body) : null]);
    if (options.method === 'GET') { if (listed) return json([]); listed = true; return json([{ id, object_path: `${owner}/${id}.safratab` }]); }
    if (url.includes('/storage/')) return json({}, 404);
    return json({});
  } });
  await store.deleteAccount(owner);
  assert.ok(calls.find(([u, m, body]) => u.endsWith('/storage/v1/object/safratab-backups') && m === 'DELETE' && body.prefixes[0] === `${owner}/${id}.safratab`));
  assert.equal(calls.at(-1)[0], `https://teste.supabase.co/auth/v1/admin/users/${owner}`);
  assert.equal(calls.at(-1)[1], 'DELETE');
  assert.ok(calls.every(([u]) => !u.includes(other)));
});
test('código expirado retornado como 403 pelo Supabase orienta pedir outro, sem confundir com sessão', async () => {
  const store = new SupabaseBackupStore({ url:'https://teste.supabase.co', key:'somente-servidor', request:async()=>json({code:'otp_expired',msg:'secret-message-not-to-display'},403) });
  await assert.rejects(store.verifyCode('admin@example.com','12345678'), error => error.status===400 && /já utilizado/.test(error.message) && !error.message.includes('secret-message'));
});
