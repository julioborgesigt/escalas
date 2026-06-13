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
| `ADMIN_GERAL_LOGIN` / `ADMIN_GERAL_SENHA` | Opcional / ambiente admin | Login admin via env (ver [`api/auth/login`](src/routes/api/auth/login/+server.ts)). A senha pode (e DEVE) ser informada como **hash PBKDF2** no formato `pbkdf2v2:...` em vez de texto claro — gere com `HASH_PASSWORD=SENHA npx tsx scripts/hash-password.ts`. Texto claro continua aceito por compatibilidade. O mesmo vale para `SUPER_ADMIN_SENHA`. |
| `RATE_LIMIT_IP_SALT` | Recomendado em produção | Segredo (`openssl rand -hex 32`) que muda a chave de rate-limit de "/24 anonimizada" para **hash salteado do IP completo**. Sem ele, 5 falhas de login bloqueiam a /24 inteira (ex.: o NAT da corporação — DoS barato e lockout mútuo). Com ele, o bloqueio é por endereço, sem persistir IP em claro (LGPD ok). |
| `SENTRY_*` / DSN | Se Sentry estiver ligado | Erros no worker (`@sentry/cloudflare`). Logins via credenciais de bootstrap (SUPER_ADMIN/ADMIN_GERAL) geram evento `warning` no Sentry. |
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

