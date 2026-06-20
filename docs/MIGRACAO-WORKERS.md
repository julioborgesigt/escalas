# Plano de Migração: Cloudflare Pages → Cloudflare Workers

> **Documento de continuidade — autossuficiente.** Pode ser retomado em outra
> sessão sem o histórico do chat. Contém o estado atual do projeto, a
> motivação, o passo a passo com comandos, gotchas, rollback, checklist de
> validação e o contexto da auditoria de segurança que originou a necessidade.
>
> **Base:** branch `main` no commit `26fb2b3` (já inclui vite 8 e o fix de
> CVEs de devDependencies). **Escrito em:** junho/2026.

---

> ## ⚠️ ATUALIZAÇÃO (Fase 2 — junho/2026): a premissa do A3 estava ERRADA
>
> A validação em staging (Worker `escalas-staging`) provou empiricamente que
> **600k iterações de PBKDF2 são IMPOSSÍVEIS no runtime da Cloudflare**, e **não
> por CPU**: a API `crypto.subtle` do **workerd** impõe um **teto rígido de
> 100.000 iterações** (erro literal: `Pbkdf2 failed: iteration counts above
> 100000 are not supported`). Como **Pages e Workers rodam o mesmo workerd**,
> esse teto é **idêntico** nos dois — **migrar de plataforma NÃO destrava 600k**
> e o `cpu_ms` não ajuda (o erro é de API, não de tempo).
>
> **O A3 foi resolvido por outro caminho — o PEPPER** (formato de hash
> `pbkdf2v3` = HMAC-SHA256 com `PASSWORD_PEPPER` antes do PBKDF2-100k),
> implementado em `src/lib/auth.ts`. Custo de CPU ~zero, dentro do teto da API,
> e neutraliza brute-force offline em caso de vazamento do D1. **Não depende
> desta migração** e funciona no Pages atual. Ver `.env.example` →
> `PASSWORD_PEPPER` e os testes em `src/lib/__tests__/auth.test.ts`.
>
> **Consequência para este plano:** a migração Pages→Workers **perde o A3 como
> justificativa**. Seguir com ela passa a valer apenas pelos **ganhos
> secundários** (Cron Triggers nativos, headroom de CPU para PDF/assinatura).
> A **Fase 4 (subir para 600k) está CANCELADA** — substituída pelo pepper.

---

## 1. Por que migrar (e o que NÃO se ganha)

### Motivação primária — teto de CPU
O projeto roda em **Cloudflare Pages Functions**, cujo limite de CPU por
request é **~50 ms** (10 ms no plano free), e **não é configurável**. Isso é o
gargalo do achado de segurança **A3**: o hashing de senha está preso em
**PBKDF2-SHA256 com 100 000 iterações** (~10–15 ms) porque 600 000 (mínimo
OWASP 2023+, ~60–90 ms) **estoura o teto** e devolve `Error 1102: Worker
exceeded CPU time limit` → HTTP 500. Isso foi confirmado empiricamente: subir
para 600k quebrou o login de todos que usam senha hasheada (o bootstrap por
env, que compara texto sem PBKDF2, seguia logando e mascarava o sintoma — ver
histórico no comentário de `src/lib/auth.ts`).

**Cloudflare Workers (standalone)** permite **`limits.cpu_ms` configurável**
(padrão 30 s no plano pago, até 5 min). Com isso o A3 (600k) vira trivial.

### Ganhos reais para ESTE projeto
1. **Headroom de CPU** para toda a carga pesada do backend, não só o PBKDF2:
   assinatura CAdES/PAdES (node-forge), verificação de assinatura na
   `/validar` (parse CMS + RSA + cadeia ICP-Brasil + OCSP + TSA + multi-
   assinatura), e geração de PDF/XLSX/DOCX. Hoje essas rotas podem estar
   perigosamente perto dos ~50 ms; no Workers deixam de correr o risco de 1102.
2. **Cron Triggers nativos** — hoje a limpeza de retenção LGPD depende de um
   GitHub Action agendado (`.github/workflows/cleanup-retencao.yml`), e o
   próprio `DEPLOY.md` alerta que, se ele parar, "as tabelas crescem
   silenciosamente". Workers tem cron nativo.
3. **Alinhamento de plataforma** — a Cloudflare prioriza Workers; Pages recebe
   menos recursos novos. Abre acesso futuro a Queues, Durable Objects e gradual
   deployments.

