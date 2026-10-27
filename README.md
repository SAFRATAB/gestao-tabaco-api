# Gestão Tabaco API

Backend do aplicativo Gestão Tabaco para leitura de NF-e/DANFE usando OpenAI.

## Endpoints

- `GET /health`
- `POST /api/ler-nota-fiscal` com multipart/form-data e campo `file`

## Rodar localmente

```bash
npm install
npm start
```

Defina `OPENAI_API_KEY` no ambiente antes de iniciar.

## Render

- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Plan: Free para testes
- Environment Variable: `OPENAI_API_KEY`
- Opcional: `OPENAI_MODEL=gpt-5.6-luna`

Não coloque a chave da OpenAI no código ou no GitHub.

## Autorização da leitura de notas

A rota de leitura exige `Authorization: Bearer <serviceToken>`. O token é emitido
pela validação positiva de assinatura ou de acesso de avaliação e dura uma hora.
Nenhuma chave da OpenAI ou de assinatura deve ser enviada ao cliente.

Opcionalmente configure `SAFRATAB_SERVICE_SIGNING_KEY` com um segredo aleatório
de pelo menos 32 caracteres, igual em todas as instâncias. Sem essa variável,
uma chave aleatória em memória é criada no início; reinícios exigem renovar a
autorização, e ambientes com múltiplas instâncias precisam da chave compartilhada.

Publique a API com suporte a `serviceToken` antes de distribuir o novo app.
Versões antigas precisam ser atualizadas para usar a leitura autenticada de notas.
Os limites existentes de quantidade e tamanho de arquivos não foram alterados.

Execute `npm test` para validar a autorização e os contratos HTTP sem chamadas
ao Google ou à OpenAI.

## Teste gratuito de 15 dias

A opção recomendada é **Render Free + Supabase Free**, sem disco pago no Render.
Requer Node 22.13 ou superior (até 25). O banco guarda somente o identificador
pseudônimo do aparelho, as datas do teste e a chave de assinatura dos comprovantes.
Os registros agrícolas continuam locais no aplicativo.

### Configuração sem disco pago

1. Crie uma conta em https://supabase.com/ e um projeto no plano **Free**.
   Selecione a região São Paulo, se disponível. Guarde a senha do banco.
2. No projeto, abra **SQL Editor**, crie uma consulta e execute todo o arquivo
   [supabase/trial_access.sql](supabase/trial_access.sql). O script pode ser
   executado novamente sem apagar registros nem renovar prazos.
3. Em **Project Settings / API** (ou **Data API**), copie a **Project URL**.
   Em **API Keys**, localize a chave administrativa **service_role** na seção
   de chaves legadas JWT. Não use a chave pública `anon`/publishable.
4. No Render, abra o serviço `gestao-tabaco-api` → **Environment** e configure:

   ```text
   SUPABASE_URL=https://SEU-PROJETO.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=CHAVE_SERVICE_ROLE_DO_PROJETO
   ```

   A chave é secreta: cole-a somente no ambiente do Render, nunca no chat,
   aplicativo ou repositório. Não é necessário configurar
   `SAFRATAB_TRIAL_DB_PATH` nem adicionar um disco.
5. Salve e publique novamente a API. Aguarde **Live**. Em um aparelho de teste,
   ative os 15 dias e confirme que nova ativação mantém a mesma data de término.

As funções SQL e as tabelas são inacessíveis às credenciais públicas do app;
somente a API, usando `service_role`, pode consultá-las. O início é definido pelo
relógio do banco, e inserções atômicas preservam a primeira ativação e a chave
mesmo com pedidos simultâneos ou múltiplas instâncias da API.

Sem configuração, ou com indisponibilidade do banco, as rotas do teste retornam
503; não há fallback em memória ou arquivo temporário que reinicie o prazo.
As assinaturas existentes continuam funcionando. Comprovantes já emitidos seguem
válidos offline até seu término original, conforme o controle do aplicativo.

Os planos gratuitos têm limites e podem sofrer suspensão por inatividade; confira
as condições vigentes do Render e Supabase. Não foi contratado plano pago.
Preserve o projeto e a chave de assinatura no banco entre publicações. Não apague
as tabelas para publicar uma versão. Se houver testes reais em outro banco,
migre também as datas originais e a chave antes de trocar o provedor.

### Compatibilidade com disco existente

Instalações que já usem SQLite podem continuar com `SAFRATAB_TRIAL_DB_PATH` em
um disco persistente. Quando as variáveis do Supabase estiverem presentes, elas
têm prioridade. Configuração incompleta não cai silenciosamente no SQLite.
Não use o filesystem temporário do Render Free para armazenar testes.