A limpeza periódica de `webhook_nonces` (e das demais tabelas de retenção) é automatizada por `executarLimpezaRetencao`, disparada pelo cron `cleanup-retencao.yml` (GitHub Actions) — ver [Failsafe da limpeza de retenção](#failsafe-da-limpeza-de-retenção).

### Failsafe da limpeza de retenção

O Cloudflare Pages não tem cron nativo, então a limpeza depende do agendador externo (`cleanup-retencao.yml`, diário). Se ele parar de disparar (workflow desabilitado, segredo rotacionado, repositório arquivado), as tabelas de retenção crescem **silenciosamente** e consomem cota do D1.

Para flagrar isso sem nova tabela nem armazenamento extra, `GET /api/health?detail=<HEALTH_DETAIL_TOKEN>` reporta o campo `retencao` derivado do último `audit_log` de limpeza:

```json
{ "status": "degraded", "checks": { "limpezaRetencao": "stale" },
  "retencao": { "ultimaExecucao": "...", "horasDesdeUltima": 73.2, "atrasada": true } }
```

**Ação do operador:** aponte um monitor externo (UptimeRobot, Better Stack, etc.) para essa URL e alerte quando `retencao.atrasada` for `true` (ou `status` for `degraded`). A tolerância padrão é 48h (o cron roda a cada 24h). A liveness pública (`/api/health` sem `detail`) **não** muda por causa da defasagem — continua `200 ok` enquanto D1/R2 respondem.

## Banco de dados (D1)

- Configuração de binding: [`wrangler.toml`](wrangler.toml) (`escalas_db`, diretório `migrations/`).
- **Migrações locais:** `npm run db:migrate`
- **Produção / remoto:** `npm run db:migrate:prod -- --yes` (usa `--remote`; o flag `--yes` é obrigatório para evitar mutação acidental de produção enquanto staging/prod compartilham D1 — ver seção de [Separação staging vs produção](#-separação-staging-vs-produção-pendente))

Após mudanças de schema, gerar migrações com Drizzle conforme o fluxo já usado no repositório e aplicar no ambiente alvo antes ou logo após o deploy compatível.

## Armazenamento (R2)

- Binding `escalas_docs` em [`wrangler.toml`](wrangler.toml) — documentos e artefatos de assinatura dependem deste bucket.

## Separação staging vs produção

> **Status: scaffold no repositório; resta a ação de infra do operador.** O `wrangler.toml` já separa os ambientes — as bindings de **produção** ficam no top-level (inalteradas) e a seção **`[env.preview]`** aponta o ambiente de preview/staging do Cloudflare Pages para um D1/R2 **dedicado** (`escalas-db-staging` / `escalas-docs-staging`). O `scripts/migrate.ts` ganhou o alvo `--staging` (`npm run db:migrate:staging`). **Produção não é afetada** (lê as bindings top-level, idênticas às anteriores). Enquanto o `database_id` de staging for o placeholder `<STAGING_DATABASE_ID>`, os deploys de **preview** falham ao bindar — proposital (fail-safe): melhor o preview quebrar do que escrever em produção. Os passos abaixo são o que falta do operador. O bloco TOML de exemplo é ilustrativo; **a configuração real e atual está no próprio `wrangler.toml`**.

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

### Defesas já no código

- ✅ `wrangler.toml` com `[env.preview]` dedicado (produção top-level inalterada).
- ✅ `scripts/migrate.ts --staging` + `npm run db:migrate:staging`; só **produção remota** exige `-- --yes` (aborta antes de tocar no D1 sem confirmação).
- Até o operador concluir os passos acima, um deploy de **preview** sem o `database_id` de staging preenchido **falha ao bindar** — não escreve em produção.

## Backup, restauração e rollback (D1 + R2)

Sistema com valor jurídico (assinaturas) exige plano de recuperação. Resumo dos mecanismos e procedimentos.

### D1 — backup lógico (export)

Export periódico do banco inteiro (esquema + dados) para um arquivo SQL:

```bash
# Produção
npx wrangler d1 export escalas-db --remote --output=backup-$(date +%F).sql
# Staging
npx wrangler d1 export escalas-db-staging --remote --output=backup-staging-$(date +%F).sql
```

Guarde o `.sql` em local seguro e **privado** — contém dados pessoais; trate como o `dump.sql` (que é git-ignored). Cadência recomendada: **diária**, automatizável por um GitHub Action agendado (mesmo molde de `cleanup-retencao.yml`) que grave o artefato num storage com retenção. Restaurar para um banco novo/vazio: `npx wrangler d1 execute <db-destino> --remote --file=backup-AAAA-MM-DD.sql`.

### D1 — Time Travel (point-in-time recovery, ~30 dias)

O D1 mantém recuperação para qualquer ponto dos últimos ~30 dias, sem backup manual — útil para reverter migração ruim ou DELETE acidental:

```bash
npx wrangler d1 time-travel info escalas-db --remote
npx wrangler d1 time-travel restore escalas-db --remote --timestamp="2026-06-05T12:00:00Z"
```

> Time Travel **substitui** o estado atual pelo do instante escolhido — faça um `export` **antes** de restaurar, para não perder dados gravados depois do ponto.

### R2 — documentos assinados

Os PDFs/artefatos são **imutáveis por hash** (a chave deriva do conteúdo), então não há sobrescrita; o risco é **perda** (deleção). O R2 não tem PITR nativo — opções: ativar **versionamento/lock** no bucket (Dashboard → R2 → bucket → Settings) e/ou um job periódico que liste e copie os objetos para um bucket de backup. Como o `arquivo_hash` de cada documento está no D1, o backup do D1 permite **detectar objetos R2 ausentes**.

### Rollback de um deploy ruim (Cloudflare Pages)

O Pages mantém o histórico de deployments. Para reverter **código** instantaneamente (sem rebuild): Dashboard → Pages → projeto → Deployments → no último deployment bom, **"Rollback to this deployment"**. Não afeta D1/R2 (dados).

### Rollback de uma migração ruim

Migrações não têm "down" automático. Para reverter: (1) `wrangler d1 time-travel restore` para o instante **antes** da migração; ou (2) aplicar uma migração corretiva nova (preferível para mudanças pequenas). Rode **sempre** a migração em staging primeiro (`npm run db:migrate:staging`).

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

## Trust Store ICP-Brasil (assinatura qualificada)

A verificação da cadeia ICP-Brasil em [`pdf-verification.ts`](src/lib/server/pdf-verification.ts) depende dos arquivos [`src/lib/server/icp-brasil/roots.pem`](src/lib/server/icp-brasil/roots.pem) e [`intermediates.pem`](src/lib/server/icp-brasil/intermediates.pem). Estes nascem vazios no repo — **antes do primeiro deploy em produção**, popule-os:

```sh
cd src/lib/server/icp-brasil
./update-trust-store.sh   # baixa raízes da ITI + ZIP das ACs credenciadas
git diff roots.pem intermediates.pem   # confira o que mudou
git add roots.pem intermediates.pem
git commit -m "chore(icp-brasil): popula trust store ($(date +%F))"
```

Há também um GitHub Action mensal ([`update-icp-brasil-trust-store.yml`](.github/workflows/update-icp-brasil-trust-store.yml)) que abre PR automaticamente quando a ITI publica mudanças.

**Após popular, ative a checagem estrita em produção:**

```
ICP_BRASIL_TRUST_STORE_REQUIRED=1
```

Sem essa env (default), o sistema apenas loga warning e aceita assinaturas mesmo com trust store vazio — útil em dev/staging, **perigoso em produção** (sem cadeia validada, qualquer cert auto-assinado passaria como "qualificada ICP-Brasil").

## Carimbo de tempo qualificado (TSA RFC 3161)

O fluxo de assinatura qualificada pode receber `TimeStampToken` por dois caminhos:

1. **Do cliente:** Web PKI / Assinador SERPRO v4+ podem embarcar TST direto no CMS. Quando presente, é validado e adotado como `act_icp`.

2. **Server-side:** quando o cliente não embarca, [`cades-finalizer.ts`](src/lib/server/cades-finalizer.ts) consulta a TSA configurada via env e **reescreve o CMS** anexando o TST como `UnsignedAttribute` do `SignerInfo` (promove CAdES-BES → CAdES-T).

Configuração:

```
TSA_URL=https://act.exemplo.com.br/tsa     # endpoint RFC 3161 da ACT
TSA_USERNAME=...                           # se a ACT exigir basic auth
TSA_PASSWORD=...
EXIGIR_TSA_QUALIFICADA=1                   # produção: recusa assinatura sem TST
```

Provedores credenciados ICP-Brasil: Bry, Soluti, Certisign, AC Safeweb, ICP-EDU. Provedores públicos (não-ICP) como `timestamp.digicert.com` funcionam mas têm valor probatório menor.

> **Aviso:** sem `EXIGIR_TSA_QUALIFICADA=1`, o sistema aceita assinaturas com apenas o `signingTime` do servidor — sem oponibilidade a terceiros conforme DOC-ICP-15.

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
