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

Requer Node 22.13 ou superior (até 25) e armazenamento persistente. No Render,
confirme ou adicione um Persistent Disk ao serviço e configure, por exemplo:

```
SAFRATAB_TRIAL_DB_PATH=/var/data/safratab/trials.sqlite
```

O disco precisa estar montado em `/var/data`. Não use o filesystem temporário do
serviço. Sem a variável, os endpoints `/api/teste-gratuito/ativar` e `/verificar`
respondem 503; assinaturas existentes continuam funcionando. A configuração do
disco pode exigir um plano pago e deve ser feita antes de distribuir o app.

O SQLite guarda o identificador pseudônimo do aparelho, início e fim do teste,
e a chave de assinatura dos comprovantes. Preserve o banco e a chave ao publicar:
a reinstalação do app no mesmo aparelho não deve renovar o prazo. Execute em uma
única instância com esse disco; não compartilhe SQLite entre múltiplas instâncias.
Não apague esse banco para publicar uma nova versão.

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
