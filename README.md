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