### Verificação

`npm test` testa os contratos HTTP, assinaturas e falhas do banco com transporte
simulado, sem consumir serviços externos. Para validar também as permissões e
as regras reais do PostgreSQL, execute em **um banco temporário de testes**:

```sh
psql -v ON_ERROR_STOP=1 -f test/trial_access_postgres.sql
```

Esse teste cria os papéis do Supabase quando ausentes e não deve ser executado
no projeto de produção. A configuração do projeto real ainda precisa ser validada
após inserir as variáveis no Render.

O teste começa na primeira ativação online, dura 15 dias corridos, não exige
cartão e não cria cobrança automática. Repetir a ativação retorna o prazo
original. Os comprovantes assinados permitem uso offline até o término original.
O token de serviços remotos nunca ultrapassa esse término. A tolerância offline
de 7 dias das assinaturas pagas permanece independente. Não há cupons próprios.

A identificação usa um hash do Android ID associado ao app; é controle por
aparelho, não por pessoa. Troca de aparelho, restauração de fábrica ou mudança
da identidade de assinatura do APK podem gerar outra identidade. Sem conta do
produtor e relógio confiável de hardware, isso não oferece proteção absoluta
contra adulteração de um aparelho. Os registros agrícolas permanecem locais.

## SAFRAMOR no mesmo servidor — leitura direta

A mesma rota `POST /api/ler-nota-fiscal`, chave `OPENAI_API_KEY` e modelo atendem
os dois aplicativos. O SAFRAMOR não pede endereço, código ou configuração ao
produtor: escolher PDF/foto inicia a autorização automática e a leitura.

### Ativar no Render, somente pelo administrador

1. Abra o serviço existente `gestao-tabaco-api` → **Environment**.
2. Adicione `SAFRAMOR_AUTO_ACCESS=true`.
3. Preserve `OPENAI_API_KEY`, `OPENAI_MODEL` e todas as variáveis do SAFRATAB.
4. Salve e publique o código atualizado, usando **Manual Deploy → Deploy latest
   commit** caso o deploy automático não tenha ocorrido.
5. Atualize o SAFRAMOR e toque em **Ler nota fiscal com IA**. Não há código para
   digitar no aparelho nem chave OpenAI dentro do APK.

O app obtém sessão em `POST /api/saframor/sessao` (sem código) e envia o documento
para a rota compartilhada usando Bearer token. Sessão de 15 minutos em memória,
renovada automaticamente. O servidor deriva o perfil do token assinado: SAFRAMOR
recebe Defensivos, Adubos e Outros; SAFRATAB mantém suas categorias, assinatura,
avaliação e teste gratuito. Sem a flag, a sessão automática retorna 503 sem
consumir IA. A rota administrativa antiga `/api/saframor/acesso`, com código,
continua compatível, mas não é usada pelo app atual.

Este acesso automático é um piloto anônimo: não identifica usuário nem comprova
que a chamada veio do APK. É habilitado explicitamente pelo administrador. Limites
por processo: 10 sessões por IP a cada 15 minutos e **30 tentativas de leitura do
SAFRAMOR por janela de 24 horas, somando todos os IPs**. O contador inclui falhas
após autorização. A cota do morango não conta leituras SAFRATAB, e o limite
anterior de 30 notas/IP/hora continua existindo. Contadores em memória reiniciam
com o processo e multiplicam por réplica. Antes de distribuição pública, usar
contas/assinaturas e cotas persistentes por usuário; esta sessão anônima não
substitui essa autenticação. Desativar a flag impede novas sessões; as emitidas
expiram em até 15 minutos. Não é necessário alterar chaves do SAFRATAB.

As requisições dos dois apps são cobradas na mesma conta OpenAI. `npm test` roda
21 testes sem chamadas pagas, incluindo habilitação da sessão, expiração, cota
global do morango e compatibilidade com o tabaco. O Render real ainda precisa
receber a flag e o deploy; os testes não alteram suas variáveis.

### Horário da sessão SAFRAMOR

A resposta de `/api/saframor/sessao` também inclui `servidorAgora` em ISO UTC.
O cliente calcula a validade por `expiraEm - servidorAgora` e acompanha o tempo
com relógio monotônico, sem comparar a validade com a data/hora civil do aparelho.
O token e sua verificação no servidor não mudaram. O campo é aditivo e não afeta
SAFRATAB ou versões anteriores do SAFRAMOR.
