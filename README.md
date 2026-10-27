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

## SAFRAMOR no mesmo servidor

A mesma rota `POST /api/ler-nota-fiscal`, `OPENAI_API_KEY` e `OPENAI_MODEL` atendem
os dois aplicativos. Não crie outro serviço nem altere as credenciais existentes.
O perfil é derivado da sessão assinada, nunca de um cabeçalho ou campo escolhido
pelo cliente. SAFRATAB continua retornando Defensivos, Fertilizantes, Lenha e
Outros; SAFRAMOR recebe Defensivos, Adubos e Outros. O esquema é copiado antes da
adaptação, sem modificar o do tabaco. Assinaturas, avaliação e teste gratuito do
SAFRATAB conservam seus contratos e prazos.

### Ativar no Render

1. No serviço existente `gestao-tabaco-api`, abra **Environment**.
2. Adicione **SAFRAMOR_ACCESS_CODE** com um código privado aleatório (16 a 512
   caracteres, sem espaços nas pontas). Pode gerar localmente com
   `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
   Nunca use a chave OpenAI como código de acesso e não envie códigos ao GitHub.
3. Salve e publique o commit mais recente (**Manual Deploy → Deploy latest commit**,
   se o deploy automático não tiver ocorrido). Preserve todas as variáveis
   atuais, inclusive OpenAI, assinatura, avaliação e Supabase.
4. Atualize o SAFRAMOR e abra **Estoque → Registrar compra / Ler NF com IA →
   Configurar IA**. O endereço padrão já é
   `https://gestao-tabaco-api.onrender.com`. Informe o código criado no passo 2.
5. Leia uma nota e revise os itens antes de confirmar. O teste real depende da
   publicação, das variáveis do Render e da conta OpenAI existente.

`POST /api/saframor/acesso` recebe `{ "codigo": "..." }` e retorna `serviceToken`
e `expiraEm`. A sessão dura uma hora e usa o público `saframor-notas-fiscais`;
`verifyServiceToken` continua verificando exclusivamente o SAFRATAB por padrão.
A mesma chave de assinatura já usada pelo serviço assina as sessões com públicos
separados. Não é necessária uma nova chave de assinatura. Sem a nova variável,
somente o acesso SAFRAMOR retorna 503; o fluxo SAFRATAB permanece disponível.

O código único é acesso privado de piloto, não assinatura compartilhada nem acesso
público de IA. Ele não é incluído no APK. As sessões ficam somente em memória no
app e exigem nova autorização após expirar/reiniciar. Limite de acesso: 10
solicitações por IP a cada 15 minutos. O limite de leitura já existente é
compartilhado: 30 notas por IP por hora. Rotacionar o código bloqueia novas
sessões; as emitidas seguem válidas até expirar. Rotacionar a chave de assinatura
invalida sessões remotas dos dois apps; não é necessário fazer isso na ativação.
O uso de IA dos dois aplicativos é cobrado na mesma conta OpenAI.

`npm test`: 19 testes, incluindo perfis alternados na mesma rota, público dos
tokens, autenticação, dados incompatíveis, assinatura e teste gratuito. Provedor
simulado, sem chamadas pagas. Publicação e variáveis reais do Render não foram
alteradas por estes testes.
