const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { TrialStore, trialRouter, TRIAL_MS } = require('../trial_access');
const { verifyServiceToken } = require('../service_auth');
const device = 'a'.repeat(64);
function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'safratab-trial-'));
  const file = path.join(directory,'trial.sqlite');
  let now = Date.parse('2026-10-26T00:00:00Z');
  let store = new TrialStore(file, { now: () => now });
  return { get store() { return store; }, setNow(n) { now=n; }, get now() { return now; },
    reopen() { store.close(); store = new TrialStore(file,{now:()=>now}); },
    close() {store.close();fs.rmSync(directory,{recursive:true,force:true});} };
}
test('15 dias são fixos e reativação ou reinício não renovam o prazo',()=>{
  const f=setup();
  try {
    const initial=f.store.activate(device);
    assert.equal(initial.expiraEm-initial.inicio,TRIAL_MS);
    assert.equal(initial.ativo,true);
    f.setNow(f.now+5*86400000);
    assert.equal(f.store.activate(device).expiraEm,initial.expiraEm);
    f.reopen();
    const restored=f.store.activate(device);
    assert.equal(restored.inicio,initial.inicio);
    assert.equal(restored.chavePublica,initial.chavePublica);
    assert.equal(f.store.verify(device,initial.comprovante).expiraEm,initial.expiraEm);
    f.setNow(initial.expiraEm);
    const expired=f.store.activate(device);
    assert.equal(expired.ativo,false);
    assert.equal(expired.serviceToken,undefined);
    assert.equal(expired.expiraEm,initial.expiraEm);
  } finally {f.close();}
});
test('comprovante alterado e uso em outro aparelho são recusados',()=>{
  const f=setup();try {
    const trial=f.store.activate(device);
    assert.equal(f.store.verify('b'.repeat(64),trial.comprovante),null);
    assert.equal(f.store.verify(device,trial.comprovante+'x'),null);
    const parts=trial.comprovante.split('.');
    const payload=JSON.parse(Buffer.from(parts[0],'base64url'));
    payload.expiraEm+=86400000;
    const modified=Buffer.from(JSON.stringify(payload)).toString('base64url')+'.'+parts[1];
    assert.equal(f.store.verify(device,modified),null);
  }finally{f.close();}
});
test('sessão de IA não ultrapassa o fim do teste gratuito',()=>{
  const f=setup();try {
    const trial=f.store.activate(device);
    f.setNow(trial.expiraEm-1000);
    const fresh=f.store.verify(device,trial.comprovante);
    assert.equal(verifyServiceToken(fresh.serviceToken,{now:trial.expiraEm-1}),true);
    assert.equal(verifyServiceToken(fresh.serviceToken,{now:trial.expiraEm}),false);
  }finally{f.close();}
});
test('rotas ativam e consultam o mesmo teste, sem autenticação de pagamento',async()=>{
  const f=setup();const app=express();app.use(express.json());app.use('/api/teste-gratuito',trialRouter(()=>f.store));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const post=async(route,body)=>fetch(`http://127.0.0.1:${server.address().port}/api/teste-gratuito/${route}`,
    {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try {
    const response=await post('ativar',{dispositivo:device});
    assert.equal(response.status,200);
    const trial=await response.json();
    assert.equal(trial.dias,15);
    const checked=await post('verificar',{dispositivo:device,comprovante:trial.comprovante});
    assert.equal(checked.status,200);
    assert.equal((await checked.json()).inicio,trial.inicio);
    assert.equal((await post('ativar',{dispositivo:'invalido'})).status,400);
    assert.equal((await post('verificar',{dispositivo:device,comprovante:'invalido'})).status,403);
  }finally{await new Promise(r=>server.close(r));f.close();}
});
test('sem persistência configurada a API falha de forma segura',async()=>{
  assert.throws(()=>new TrialStore(undefined),/disco persistente/);
  const app=express();app.use(express.json());app.use('/trial',trialRouter(()=>{throw new Error('armazenamento indisponível');}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try {
    const response=await fetch(`http://127.0.0.1:${server.address().port}/trial/ativar`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dispositivo:device})});
    assert.equal(response.status,503);
    assert.equal((await response.json()).comprovante,undefined);
  }finally{await new Promise(r=>server.close(r));}
});