### O que NÃO muda (sem ilusões)
- **Velocidade percebida pelo usuário:** ~zero ganho. Pages Functions já rodam
  sobre o runtime Workers (mesmo workerd/V8, mesma edge/CDN). Latência, cold
  start e throughput de D1/R2 são equivalentes.
- **Custo:** Pages e Workers estão no mesmo plano de US$ 5; o pricing convergiu.
- **A aplicação:** SvelteKit, rotas e lógica ficam praticamente inalterados.

### Alternativa mais barata se o objetivo for SÓ o A3
O risco real do iter baixo é **brute-force offline caso o banco vaze**. Um
**pepper** (segredo global `PASSWORD_PEPPER` via HMAC, custo de CPU ~zero)
neutraliza esse cenário **sem migrar de plataforma**. Se a Fase 0 mostrar que
as rotas estão folgadas e não há outro motivo para migrar, prefira o pepper
(novo formato `pbkdf2v3` + re-hash no login). A migração só "vale a pena pelo
A3" se você quer o **600k literal** + os outros ganhos acima.

---

## 2. Estado atual do projeto (snapshot preciso)

| Item | Valor atual |
|------|-------------|
| Plataforma | Cloudflare **Pages**, projeto `escalas` |
| Framework | SvelteKit 2 + `@sveltejs/adapter-cloudflare@7.2.9` |
| Bundler | **vite 8** (rolldown) + `@sveltejs/vite-plugin-svelte@7` |
| Runtime flags | `compatibility_date = "2026-04-01"`, `compatibility_flags = ["nodejs_compat"]` |
| D1 (prod) | binding `escalas_db`, db `escalas-db`, id `dc86ec72-7ed4-4e8c-9d29-67a4e509ea49` |
| D1 (staging) | db `escalas-db-staging`, id `c4da26fa-a92a-4553-9869-e53474ec4948` |
| R2 (prod/staging) | binding `escalas_docs`, buckets `escalas-docs` / `escalas-docs-staging` |
| Deploy | GitHub Actions `.github/workflows/deploy.yml` via `cloudflare/wrangler-action@v4` |
| Comando de deploy | `pages deploy .svelte-kit/cloudflare --project-name=escalas [--branch=staging]` |
| Cron | GitHub Action `cleanup-retencao.yml` (Pages não tem cron nativo) |
| Node | 22 (engines `>=22`) |

**Decisão de adapter (importante):** o `@sveltejs/adapter-cloudflare@7.2.9`
suporta **tanto Pages quanto Workers com static assets** — **não é preciso
trocar de adapter**. O modo é detectado pela config do wrangler:
- tem `pages_build_output_dir` → **Pages**;
- tem `main` + `assets` → **Workers**.

**Saída do build hoje** (`.svelte-kit/cloudflare/`, modo Pages):
```
_worker.js   _app/   _headers   _routes.json   404.html
face-api/    favicon.svg   init.js   robots.txt
```

**`wrangler.toml` atual (resumo):**
```toml
name = "escalas"
compatibility_date = "2026-04-01"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = ".svelte-kit/cloudflare"

[vars]
TSA_URL = "http://timestamp.digicert.com"

[[d1_databases]]
binding = "escalas_db"
database_name = "escalas-db"
database_id = "dc86ec72-7ed4-4e8c-9d29-67a4e509ea49"
migrations_dir = "migrations"

[[r2_buckets]]
binding = "escalas_docs"
bucket_name = "escalas-docs"

[env.preview.vars]
TSA_URL = "http://timestamp.digicert.com"
[[env.preview.d1_databases]]
binding = "escalas_db"
database_name = "escalas-db-staging"
database_id = "c4da26fa-a92a-4553-9869-e53474ec4948"
migrations_dir = "migrations"
[[env.preview.r2_buckets]]
binding = "escalas_docs"
bucket_name = "escalas-docs-staging"
```

**`_headers` atual (recurso de Pages):**
```
/face-api/*   → Cache-Control: public, max-age=31536000, immutable
/init.js      → Cache-Control: public, max-age=3600 + Content-Type
/robots.txt   → Cache-Control: public, max-age=86400
```

---

## 3. Fase 0 — Medir o headroom de CPU (decide se vale a pena)

Objetivo: saber se a migração é **corretiva** (já há estouro) ou **preventiva**.

