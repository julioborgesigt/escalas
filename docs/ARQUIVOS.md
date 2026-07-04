# Mapa de Arquivos do Projeto

Documento **vivo**: descreve o propósito de cada arquivo versionado do repositório, pasta por pasta.
Última revisão completa: **2026-07-04**. Ao criar/mover/remover arquivos relevantes, atualize a linha correspondente **no mesmo PR** (mesma convenção do `docs/README.md`).

No final há uma seção de **[achados de código morto e duplicado](#11-achados-código-morto-e-duplicado)** levantados com `knip` e `jscpd` + inspeção manual, para orientar limpezas futuras.

## Índice

1. [Raiz do projeto](#1-raiz-do-projeto)
2. [`.github/` — CI/CD e automações](#2-github--cicd-e-automações)
3. [`scripts/` — utilitários de operação](#3-scripts--utilitários-de-operação)
4. [`migrations/` — migrações do banco D1](#4-migrations--migrações-do-banco-d1)
5. [`e2e/` — testes end-to-end](#5-e2e--testes-end-to-end)
6. [`static/` — arquivos servidos como estáticos](#6-static--arquivos-servidos-como-estáticos)
7. [`docs/` — documentação](#7-docs--documentação)
8. [`src/` — raiz da aplicação](#8-src--raiz-da-aplicação)
9. [`src/lib/` — código compartilhado](#9-srclib--código-compartilhado)
10. [`src/routes/` — páginas e APIs](#10-srcroutes--páginas-e-apis)
11. [Achados: código morto e duplicado](#11-achados-código-morto-e-duplicado)

---

## 1. Raiz do projeto

### Documentação (ver detalhes em [`docs/README.md`](README.md))

| Arquivo | O que faz |
|---------|-----------|
| `README.md` | Visão geral do sistema: stack, setup local, arquitetura, módulos, RBAC, padrões de código, troubleshooting. Porta de entrada de qualquer dev. |
| `DEPLOY.md` | Runbook de produção: variáveis/secrets, papéis de admin, backup/rollback, staging, trust store ICP-Brasil, TSA, go-live. |
| `TESTING.md` | Roteiro de regressão manual (100+ casos) de todos os fluxos de negócio. |
| `CLAUDE.md` | Diretrizes de código para devs e agentes de IA: mapa da documentação, runes do Svelte 5 obrigatórias, padrão de erros de API (`$lib/server/api`). |

### Configuração de build e ferramentas

| Arquivo | O que faz |
|---------|-----------|
| `package.json` | Dependências e scripts npm (`dev`, `build`, `check`, `test`, `db:migrate*`, `users:*`, `lint*`, `knip`). Fixa Node ≥ 22 e `overrides` de segurança (cookie, esbuild, uuid, dompurify). |
| `package-lock.json` | Lockfile npm (gerado — nunca editar à mão). |
| `svelte.config.js` | Config do SvelteKit: adapter Cloudflare e, principalmente, a **CSP** das respostas HTML (nonces em scripts inline, `connect-src` liberando os WebSockets do Assinador SERPRO e o Sentry). |
| `vite.config.ts` | Config do Vite/Vitest: plugin Tailwind, `rollup-plugin-visualizer` (gera `bundle-stats.html`) e o **code splitting manual** (`face-api`, `pdf`, `office`, `charts`, `crypto`). |
| `wrangler.toml` | Config Cloudflare: bindings D1 (`escalas_db`) e R2 (`escalas_docs`), `nodejs_compat`, diretório de migrações e a var não-secreta `TSA_URL` (carimbo de tempo DigiCert). |
| `drizzle.config.ts` | Config do drizzle-kit: aponta o schema (`src/lib/server/schema.ts`) e a pasta de saída (`migrations/`), dialeto SQLite. |
| `tsconfig.json` | TypeScript em `strict`, estende o tsconfig gerado pelo SvelteKit. |
| `playwright.config.ts` | Config do Playwright: builda + serve preview na porta 4173, `e2e/global-setup.ts` como seed, só Chromium. |
| `eslint.config.js` | ESLint flat config (JS + typescript-eslint + eslint-plugin-svelte + prettier). |
| `.prettierrc` / `.prettierignore` | Formatação (tabs, single quotes, plugin Svelte) e pastas ignoradas (migrations, static, builds). |
| `knip.json` | Config do **knip** (detector de código/exports mortos): entry points `src/lib/db.ts`, `src/lib/db/gise/index.ts` e `scripts/`. Rode com `npm run knip`. |
| `.fallowrc.json` | Config da ferramenta **fallow** (análise de duplicação/deps não usadas), com `minOccurrences: 3` para clones. Ferramenta ad hoc — não está nas devDependencies. |
| `.npmrc` | `engine-strict=true` — falha `npm install` se o Node não satisfizer `engines`. |
| `.gitattributes` | Marca `*.ps1` como binário para preservar BOM UTF-8 (o PowerShell 5.1 corrompe acentos sem BOM). |
| `.gitignore` | Ignora builds, `.wrangler/`, `.dev.vars`, dumps e a **chave privada** do selo (`selo-institucional.key.pem`); o cert público é versionado. |
| `.env.example` | **Fonte autoritativa** de todas as variáveis de ambiente (~38 variáveis comentadas): tokens de webhook, pepper de senha, chaves de cifra de CPF, e-mail, Sentry, selo institucional, TSA etc. |
| `_headers` | Headers do Cloudflare Pages para estáticos: cache imutável de 1 ano para `/face-api/*`, 1h para `/init.js`, 1 dia para `robots.txt`. |
| `selo-institucional.cert.pem` | Certificado **público** (PEM) do selo institucional — versionado de propósito para conferência por terceiros. A chave privada vai só em secret (`SELO_INSTITUCIONAL_PEM`). |
| `Código.gs` | ⚠️ Google Apps Script **legado** (928 linhas) de um formulário externo de produtividade (tokens por e-mail, rascunhos, dashboard em planilha). **Nenhuma referência no repositório** — ver [seção 11](#11-achados-código-morto-e-duplicado). |
| `.vscode/settings.json` | Silencia o lint de at-rules desconhecidas do CSS (diretivas do Tailwind 4). |
| `.vscode/extensions.json` | Recomenda a extensão oficial do Svelte. |
| `.claude/settings.local.json` | Permissões locais de sessões antigas do Claude Code (caminhos Windows, scripts que já não existem). Ver [seção 11](#11-achados-código-morto-e-duplicado). |

## 2. `.github/` — CI/CD e automações

| Arquivo | O que faz |
|---------|-----------|
| `workflows/deploy.yml` | Pipeline principal (PR/push em `main`/`staging`): lint (ratchet), format check, svelte-check, vitest, build, guards de padrão (erros de API, permissão de documento), migrações locais + Playwright E2E e por fim `wrangler pages deploy` (staging → preview com D1/R2 dedicados). |
| `workflows/cleanup-retencao.yml` | Cron diário (04:17 UTC) que chama `/api/webhook/limpeza-retencao` com o `SYNC_TOKEN` — o Pages não tem cron nativo, então a limpeza LGPD (sessões/tokens/nonces expirados, audit_log vencido) é disparada daqui. |
| `workflows/backup-d1.yml` | Backup lógico diário do D1: `wrangler d1 export` → sanity check → gzip → **cifra com `age`** antes de sair do runner → upload no bucket R2 privado `escalas-backups`. Retenção/imutabilidade ficam no bucket. |
| `workflows/update-icp-brasil-trust-store.yml` | Cron mensal que baixa a cadeia oficial da ITI e, se raízes/intermediárias mudaram, abre um PR com o diff dos PEMs de `src/lib/server/icp-brasil/`. |
| `dependabot.yml` | Atualizações automatizadas de dependências npm e GitHub Actions (semanais, seg. 06:00 America/Fortaleza, máx. 5 PRs) + PRs de segurança para CVEs. |

## 3. `scripts/` — utilitários de operação

> Também documentados em [`scripts/README.md`](../scripts/README.md).

| Arquivo | O que faz |
|---------|-----------|
| `README.md` | Descreve cada script e o setup detalhado da integração Google Sheets / Base_Equipe. |
| `migrate.ts` | Runner de migrações do D1: executa em ordem só o que ainda não foi aplicado, registrando na tabela de controle `_migrations_aplicadas` (evita re-executar migração não-idempotente). Suporta `--remote`, `--staging`, `--baseline` (adoção única de banco já migrado). |
| `set-default-password-all-users.ts` | Define uma senha (via env `SET_PASSWORD`) para **todos** os usuários, marcando `primeiro_acesso=1` para forçar troca. Usa o mesmo `password-hash.ts` do app. |
| `clear-passwords-non-admins.ts` | Zera a senha de todos os policiais **preservando administradores** (via `wrangler d1 execute`). |
| `GoogleAppsScript_Sync.gs` | Apps Script **vigente** da planilha Google: menu "🚀 Sincronização D1" que envia policiais (`DB_SERVIDORES`) e unidades (`DB_UNIDADES`) aos webhooks (`SYNC_TOKEN` no `PropertiesService`), reset destrutivo com confirmação dupla e Web App que recebe a aba `Base_Equipe` do portal ao finalizar GISE. |
| `purgar-dump-historico.sh` | Script **destrutivo** (git-filter-repo) para expurgar o antigo `dump.sql` (PII real) de todo o histórico Git; exige força-push e re-clone geral. Só rodar seguindo o checklist do próprio arquivo. |
| `calc-policy-hash.ps1` | Baixa o PDF oficial da Política de Assinatura ICP-Brasil (PA-AD-RB), calcula o SHA-256 e imprime o valor para configurar `PA_AD_RB_HASH_HEX` em produção (sem ele o Validador ITI rejeita o `signaturePolicyId`). |

## 4. `migrations/` — migrações do banco D1

SQL gerado pelo Drizzle (nunca editar à mão — altere `src/lib/server/schema.ts` e gere de novo). `meta/_journal.json` e `meta/0000_snapshot.json` são metadados do drizzle-kit. Descrições inferidas do nome + schema:

| Arquivo | O que faz |
|---------|-----------|
| `0000_initial_schema.sql` | Schema inicial completo (policiais, escalas, sessões, unidades, GISE, documentos…). |
| `0001_lat_lng_real_normalize.sql` | Normaliza colunas de latitude/longitude para `REAL`. |
| `0002_auth_legacy_password_deadline.sql` | Prazo/controle para migração de hashes de senha legados. |
| `0003_gise_supervisao_extra_unidade.sql` | Unidade sintética de "supervisão extra" da GISE. |
| `0004_unidades_departamentos.sql` | Acrescenta departamentos à hierarquia de unidades. |
| `0005_supervisao_extra_para_departamento.sql` | Move a supervisão extra para o nível de departamento. |
| `0006_seed_departamento_supervisao_extra.sql` | Seed do departamento de supervisão extra. |
| `0007_gise_escalas_feriado.sql` | Flag de feriado em `gise_escalas`. |
| `0008_gise_breve_relatorio_textos.sql` | Colunas de título/textos do "Breve relatório" por escala GISE. |
| `0009_gise_planilha_base_equipe_alimentada.sql` | Flag de que a aba Base_Equipe já foi alimentada. |
| `0010_expandir_tipos_dois_fatores_tokens.sql` | Novos tipos de desafio 2FA (assinatura, reset, e-mail pessoal…). ⚠️ prefixo `0010` duplicado com a migração abaixo (funciona — o runner registra por nome — mas evite repetir numeração). |
| `0010_policiais_rubrica.sql` | Rubrica reutilizável do policial (imagem + consentimento). |
| `0011_gise_assessor_email_notificacao.sql` | E-mail de notificação do assessor GISE. ⚠️ prefixo `0011` duplicado. |
| `0011_gise_presenca_termos.sql` | Tabela de termos de presença GISE (Token A3). |
| `0012_signature_verification_metadata.sql` | Metadados de verificação CAdES (OCSP, TST…) nos documentos. |
| `0013_termos_uso.sql` | Tabela `aceites_termos` (aceite do termo de uso). |
| `0014_fds_finalizada.sql` | Finalização de escala FDS. |
| `0015_fds_email_envio.sql` | E-mail de envio da escala FDS. |
| `0016_escala_solicitacoes_assinatura.sql` | Solicitações de assinatura de escala por unidade/respondência. |
| `0017_anonimizar_ips_historico.sql` | Anonimiza IPs já gravados (LGPD). |
| `0018_lgpd_retencao_config.sql` | Chaves de configuração de retenção de dados. |
| `0019_lgpd_incidentes.sql` | Tabela de incidentes LGPD. |
| `0020_lgpd_solicitacoes.sql` | Tabela de solicitações de titulares (art. 18). |
| `0021_lgpd_granular_consent.sql` | Consentimento granular (ex.: rubrica). |
| `0022_recovery_attempts.sql` | Tabela de rate-limit dos fluxos de recuperação de senha. |
| `0023_escala_solicitacoes_assinatura_fks.sql` | FKs da tabela de solicitações de assinatura. |
| `0024_webhook_nonces.sql` | Nonces de webhook (replay protection). |
| `0025_user_agent_raw.sql` | Coluna de user-agent bruto (evidência). |
| `0026_aceite_termo_snapshot.sql` | Snapshot do texto do termo aceito. |
| `0027_aceite_assinatura_avancada.sql` | Aceite específico da assinatura avançada. |
| `0028_login_certificado.sql` | Estruturas do login por certificado A3 (desafios/nonces). |
| `0029_login_attempts_identifier.sql` | Identificador (matrícula/login) em `login_attempts`. |
| `0030_escala_policiais_policial_data_idx.sql` | Índice em `escala_policiais (policial, data)`. |
| `0031_policiais_cpf_index.sql` | Índice cego de CPF (`cpf_index`, HMAC) para lookup do cert-login. |
| `0032_admin_geral_vinculado.sql` | Vínculo Admin Geral ↔ policial. |
| `0033_audit_forense.sql` | Trilha de auditoria forense (`audit_log` com cadeia de hash). |

## 5. `e2e/` — testes end-to-end

| Arquivo | O que faz |
|---------|-----------|
| `global-setup.ts` | Seed do D1 local antes dos specs: aplica migrações e cria a `FIXTURE` (2 unidades, 2 policiais com senha conhecida, 1 escala + documento assinado). Reusa `password-hash.ts` e o hash do termo do próprio app. |
| `auth.spec.ts` | Login: redirect para `/login`, formulário visível, erro com credencial inválida etc. |
| `assinatura-validacao.spec.ts` | Lado de **verificação** do ciclo de assinatura: página pública `/validar/[hash]` e gating do download do PDF íntegro (401 para anônimo — o manifesto forense tem PII). |
| `escalas-cross-lotacao.spec.ts` | Regressão P0.1: usuário de outra lotação **não** pode baixar documento assinado de escala alheia (`verificarPermissaoEscala`). |

## 6. `static/` — arquivos servidos como estáticos

| Arquivo | O que faz |
|---------|-----------|
| `init.js` | Boot script síncrono no `<head>`: aplica a classe `.dark` conforme tema salvo/preferido antes da hidratação (evita FOUC). Está em arquivo próprio (não inline) para a CSP poder viver sem `unsafe-inline`. |
| `favicon.svg` | Favicon do site. |
| `robots.txt` | Política para crawlers. |
| `face-api/README.md` | Explica que os modelos são copiados de `@vladmandic/face-api` e servidos localmente (CSP + sem rate-limit de CDN), e como atualizá-los. |
| `face-api/tiny_face_detector_model.*` | Modelo de detecção de rosto (manifest JSON + pesos binários). |
| `face-api/face_landmark_68_model.*` | Modelo de 68 pontos faciais (usado no liveness de virar o rosto). |
| `face-api/face_expression_model.*` | Modelo de expressões (usado no challenge de sorriso). |

## 7. `docs/` — documentação

> O índice canônico, com a distinção documento vivo × registro histórico, é o [`docs/README.md`](README.md). Resumo:

| Arquivo | O que faz |
|---------|-----------|
| `README.md` | Índice de toda a documentação. |
| `ARQUIVOS.md` | **Este documento** — mapa arquivo-a-arquivo do repositório. |
| `QA_ASSINATURA_A3_DESKTOP.md` | Roteiro de QA manual do fluxo de presença GISE por Token A3 (exige Assinador SERPRO + token físico; não roda em CI). |
| `MIGRACAO-WORKERS.md` | Avaliação Pages→Workers — **arquivada** (o achado que a motivava foi resolvido pelo `PASSWORD_PEPPER`). |
| `auditorias/AUDITORIA_GERAL_2026-06-28.md` | Auditoria geral mais recente (segurança, código, banco, dependências, CI, LGPD). |
| `auditorias/LGPD_AUDIT.md` / `LGPD_REMEDIATION_PLAN.md` | Auditoria de conformidade LGPD e plano de remediação (mai/2026; majoritariamente implementado). |
| `auditorias/SIGNATURE_HARDENING.md` | Sessão de endurecimento das assinaturas digitais (16 achados) + ações de go-live. |
| `auditorias/ANALISE_JURIDICA_ASSINATURAS.md` | Parecer técnico-jurídico assinatura avançada × qualificada (Lei 14.063/2020, MP 2.200-2). |
| `auditorias/AUDITORIA_PERFORMANCE_UX.md` | Auditoria de performance/UX (3 fases implementadas). |
| `auditorias/AUDITORIA_VISUAL.md` | Auditoria de consistência visual (tipografia, ícones, tokens). |
| `auditorias/skeleton_audit_final.md` | Consolidação final das auditorias de aproveitamento do Skeleton UI v4. |
| `auditorias/SKELETON_AUDIT.md` / `SKELETON_DEEP_AUDIT.md` | ⚠️ Supersedidas — mantidas por rastreabilidade. |

## 8. `src/` — raiz da aplicação

| Arquivo | O que faz |
|---------|-----------|
| `app.html` | Template HTML raiz: fontes self-hosted, `/init.js` no head, `data-theme="policial"`, preload por hover. |
| `app.css` | CSS global: imports do Tailwind 4 + fontes Inter/Outfit (subsets latinos) + Skeleton + `theme.css`; fundo "premium" do dark mode. |
| `theme.css` | Tokens do tema Skeleton `policial` (cores, tipografia Inter/Outfit, raios, espaçamentos). |
| `app.d.ts` | Tipos globais: interface `Env` com **todos os bindings/secrets** documentados (D1, R2, EMAIL, SYNC_TOKEN, PASSWORD_PEPPER, chaves de CPF…), `App.Locals` (usuário da sessão), `App.Platform`. |
| `hooks.server.ts` | Middleware global de TODAS as requisições: contexto AsyncLocalStorage, Sentry, validação de sessão (com cache edge), gate de rotas públicas × autenticadas, redirect de primeiro acesso/termo, **CSRF double-submit** em métodos mutantes de `/api/*`, headers de segurança/CSP para respostas não-HTML e `handleError` com `errorId` rastreável. |
| `hooks.client.ts` | Captura de erros JS no navegador via Sentry (`PUBLIC_SENTRY_DSN`), carregado dinamicamente pós-hidratação com fila para erros precoces. |

## 9. `src/lib/` — código compartilhado

### 9.1 Raiz de `src/lib`

| Arquivo | O que faz |
|---------|-----------|
| `auth.ts` | Núcleo de autenticação/RBAC: tipo `UsuarioLogado`, helpers `isAdminGeral/Seccional/Unidade/AnyAdmin`, criação/validação/exclusão de sessão (TTL 8h), geração de token, 2FA por e-mail (criar/verificar desafio), tokens de redefinição de senha, comparação timing-safe. Re-exporta o hash de senha de `crypto/password-hash`. |
| `api-fetch.ts` | `apiFetch<T>()` — wrapper de `fetch` para o cliente com tratamento padrão de erro/JSON. |
| `csrf.ts` | Helpers CSRF do **cliente**: nomes do cookie/header e `csrfHeaders()` que todo fetch mutante para `/api/*` deve incluir. |
| `db.ts` | Fachada da camada de dados: re-exporta tudo de `src/lib/db/*` para manter os imports `from '$lib/db'` estáveis. |
| `enhance-handler.ts` | `makeEnhanceHandler()` — fábrica de `SubmitFunction` (use:enhance) padronizando flag de progresso, `invalidate`, toasts e callback de sucesso; evita ~30 repetições da mesma boilerplate. |
| `export-charts.ts` | Exporta gráficos Chart.js e rankings como PNG (canvas off-screen com header/footer padronizados); usado no dashboard de produtividade. |
| `liveness-challenge.ts` | Liveness **ativa** (challenge-response) com face-api: sorteia um desafio (`head_turn`, `smile`) e detecta seu cumprimento em janela curta — barra foto/vídeo pré-gravado na selfie da assinatura. |
| `loading.svelte.ts` | Estado global de loading (overlay) em runes — `loading.show()/hide()`. |
| `logger.ts` | Logger estruturado JSON (browser e worker), compatível com Cloudflare Logs. |
| `rotacao.ts` | Cálculo de rotação de plantão 1x3 e 2x6: detecta o padrão dos dias, projeta o mês seguinte, helpers de mês/dia. ⚠️ contém `calcularDataSaida` duplicada de `utils.ts` (ver seção 11). |
| `serpro.ts` | Cliente WebSocket do **Assinador SERPRO Desktop**: descoberta de porta (65166/65156/65500), listagem de certificados, assinatura de hash e fluxo de login por certificado. |
| `toast.ts` | Instância única do toaster do Skeleton. |
| `types.ts` | Tipos de domínio compartilhados entre páginas (linhas de listagem res-gise, `EscalaListagem`, config de perguntas GISE…). |
| `utils.ts` | Utilitários genéricos: formatação de data/CPF/telefone, `normalizarTexto`, `calcularDataSaida`, máscaras de PII (`mascararNome/CPF/Email`), `getNowBR()`. |
| `utils/localStorage.ts` | `getSavedFilters()` — restaura filtros de tela salvos no localStorage com defaults. |
| `constants/cidades.ts` | Lista estática das cidades do Ceará (selects de formulário). |
| `assets/favicon.svg`, `assets/logo.png` | Ícone e logotipo institucionais importados por componentes. |

### 9.2 `src/lib/crypto/` — criptografia pura (sem dependência de $lib/$env)

| Arquivo | O que faz |
|---------|-----------|
| `password-hash.ts` | Hash de senha PBKDF2 (100k iterações) com **pepper** HMAC opcional; formatos `pbkdf2v1/v2/v3`, verificação retro-compatível e detecção de hash legado. Módulo puro reutilizado por app, scripts e e2e (achado C6). |
| `cpf-cripto.ts` | Cifra de CPF em repouso (LGPD): AES-256-GCM (`enc:v1:…`) + índice cego determinístico HMAC (`cpf_index`) para lookup do login por certificado; helpers para preparar/decifrar CPF no fluxo do banco. |
| `field-cripto.ts` | Cifra genérica de campos sensíveis (mesmo envelope AES-GCM, sem normalização de domínio) — ex.: IP completo do audit log, recuperável só em perícia. |
| `hex.ts` | Conversões hex ↔ bytes sem dependências (compartilhado app + scripts; achado C7). |
| `bin.ts` | `binStringToBytes()` — converte "binary string" do node-forge para `Uint8Array`. |
| `__tests__/cpf-cripto.test.ts` / `__tests__/field-cripto.test.ts` | Testes de round-trip, formato do envelope e chaves inválidas. |

### 9.3 `src/lib/schemas/` — validação Zod

| Arquivo | O que faz |
|---------|-----------|
| `index.ts` | Barrel — re-exporta todos os schemas. |
| `auth.ts` | Login, 2FA, reenvio de código, primeiro acesso, solicitação/confirmação de redefinição, verificação de e-mail pessoal, login por certificado, alterar senha. |
| `escala.ts` | Criação/edição de escala e associação policial↔escala. |
| `policial.ts` / `policial-search.ts` | Cadastro/edição de policial e query da busca paginada. |
| `unidade.ts` | Cadastro de unidade. |
| `config.ts` | Flags de configuração de assinatura. |
| `gise.ts` | Assinatura GISE, params de rota, download e query de export do histórico. |
| `gise-respostas-form.ts` (+ `.test.ts`) | Parse tolerante/estrito do JSON de respostas do formulário GISE. |
| `assinatura-pdf.ts` | Schemas dos endpoints de assinatura de PDF (preparar/finalizar/simples, presença) — blindam contra NaN, coordenadas fora de faixa e payloads gigantes. |
| `lgpd.ts` | Incidentes e solicitações LGPD (limites de tamanho, enums, bloqueio de mass-assignment). |
| `__tests__/schemas.test.ts` / `__tests__/lgpd.test.ts` | Testes dos schemas. |

### 9.4 `src/lib/composables/` — lógica reativa reutilizável (Svelte 5)

| Arquivo | O que faz |
|---------|-----------|
| `index.ts` / `gise/index.ts` | Barrels. |
| `useAssinaturaEscala.svelte.ts` | Estado e fluxo de assinatura de escala (simples + SERPRO): painéis, download do PDF, callbacks. |
| `useGiseAssinatura.svelte.ts` | Todos os fluxos de assinatura da página GISE detalhada: modal de rubrica, assinatura simples, token SERPRO (escala + relatórios) e lote de relatórios. |
| `useGiseEstado.svelte.ts` | Estados derivados/permissões/formatação da página GISE detalhada. |
| `gise/useGiseSeccionalActions.svelte.ts` | Os 11 fluxos CRUD do card de seccional GISE (equipes, membros, unidades-slot, vagas/horários, remoção com confirmação). |
| `useAutorizacao.svelte.ts` | Helpers de autorização no cliente (papel do usuário logado). |
| `useCharts.svelte.ts` | Ciclo de vida de gráficos Chart.js (criação, destruição de instâncias antigas, updates). |
| `useConfirmationDialog.svelte.ts` | Diálogo de confirmação genérico (abrir com item, confirmar/fechar). |
| `useMultiSelect.svelte.ts` | Seleção múltipla (toggle, selectAll, contagem). |
| `useMobile.svelte.ts` | Detecção reativa de dispositivo móvel. |
| `useScrollLock.svelte.ts` | Trava o scroll do body com contador (modais aninhados) e compensa a barra de rolagem. |

### 9.5 `src/lib/components/` — componentes Svelte reutilizáveis

| Arquivo | O que faz |
|---------|-----------|
| `PainelAssinaturaEscala.svelte` | Casca que escolhe entre `PainelAssinaturaFDS` (fluxo FDS) e `PainelAssinaturaDigital` conforme o tipo da escala. |
| `PainelAssinaturaDigital.svelte` | Painel completo de assinatura de escala: status do documento, assinatura avançada em tela (SignaturePad), token A3, download/revogação. |
| `PainelAssinaturaFDS.svelte` | Fluxo FDS: finalizar escala, enviar por e-mail (destinatário padrão DPIS), desfinalizar. |
| `PainelAssinaturaToken.svelte` | Assinatura qualificada via **Assinador SERPRO**: prepara no servidor, assina o hash no token, finaliza e baixa o PDF; expõe `control` imperativo para o pai. |
| `SignaturePad.svelte` | Captura de evidências da assinatura **avançada**: rubrica desenhada, selfie com **liveness challenge** (face-api), GPS e código 2FA por e-mail, conforme flags. |
| `SignaturePadTypes.ts` | Tipos do payload de confirmação do SignaturePad (rubrica, GPS, selfie, liveness). |
| `RubricaCanvas.svelte` | Primitivo de desenho de rubrica que exporta PNG **transparente** recortado (compartilhado pelo cadastro de rubrica). |
| `ModalCadastrarRubrica.svelte` | Cadastro da rubrica reutilizável (desenhar ou foto da assinatura em papel com recorte/remoção de fundo client-side; consentimento LGPD explícito). |
| `SearchableSelect.svelte` | Combobox com busca assíncrona/debounce (Skeleton) usado nas buscas de policiais/unidades. |
| `PaginationControls.svelte` | Barra de paginação padrão (Skeleton Pagination + contadores). |
| `LoadingOverlay.svelte` | Overlay global de loading (com deslocamento opcional do sidebar). |
| `Spinner.svelte` | Spinner circular pequeno (Progress do Skeleton). |
| `SkeletonCard.svelte` | Placeholder de carregamento em forma de card. |
| `CodigoTimer.svelte` | Contagem regressiva do código 2FA com botão de reenviar. |
| `FloatingRefresh.svelte` | Botão flutuante mobile que chama `invalidateAll()`. |
| `IconTooltip.svelte` | Tooltip padronizado para ícones. |

### 9.6 `src/lib/db/` — camada de acesso a dados (Drizzle)

| Arquivo | O que faz |
|---------|-----------|
| `core.ts` | `getDB()` (Drizzle sobre D1), `getR2()`, `hasR2()` — entry points dos bindings. |
| `policiais.ts` | Queries de policiais: listagem/busca (com escopo), criar/atualizar/upsert/excluir, promoção de papel, rubrica do assinante. |
| `unidades.ts` | CRUD de unidades e consultas da hierarquia (seccionais). |
| `escalas.ts` | Escalas e `escala_policiais`: listar/criar/excluir, marcar visto, finalizar/desfinalizar FDS, adicionar múltiplas datas/todos os policiais, solicitações de assinatura. |
| `documentos.ts` | Documentos assinados de escala: salvar/buscar/excluir, busca por hash de verificação; metadados CAdES. |
| `configuracoes.ts` | Tabela chave-valor `configuracoes`: flags de assinatura, provedor de e-mail padrão, chaves de retenção LGPD. |
| `audit.ts` | Trilha de auditoria forense: catálogo central de ações (rótulo/categoria/severidade), ator×alvo×resultado, IP anonimizado + cifrado, **cadeia de hash** anti-adulteração, consulta paginada e resumo. |
| `admin-vinculado.ts` | Vínculo Admin Geral ↔ policial (promoção/despromoção e checagem). |
| `termos.ts` | Registros de aceite do termo de uso (o texto vigente vive em código). |
| `lgpd-incidentes.ts` | CRUD de incidentes de segurança/LGPD. |
| `lgpd-solicitacoes.ts` | Solicitações de titulares (art. 18): criar, listar (admin e próprio usuário), responder. |
| `lgpd-retencao.ts` | Limpeza de retenção: carrega prazos configurados, executa expurgo (sessões, tokens, tentativas, nonces, audit_log) e avalia a saúde da última execução. |
| `__tests__/audit.test.ts`, `audit-forense.test.ts`, `lgpd-retencao.test.ts` | Testes de canonicalização/hash da auditoria e do expurgo. |

#### `src/lib/db/gise/` — sub-módulo GISE

| Arquivo | O que faz |
|---------|-----------|
| `index.ts` | Barrel do sub-módulo. |
| `types.ts` | Tipos compostos (`GiseDetalhado`, equipes com membros, slots de unidade). |
| `escalas.ts` | Re-exporta os 4 módulos de escalas abaixo. |
| `escalas-crud.ts` | Buscar/criar/atualizar GISE, buscar a ativa, reabrir, **clonar para a próxima data**. |
| `escalas-detalhado.ts` | Listagem e o agregado `buscarGiseDetalhado` (seccionais → equipes → membros → presenças/assinaturas) que alimenta a página `/gise/[id]`. |
| `escalas-status.ts` | Máquina de estados: verificação de completude, saída completa por seccional, sincronização de status após presenças/relatórios, promoção para "pronta para finalizar". |
| `escalas-papel.ts` | Flags de papel na GISE ativa (supervisor/membro/supervisão) usadas no menu. |
| `seccionais.ts` | CRUD de seccionais da GISE, unidades-slot e revogação de assinaturas da seccional. |
| `equipes.ts` | CRUD de equipes (operacional/SEINT) e verificação de slots DPC/OIP. |
| `membros.ts` | Adicionar/remover membro e as verificações de **conflito de horário** entre GISEs e com escalas. |
| `presencas.ts` | Entrada/saída de presença (GPS, selfie, rubrica). |
| `respostas.ts` | Modelo de formulário (perguntas) e respostas de produtividade: buscar/salvar por policial/equipe, agregações por seccional e listagem geral. |
| `assinaturas.ts` | Assinaturas de relatórios extraordinários e termos de presença (evidências). |
| `documentos.ts` | PDFs assinados da GISE (R2 + metadados). |
| `participacao.ts` | Resolve no **servidor** o vínculo e horário previsto de um policial na GISE (validação do fluxo Token A3). |
| `planilha-base-equipe-dados.ts` | Colunas/linhas da aba `Base_Equipe` (sem `$env`, para reuso no download XLSX). |
| `base-equipe.ts` | Query dos membros no formato da planilha Base_Equipe. |
| `vagas-padrao.ts` | Vagas padrão por equipe (config do supervisor). |

### 9.7 `src/lib/server/` — backend puro (nunca importar no cliente)

#### Infra de requisição, segurança e observabilidade

| Arquivo | O que faz |
|---------|-----------|
| `api.ts` | Helpers padrão de API: enum `ErrorCode`, `apiError()` e atalhos (`badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `rateLimited`, `serverError` com `errorId`), guards `requireAuth/Admin/SuperAdmin`, `validateBody` (Zod) e `contentDisposition`. **Todo endpoint deve usar isto** (ver CLAUDE.md). |
| `csrf.ts` | Geração do token CSRF (lado servidor do double-submit). |
| `csp.ts` | CSP manual para respostas **não-HTML** (a CSP de HTML fica no `svelte.config.js`). |
| `logger.ts` | Re-export do logger estruturado para uso em código server-only. |
| `request-context.ts` | `AsyncLocalStorage` com o contexto da requisição (request_id etc.) acessível em qualquer camada. |
| `sentry.ts` | Integração Sentry Cloudflare: `withSentryRequest` e `beforeSend` que **sanitiza PII** de URLs/tags. |
| `platform.ts` | Cast tipado dos bindings Cloudflare (`getR2` tolerante que retorna `undefined`). ⚠️ duplica semântica de `db/core.getR2` (ver seção 11). |
| `app-origin.ts` | Origem canônica para links de e-mail (`APP_ORIGIN` > `url.origin`) — defesa contra host-header injection. |
| `schema.ts` | **Fonte de verdade do banco**: todas as tabelas Drizzle (policiais, escalas, sessões, unidades, documentos, GISE completo, aceites, LGPD, auditoria) e seus tipos inferidos. |
| `session-cache.ts` | Cache edge (Cache API, TTL 60s) da sessão validada + aceite do termo — poupa 2 idas ao D1 por request autenticado; logout invalida explicitamente. |
| `auth-flow.ts` | Fluxo único de login (form e API JSON): rate-limit por IP/identificador, auditoria, migração de hash legado, opções de cookie e disparo do 2FA. |
| `cert-login.ts` | Verificação criptográfica do desafio-resposta do **login por Token A3** (prova de posse da chave privada, não só do certificado público). |
| `recovery-rate-limit.ts` | Rate-limit isolado dos fluxos de recuperação de senha (não infla `login_attempts`). |
| `webhook-auth.ts` | Autenticação dos webhooks: Bearer `SYNC_TOKEN` ou HMAC `X-Hub-Signature-256`, comprimento mínimo do segredo e **replay protection** por nonce+timestamp. |
| `email.ts` | Envio de e-mail com provedor padrão configurável (binding Cloudflare `EMAIL` ou Resend) e **fallback automático**; templates de 2FA, redefinição, primeiro acesso, escala FDS e aviso ao assessor GISE. |
| `cfg-ass-cache.ts` | Flags de configuração de assinatura em cache edge (TTL 5 min) — decisão exclusiva do servidor (antes era cookie editável pelo cliente). |
| `gise-papel-cache.ts` | Cache edge (60s) do papel GISE por policial para o menu lateral, com invalidação explícita nas mutações. |

#### Permissões e regras de domínio

| Arquivo | O que faz |
|---------|-----------|
| `escala-permissao.ts` | `verificarPermissaoEscala` — quem pode ver/operar uma escala (lotação, papel, solicitação de assinatura). |
| `gise-permissao.ts` | Permissões sobre uma GISE (admin participante, supervisor…). |
| `policial-permissao.ts` | Escopo administrativo sobre o cadastro de policiais (`lotacoesAdministradas`: geral = irrestrito; seccional = sua seccional; unidade = sua lotação). |
| `escala-conflict.ts` | Choque de horário global entre TODAS as escalas (plantão/expediente/FDS/GISE), individual e em lote. |
| `gise-supervisao-extra.ts` | Resolução server-side da unidade sintética de "supervisão extra" (relatórios do quadro de supervisão). |
| `gise-base-equipe-sync.ts` | Envio pós-finalização da GISE para a planilha Google (aba Base_Equipe) via webhook assinado; falha não bloqueia a finalização. |
| `gise-assessor-notificacao-text.ts` | Texto plano/HTML do aviso ao assessor quando uma seccional envia a GISE. |
| `breve-relatorio-env.ts` | Merge das chaves de configuração do "Breve relatório" (banco → defaults). |
| `signature-level.ts` | Fonte única da classificação **SIMPLES × AVANÇADA** (Lei 14.063/2020): requisitos sempre ativos, obrigatórios e reforços; rótulos e base legal. Mudança aqui exige revisão jurídica. |

#### Assinatura digital e PDFs

| Arquivo | O que faz |
|---------|-----------|
| `pdf-signing.ts` | Barrel de `pdf-signing-prepare` + `pdf-signing-visual`. |
| `pdf-signing-prepare.ts` | Preparação/finalização da assinatura: placeholder PKCS#7 no PDF, extração de dados do certificado, estampa da rubrica, embed do CMS do SERPRO/WebPKI. |
| `pdf-signing-visual.ts` | Elementos visuais: rodapé simples, rodapé universal com QR e a **página de manifesto/auditoria** (evidências). |
| `server-seal.ts` | **Selo institucional** (assinatura avançada com certificado da instituição): sela o PDF com CMS real autocontido; carrega o par de chaves de `SELO_INSTITUCIONAL_PEM`; verificação do selo. |
| `cades-finalizer.ts` | Pós-assinatura compartilhado pelos endpoints `finalizar-assinatura`: verificação criptográfica do CMS, OCSP, carimbo de tempo, montagem dos metadados CAdES-LT. |
| `signature-service.ts` | Orquestração **unificada** da finalização (escala, GISE, relatórios): validação CPF do token × usuário, flags de evidência, chamada do finalizer — consolidação que eliminou drift entre 6 endpoints. |
| `cms-tst.ts` | Insere o `TimeStampToken` RFC 3161 como unsigned attribute do CMS sem invalidar a assinatura RSA. |
| `tsa.ts` | Cliente TSA RFC 3161 (carimbo do `signatureValue` via `TSA_URL`). |
| `ocsp.ts` | Cliente OCSP mínimo (RFC 6960) em node-forge: monta a request DER, parseia a resposta, valida com allowlist de URLs (anti-SSRF) e guarda o snapshot para reauditoria offline. |
| `pades-lt.ts` | PAdES-LT: anexa o Document Security Store (certificados + OCSP + CRLs) ao PDF via incremental update — validação offline no Adobe/ITI. |
| `pdf-verification.ts` | Verificação completa da assinatura: byte-range/integridade, RSA/ECDSA dos SignedAttributes, cadeia ICP-Brasil, TST, política e OCSP carimbado. |
| `crypto-verify.ts` | Verificação multi-algoritmo do CMS (PKCS#1 v1.5, RSASSA-PSS, ECDSA P-256/384/521) — suporta tokens A3 modernos. |
| `icp-policy.ts` | Identidade da Política de Assinatura ICP-Brasil PA-AD-RB v2.3 (OIDs, hash) compartilhada entre assinar e verificar. |
| `icp-brasil/trust-store.ts` | Carrega raízes/intermediárias ICP-Brasil inlinadas no bundle (`?raw`) para o node-forge; modo fail-open/closed configurável. |
| `icp-brasil/roots.pem` / `intermediates.pem` | Os PEMs da cadeia ICP-Brasil (atualizados pelo workflow mensal). |
| `icp-brasil/update-trust-store.sh` / `.ps1` | Scripts (Linux/Windows) que baixam a cadeia da ITI e regeneram os PEMs. |
| `icp-brasil/README.md` | O que é o trust store e como/quando atualizar. |
| `document-utils.ts` | Utilitários de documento: hash SHA-256 de buffer, parse de user-agent, rótulos do tipo de carimbo de tempo. |
| `conferencia-pdf.ts` | Gera o **rascunho** (PDF sem manifesto forense) usado nas cópias de conferência de escala e GISE. |
| `copia-conferencia.ts` | Política da cópia de conferência (minimização de PII): quem pode baixar o forense íntegro × cópia regenerada com rodapé + QR para `/validar`. |
| `selfie-upload.ts` | Upload defensivo de selfie para o R2: magic bytes, limite 5 MB, chave namespaced. |
| `gise-termo-presenca.ts` | Gera o "Termo de Confirmação de Presença" (1 página) para assinatura por Token A3. |
| `gise-logos.ts` | Carrega os logos institucionais GISE do R2 (best-effort). |
| `audit-pdf.ts` | PDFs da trilha de auditoria: relatório tabular e comprovante detalhado de um evento (campos forenses + cadeia de hash). |

#### Exportação de documentos

| Arquivo | O que faz |
|---------|-----------|
| `export.ts` | Barrel dos três formatos. |
| `export-pdf.ts` | Todos os PDFs (jsPDF + autotable): escala expediente/plantão, GISE diária, relatório de produtividade e relatórios extraordinários (seccional e supervisão). Maior arquivo do server (~1,6k linhas). |
| `export-xlsx.ts` | Planilhas de escala (ExcelJS). |
| `export-docx.ts` | Documentos Word de escala (docx). |
| `export-shared.ts` | Formatação compartilhada dos três: horários, agrupamento por data, colunas/linhas de expediente e plantão. |
| `gise-xlsx-workbook-append.ts` | Workbook XLSX do download por GISE (aba Base_Equipe + uma por seccional), com append de várias GISEs (histórico). |

#### Termo de uso

| Arquivo | O que faz |
|---------|-----------|
| `termo/termo-vigente.ts` | Texto **vigente** do termo de uso em código (versão, data, HTML) + hash — qualquer mudança exige reaceite de todos. |
| `termo/sanitize.ts` | Sanitizador whitelist do HTML do termo (defesa em camadas antes do `{@html}`). |
| `termo/__tests__/sanitize.test.ts` | Testes do sanitizador. |

#### Testes (`src/lib/server/__tests__/`)

Cobrem principalmente a cadeia de assinatura e autenticação. Por arquivo:

| Arquivo | O que testa |
|---------|-------------|
| `auth-flow.test.ts` | Rate-limit, cookies e caminhos do login unificado. |
| `cert-login.test.ts` | Desafio-resposta do login por certificado (anti-bypass). |
| `verificar-desafio-2fa.test.ts` | Verificação do código 2FA (expiração, tentativas). |
| `cades-finalizer.test.ts` / `cms-tst.test.ts` / `tsa.test.ts` | Finalização CAdES, inserção de TST no CMS e cliente TSA. |
| `crypto-verify.test.ts` / `pdf-verification-tst.test.ts` | Verificação multi-algoritmo e do carimbo de tempo (usa a fixture `fixtures/digicert-tst.b64`). |
| `pdf-signing-prepare.test.ts` / `pdf-signing-ber.test.ts` / `der-length.test.ts` / `pdf-byterange-coverage.test.ts` | Preparação do placeholder, parsing BER/DER e cobertura do byte-range. |
| `icp-policy.test.ts` / `icp-crypto-policy.test.ts` | OIDs/hash da política de assinatura e política criptográfica. |
| `ocsp.test.ts` / `ocsp-ssrf.test.ts` | Cliente OCSP e allowlist anti-SSRF. |
| `server-seal.test.ts` | Selo institucional (selagem/verificação). |
| `signature-level.test.ts` | Classificação simples × avançada. |
| `escala-permissao.test.ts` / `gise-permissao.test.ts` | Guardas de permissão. |
| `gise-termo-presenca.test.ts` | Geração do termo de presença. |
| `copia-conferencia.test.ts` | Política de download forense × conferência. |
| `saida-completa-seccional.test.ts` | Regra de saída completa da seccional GISE. |
| `solicitacao-dpc.test.ts` | Acesso concedido por solicitação de assinatura (DPC). |
| `selfie-upload.test.ts` | Validações do upload de selfie. |
| `sentry.test.ts` | Sanitização de PII no `beforeSend`. |
| `webhook-auth.test.ts` | Bearer/HMAC e replay protection dos webhooks. |

#### Testes (`src/lib/__tests__/`)

| Arquivo | O que testa |
|---------|-------------|
| `auth.test.ts` | PBKDF2/pepper, sessões, tokens e 2FA. |
| `security.test.ts` | CSRF, headers de segurança, rotas públicas. |
| `api-guards.test.ts` / `api-helpers.test.ts` | Guards (`requireAuth/Admin`) e helpers de erro da API. |
| `liveness-challenge.test.ts` | Sorteio e detecção dos challenges de liveness. |
| `utils.test.ts` | Utilitários de formatação/máscara. |

### 9.8 `src/lib/gise/` e `src/lib/produtividade/` — regras de negócio compartilháveis com o cliente

| Arquivo | O que faz |
|---------|-----------|
| `gise/gise-formatters.ts` | Rótulos/cores de status e formatação de datas da GISE. |
| `gise/gise-horarios.ts` | Validação/normalização de horários HH:MM e detecção de sobreposição. |
| `gise/gise-page-helpers.ts` (+ `.test.ts`) | Helpers puros da página GISE: tipos de equipe por seccional, membros, checagem de rubricas completas, cores por seccional, filtros de unidades. |
| `gise/gise-supervisao-extra.ts` | Constantes e regras da "supervisão extra" no lado compartilhado (rubricas, faltantes, marcador de rodagem). |
| `gise/breve-relatorio.ts` | Títulos/textos padrão do bloco "Breve relatório" dos PDFs de extra e resolução da precedência (escala → config → default). |
| `produtividade/index.ts` | Barrel. |
| `produtividade/questions.ts` | Mapeia o modelo cru de perguntas GISE em perguntas processadas (tipos, cores, chaves). |
| `produtividade/stats.ts` | Estatísticas agregadas e ranking a partir das respostas de produtividade. |

## 10. `src/routes/` — páginas e APIs

### 10.1 Raiz e infraestrutura de rota

| Arquivo | O que faz |
|---------|-----------|
| `+layout.svelte` | Layout raiz (~1k linhas): sidebar/menu por papel e módulo (escalas × GISE), tema claro/escuro, toaster, overlay global e navegação mobile. |
| `+layout.server.ts` | Load global: usuário logado, flags de assinatura (cache edge) e papéis GISE (cache edge) para desenhar o menu. |
| `+page.server.ts` / `+page.svelte` | Rota `/` — apenas redireciona para a home correta do usuário (login/bem-vindo). |
| `+error.svelte` | Página de erro genérica. |

### 10.2 Autenticação, conta e termo

| Arquivo | O que faz |
|---------|-----------|
| `login/+page.server.ts` | Load + actions do login (matrícula/senha via `auth-flow`, cookie de módulo). |
| `login/+page.svelte` | Tela de login: formulário, etapa 2FA com timer, e **login por certificado A3** (SERPRO). |
| `login/+layout.svelte` | Layout mínimo sem sidebar. |
| `alterar-senha/+page.server.ts` / `.svelte` | Troca de senha obrigatória (primeiro acesso) e voluntária; valida força e invalida sessões. |
| `redefinir-senha/+page.server.ts` / `.svelte` | Reset de senha via token de e-mail (verificação, expiração, uso único). |
| `aceitar-termo/+page.server.ts` / `.svelte` | Exibe o termo vigente sanitizado e registra o aceite (snapshot + hash). |
| `bem-vindo/+page.server.ts` / `.svelte` | Hub pós-login: redireciona para a boas-vindas do módulo correto (admin com módulo "ambas" escolhe aqui). |
| `escalas/bem-vindo/…` e `gise/bem-vindo/…` | Boas-vindas específicas por módulo com atalhos por papel. |
| `super-admin/+page.server.ts` / `.svelte` | Console de boas-vindas do Super Admin (atalhos de gestão de estrutura/config/auditoria). |
| `termo/[versao]/+page.server.ts` / `.svelte` | Consulta **pública** de uma versão do termo de uso. |
| `termo/dpo/+page.svelte` | Página pública do Encarregado de Dados (DPO). |

APIs correspondentes em `api/auth/`:

| Endpoint | O que faz |
|----------|-----------|
| `login/+server.ts` | Login JSON (mesmo `tentarLogin` do form). |
| `verificar-2fa/+server.ts` | Confirma o código 2FA e cria a sessão. |
| `reenviar-codigo/+server.ts` | Reenvia código 2FA (invalida o anterior; rate-limit por IP). |
| `logout/+server.ts` | Encerra a sessão e invalida o cache edge. |
| `alternar-modulo/+server.ts` | Troca o cookie de módulo do admin (escalas × GISE). |
| `primeiro-acesso/+server.ts` | Gera e envia o link de primeiro acesso (substitui senha provisória). |
| `solicitar-redefinicao/+server.ts` | Início do reset por e-mail pessoal — **anti-enumeração** (resposta idêntica para usuário inexistente). |
| `confirmar-redefinicao/+server.ts` | Confirma o código, valida o e-mail pessoal e envia o link de reset. |
| `solicitar-verificacao-email-pessoal/+server.ts` / `confirmar-verificacao-email-pessoal/+server.ts` | Cadastro verificado do e-mail pessoal (canal de recuperação). |
| `solicitar-codigo-assinatura/+server.ts` | Código 2FA específico do ato de **assinar** (flag `exigirCodigoEmail`). |
| `certificado/iniciar/+server.ts` / `certificado/verificar/+server.ts` | Desafio-resposta do login por Token A3 (nonce → CMS verificado criptograficamente). |

### 10.3 Escalas (plantão, expediente, FDS)

| Arquivo | O que faz |
|---------|-----------|
| `escalas/+page.server.ts` | Lista de escalas com filtros/paginação server-side + actions (criar, excluir, marcar visto, próximo mês por rotação, solicitar assinatura). |
| `escalas/+page.svelte` | Tela da lista: filtros, tabela, modal de nova escala e seção/assinaturas. |
| `escalas/_components/TabelaEscalas.svelte` | Tabela/cards das escalas com ações por linha. |
| `escalas/_components/ModalNovaEscala.svelte` | Modal de criação rápida de escala (⚠️ duplica boa parte de `escalas/nova` — ver seção 11). |
| `escalas/_components/SecaoAssinaturas.svelte` | Bloco de solicitações de assinatura recebidas/pendentes. |
| `escalas/_components/DialogSolicitarAssinatura.svelte` | Diálogo de solicitação de assinatura a um DPC (busca de destinatário etc.). |
| `escalas/nova/+page.server.ts` / `.svelte` | Página completa de criação de escala (tipo, período, horários, seleção de policiais). |
| `escalas/[id]/+page.server.ts` | Detalhe da escala (~1k linhas): load com policiais agrupados + todas as actions de edição (adicionar/remover servidores, editar dias/plantões, equipes, e-mails FDS…). |
| `escalas/[id]/+page.svelte` | Composição do detalhe: cabeçalho, tabelas, painéis de assinatura. |
| `escalas/[id]/_components/EscalaCabecalho.svelte` | Cabeçalho com metadados e ações de exportação. |
| `escalas/[id]/_components/TabelaServidores.svelte` | Tabela dos servidores de escala de **expediente** (edição inline, seleção múltipla). |
| `escalas/[id]/_components/TabelaPlantao.svelte` | Tabela agrupada por dia para escalas de **plantão**. |
| `escalas/[id]/_components/ListaFds.svelte` | Lista/edição específica das escalas de **FDS**. |
| `escalas/[id]/_components/FormAdicionarServidores.svelte` | Formulário de adição em massa de servidores (busca, datas, horários). |
| `escalas/[id]/_components/FormInlineAdicionarOip.svelte` | Adição inline de OIP a um dia de plantão. |
| `escalas/[id]/_components/ModalEditarDias.svelte` / `ModalEditarPlantao.svelte` | Modais de edição de dias (expediente/FDS) e de plantão (⚠️ par com alta duplicação — seção 11). |
| `escalas/[id]/_components/ModalConfirmar.svelte` | Confirmação genérica local. |
| `escalas/[id]/_components/ToolbarSelecao.svelte` | Barra de ações sobre a seleção múltipla. |
| `recebidos/+page.server.ts` / `.svelte` | Caixa de entrada de escalas recebidas pela unidade do usuário (marcar visto, excluir, baixar documento). |
| `painel/+page.server.ts` / `.svelte` | Dashboard admin: visão consolidada por unidade/período, pendências de compliance (unidades sem escala enviada) e ações de limpeza. |

APIs de escala (`api/escalas/[id]/…`):

| Endpoint | O que faz |
|----------|-----------|
| `download/+server.ts` | Baixa a escala em PDF/XLSX/DOCX (ou a cópia de conferência, se assinada). |
| `preparar-assinatura/+server.ts` | Gera o PDF com placeholder e devolve o hash para o token assinar. |
| `finalizar-assinatura/+server.ts` | Embarca o CMS, verifica (CAdES-LT), sela e persiste. |
| `assinar-simples/+server.ts` | Assinatura avançada em tela (rubrica+selfie+GPS+2FA) com selo institucional. |
| `documento-assinado/+server.ts` | GET baixa o documento assinado (com `verificarPermissaoEscala`); DELETE revoga. |
| `solicitar-assinatura/+server.ts` | Cria/remove solicitação de assinatura para um DPC. |

### 10.4 GISE

| Arquivo | O que faz |
|---------|-----------|
| `gise/+page.server.ts` / `.svelte` | Home GISE: card da GISE ativa, criação (admin) e histórico. |
| `gise/_components/CardGiseAtiva.svelte` | Card de status da GISE ativa com atalhos. |
| `gise/_components/ModalCriarGise.svelte` | Criação de GISE (data, horários, feriado, seccionais iniciais). |
| `gise/_components/SecaoHistorico.svelte` | Histórico filtrável de GISEs com downloads. |
| `gise/_components/ModalDownloadExtras.svelte` | Download em lote de relatórios extraordinários do histórico. |
| `gise/_components/DialogInfo.svelte` | Diálogo informativo (ajuda). |
| `gise/config/+page.server.ts` / `.svelte` | Configurações GISE do admin: vagas padrão por equipe, horários e textos do Breve Relatório. |
| `gise/[id]/+page.server.ts` | Load do detalhe (usa `buscarGiseDetalhado`) e delega as actions aos módulos `_actions/*`. |
| `gise/[id]/+page.svelte` | Composição do detalhe da GISE: cabeçalho, avisos, seccionais, supervisão, modais e assinaturas em lote. |
| `gise/[id]/_actions/shared.ts` | Helper `getInt` de FormData. |
| `gise/[id]/_actions/actions-escala.ts` | Actions da escala em si: datas/horários, breve relatório, finalizar/reabrir/excluir, notificação ao assessor. |
| `gise/[id]/_actions/actions-seccional.ts` | Actions de seccional: adicionar/finalizar/remover, revogar assinaturas. |
| `gise/[id]/_actions/actions-equipe.ts` | Actions de equipe: criar/editar vagas e horários/excluir. |
| `gise/[id]/_actions/actions-membros.ts` | Actions de membro: adicionar/remover com checagem de conflito. |
| `gise/[id]/_actions/actions-unidade.ts` | Actions das unidades-slot da seccional. |
| `gise/[id]/_components/GiseCabecalho.svelte` | Cabeçalho (status, datas, ações gerais). |
| `gise/[id]/_components/GiseStatusAvisos.svelte` | Banner de avisos de status. |
| `gise/[id]/_components/GiseSeccional.svelte` | Card completo de uma seccional (~1,6k linhas): equipes, membros, presenças, respostas, assinaturas. |
| `gise/[id]/_components/GiseSupervisao.svelte` | Card do quadro de supervisão (~1,6k linhas): membros, presenças, relatórios e assinaturas do supervisor. |
| `gise/[id]/_components/GiseLoteAssinaturas.svelte` | Assinatura em lote dos relatórios extraordinários (manual e digital). |
| `gise/[id]/_components/modais/ModalDatasHoras.svelte` | Edição de datas/horários da GISE. |
| `gise/[id]/_components/modais/ModalBreveRelatorio.svelte` | Edição dos textos do breve relatório. |
| `gise/[id]/_components/modais/ModalFinalizar.svelte` / `ModalReabrir.svelte` / `ModalExcluirGise.svelte` / `ModalRemoverSeccional.svelte` | Confirmações das operações críticas. |
| `gise/[id]/_components/modais/ModalRubrica.svelte` | Captura de rubrica para os fluxos de assinatura da página. |
| `gise/[id]/_components/modais/ModalRelatorioDigital.svelte` | Fluxo de assinatura digital (token) de um relatório. |

APIs GISE (`api/gise/…`):

| Endpoint | O que faz |
|----------|-----------|
| `[id]/download/+server.ts` | Download da GISE (PDF/XLSX) ou cópia de conferência. |
| `[id]/preparar-assinatura` / `finalizar-assinatura` / `assinar-simples` | Trio de assinatura da escala GISE diária (mesmo padrão das escalas). |
| `[id]/assinar/+server.ts` | ⚠️ **Deprecado** — redireciona para `assinar-simples` (compatibilidade). |
| `[id]/documento-assinado/+server.ts` (+ `/info`) | Baixar/revogar o PDF assinado e consultar metadados. |
| `[id]/finalizar/+server.ts` | Finaliza a GISE e **clona a próxima** (admin). |
| `[id]/reabrir/+server.ts` | Reabre GISE assinada/finalizada (revoga assinatura, reseta seccionais). |
| `[id]/presenca/preparar-assinatura` / `finalizar-assinatura` | Termo de presença por Token A3 (desktop): gera termo de 1 página, valida vínculo/horário no servidor, persiste presença + termo. |
| `[id]/relatorios/[seccionalId]/preparar-assinatura` / `finalizar-assinatura` / `assinar` | Assinatura do relatório extraordinário da seccional (qualificada e simples). |
| `historico/export/+server.ts` | Export agregado do histórico de GISEs (XLSX multi-GISE). |

### 10.5 res-gise (visão do membro), produtividade e demais páginas

| Arquivo | O que faz |
|---------|-----------|
| `res-gise/+page.server.ts` | Load + actions da visão do membro/supervisor da GISE ativa: presença (entrada/saída com evidências), preenchimento do formulário de produtividade, configuração do modelo (admin). Maior `+page.server` do projeto (~800 linhas). |
| `res-gise/+page.svelte` | Composição: lista de escalas do usuário, formulário de serviço, config do formulário. |
| `res-gise/useResGise.svelte.ts` | Composable central da página (~500 linhas): estado de seleção, etapas de presença/assinatura, integração com SignaturePad e Token A3. |
| `res-gise/FormularioServico.svelte` | Formulário de serviço do membro (respostas + relatório + assinatura). |
| `res-gise/RelatorioProdutividade.svelte` | Bloco dinâmico de perguntas de produtividade (mandados, prisões, apreensões…). |
| `res-gise/ConfigurarFormulario.svelte` | Editor do modelo de perguntas (admin) com restauração do padrão. |
| `produtividade/+page.server.ts` / `.svelte` | Dashboard de produtividade (Admin Geral): agregados, gráficos Chart.js, rankings e export PNG/PDF. |

### 10.6 Cadastros e administração

| Arquivo | O que faz |
|---------|-----------|
| `policiais/+page.server.ts` / `.svelte` | Gestão de policiais (escopo por papel): busca paginada, criar/editar/excluir, promover papel, primeiro acesso. |
| `policiais/[id]/+page.server.ts` / `.svelte` | Ficha do policial: dados, papel, vínculo admin, rubrica, e-mails. |
| `policiais/upload/+page.server.ts` / `.svelte` | Upload de CSV para carga em massa de policiais (validação linha a linha). |
| `unidades/+page.server.ts` / `.svelte` | Gestão de unidades (hierarquia departamento→seccional→delegacia). |
| `unidades/_components/ModalCadastrarUnidade.svelte` / `ModalExcluirUnidade.svelte` | Modais de cadastro/exclusão. |
| `config-geral/+page.server.ts` / `.svelte` | Configurações gerais (Admin Geral): provedor de e-mail padrão. |
| `conf-ass/+page.server.ts` / `.svelte` | Política de assinatura (Super Admin): flags de selfie/GPS/2FA/smartphone e o nível resultante (simples × avançada) com base legal. |
| `auditoria/+page.server.ts` / `.svelte` | Console da trilha forense (Admin Geral): filtros por ator/ação/período, detalhe do evento, verificação da cadeia de hash. |
| `auditoria/export/+server.ts` | Export CSV/PDF da trilha com janelas máximas (1 ano CSV / 1 mês PDF). |

APIs de administração:

| Endpoint | O que faz |
|----------|-----------|
| `api/admin/audit/+server.ts` | Consulta paginada do audit log (Admin Geral). |
| `api/admin/compliance/+server.ts` | Pendências de compliance por unidade/período (alimenta o painel). |
| `api/admin/lgpd/incidentes/…` | Lista/registra (POST) e detalha/atualiza (PATCH) incidentes LGPD. |
| `api/admin/lgpd/solicitacoes/…` | Lista, detalha e responde solicitações de titulares. |
| `api/admin/lgpd/limpeza/+server.ts` | Dispara manualmente a limpeza de retenção. |
| `api/lgpd/solicitar/+server.ts` | Titular abre/acompanha as próprias solicitações (art. 18). |
| `api/configuracoes/assinatura/+server.ts` | GET/PUT das flags de assinatura (PUT restrito, invalida o cache edge). |
| `api/perfil/rubrica/+server.ts` | POST/DELETE da rubrica reutilizável (consentimento LGPD; exclusão a qualquer momento). |
| `api/policiais/search/+server.ts` | Busca paginada de policiais (RBAC: comum só vê a própria lotação). |
| `api/policiais/[id]/email-aviso/+server.ts` | E-mails do policial p/ pré-preencher aviso de assessor (Admin Geral). |
| `api/unidades/search/+server.ts` | Busca de unidades para selects. |
| `api/health/+server.ts` | Liveness/readiness binária (`ok`/`down`); detalhe interno só com `HEALTH_DETAIL_TOKEN`. |

### 10.7 Validação pública e webhooks

| Arquivo | O que faz |
|---------|-----------|
| `validar/+page.svelte` | Página pública para digitar o hash de verificação. |
| `validar/[hash]/+page.server.ts` / `.svelte` | Resultado da validação: verificação criptográfica completa do documento + metadados minimizados (sem PII sensível para anônimos). |
| `api/validar/[hash]/download/+server.ts` | Download do documento validado: cópia de conferência para todos; forense íntegro só para perfis autorizados. |
| `api/validar/logo/+server.ts` | Serve o brasão via R2 com cache longo (bucket é privado). |
| `api/webhook/sync-policiais/+server.ts` | Upsert em massa de policiais vindo da planilha (Bearer/HMAC + replay protection). |
| `api/webhook/sync-unidades/+server.ts` | Idem para unidades (com hierarquia). |
| `api/webhook/reset-policiais/+server.ts` | **Reset destrutivo** das tabelas operacionais — exige 3 credenciais simultâneas (SYNC_TOKEN + RESET_TOKEN + data UTC do dia). |
| `api/webhook/limpeza-retencao/+server.ts` | Gatilho da limpeza de retenção LGPD (chamado pelo cron do GitHub Actions). |

---

## 11. Achados: código morto e duplicado

Levantado em 2026-07-04 com `npm run knip`, `jscpd` (`--min-tokens 70`) e inspeção manual. O projeto está **bem enxuto** — o knip encontrou um único export morto — mas há oportunidades reais de consolidação.

### 11.1 Código morto / arquivos órfãos

| # | Achado | Recomendação |
|---|--------|--------------|
| M1 | **`Código.gs` (raiz, 928 linhas)** — Apps Script de um sistema *anterior* (formulário externo de produtividade: `doPost`/`doGet`, tokens de acesso por e-mail, rascunhos, dashboard em planilha). Nenhuma referência em código ou docs; o script vigente é `scripts/GoogleAppsScript_Sync.gs`. | Remover do repositório (o histórico Git preserva). Se ainda estiver em produção em alguma planilha antiga, mover para `docs/` como registro histórico com um banner. |
| M2 | **`calcularCaixaRubrica`** (`src/lib/server/pdf-signing-prepare.ts:582`) — único export sem importadores apontado pelo knip; é usada apenas dentro do próprio arquivo. | Remover a palavra-chave `export` (a função em si é viva). |
| M3 | **`.claude/settings.local.json`** — permissões de sessões antigas do Claude Code, com caminhos Windows (`/c/Users/Pc/...`) e scripts que não existem mais (`scripts/update-api.js`, `update-proximo-mes.cjs`, `update-export.cjs`, `update-page.cjs`). Por convenção esse arquivo é *local* (o próprio nome diz) e não costuma ser versionado. | Adicionar `.claude/settings.local.json` ao `.gitignore` e removê-lo do repo. |
| M4 | **`scripts/gerar-selo-institucional.mjs` não existe**, mas é citado como a origem do par de chaves do selo em `src/lib/server/server-seal.ts:24`. | Ou versionar o script gerador, ou ajustar o comentário/DEPLOY.md para documentar o comando `openssl` equivalente. |
| M5 | **Drift de docs no `README.md`**: (a) a árvore de pastas cita `useLocalStorageFilters.svelte.ts`, mas o arquivo real é `src/lib/utils/localStorage.ts` (função `getSavedFilters`); (b) o fluxo de login fala em sessão de **12 horas**, mas `src/lib/auth.ts` define `SESSION_TTL_MS = 8h`. | Corrigir as duas referências no README. |

### 11.2 Funções duplicadas (mesmo nome, implementações paralelas)

| # | Achado | Recomendação |
|---|--------|--------------|
| D1 | **`calcularDataSaida` existe em dois módulos**: `src/lib/utils.ts:30` e `src/lib/rotacao.ts:158`. Mesma assinatura e mesma regra ("se hora de saída ≤ entrada, avança um dia"); a versão de `rotacao.ts` só acrescenta o caso de strings vazias. Ambas têm consumidores (`utils` → exports/PDF/planilha; `rotacao` → páginas de escala). | Manter **uma** (em `utils.ts`, absorvendo o guard de string vazia) e re-exportar/importar dela em `rotacao.ts`. Risco baixo, ganho de manutenção. |
| D2 | **`getR2` existe em dois módulos com semântica diferente**: `src/lib/db/core.ts` (lança erro se o binding faltar) e `src/lib/server/platform.ts` (retorna `undefined`). Os dois são usados em ~10 endpoints cada. | Consolidar em um módulo com dois nomes explícitos (ex.: `getR2()` que lança e `tryGetR2()` que retorna `undefined`), para o leitor não depender do caminho do import para saber o comportamento. |

### 11.3 Duplicação estrutural (jscpd: 276 clones exatos, ~4% das linhas)

Pares com mais linhas clonadas — candidatos a extração de componente/helper, em ordem de impacto:

| Linhas clonadas | Onde | Observação |
|----------------:|------|------------|
| ~164 | `escalas/nova/+page.svelte` × `escalas/_components/ModalNovaEscala.svelte` (+72 nos respectivos `+page.server.ts`) | O formulário de criação de escala existe **duas vezes** (página completa e modal). É a maior duplicação funcional do projeto: extrair um `FormNovaEscala.svelte` compartilhado (e um helper comum para a action). |
| ~133 | `escalas/_components/DialogSolicitarAssinatura.svelte` × `lib/components/PainelAssinaturaDigital.svelte` | Bloco de UI de solicitação/status de assinatura repetido. |
| ~141 | `ModalEditarDias.svelte` × `ModalEditarPlantao.svelte` | Par de modais quase gêmeos (validação de datas/horas + markup). |
| ~122 | `lib/db/gise/respostas.ts` × `routes/res-gise/+page.server.ts` | Um clone único de 122 linhas — bloco de agregação de respostas repetido fora da camada db. Mover para `respostas.ts` e importar. |
| ~131 | `FormAdicionarServidores.svelte` × `FormInlineAdicionarOip.svelte` (+46 com `ListaFds`) | Lógica TS de busca/validação de servidor repetida. |
| ~115 | `ListaFds.svelte` × `TabelaServidores.svelte` | Linhas de tabela/ações repetidas. |
| ~93 | `alterar-senha/+page.svelte` × `redefinir-senha/+page.svelte` | Formulário de nova senha (força, confirmação) duplicado — extrair `FormNovaSenha.svelte`. |
| ~107 | `api/gise/[id]/{assinar-simples,preparar-assinatura,finalizar-assinatura}` entre si e × `presenca/…` × `relatorios/…` (vários clones de 35–67 linhas) | Restos da era pré-`signature-service.ts`: o "miolo" já foi unificado, mas o preâmbulo (auth, params, flags, buscas) ainda é copiado entre os endpoints. Um helper `carregarContextoAssinaturaGise()` eliminaria a família toda. |
| ~76 | `escalas/nova/+page.svelte` × `gise/_components/ModalCriarGise.svelte` | Blocos de formulário de data/horário. |
| ~210 (interno) | `GiseSupervisao.svelte` (10 clones dentro do próprio arquivo) | Markup repetido por tipo de relatório; um snippet `{#snippet}` resolveria. Também é o arquivo mais longo entre os componentes (1,6k linhas). |
| ~202 (interno) | `lib/server/export-pdf.ts` (8 clones internos) | Blocos de cabeçalho/tabela dos vários PDFs; candidatos a helpers no próprio arquivo. |
| ~176 (interno) | `escalas/[id]/+page.server.ts` (15 clones internos) | Preâmbulo repetido nas actions (auth + buscarEscala + permissão); um helper local `carregarEscalaAutorizada()` enxugaria ~150 linhas. |
| ~148 (interno) | `res-gise/RelatorioProdutividade.svelte` | Markup repetido por tipo de pergunta. |

Relatório completo: rode `npx jscpd src --min-tokens 70 --reporters consoleFull`.

### 11.4 Observações menores

- **Migrações com prefixo duplicado** (`0010_*` ×2 e `0011_*` ×2): inofensivo (o runner controla por nome de arquivo), mas evite repetir numeração em migrações novas.
- **`/api/gise/[id]/assinar`** está formalmente deprecado (redireciona para `assinar-simples`). Quando não houver mais clientes antigos, pode ser removido junto com a rota.
- O `knip` existe como script (`npm run knip`) mas **não roda no CI** — considerar adicioná-lo ao `deploy.yml` (ou como job não-bloqueante) para impedir regressão de código morto.
- `.fallowrc.json` referencia entry points `src/index.*`/`src/main.*` que não existem neste projeto SvelteKit — se a ferramenta `fallow` for mesmo usada, os entries deveriam espelhar os do `knip.json`; senão, o arquivo pode ser removido.
