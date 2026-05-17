# Deploy e operação (Cloudflare Pages + D1 + R2)

Este runbook descreve o que é necessário para colocar e manter o sistema em produção com o stack atual (SvelteKit, adapter Cloudflare, Wrangler).

## Pré-requisitos

- Conta Cloudflare com **Pages**, **D1** e **R2** habilitados.
- Node.js 20+ (alinhado ao [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)).
- API token da Cloudflare com permissão de deploy em Pages (e acesso à conta).

## Variáveis e secrets

Configurar no projeto Pages (**Settings → Environment variables**) ou via `wrangler secret`, conforme o fluxo da equipe. Referência de tipos: [`src/app.d.ts`](src/app.d.ts).

| Variável | Obrigatório | Uso |
|----------|-------------|-----|
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | Se envio de e-mail estiver ativo | SMTP Gmail (2FA, redefinição de senha, etc.) |
| `SYNC_TOKEN` | Sim, para webhooks | Bearer token usado por [`/api/webhook/sync-policiais`](src/routes/api/webhook/sync-policiais/+server.ts) e [`/api/webhook/sync-unidades`](src/routes/api/webhook/sync-unidades/+server.ts) |
| `RESET_TOKEN` | **Apenas** se quiser permitir reset destrutivo | Segredo **separado**, distinto do `SYNC_TOKEN`, exigido por [`/api/webhook/reset-policiais`](src/routes/api/webhook/reset-policiais/+server.ts). Sem ele configurado, o endpoint sempre retorna 401 (fail-closed). |
| `ADMIN_GERAL_LOGIN` / `ADMIN_GERAL_SENHA` | Opcional / ambiente admin | Login admin via env (ver [`api/auth/login`](src/routes/api/auth/login/+server.ts)) |
| `SENTRY_*` / DSN | Se Sentry estiver ligado | Erros no worker (`@sentry/cloudflare`) |
| `WEBHOOK_REPLAY_ENFORCE` | Após rollout (ver abaixo) | Quando truthy (`1`, `true`, `yes`, `on`), webhooks rejeitam requisições sem `X-Webhook-Timestamp` + `X-Webhook-Nonce`. Default: aceita por compatibilidade, mas loga `info` para cada chamada sem headers. |

**Secrets sensíveis:** nunca commitar `.dev.vars` com valores reais; usar apenas localmente ou CI.

> **Importante:** `RESET_TOKEN` deve ser **estritamente diferente** de `SYNC_TOKEN`. O design separa os dois para que comprometer o token de webhook não baste para apagar o banco. Gere com `openssl rand -hex 32` e armazene apenas no Cloudflare + na planilha de operações.

### Endpoint destrutivo `/api/webhook/reset-policiais`

Apaga TODAS as tabelas operacionais (policiais, unidades, escalas, GISE, documentos). Exige **3 camadas** de autenticação:

1. `Authorization: Bearer <SYNC_TOKEN>` — token padrão de webhooks.
2. `X-Reset-Token: <RESET_TOKEN>` — segredo separado.
3. `X-Confirm-Reset: <YYYY-MM-DD em UTC>` — janela de 24 h, evita replay.

Antes de deletar, o endpoint registra no logger estruturado um snapshot com a contagem de linhas por tabela. Esse snapshot é devolvido na resposta e pode ser consultado em Workers Logs / Sentry para recuperação forense.