1. **Logs:** procurar `Error 1102` / "exceeded CPU" em **Cloudflare Logs** e no
   **Sentry**, nas rotas:
   - `src/routes/api/escalas/[id]/finalizar-assinatura/+server.ts`
   - `src/routes/api/escalas/[id]/preparar-assinatura/+server.ts`
   - `src/routes/api/escalas/[id]/assinar-simples/+server.ts`
   - `src/routes/api/gise/[id]/**` (assinar/finalizar/relatórios)
   - `src/routes/validar/[hash]/+page.server.ts` (verificação completa)
   - `src/routes/api/gise/historico/export/+server.ts`
   Qualquer ocorrência ⇒ migração **corretiva/urgente**.
2. **Instrumentação temporária:** medir `performance.now()` em torno das
   operações CPU-bound (boa proxy de CPU time, pois quase não têm I/O):
   `verificarAssinaturaCompleta` (`src/lib/server/pdf-verification.ts`),
   `prepararPdfParaAssinatura` (`src/lib/server/pdf-signing-prepare.ts`),
   `gerarPdf*/export-*`, e o `derivarPBKDF2` (`src/lib/auth.ts`). Logar a
   duração e exercitar com **piores casos reais**: PDF com 2 assinaturas
   (OIP + DPC), escala grande, export do histórico GISE.
3. **Critério de decisão:**
   - P99 confortavelmente **< ~30 ms** ⇒ migração **preventiva** (ou só faça o
     pepper, se o único motivo for o A3).
   - Perto de/ acima de **50 ms** ou com qualquer 1102 ⇒ migração **corretiva**.

---

## 4. Fase 1 — Preparação (em branch, sem tocar produção)

### 4.1 `wrangler.toml` em modo Workers
Substituir `pages_build_output_dir` por `main` + `[assets]` + `[limits]`.
**Confirme os caminhos `main`/`directory` rodando `npm run build` em modo
Workers** (o adapter v7 pode reorganizar a saída; ver doc oficial do adapter).
Esqueleto:

```toml
name = "escalas"
main = ".svelte-kit/cloudflare/_worker.js"      # CONFIRMAR no build Workers
compatibility_date = "2026-04-01"
compatibility_flags = ["nodejs_compat"]          # MANTER (usa node:crypto, Buffer)

[assets]
directory = ".svelte-kit/cloudflare"             # CONFIRMAR no build Workers
binding = "ASSETS"

[limits]
cpu_ms = 300000                                  # libera o A3 (600k) e a cripto/PDF

[observability]
enabled = true

[vars]
TSA_URL = "http://timestamp.digicert.com"

[[d1_databases]]
binding = "escalas_db"
database_name = "escalas-db"
database_id = "dc86ec72-7ed4-4e8c-9d29-67a4e509ea49"
migrations_dir = "migrations"

[[r2_buckets]]
binding = "escalas_docs"
bucket_name = "escalas-docs"

# Ambiente de staging (substitui o atual [env.preview])
[env.staging.vars]
TSA_URL = "http://timestamp.digicert.com"
[env.staging.assets]
directory = ".svelte-kit/cloudflare"
binding = "ASSETS"
[env.staging.limits]
cpu_ms = 300000
[[env.staging.d1_databases]]
binding = "escalas_db"
database_name = "escalas-db-staging"
database_id = "c4da26fa-a92a-4553-9869-e53474ec4948"
migrations_dir = "migrations"
[[env.staging.r2_buckets]]
binding = "escalas_docs"
bucket_name = "escalas-docs-staging"
```

### 4.2 `svelte.config.js`
Em geral **nada muda** — `adapter()` detecta o modo pela config do wrangler.
Validar com `npm run build` que a saída é a esperada de Workers. Caso a doc do
adapter v7 exija opções (ex.: `config`, `platformProxy`), ajustar aqui.

### 4.3 `.github/workflows/deploy.yml`
Trocar o comando nos jobs `deploy-staging` e `deploy-production`:
- **De:** `command: pages deploy .svelte-kit/cloudflare --project-name=escalas [--branch=staging]`
- **Para (produção):** `command: deploy`
- **Para (staging):** `command: deploy --env staging`

O resto (checkout, setup-node 22, `npm ci`, `npm run build`, gates de teste,
guards de segurança, migrations locais, Playwright) permanece **igual**.

