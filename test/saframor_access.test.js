process.env.OPENAI_API_KEY = 'test-only-not-a-real-key';
process.env.SAFRAMOR_ACCESS_CODE = 'codigo-ficticio-apenas-teste-123';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { issueServiceToken, verifyServiceToken } = require('../service_auth');
const { saframorAccessRouter } = require('../saframor_access');

async function iniciar(t, app = require('../server')) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
async function acesso(base, codigo) {
  return fetch(base + '/api/saframor/acesso', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({codigo})});
}

test('sessões do morango e tabaco têm públicos separados e expiração preservada', () => {
  const key = 'a'.repeat(32);
  const token = issueServiceToken({aplicativo:'saframor',key,now:1000,expiresAt:3000});
  assert.equal(verifyServiceToken(token,{aplicativo:'saframor',key,now:2000}),true);
  assert.equal(verifyServiceToken(token,{key,now:2000}),false);
  assert.equal(verifyServiceToken(token,{aplicativo:'saframor',key,now:3000}),false);
  assert.equal(verifyServiceToken(issueServiceToken({key,now:1000}),{aplicativo:'saframor',key,now:2000}),false);
  assert.throws(()=>issueServiceToken({aplicativo:'outro'}));
});
test('acesso SAFRAMOR recusa configuração ausente e código incorreto',async t=>{
  const app=express();app.use(express.json());app.use('/api/saframor',saframorAccessRouter({codigo:''}));
  const base=await iniciar(t,app);
  assert.equal((await acesso(base,'qualquer')).status,503);
  const configurado=await iniciar(t);
  assert.equal((await acesso(configurado,'incorreto')).status,401);
  assert.equal((await acesso(configurado,{invalido:true})).status,401);
  const r=await acesso(configurado,process.env.SAFRAMOR_ACCESS_CODE);
  assert.equal(r.status,200);
  const j=await r.json();assert.ok(Date.parse(j.expiraEm)>Date.now());
  assert.equal(verifyServiceToken(j.serviceToken,{aplicativo:'saframor'}),true);
  assert.equal(verifyServiceToken(j.serviceToken),false);
});
test('mesma rota e chave usam perfis corretos sem mudar o esquema do SAFRATAB',async t=>{
  const base=await iniciar(t);
  const realFetch=global.fetch;
  const perfis=[];
  let categoriaInvalida=false;
  global.fetch=async(url,options)=>{
    if(!String(url).startsWith('https://api.openai.com/'))return realFetch(url,options);
    assert.equal(options.headers.Authorization,'Bearer test-only-not-a-real-key');
    const body=JSON.parse(options.body);
    const categorias=body.text.format.schema.properties.itens.items.properties.categoria.enum;
    const texto=body.input[0].content[0].text;
    perfis.push(categorias);
    const morango=categorias.includes('Adubos');
    assert.match(texto,morango?/SAFRAMOR/:/Gestão Tabaco/);
    return new Response(JSON.stringify({output_text:JSON.stringify({itens:[{produto:'Adubo teste',categoria:categoriaInvalida?'Lenha':morango?'Adubos':'Fertilizantes'}]})}));
  };
  t.after(()=>{global.fetch=realFetch;});
  async function ler(token,pdf=true){
    const form=new FormData();form.set('file',new Blob(['documento fictício']),pdf?'nota.pdf':'nota.jpg');
    return realFetch(base+'/api/ler-nota-fiscal',{method:'POST',headers:{Authorization:`Bearer ${token}`,'X-App':'saframor'},body:form});
  }
  // Header do cliente não muda o perfil: a sessão assinada é a autoridade.
  const tabaco=issueServiceToken();
  assert.equal((await ler(tabaco)).status,200);
  const token=(await (await acesso(base,process.env.SAFRAMOR_ACCESS_CODE)).json()).serviceToken;
  const r=await ler(token);assert.equal(r.status,200);assert.equal((await r.json()).itens[0].categoria,'Adubos');
  assert.equal((await ler(token,false)).status,200);
  assert.equal((await ler(tabaco)).status,200);
  assert.deepEqual(perfis,[['Defensivos','Fertilizantes','Lenha','Outros'],['Defensivos','Adubos','Outros'],['Defensivos','Adubos','Outros'],['Defensivos','Fertilizantes','Lenha','Outros']]);
  categoriaInvalida=true;
  assert.equal((await ler(token)).status,502);
  const antes=perfis.length;assert.equal((await ler(token+'x')).status,401);assert.equal(perfis.length,antes);
});