**Operação recomendada:** disparar pelo menu da planilha (`scripts/GoogleAppsScript_Sync.gs` → "⚠️ ZERAR Banco de Dados"). Há dupla confirmação (botão + frase digitada) para evitar acidente. Ver setup em [Sincronização Google Sheets](#sincronização-google-sheets).

### Replay protection dos webhooks (P1.3)

Além da autenticação HMAC/Bearer, todos os webhooks (`sync-policiais`, `sync-unidades`, `reset-policiais`) suportam dois headers extras para impedir reenvio de payload capturado:

| Header | Valor |
|--------|-------|
| `X-Webhook-Timestamp` | Unix em segundos (10 dígitos), milissegundos (13 dígitos), ou ISO 8601. Servidor aceita janela de ±5 min (clock skew). |
| `X-Webhook-Nonce` | Único por requisição, ≥16 chars. UUID v4 ou similar. Persistido em `webhook_nonces` (PRIMARY KEY) — reenvio do mesmo nonce devolve 401. |

O `scripts/GoogleAppsScript_Sync.gs` já envia ambos os headers em todas as chamadas a partir do `sendToAPI()`. **Republicar a Web App do Apps Script após o deploy é o que ativa a geração desses headers no caller.**

#### Rollout em duas fases

1. **Deploy do código (esta versão)**: servidor passa a aceitar e validar os headers quando presentes, mas **não exige**. Sem headers, vai um `info` no log dizendo "sem headers de replay protection — rollout".
2. **Republicar a Apps Script**: passa a enviar os headers. Confirmar nos logs do Worker que toda chamada agora vem com timestamp+nonce.
3. **Setar `WEBHOOK_REPLAY_ENFORCE=1`** no Cloudflare (Settings → Environment variables): qualquer chamada sem os headers passa a devolver 401. A partir daqui, replay protection está **obrigatório**.

A limpeza periódica de `webhook_nonces` ainda não é automatizada. Como nonces fora da janela de 5min são inúteis para defender contra replay, qualquer cron simples (ex.: `DELETE FROM webhook_nonces WHERE received_at < datetime('now', '-1 hour');`) pode rodar via Cloudflare Cron Trigger no futuro.

## Banco de dados (D1)

- Configuração de binding: [`wrangler.toml`](wrangler.toml) (`escalas_db`, diretório `migrations/`).
- **Migrações locais:** `npm run db:migrate`
- **Produção / remoto:** `npm run db:migrate:prod -- --yes` (usa `--remote`; o flag `--yes` é obrigatório para evitar mutação acidental de produção enquanto staging/prod compartilham D1 — ver seção de [Separação staging vs produção](#-separação-staging-vs-produção-pendente))

Após mudanças de schema, gerar migrações com Drizzle conforme o fluxo já usado no repositório e aplicar no ambiente alvo antes ou logo após o deploy compatível.

## Armazenamento (R2)

- Binding `escalas_docs` em [`wrangler.toml`](wrangler.toml) — documentos e artefatos de assinatura dependem deste bucket.

## ⚠️ Separação staging vs produção (PENDENTE)

> **Risco aberto identificado pela auditoria.** Hoje `wrangler.toml` declara **um único** `[[d1_databases]]` e **um único** `[[r2_buckets]]`. O workflow faz `pages deploy --branch=staging` para PRs/staging, mas **as bindings apontam para o mesmo banco de produção**. Consequência: qualquer deploy em staging escreve no D1 real; rodar `npm run db:migrate:prod` da branch errada destrói dados de produção.

### Como separar (recomendado antes do go-live)

1. **Criar D1 e R2 dedicados ao staging:**

	```bash
	wrangler d1 create escalas-db-staging
	wrangler r2 bucket create escalas-docs-staging
	```

	Anote os `database_id` retornados.

2. **Editar `wrangler.toml` para usar environments:**

	```toml
	# wrangler.toml — exemplo após a separação
	name = "escalas"
	compatibility_date = "2026-04-01"
	compatibility_flags = ["nodejs_compat"]
	pages_build_output_dir = ".svelte-kit/cloudflare"

	[env.production]
	[[env.production.d1_databases]]
	binding = "escalas_db"
	database_name = "escalas-db"
	database_id = "dc86ec72-..."  # ID atual (produção)
	migrations_dir = "migrations"

	[[env.production.r2_buckets]]
	binding = "escalas_docs"
	bucket_name = "escalas-docs"

	[env.staging]
	[[env.staging.d1_databases]]
	binding = "escalas_db"
	database_name = "escalas-db-staging"
	database_id = "<ID-DO-STAGING>"
	migrations_dir = "migrations"

	[[env.staging.r2_buckets]]
	binding = "escalas_docs"
	bucket_name = "escalas-docs-staging"
	```

3. **Atualizar `scripts/migrate.ts`** para aceitar `--env staging|production` em vez de só `--remote`, e ajustar os scripts `npm run db:migrate*` correspondentes.

4. **Atualizar `.github/workflows/deploy.yml`** para passar `--env staging` / `--env production` no `pages deploy` (ou usar projetos de Pages separados — `escalas` e `escalas-staging`).

5. **Configurar variáveis de ambiente separadas** no Cloudflare Pages para staging (SENTRY_DSN com `SENTRY_ENVIRONMENT=staging`, GMAIL_* dedicado, etc.).

6. **Sincronizar schema** do staging executando todas as migrações: `wrangler d1 migrations apply escalas-db-staging --env staging --remote`.

7. **Validar**: deploy de teste para staging, conferir no Cloudflare Dashboard que o tráfego escreve no `escalas-db-staging`, não no `escalas-db`.

### Mitigações enquanto a separação não é feita

- Bloqueio temporário do script: NÃO rodar `npm run db:migrate:prod` da branch staging.
- ✅ **Implementado**: `scripts/migrate.ts` exige `--yes` explícito quando `--remote` (use `npm run db:migrate:prod -- --yes`). Sem o flag o script aborta antes de tocar no D1.
- Comunicar a equipe que **toda escrita feita em staging persiste em produção**.

## Modelos do face-api (assets estáticos)

O reconhecimento facial usado pelo `SignaturePad.svelte` carrega o modelo `tinyFaceDetector` de [`@vladmandic/face-api`](https://github.com/vladmandic/face-api). Os arquivos (`tiny_face_detector_model-weights_manifest.json` + `tiny_face_detector_model.bin`, ~196 KB) ficam **versionados em [`static/face-api/`](static/face-api/)** e são servidos pela CDN do Cloudflare Pages em `/face-api/`.

- **Antes:** baixados de `cdn.jsdelivr.net`. Risco de rate-limit, indisponibilidade e exigia entrada extra no CSP.
- **Hoje:** servidos `same-origin` com cache imutável. CSP `connect-src` mais estrita.

**Quando atualizar `@vladmandic/face-api`:** copie os arquivos novos do `node_modules` para `static/face-api/` (instruções em [`static/face-api/README.md`](static/face-api/README.md)). Sem esse passo, a versão da lib em runtime fica dessincronizada do modelo servido.

## Cache edge das flags de assinatura

As flags `exigir_foto_assinatura`, `exigir_gps_assinatura`, `exigir_codigo_email_assinatura` e `restringir_smartphone` são lidas via [`lerFlagsAssinatura`](src/lib/server/cfg-ass-cache.ts) — wrapper sobre `caches.default` (Cache API edge do Cloudflare) com TTL de 5 min.

- Em **miss**, consulta o D1 e popula o cache.
- Quando o admin altera uma flag em [`PUT /api/configuracoes/assinatura`](src/routes/api/configuracoes/assinatura/+server.ts), o handler chama `invalidarFlagsAssinatura()` para zerar o cache em todos os PoPs.
- Não há nada a configurar no Cloudflare — o `caches.default` é nativo do runtime e **não exige binding**.

> **Por que não cookie?** Antes essas flags eram cacheadas em um cookie do cliente (`cfg_ass`). Como o cookie não era assinado, um usuário podia editá-lo no devtools e desligar exigências de selfie/GPS/código antes de chamar os endpoints de assinatura. A migração para Cache API server-side fechou esse vetor.

## Sincronização Google Sheets

O script [`scripts/GoogleAppsScript_Sync.gs`](scripts/GoogleAppsScript_Sync.gs) faz o upsert de servidores e unidades a partir de uma planilha. Ele consome `SYNC_TOKEN` (e opcionalmente `RESET_TOKEN`) via `PropertiesService` da própria planilha — **nunca** colocados no código-fonte.

**Setup inicial:**

1. Cole o script em `Extensões → Apps Script` na planilha.
2. Recarregue a planilha — surge o menu **"🚀 Sincronização D1"**.
3. Clique em **"⚙️ Configurar tokens"** e cole `SYNC_TOKEN` (e `RESET_TOKEN` se for usar reset).

**Rotação de tokens:** atualize o secret no Cloudflare Pages e refaça o passo 3. Não há recarga necessária.

## Build e deploy

1. `npm ci`
2. `npm run build` — saída em `.svelte-kit/cloudflare`
3. Deploy Pages (exemplo do workflow): `wrangler pages deploy .svelte-kit/cloudflare --project-name=escalas`

Branches **`main`** e **`staging`** disparam o workflow [Deploy to Cloudflare Pages](.github/workflows/deploy.yml).

## CI antes do deploy

O job `test` executa, em ordem:

- Vitest (`npx vitest run`)
- `svelte-check`
- ESLint e Prettier (`format:check`)
- Playwright (`npx playwright install --with-deps chromium` + `npx playwright test`)

Falhas bloqueiam staging e produção.

**E2E local:** após clonar ou atualizar o Playwright, execute `npx playwright install` (ou `npx playwright install chromium`) para baixar o browser; sem isso, testes que usam `page` falham com “Executable doesn't exist”.

## Dependabot (atualizações automatizadas)

Configurado em `.github/dependabot.yml`. O bot do GitHub abre PRs automaticamente:

- **Semanalmente (segundas, 06:00 BRT)**: novas versões de dependências npm.
- **Mensalmente**: novas versões de actions do GitHub Actions.
- **Imediatamente**: qualquer vulnerabilidade publicada que afete uma dependência atual (CVE / GitHub Advisory).

PRs do bot:

- Aparecem com label `dependencies` (+ `security` se for fix de CVE, `npm` ou `github-actions`).
- Passam pelo CI normal — só mergeie depois que o job `test` ficar verde.
- Vêm agrupadas por ecossistema (ex.: todas as `@sveltejs/*` numa PR só, `@types/*` em outra) para reduzir ruído.

### Quando NÃO mergeiar direto

O `dependabot.yml` ignora **upgrades major** de algumas dependências críticas:

| Dependência | Por quê |
|---|---|
| `node-forge` | Mudança pode alterar validação de cadeia ICP-Brasil |
| `pdf-lib` | Caminho da assinatura digital — pode quebrar PDFs já assinados |
| `@signpdf/*` | Idem — placeholder/embed pode mudar formato |

Para esses, qualquer upgrade major precisa ser feito manualmente após testar o fluxo de assinatura ponta-a-ponta em staging.

### Boas práticas

1. Para alertas de **vulnerabilidade**, mergeie em até 7 dias (24h se severidade `critical`).
2. Para upgrades rotineiros, agrupe a revisão em uma única sessão semanal — evita PRs antigas quebrando contra mudanças recentes.
3. Se uma PR do bot quebrar testes que **não são** da dependência atualizada, é sinal de teste frágil; abra issue separada antes de fechar a PR.

## Checklist rápido de release

1. Migrações D1 aplicadas no ambiente alvo.
2. Variáveis e secrets conferidos no dashboard Cloudflare:
   - `SYNC_TOKEN` definido.
   - `RESET_TOKEN` definido **e diferente do SYNC_TOKEN** (ou intencionalmente vazio para desabilitar reset).
   - `GMAIL_USER` / `GMAIL_APP_PASSWORD` se for enviar e-mail.
3. Smoke manual: login, rota protegida, `/api/health`, fluxo crítico de negócio (ex.: validação pública se aplicável).
4. Conferir que o admin consegue alterar flags em `/api/configuracoes/assinatura` e que a próxima assinatura reflete a mudança em ≤ 5 min (TTL do cache edge).
5. Monitorar logs no dashboard Workers/Pages e alertas no Sentry, se configurado.

## Versão

O campo `version` em [`package.json`](package.json) é informativo; para releases formais, manter changelog ou tags Git alinhados ao processo interno da equipe.