### 4.4 Secrets e vars
Re-cadastrar no Worker (mesmos valores) via `wrangler secret put <NOME>` ou
Dashboard → Workers → Settings. Lista de referência em `.env.example` e
`src/app.d.ts`. Críticos:
`SYNC_TOKEN`, `RESET_TOKEN`, `RATE_LIMIT_IP_SALT`, `RESEND_API_KEY`,
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPER_ADMIN_LOGIN/SENHA/EMAIL`,
`ADMIN_GERAL_LOGIN/SENHA`, `SENTRY_DSN`, `GISE_BASE_EQUIPE_SECRET`,
`TSA_USERNAME/PASSWORD` (se usados), `SELO_INSTITUCIONAL_PEM`,
`HEALTH_DETAIL_TOKEN`, `SESSION_CACHE_TTL_SECONDS` (opcional).

---

## 5. Fase 2 — Validar em staging

1. Build + deploy de staging (escreve no **D1/R2 de staging**, nunca produção):
   ```sh
   npm run build
   npx wrangler deploy --env staging
   # se necessário, aplicar migrations no D1 de staging:
   npm run db:migrate:staging
   ```
2. Testar pela URL `*.workers.dev` (domínio de produção ainda no Pages).
3. **Checklist funcional** (ver seção 9).
4. **Medir CPU** no Dashboard → Workers → Analytics e confirmar headroom.

---

## 6. Fase 3 — Cutover de produção

1. Deploy do Worker de produção (domínio ainda no Pages):
   ```sh
   npm run build
   npx wrangler deploy
   ```
   Testar pela URL `*.workers.dev`.
2. **Mover o custom domain** do projeto Pages para o Worker
   (Dashboard → Workers → seu worker → Settings → Domains & Routes →
   Add Custom Domain). Esse é o **único instante de virada** — Pages e Worker
   não servem o mesmo domínio simultaneamente.
3. **NÃO deletar o projeto Pages** — fica como rollback quente.

---

## 7. Fase 4 — Pós-migração

1. **Habilitar o A3 (600k)** — em `src/lib/auth.ts`:
   - Trocar `const PBKDF2_V2_ITERATIONS = 100_000;` por `600_000;`.
   - Reativar a migração no `isHashLegado` para re-hashar 100k→600k no próximo
     login (hoje está como `return !storedHash.startsWith(PBKDF2_V2_PREFIX);`;
     a versão com migração marca v2 abaixo do alvo como legado). Ver o comentário
     extenso no topo da seção de hashing em `auth.ts` (já documenta o trade-off
     Pages × Workers).
   - `derivarPBKDF2` aceita o iter por argumento; nenhum outro código muda.
   - Validar: `npx vitest run src/lib/__tests__/auth.test.ts` (ajustar os
     asserts que fixam `pbkdf2v2:100000:` para `600000`).
2. **Cron nativo (opcional):** mover `cleanup-retencao` de GitHub Actions para
   um **Cron Trigger** do Worker (`[triggers] crons = ["..."]` no wrangler +
   handler `scheduled`). Elimina a fragilidade descrita no `DEPLOY.md`.
3. Atualizar `DEPLOY.md` (Pages → Workers) e remover o `_headers` se os headers
   migrarem para regras do Worker (ver gotcha).

---

## 8. Rollback

Reapontar o **custom domain de volta para o projeto Pages** (que permanece
intacto e com histórico de deployments). Sem perda de dados — D1 e R2 são os
mesmos bindings/IDs. Janela de minutos.

---

## 9. Checklist de validação (staging e pós-cutover)

- [ ] Login matrícula+senha → 2FA por e-mail → sessão.
- [ ] Login por **Token A3** (certificado ICP-Brasil) — `/api/auth/certificado/*`.
- [ ] **Fail-closed A1:** conta sem e-mail recebe 403 (não 500).
- [ ] Assinatura **em tela** (avançada): rubrica + selfie + liveness + GPS + 2FA.
- [ ] Assinatura **com Token A3** (qualificada): preparar → SERPRO → finalizar.
- [ ] Página **`/validar/[hash]`** + download forense (autenticado).
- [ ] Verificação CAdES/OCSP/TSA não estoura CPU (rodar PDF com 2 assinaturas).
- [ ] Webhooks `/api/webhook/*` (sync-policiais) com `SYNC_TOKEN`.
- [ ] **Cache de assets** (`/face-api/*` immutable, `/init.js`) — ver gotcha `_headers`.
- [ ] Exportações XLSX/DOCX/PDF do histórico GISE.
- [ ] Cron de retenção (Action atual OU Cron Trigger novo) dispara e limpa.
- [ ] Secrets todos presentes (e-mail sai, OCSP/TSA funcionam, Sentry recebe).
- [ ] CPU time no Analytics dentro do esperado (com folga).

---

## 10. Gotchas específicos deste projeto

- **`_headers`:** é recurso nativo do Pages. O Workers Static Assets passou a
  suportar `_headers`/`_redirects` e o adapter v7 deve propagá-lo — **mas valide
  em staging** que o cache de `/face-api/*` (immutable, ~196 KB de modelos
  face-api) e `/init.js` continua aplicado. Se não aplicar, mova esses headers
  para regras no Worker (não dá para usar o `hooks.server.ts`, que só roda em
  rotas dinâmicas, não em assets servidos diretamente).
- **`[env.preview]` → `[env.staging]`:** o Pages dá preview deployments
  automáticos por branch/PR; no Workers isso vira *preview URLs / versions* — a
  mecânica de preview por PR muda (readequar se a equipe depende disso).
- **`nodejs_compat`:** MANTER — o projeto usa `node:crypto` (`timingSafeEqual`,
  `Buffer`) em auth, CSRF e verificação de assinatura.
- **Migrations no CI:** o passo `wrangler d1 migrations apply escalas-db --local`
  do `deploy.yml` continua igual.
- **Domínio único:** o cutover do custom domain é atômico (Pages OU Worker).
- **Staging escreve em staging:** garantir que `--env staging` usa
  `escalas-db-staging`/`escalas-docs-staging` antes de qualquer teste com dados.

---

## 11. Esforço e risco

- **Esforço:** ~1 dia (config + staging + validação); o cutover em si é minutos.
- **Risco:** concentrado em **domínio, preview e secrets** de produção,
  mitigado por manter o Pages como rollback quente.
- **Pré-requisito de decisão:** a Fase 0. Se o P99 estiver folgado e o único
  objetivo for o A3, o **pepper** entrega o ganho de segurança sem nada disso.

---

## Apêndice A — Contexto da auditoria de segurança (origem deste plano)

Esta migração nasceu do achado **A3** de uma auditoria do fluxo de login por
token e assinatura digital. Estado dos achados (todos os demais já em produção):

| # | Achado | Status |
|---|--------|--------|
| A1 | 2FA contornável sem e-mail | ✅ Fail-closed (sem e-mail ⇒ 403 "contate o administrador"; admin cadastra e-mail no painel; quem tem Token A3 loga por ele) |
| A2 | Liveness avaliado no cliente | ✅ Nível 0 — fronteira de garantia documentada |
| A3 | **PBKDF2 100k (< OWASP 600k)** | ⚠️ **Limitado pelo CPU do Pages — este plano (Workers) ou o pepper resolvem** |
| A4 | `arquivo_hash` vindo do cliente | ✅ Recalculado do PDF final |
| A5 | Janela de revogação do cache de sessão | ✅ TTL configurável via `SESSION_CACHE_TTL_SECONDS` |
| A6 | `innerHTML` no modal SERPRO | ✅ Construção de DOM segura |
| A7 | Bootstrap por env sem 2FA | ✅ Auditado no log (`login_bootstrap`); mitigação operacional documentada |
| A8 | CVEs de dependências | ✅ `dompurify` (override) + wrangler/miniflare atualizados; audit limpo |

### Pendências remanescentes (fora desta migração)
- **A3:** decidir entre **(a) pepper** (`pbkdf2v3` + HMAC com `PASSWORD_PEPPER`,
  custo de CPU ~zero, resolve o risco de brute-force offline sem migrar) ou
  **(b) esta migração** (600k literal + headroom geral). Não são exclusivos.
- **Documentos qualificados *antigos* na `/validar`:** assinaturas feitas antes
  do A4 mostram `hashConfere=false` (a verificação CAdES-LT em si continua
  válida). Opcional: script de reconciliação do `arquivo_hash`.

## Apêndice B — Referências de código

- Hashing/iterations + histórico do A3: `src/lib/auth.ts` (topo da seção
  "Hashing de senha", `PBKDF2_V2_ITERATIONS`, `derivarPBKDF2`, `isHashLegado`).
- Login/2FA/fail-closed/bootstrap: `src/lib/server/auth-flow.ts`.
- Verificação de assinatura (CPU-pesada): `src/lib/server/pdf-verification.ts`,
  `crypto-verify.ts`, `cades-finalizer.ts`, `ocsp.ts`, `tsa.ts`.
- Cache de sessão / TTL (A5): `src/lib/server/session-cache.ts`, `hooks.server.ts`.
- Deploy atual: `.github/workflows/deploy.yml`, `wrangler.toml`, `_headers`, `DEPLOY.md`.
- Testes do fail-closed (A1): `src/lib/server/__tests__/auth-flow.test.ts`.
