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
| `SYNC_TOKEN` | Para webhooks | Autenticação de [`/api/webhook/*`](src/routes/api/webhook/) |
| `ADMIN_GERAL_LOGIN` / `ADMIN_GERAL_SENHA` | Opcional / ambiente admin | Login admin via env (ver [`api/auth/login`](src/routes/api/auth/login/+server.ts)) |
| `SENTRY_*` / DSN | Se Sentry estiver ligado | Erros no worker (`@sentry/cloudflare`) |

**Secrets sensíveis:** nunca commitar `.dev.vars` com valores reais; usar apenas localmente ou CI.

## Banco de dados (D1)

- Configuração de binding: [`wrangler.toml`](wrangler.toml) (`escalas_db`, diretório `migrations/`).
- **Migrações locais:** `npm run db:migrate`
- **Produção / remoto:** `npm run db:migrate:prod` (usa `--remote` no script; exige Wrangler autenticado)

Após mudanças de schema, gerar migrações com Drizzle conforme o fluxo já usado no repositório e aplicar no ambiente alvo antes ou logo após o deploy compatível.

## Armazenamento (R2)

- Binding `escalas_docs` em [`wrangler.toml`](wrangler.toml) — documentos e artefatos de assinatura dependem deste bucket.

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

## Checklist rápido de release

1. Migrações D1 aplicadas no ambiente alvo.
2. Variáveis e secrets conferidos no dashboard Cloudflare.
3. Smoke manual: login, rota protegida, `/api/health`, fluxo crítico de negócio (ex.: validação pública se aplicável).
4. Monitorar logs no dashboard Workers/Pages e alertas no Sentry, se configurado.

## Versão

O campo `version` em [`package.json`](package.json) é informativo; para releases formais, manter changelog ou tags Git alinhados ao processo interno da equipe.
