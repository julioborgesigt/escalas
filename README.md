# Sistema de Gestão de Escalas — PCCE

Plataforma de gestão de escalas de plantão, expediente e GISE (Grupo de Intervenção e Suporte Especializado) da Polícia Civil do Estado do Ceará. Inclui geração de PDFs, assinatura digital ICP-Brasil (e-CPF via WebPKI/SERPRO), reconhecimento facial e controle completo de produtividade.

---

## Índice

1. [Stack Tecnológico](#1-stack-tecnológico)
2. [Pré-requisitos](#2-pré-requisitos)
3. [Setup do Ambiente Local](#3-setup-do-ambiente-local)
4. [Variáveis de Ambiente](#4-variáveis-de-ambiente)
5. [Banco de Dados](#5-banco-de-dados)
6. [Scripts Disponíveis](#6-scripts-disponíveis)
7. [Arquitetura e Estrutura de Pastas](#7-arquitetura-e-estrutura-de-pastas)
8. [Módulos do Sistema](#8-módulos-do-sistema)
9. [Autenticação e Autorização](#9-autenticação-e-autorização)
10. [Padrões de Código](#10-padrões-de-código)
11. [Testes](#11-testes)
12. [Deploy em Produção](#12-deploy-em-produção)
13. [Softwares Externos e Integrações](#13-softwares-externos-e-integrações)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Stack Tecnológico

> As versões exatas estão no [`package.json`](package.json) — a tabela abaixo indica apenas a versão _major_ adotada.

| Camada                | Tecnologia                                                     | Major |
| --------------------- | -------------------------------------------------------------- | ----- |
| Meta-framework        | SvelteKit                                                      | 2     |
| UI                    | Svelte (runes)                                                 | 5     |
| Estilização           | Tailwind CSS + Skeleton UI                                     | 4 / 4 |
| ORM                   | Drizzle ORM                                                    | 0.4x  |
| Banco de dados        | Cloudflare D1 (SQLite serverless)                              | —     |
| Armazenamento         | Cloudflare R2 (PDFs, selfies, documentos)                      | —     |
| Hospedagem            | Cloudflare Pages (edge runtime)                                | —     |
| Validação             | Zod                                                            | 4     |
| Assinatura digital    | pdf-lib + @signpdf + node-forge + web-pki                      | —     |
| Reconhecimento facial | @vladmandic/face-api (TensorFlow.js)                           | 1     |
| E-mail                | Cloudflare Email Sending (binding `EMAIL`) + Resend (fallback) | —     |
| Geração de documentos | jsPDF + ExcelJS + docx                                         | —     |
| Monitoramento         | Sentry (Cloudflare Workers)                                    | 10    |
| Testes unitários      | Vitest                                                         | 4     |
| Testes E2E            | Playwright                                                     | 1     |
| Build                 | Vite                                                           | 8     |
| Linguagem             | TypeScript                                                     | 5     |

---

## 2. Pré-requisitos

Antes de começar, certifique-se de ter instalado:

- **Node.js v22+** (alinhado ao `engines` do `package.json`) — [nodejs.org](https://nodejs.org)
- **npm** (vem com o Node.js)
- **Wrangler CLI** (para interagir com Cloudflare localmente):
  ```bash
  npm install -g wrangler@latest
  ```

Opcionalmente, para testes E2E:

- **Playwright** com Chromium (instalado abaixo no setup)

Não é obrigatório ter conta Cloudflare para desenvolvimento local — o Wrangler/Miniflare simula D1 e R2 na sua máquina.

---

## 3. Setup do Ambiente Local

### 3.1 Clonar e instalar

```bash
git clone <url-do-repositorio> escalas
cd escalas
npm install
```

### 3.2 Configurar variáveis de ambiente

Crie o arquivo `.dev.vars` na raiz do projeto (o Wrangler usa esse arquivo para simular _secrets_ localmente):

```bash
cp .env.example .dev.vars
```

Edite `.dev.vars` com os valores mínimos para desenvolvimento:

```ini
SYNC_TOKEN=qualquer-string-para-dev
RESET_TOKEN=outra-string-diferente-do-sync-token
# Opcional — só se quiser testar envio de e-mail (2FA, primeiro acesso):
# RESEND_API_KEY=re_...
# RESEND_FROM_EMAIL=onboarding@resend.dev
```

> Veja a seção [Variáveis de Ambiente](#4-variáveis-de-ambiente) para a lista completa.

### 3.3 Criar o banco de dados local

```bash
npm run db:migrate
```

Isso aplica todas as migrações SQL na instância local do D1 (SQLite gerenciado pelo Wrangler em `.wrangler/`).

### 3.4 Iniciar o servidor

```bash
npm run dev
```

Acesse **http://localhost:5173**. O SvelteKit roda integrado ao Cloudflare adapter, simulando todas as _bindings_ (D1, R2) configuradas no `wrangler.toml`.

### 3.5 (Opcional) Instalar modelos de reconhecimento facial

Os modelos do face-api já estão em `static/face-api/` e são servidos diretamente. Nenhuma ação adicional é necessária — o download é feito sob demanda pelo navegador.

### 3.6 Fluxo de desenvolvimento típico

```bash
# Terminal 1: servidor de desenvolvimento
npm run dev

# Terminal 2: type-check contínuo (altamente recomendado)
npm run check:watch

# Terminal 3: testes unitários em watch mode
npm run test:watch
```

Antes de abrir um PR, sempre execute:

```bash
npm run lint:fix   # corrige erros de lint automaticamente
npm run format     # formata o código com Prettier
npm run check      # type-check final
npm run test       # testes unitários
```

---

## 4. Variáveis de Ambiente

### Arquivo `.dev.vars` (local) / Cloudflare Pages → Settings → Environment Variables (produção)

> **Fonte autoritativa:** a lista completa e comentada de todas as variáveis está em [`.env.example`](.env.example); os tipos em [`src/app.d.ts`](src/app.d.ts). Para o detalhe operacional de cada uma (avisos, rotação, go-live), veja [`DEPLOY.md`](DEPLOY.md). A tabela abaixo resume as principais.

| Variável                                                           | Obrigatória | Descrição                                                                                                                                                                   |
| ------------------------------------------------------------------ | :---------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SYNC_TOKEN`                                                       |     ✅      | Bearer token para os webhooks de sincronização (`/api/webhook/sync-policiais`, `/api/webhook/sync-unidades`). Gere com `openssl rand -hex 32`.                              |
| `RESET_TOKEN`                                                      |     ⚠️      | Token **separado** do `SYNC_TOKEN` para o endpoint destrutivo `/api/webhook/reset-policiais`. Se não definido, o endpoint retorna 401 (fail-closed seguro).                 |
| E-mail (binding `EMAIL` ou `RESEND_API_KEY` + `RESEND_FROM_EMAIL`) | ✅ produção | Envio de 2FA, primeiro acesso e reset de senha. **Sem e-mail funcionando, o login com 2FA trava (fail-closed).**                                                            |
| `PASSWORD_PEPPER`                                                  | ⚠️ produção | Pepper de senha (HMAC antes do PBKDF2, formato `pbkdf2v3`). **Nunca rotacionar** sem plano de migração — ver [`DEPLOY.md`](DEPLOY.md#hashing-de-senha-e-o-password_pepper). |
| `CPF_ENCRYPTION_KEY` / `CPF_INDEX_KEY`                             | ⚠️ produção | Cifra de CPF em repouso (AES-256-GCM) + índice cego para lookup (LGPD).                                                                                                     |
| `RATE_LIMIT_IP_SALT`                                               | ⚠️ produção | Muda a chave do rate-limit de "/24 anonimizada" para hash salteado do IP completo (evita lockout do NAT corporativo).                                                       |
| `APP_ORIGIN`                                                       | ⚠️ produção | Origem canônica (`https://...`) usada nos links de e-mail.                                                                                                                  |
| `SUPER_ADMIN_LOGIN` / `SUPER_ADMIN_SENHA` / `SUPER_ADMIN_EMAIL`    |     ❌      | Conta root de break-glass via env. Prefira senha em hash PBKDF2 e defina o e-mail para exigir 2FA — ver [`DEPLOY.md`](DEPLOY.md#variáveis-e-secrets).                       |
| `ADMIN_GERAL_LOGIN` / `ADMIN_GERAL_SENHA`                          |     ❌      | Login de Admin Geral via env (bootstrap). Logins por credencial de bootstrap são auditados (`login_bootstrap`).                                                             |
| `GISE_BASE_EQUIPE_WEBHOOK_URL`                                     |     ❌      | URL do Google Apps Script que popula a aba `Base_Equipe` da planilha. Ex: `https://script.google.com/macros/s/AKfy.../exec`                                                 |
| `GISE_BASE_EQUIPE_SECRET`                                          |     ❌      | Segredo compartilhado com `ScriptProperties.BASE_EQUIPE_SECRET` no Apps Script. Gere com `openssl rand -hex 32`.                                                            |

> **Dica:** Use `openssl rand -hex 32` para gerar qualquer token seguro de 256 bits.
>
> **Legado:** `GMAIL_USER`/`GMAIL_APP_PASSWORD` (SMTP Gmail) não são mais lidos — o envio de e-mail usa o binding `EMAIL` da Cloudflare com fallback Resend.

### Bindings Cloudflare (`wrangler.toml`)

Não são variáveis de ambiente, mas recursos Cloudflare vinculados automaticamente:

| Binding        | Tipo        | Descrição                                             |
| -------------- | ----------- | ----------------------------------------------------- |
| `escalas_db`   | D1 Database | Banco de dados SQLite serverless principal            |
| `escalas_docs` | R2 Bucket   | Armazenamento de PDFs, selfies e documentos assinados |

---

## 5. Banco de Dados

### Tecnologia

O projeto usa **Cloudflare D1** (SQLite serverless) via **Drizzle ORM**. O schema está em `src/lib/server/schema.ts`.

- **Local**: SQLite gerenciado pelo Wrangler em `.wrangler/state/v3/d1/`
- **Produção**: D1 na infraestrutura Cloudflare

### Principais tabelas

| Tabela                           | Descrição                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `policiais`                      | Servidores (matrícula, CPF, cargo, lotação, senha PBKDF2, papel RBAC)                                               |
| `policial_historico`             | Histórico funcional por servidor (movimentações, afastamentos, desvinculações, diffs de edição) com PDF anexo no R2 |
| `administradores`                | Admins gerais do sistema                                                                                            |
| `sessoes`                        | Sessões ativas (token, tipo, expiração em 8h)                                                                       |
| `escalas`                        | Escalas de plantão, expediente e FDS                                                                                |
| `escala_policiais`               | Associação policial ↔ escala (data, horário, equipe)                                                                |
| `escala_documentos`              | PDFs assinados com metadados CAdES-LT (OCSP, TST, selfie, GPS, IP)                                                  |
| `escala_solicitacoes_assinatura` | Solicitações de assinatura por unidade/respondência                                                                 |
| `unidades`                       | Hierarquia: departamento → seccional → delegacia                                                                    |
| `gise_escalas`                   | GISE operacionais (status, supervisor, assessor, configuração)                                                      |
| `gise_seccionais`                | Seccionais dentro de uma GISE                                                                                       |
| `gise_equipes`                   | Equipes (operacional/SEINT) com slots DPC/OIP                                                                       |
| `gise_membros`                   | Associação policial ↔ equipe GISE                                                                                   |
| `gise_presencas`                 | Registros de entrada/saída (GPS, selfie, rubrica)                                                                   |
| `gise_documentos`                | PDFs assinados de GISE                                                                                              |
| `gise_respostas_formulario`      | Respostas de formulários (JSON) por policial/equipe                                                                 |
| `gise_assinaturas_relatorios`    | Assinaturas de relatórios de extra/produtividade                                                                    |
| `aceites_termos`                 | Histórico de aceite de termos de uso (versão, hash, IP, user-agent)                                                 |
| `audit_log`                      | Trilha de auditoria forense (eventos de negócio, cadeia de hash tamper-evident)                                     |
| `app_log`                        | Logs técnicos do servidor (warn/error do logger, correlacionados por `request_id`)                                  |

### Comandos de migração

```bash
# Aplicar migrações localmente
npm run db:migrate

# Aplicar migrações em staging (D1 dedicado escalas-db-staging)
npm run db:migrate:staging

# Aplicar migrações em produção (requer Wrangler autenticado; --yes obrigatório)
npm run db:migrate:prod -- --yes

# Gerar nova migração após alterar src/lib/server/schema.ts
npx drizzle-kit generate --dialect sqlite
```

> **Importante:** nunca edite arquivos em `migrations/` manualmente. Sempre edite o schema e deixe o Drizzle gerar o SQL.

### Histórico de migrações

O histórico completo está na própria pasta [`migrations/`](migrations/) — os nomes dos arquivos são autoexplicativos (`0000_initial_schema.sql` … `0033_audit_forense.sql`) e o `migrations/meta/_journal.json` rastreia o que já foi aplicado em cada ambiente. Para entender uma migração específica, leia o SQL dela e o trecho correspondente do [`src/lib/server/schema.ts`](src/lib/server/schema.ts).

---

## 6. Scripts Disponíveis

```bash
# Desenvolvimento
npm run dev                # Servidor local (localhost:5173)
npm run build              # Build de produção (.svelte-kit/cloudflare/)
npm run preview            # Pré-visualização local da build

# Qualidade de código
npm run check              # Type-check (Svelte Check + TypeScript)
npm run check:watch        # Type-check contínuo
npm run lint               # ESLint
npm run lint:strict        # ESLint falhando com qualquer warning
npm run lint:ci            # ESLint com o teto de warnings usado no CI (ratchet)
npm run lint:fix           # ESLint com auto-fix
npm run format             # Prettier (formata todos os arquivos)
npm run format:check       # Prettier sem alterar (só verifica)
npm run knip               # Detecção de código/exports mortos

# Testes
npm run test               # Vitest (run once)
npm run test:watch         # Vitest (watch mode)

# Banco de dados
npm run db:migrate               # Aplica migrações localmente
npm run db:migrate:staging       # Aplica migrações no D1 de staging
npm run db:migrate:prod -- --yes # Aplica migrações em produção (--yes obrigatório)

# Utilitários de usuários (scripts/)
npm run users:set-default-password          # Define senha padrão para todos os usuários (local)
npm run users:set-default-password:prod     # Idem, em produção
npm run users:clear-passwords-non-admins    # Limpa senhas de não-admins (local)
npm run users:clear-passwords-non-admins:prod  # Idem, em produção
```

---

## 7. Arquitetura e Estrutura de Pastas

```
escalas/
├── src/
│   ├── routes/                     # Rotas SvelteKit (páginas + APIs)
│   │   ├── api/                    # Endpoints REST
│   │   │   ├── auth/               # Login, logout, 2FA, reset de senha
│   │   │   ├── escalas/            # CRUD escalas, geração PDF, assinaturas
│   │   │   ├── gise/               # GISE (escalas, equipes, presenças, formulários)
│   │   │   ├── policiais/          # CRUD policiais, busca
│   │   │   ├── unidades/           # Hierarquia de unidades
│   │   │   ├── validar/            # Validação pública de assinaturas
│   │   │   ├── webhook/            # Sync de planilha Google + reset destrutivo
│   │   │   ├── configuracoes/      # Flags de assinatura (com cache edge)
│   │   │   ├── admin/              # Audit log, compliance, LGPD (incidentes/solicitações/limpeza)
│   │   │   ├── lgpd/               # Solicitações do titular (art. 18)
│   │   │   ├── perfil/             # Rubrica reutilizável (POST/DELETE)
│   │   │   └── health/             # Health check
│   │   ├── login/                  # Página de login + 2FA + certificado A3
│   │   ├── alterar-senha/          # Troca de senha obrigatória (primeiro acesso)
│   │   ├── redefinir-senha/        # Reset de senha via token
│   │   ├── aceitar-termo/          # Aceite de termo de uso
│   │   ├── bem-vindo/              # Boas-vindas pós-login (+ escalas/bem-vindo e gise/bem-vindo por módulo)
│   │   ├── super-admin/            # Console de boas-vindas do Super Admin
│   │   ├── escalas/                # Gestão de escalas (lista, nova, detalhe)
│   │   ├── painel/                 # Dashboard admin
│   │   ├── recebidos/              # Caixa de entrada de escalas recebidas
│   │   ├── gise/                   # GISE (lista, detalhe, config de questões)
│   │   ├── res-gise/               # Presença e relatórios GISE (visão do membro)
│   │   ├── policiais/              # Gestão de policiais (lista, detalhe, upload CSV)
│   │   ├── unidades/               # Gestão de unidades
│   │   ├── produtividade/          # Dashboard de produtividade
│   │   ├── perfil/                 # Meu perfil (rubrica, e-mail pessoal, solicitações de alteração)
│   │   ├── solicitacoes/           # Aprovação de alterações cadastrais (Admin Geral)
│   │   ├── conf-ass/               # Configuração de assinatura
│   │   ├── config-geral/           # Configurações gerais (provedor de e-mail)
│   │   ├── auditoria/              # Trilha forense + logs técnicos (/auditoria/logs)
│   │   ├── validar/                # Validação pública de PDF assinado
│   │   ├── termo/                  # Consulta pública do termo de uso (/termo → versão vigente)
│   │   ├── +layout.svelte          # Layout raiz (sidebar, tema, toast)
│   │   ├── +layout.server.ts       # Load global (usuário, flags, papel GISE)
│   │   └── +error.svelte           # Página de erro
│   ├── lib/
│   │   ├── components/             # Componentes Svelte reutilizáveis
│   │   │   ├── PainelAssinaturaEscala.svelte   # Painel completo de assinatura
│   │   │   ├── PainelAssinaturaToken.svelte    # Assinatura via WebPKI/SERPRO
│   │   │   ├── SignaturePad.svelte             # Rubrica + selfie + GPS + 2FA
│   │   │   ├── SearchableSelect.svelte         # Select com busca async
│   │   │   ├── LoadingOverlay.svelte           # Overlay de loading global
│   │   │   └── ...
│   │   ├── composables/            # Lógica reativa reutilizável (Svelte 5)
│   │   │   ├── useAssinaturaEscala.svelte.ts   # Estado de assinatura
│   │   │   ├── useGiseEstado.svelte.ts         # Estados derivados GISE
│   │   │   ├── useCharts.svelte.ts             # Integração Chart.js
│   │   │   └── ...
│   │   ├── server/                 # Backend puro — nunca importar no cliente
│   │   │   ├── schema.ts           # Schema Drizzle (fonte de verdade do banco)
│   │   │   ├── pdf-signing.ts      # Geração e assinatura de PDFs
│   │   │   ├── pdf-verification.ts # Validação de assinaturas (OCSP, CAdES)
│   │   │   ├── icp-brasil/         # Trust store ICP-Brasil
│   │   │   ├── email.ts            # Envio de e-mail (binding EMAIL / Resend)
│   │   │   ├── termo/              # Conteúdo e hash do termo de uso vigente
│   │   │   └── ...
│   │   ├── db/                     # Camada de acesso ao banco (queries tipadas)
│   │   │   ├── core.ts             # getDB() e getR2() — entry points do banco
│   │   │   ├── policiais.ts        # Queries de policiais
│   │   │   ├── escalas.ts          # Queries de escalas
│   │   │   ├── gise/               # Sub-módulo GISE
│   │   │   └── ...
│   │   ├── schemas/                # Schemas Zod de validação
│   │   │   ├── auth.ts             # Login, reset, 2FA
│   │   │   ├── escala.ts           # Criação/edição de escala
│   │   │   ├── gise.ts             # GISE e operações
│   │   │   └── ...
│   │   ├── auth.ts                 # Exports públicos de auth (tipos, helpers RBAC)
│   │   ├── serpro.ts               # Cliente WebSocket para Assinador SERPRO Desktop
│   │   ├── csrf.ts                 # Helpers CSRF (cliente)
│   │   ├── loading.svelte.ts       # Estado global de loading
│   │   ├── toast.ts                # Sistema de toasts
│   │   ├── logger.ts               # Logger estruturado
│   │   └── utils.ts                # Utilitários genéricos
│   ├── hooks.server.ts             # Middleware global (CSRF, auth, headers de segurança)
│   ├── app.d.ts                    # Tipos globais (bindings CF, App.Locals)
│   ├── app.css                     # Estilos globais
│   ├── app.html                    # HTML raiz
│   └── theme.css                   # Variáveis CSS do tema
├── migrations/                     # Migrações SQL geradas pelo Drizzle
├── scripts/                        # Scripts utilitários Node.js
│   ├── migrate.ts                  # Runner de migrações
│   ├── set-default-password-all-users.ts
│   ├── clear-passwords-non-admins.ts
│   └── GoogleAppsScript_Sync.gs   # Google Apps Script (sync planilha)
├── e2e/                            # Testes E2E Playwright
├── docs/                           # Documentação complementar (ver docs/README.md)
│   ├── QA_ASSINATURA_A3_DESKTOP.md # Roteiro de QA manual do fluxo Token A3
│   └── HISTORICO.md                # Catálogo das auditorias/decisões arquivadas (preservadas no Git)
├── static/
│   └── face-api/                   # Modelos ML do face-api (servidos localmente)
├── wrangler.toml                   # Config Cloudflare (D1, R2, adapter)
├── drizzle.config.ts               # Config Drizzle ORM
├── svelte.config.js                # Config SvelteKit (adapter, CSP)
├── vite.config.ts                  # Config Vite (code splitting, aliases)
├── tsconfig.json                   # Config TypeScript (strict mode)
├── playwright.config.ts            # Config Playwright
├── DEPLOY.md                       # Runbook completo de operações em produção
├── TESTING.md                      # Roteiros de testes manuais (100+ casos)
└── CLAUDE.md                       # Diretrizes de código para o projeto
```

> **Mapa da documentação:** o índice completo (o que é vivo × registro histórico) está em [`docs/README.md`](docs/README.md).

---

## 8. Módulos do Sistema

### Escalas

Gestão do ciclo de vida de escalas de plantão, expediente e finais de semana (FDS):

- Criação e edição com seleção de policiais por unidade
- Geração de PDF com layout oficial
- Envio por e-mail para destinatário configurado
- Assinatura digital com e-CPF (WebPKI ou SERPRO Desktop)
- Validação pública de autenticidade via QR Code / hash

### GISE

Gerenciamento completo de operações GISE:

- Criação e configuração pelo supervisor (seccionais, equipes, questões)
- Registro de presença (entrada/saída com GPS, selfie e rubrica) — em desktop, confirmação por Token A3
- Comprovante de presença baixável nos dois fluxos: Token A3 serve o termo qualificado do R2; presença em tela gera o comprovante avançado sob demanda
- Preenchimento de formulários operacionais e SEINT por membros
- Assinatura de relatórios de extra/produtividade
- Relatórios e dashboards de produtividade

### Assinatura Digital

Três modalidades suportadas:

| Modalidade      | Mecanismo                                                                                  | Dados coletados                                |
| --------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| **Qualificada** | e-CPF ICP-Brasil via WebPKI (Lacuna) ou Assinador SERPRO Desktop                           | Certificado, OCSP, carimbo de tempo (CAdES-LT) |
| **Avançada**    | 2FA por e-mail (sempre) + selfie com liveness + rubrica gráfica + GPS + selo institucional | Foto, coordenadas, user-agent, timestamp       |
| **Simples**     | Confirmação textual — **descontinuada** (restrita a fluxos FDS legados)                    | IP, user-agent, timestamp                      |

O enquadramento jurídico de cada modalidade (Lei 14.063/2020, MP 2.200-2) está no parecer `ANALISE_JURIDICA_ASSINATURAS.md`, arquivado no histórico do Git — ver [`docs/HISTORICO.md`](docs/HISTORICO.md).

### Validação Pública

A rota `/validar/[hash]` é **pública e sem autenticação**. Qualquer pessoa pode verificar a autenticidade de um documento assinado informando o hash SHA-256 exibido no PDF.

### Observabilidade e Auditoria

Dois registros complementares, ambos restritos ao **Super Admin**:

| Console           | Fonte                                                          | Conteúdo                                                                                                                                         |
| ----------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/auditoria`      | `audit_log` ([`src/lib/db/audit.ts`](src/lib/db/audit.ts))     | Trilha forense de eventos de negócio: catálogo de ações, ator × alvo, severidade, cadeia de hash verificável, exportação CSV/PDF                 |
| `/auditoria/logs` | `app_log` ([`src/lib/db/app-logs.ts`](src/lib/db/app-logs.ts)) | Logs técnicos: todo `logger.warn`/`logger.error` do servidor, persistido por request após a resposta (`waitUntil`, sem custo no caminho crítico) |

Os dois se correlacionam pelo `request_id` (gerado em `hooks.server.ts` e propagado por AsyncLocalStorage) — que é também o `errorId` exibido ao usuário em erros 5xx e a tag enviada ao Sentry. No detalhe de um evento da auditoria, o Request ID é um link para os logs técnicos daquela mesma request.

O logger estruturado ([`src/lib/logger.ts`](src/lib/logger.ts)) continua emitindo JSON para Cloudflare Logs/Logpush; a persistência em `app_log` é um espelho consultável de dentro do app (níveis `debug`/`info` não são persistidos). Retenção: purga automática junto à limpeza LGPD (`lgpd.retencao.app_log_dias`, default 90 dias).

---

## 9. Autenticação e Autorização

### Fluxo de login

1. Usuário informa matrícula + senha
2. Servidor verifica com PBKDF2-HMAC-SHA256 (100k iterações — teto do runtime da Cloudflare —, salt 16 bytes, timing-safe). Em produção, a senha passa antes por HMAC com o `PASSWORD_PEPPER` (formato `pbkdf2v3`) — ver [`DEPLOY.md`](DEPLOY.md#hashing-de-senha-e-o-password_pepper)
3. 2FA: gera código de 6 dígitos e envia por e-mail (fail-closed — conta sem e-mail cadastrado não recebe sessão)
4. Sessão criada com token de 256 bits, expira em 8 horas (`SESSION_TTL_MS` em `src/lib/auth.ts`)
5. Sessão armazenada em cookie `session_token` (httpOnly, secure, SameSite=strict)

Alternativa: **login por certificado digital A3** (e-CPF ICP-Brasil) via `/api/auth/certificado/*`, dispensa senha e 2FA por e-mail. Além da assinatura do desafio e da cadeia ICP-Brasil, o login consulta a **revogação (OCSP)** do certificado: um e-CPF revogado é recusado; se o responder da AC estiver indisponível, o login prossegue e registra `metadados.ocsp = 'unknown'` na auditoria (soft-fail). O botão existe nas duas abas do `/login`: na aba **Policial** cria sessão operacional; na aba **Administrador** (`comoAdmin`) resolve a conta admin vinculada ao policial do certificado e cria sessão de administrador no módulo escolhido.

### Primeiro acesso

Após criar um policial/admin, a conta fica bloqueada até o usuário definir sua própria senha (`primeiro_acesso = true`). O sistema redireciona automaticamente para `/alterar-senha`.

### Termo de uso

O aceite do termo de uso é obrigatório a cada nova versão. Qualquer mudança no arquivo `src/lib/server/termo/termo-vigente.ts` gera um novo hash que invalida aceites anteriores e exige reaceite na próxima sessão.

### Papéis (RBAC)

| Tipo                     | Papel             | Acesso                                                                                                                                                  |
| ------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin` + `isSuperAdmin` | Super Admin       | Tudo do Admin Geral **mais**: promover admins, gerenciar policiais/unidades, configurar política de assinatura, baixar o forense pelo portal `/validar` |
| `admin`                  | Admin Geral       | Operação global (escalas, GISE, LGPD/compliance) em todas as unidades — não remodela a base; consoles de auditoria são do Super Admin                   |
| `policial`               | `admin_seccional` | Gerencia escalas e policiais da sua seccional                                                                                                           |
| `policial`               | `admin_unidade`   | Gerencia escalas da sua unidade                                                                                                                         |
| `policial`               | —                 | Acessa apenas suas próprias escalas e GISE                                                                                                              |

A matriz completa de capacidades por papel está em [`DEPLOY.md`](DEPLOY.md#papéis-e-privilégios-de-administrador). Membros de GISE têm papéis adicionais (`supervisor`, `assessor/SEINT`, `membro`) calculados dinamicamente a partir da tabela `gise_membros`.

### Proteção CSRF

O projeto usa o padrão _double-submit cookie_:

- Geração: cookie `csrf_token` com token aleatório de 256 bits (não httpOnly)
- Verificação: todos os métodos mutantes (`POST`, `PUT`, `PATCH`, `DELETE`) em `/api/*` exigem o header `x-csrf-token` igual ao cookie
- Rotas isentas: `/api/auth/login`, `/api/health`, `/api/webhook` (autenticados por bearer token próprio)

---

## 10. Padrões de Código

> Leia também o [`CLAUDE.md`](CLAUDE.md) para diretrizes detalhadas.

### Svelte 5 — Runes obrigatórias

```svelte
<!-- ✅ CORRETO -->
<script lang="ts">
	let { titulo, onSalvar } = $props();
	let nome = $state('');
	let nomeUppercase = $derived(nome.toUpperCase());

	$effect(() => {
		document.title = titulo;
	});
</script>

<!-- ❌ NUNCA faça -->
<script lang="ts">
	export let titulo;           // use $props()
	let nome = '';               // use $state()
	$: upper = nome.toUpperCase(); // use $derived()
	import { writable } from 'svelte/store'; // use $state em arquivos .svelte.ts
	onMount(() => { ... });      // use $effect()
</script>
```

### Composables reutilizáveis

Para lógica reativa compartilhada entre componentes, crie arquivos `.svelte.ts`:

```typescript
// src/lib/composables/useContador.svelte.ts
export function useContador(inicial = 0) {
	let valor = $state(inicial);
	const dobro = $derived(valor * 2);

	return {
		get valor() {
			return valor;
		},
		get dobro() {
			return dobro;
		},
		incrementar() {
			valor++;
		}
	};
}
```

### SvelteKit — Server-first

```typescript
// ✅ CORRETO: Server Action em +page.server.ts
export const actions = {
	salvar: async ({ request, locals }) => {
		const data = await request.formData();
		const parsed = minhaSchema.parse(Object.fromEntries(data));
		await salvarNoBanco(parsed);
		return { sucesso: true };
	}
};

// ✅ CORRETO: Load function no servidor
export const load: PageServerLoad = async ({ locals }) => {
	return { policiais: await buscarPoliciais(getDB(locals.platform)) };
};
```

### Validação com Zod

Sempre valide inputs de formulários e APIs no servidor com Zod. Os schemas ficam em `src/lib/schemas/`.

```typescript
import { z } from 'zod';
import { fail } from '@sveltejs/kit';

const schema = z.object({
	nome: z.string().min(3, 'Mínimo 3 caracteres'),
	cargo: z.enum(['DPC', 'OIP'])
});

// Em uma action:
const result = schema.safeParse(Object.fromEntries(formData));
if (!result.success) return fail(400, { erro: result.error.flatten() });
```

### Code splitting

O `vite.config.ts` já configura code splitting manual para manter o bundle inicial leve. Ao adicionar novas dependências pesadas, avalie adicioná-las a um chunk existente ou criar um novo:

```typescript
// vite.config.ts — chunks manuais
manualChunks(id) {
	if (id.includes('@vladmandic/face-api') || id.includes('@tensorflow')) return 'face-api';
	if (id.includes('pdf-lib') || id.includes('jspdf') || id.includes('@signpdf')) return 'pdf';
	// ...
}
```

### Padrões visuais (UI)

Regras estabelecidas na auditoria visual de jul/2026 (`AUDITORIA_VISUAL_UX_2026-07-11.md`, arquivada — ver [`docs/HISTORICO.md`](docs/HISTORICO.md)). Os tokens vivem em [`src/theme.css`](src/theme.css) (paleta oklch de 7 canais) e [`src/app.css`](src/app.css) (`@theme` + `@utility`).

**Cores** — sempre pelos canais do tema (`primary`, `secondary`, `tertiary`, `success`, `warning`, `error`, `surface`). Nunca cores cruas da paleta Tailwind (`text-red-500`, `bg-indigo-600`…).

**Texto pequeno** — dois degraus abaixo de `text-xs`, e só eles: `text-2xs` (0,7rem — labels, badges) e `text-3xs` (0,625rem — metadados densos, piso absoluto). Não criar `text-[...]` arbitrários.

**Contraste** — texto informativo usa no mínimo `text-surface-500 dark:text-surface-400`; `text-surface-400` puro só em ícones decorativos, placeholders e estados `disabled`/inativos.

**Foco de teclado** — nunca `outline-none`/`focus:outline-none` sem substituto visível (`focus-visible:ring-2 focus-visible:ring-primary-500 …` ou `focus-within:ring` no container).

**Superfícies elevadas** — `card-elevated` (fundo canônico de modal/card sobre a página) e `card-elevated-2` (sub-card aninhado); translúcidas: `card-glass` / `card-glass-auth`. Não montar pares `bg-* dark:bg-*` à mão.

**Modais** — sempre `Dialog` do Skeleton (foco/ESC/ARIA de graça). Backdrop canônico: `bg-surface-950/80 backdrop-blur-sm`; modal empilhado sobre modal usa `backdrop-blur-md` + `z-[60]`/`z-[70]`. Card do modal: `card-elevated rounded-2xl shadow-2xl`. Rodapé: `flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3` (Cancelar = `preset-outlined-surface-500`).

**Botões (semântica dos presets)** — CTA `preset-filled-primary-500` · destrutivo `preset-filled-error-500` · cancelar/neutro `preset-outlined-surface-500`. O feedback tátil de clique (afundar 5% pressionado) é **global e automático** para `.btn`/`.btn-icon` (regra em `app.css`) — não adicionar `active:scale-95` inline; use-o apenas em elementos interativos custom fora dessas classes.

**Border-radius** — o tema define `--radius-base` (= `rounded-xl`, botões/inputs) e `--radius-container` (= `rounded-2xl`, cards/modais); pills/chips usam `rounded-full`. Em código novo, não usar `rounded`/`rounded-md`; reservar `rounded-lg` para elementos ≤ 32 px de altura.

**Z-index (escala)** — `z-10` elementos locais · `z-40` topbar mobile + backdrop da sidebar · `z-50` sidebar e modais · `z-[60]`/`z-[70]` modal sobre modal · `z-[100]` diálogos globais (logout, avisos) · `9999` toasts · `10000` LoadingOverlay e barra de progresso de navegação. Não inventar valores fora da escala.

**Breakpoints** — `xs:` (400 px, definido no `@theme`) para telefones estreitos; demais são os padrões do Tailwind. Exceção documentada: o corte da sidebar no `+layout.svelte` é `min-[900px]` (deliberado — não migrar para `lg:`).

**Ícones** — código novo usa [`lucide-svelte`](https://lucide.dev) (já é dependência; herda `currentColor`). **Nunca emoji como ícone** (✍️ ✅ 🔒…): renderizam diferente por SO e ignoram a cor do tema. O SVG inline legado migra oportunisticamente ao tocar no arquivo.

**Transições** — em código novo, prefira a propriedade específica (`transition-colors`, `transition-transform`, `transition-opacity`) a `transition-all`, que anima layout sem querer e custa mais. O legado migra oportunisticamente.

**Loading** — usar `$lib/components/Spinner.svelte` (acessível, herda `currentColor`); não desenhar SVG `animate-spin` à mão. Carregamento de página: skeletons (`SkeletonCard`) + barra de progresso do layout; operações de API: `loading.show()`/`hide()`.

**Tabelas** — padrão duplo: `<div class="hidden md:block table-wrap"><table class="table">…` no desktop + lista de cards `md:hidden` no mobile. Nunca `<table>` sem `table-wrap`.

---

## 11. Testes

### Testes unitários (Vitest)

```bash
npm run test          # Executa uma vez
npm run test:watch    # Watch mode (recomendado durante desenvolvimento)
```

Arquivos de teste ficam em `src/` com o padrão `*.test.ts`, distribuídos em pastas `__tests__/` junto do código testado (50+ arquivos, 530+ testes). Os principais grupos:

- `src/lib/__tests__/` — autenticação (PBKDF2/pepper, sessões, 2FA), CSRF, headers de segurança, utilitários
- `src/lib/server/__tests__/` — fluxo de login, assinatura (CAdES, OCSP, TSA, trust store), permissões, webhooks, Sentry/PII
- `src/lib/schemas/__tests__/` — schemas Zod (LGPD, formulários)

### Testes E2E (Playwright)

```bash
# Instalar browsers (apenas uma vez)
npx playwright install --with-deps chromium

# Rodar todos os testes E2E
npx playwright test

# Rodar com interface visual (útil para debugar)
npx playwright test --ui

# Rodar um arquivo específico
npx playwright test e2e/auth.spec.ts
```

Os testes E2E fazem build + preview automático antes de rodar (via `e2e/servidor-e2e.ts`), e o `global-setup` aplica as migrations pendentes no D1 local e semeia os fixtures — não é preciso preparar o banco manualmente. Configure credenciais de teste em `e2e/global-setup.ts`. Além do projeto `chromium`, um projeto `mobile` (Pixel 7 emulado) reexecuta os specs de UI em viewport de celular.

**Fluxo A3 qualificado em CI:** o build de E2E injeta uma **CA de teste** no trust store ICP-Brasil (`E2E_TEST_CA=1` no build → `define` do Vite → `trust-store.ts`; chaves regeneradas a cada execução em `e2e/ca-teste/artefatos/`, gitignored). O spec `assinatura-qualificada-a3.spec.ts` faz o papel do Assinador SERPRO no runner (CMS CAdES assinado com o "e-CPF" de teste) e percorre preparar → finalizar → download → `/validar` contra a verificação real do servidor — incluindo os negativos de CA desconhecida, CPF divergente e digest adulterado. Em build normal a constante não existe e o ramo é código morto: **não há env de runtime capaz de ligar a CA de teste em produção**.

### Testes manuais

O arquivo [`TESTING.md`](TESTING.md) é o roteiro de **exceção**: cobre o que exige hardware ou ambiente real (Assinador SERPRO com token físico, caixa de e-mail, ACT ICP). O gate de regressão é a suíte automatizada (Vitest + Playwright no CI); os casos do TESTING.md já cobertos por spec estão anotados no próprio arquivo.

---

## 12. Deploy em Produção

> Para o runbook completo de operações, leia [`DEPLOY.md`](DEPLOY.md).

### Pré-requisitos

- Wrangler autenticado: `wrangler login`
- Variáveis de ambiente configuradas no **Cloudflare Pages → Settings → Environment Variables**
- Projeto Pages criado no dashboard Cloudflare

### Deploy via CI/CD (recomendado)

Faça push ou abra PR para as branches `main` ou `staging`. O GitHub Actions (`.github/workflows/deploy.yml`) executa automaticamente:

1. `npm run lint:ci` + `npm run format:check`
2. `npx svelte-check --threshold error`
3. `npx vitest run`
4. `npm run build`
5. Guards de padrão (erros de API via `$lib/server/api`, permissão de documento assinado)
6. Migrações D1 locais + `npx playwright test` (E2E)
7. `wrangler pages deploy` (push em `staging` gera um _preview deployment_ com D1/R2 dedicados)

### Deploy manual

```bash
# 1. Aplicar migrações de banco em produção (SEMPRE antes de deploiar código novo)
npm run db:migrate:prod -- --yes

# 2. Build
npm ci
npm run build

# 3. Deploy
wrangler pages deploy .svelte-kit/cloudflare --project-name=escalas
```

### Checklist pré-deploy

- [ ] Todas as variáveis de ambiente estão configuradas no dashboard Cloudflare
- [ ] `RESET_TOKEN` é diferente de `SYNC_TOKEN` (ou intencionalmente vazio)
- [ ] Migrações aplicadas: `npm run db:migrate:prod -- --yes`
- [ ] Testes passando: `npm run test`
- [ ] Type-check limpo: `npm run check`
- [ ] Build sem erros: `npm run build`

### Smoke tests pós-deploy

1. Acessar a URL do projeto e fazer login
2. `GET /api/health` deve retornar `200 OK`
3. Verificar uma escala existente e conferir o PDF
4. Conferir logs em **Cloudflare Pages → Functions → Logs**

### Cache edge de configurações

As flags de assinatura (`exigir_foto`, `exigir_gps`, etc.) são cacheadas por 5 minutos em todos os PoPs Cloudflare. Quando um admin altera a configuração em `/conf-ass`, o cache é invalidado automaticamente via Cloudflare Cache API.

### Reset destrutivo (emergência)

O endpoint `/api/webhook/reset-policiais` **apaga todas as tabelas operacionais**. Requer três camadas de autenticação simultâneas:

1. `Authorization: Bearer <SYNC_TOKEN>`
2. `X-Reset-Token: <RESET_TOKEN>`
3. `X-Confirm-Reset: <YYYY-MM-DD em UTC>` (janela de 24 horas, previne replay attacks)

> ⚠️ Use apenas via o menu da planilha Google Sheets, que exige confirmação dupla.

---

## 13. Softwares Externos e Integrações

### Assinador SERPRO Desktop

Para assinatura qualificada com certificado A3 (hardware token), o usuário precisa ter o **Assinador SERPRO Desktop** instalado na máquina. O sistema se conecta a ele via WebSocket local.

- Download: [assinador.serpro.gov.br](https://www.serpro.gov.br/menu/nossas-forcas/especializados/assinador-digital)
- O sistema tenta automaticamente as portas 65166, 65156 e 65500 em `assinador-desktop.serpro.gov.br` e `127.0.0.1`
- **Em ambiente de desenvolvimento**: logs detalhados de conexão aparecem no console do navegador (gateados por `import.meta.env.DEV`)

### WebPKI (Lacuna Software)

Alternativa ao SERPRO para assinatura qualificada. Requer extensão do navegador ou plugin instalado. A biblioteca (`web-pki`) é carregada sob demanda.

- Documentação: [docs.lacunasoftware.com](https://docs.lacunasoftware.com/articles/web-pki/)

### Google Apps Script (sincronização de planilha)

O arquivo [`scripts/GoogleAppsScript_Sync.gs`](scripts/GoogleAppsScript_Sync.gs) é um Apps Script configurado em uma planilha Google que sincroniza policiais e unidades. Ele chama os webhooks da aplicação autenticado pelo `SYNC_TOKEN` (com replay protection — ver [`DEPLOY.md`](DEPLOY.md#replay-protection-dos-webhooks-p13)).

Para configurar:

1. Abra a planilha Google em `Extensões → Apps Script`
2. Cole o conteúdo de `scripts/GoogleAppsScript_Sync.gs`
3. Use o menu "🚀 Sincronização D1" → "⚙️ Configurar tokens" para gravar `SYNC_TOKEN` (e `RESET_TOKEN`, se for usar reset) no `PropertiesService`
4. Para a integração `Base_Equipe` (GISE), publique como Web App — detalhes em [`scripts/README.md`](scripts/README.md)

### Reconhecimento facial (face-api)

Os modelos de IA do `@vladmandic/face-api` estão em `static/face-api/` e são **servidos pelo próprio projeto** (sem dependência externa de CDN). Isso garante conformidade com a CSP e evita _rate limiting_.

Para atualizar os modelos: siga as instruções em `static/face-api/README.md`.

### E-mail transacional (2FA, primeiro acesso, reset de senha)

O envio de e-mail usa o **binding `EMAIL`** (Cloudflare Email Sending, configurado em Pages → Settings → Bindings) como caminho primário, com **Resend** como fallback (`RESEND_API_KEY` + `RESEND_FROM_EMAIL`). A implementação está em `src/lib/server/email.ts`.

> **Importante:** sem e-mail funcionando, o 2FA (fail-closed) e o primeiro acesso travam. Ver [`DEPLOY.md`](DEPLOY.md#variáveis-e-secrets).

---

## 14. Troubleshooting

### `npm run dev` falha com erro de binding D1/R2

O banco local ainda não existe. Rode `npm run db:migrate` antes.

### Type errors em arquivos `.svelte` que não aparecem no editor

Execute `npm run check` (usa o Svelte Check, que é mais rigoroso que o servidor de linguagem do editor). O VS Code com a extensão oficial do Svelte geralmente alinha com o check, mas pode haver delay.

### Erro de CSRF em chamadas de API no desenvolvimento

Certifique-se de que o frontend usa `csrfHeaders()` de `$lib/csrf` em todas as requisições mutantes:

```typescript
import { csrfHeaders } from '$lib/csrf';

await fetch('/api/meu-endpoint', {
	method: 'POST',
	headers: { ...csrfHeaders(), 'Content-Type': 'application/json' },
	body: JSON.stringify(dados)
});
```

### Assinador SERPRO não conecta

1. Verifique se o Assinador SERPRO Desktop está rodando na bandeja do sistema
2. Abra `https://assinador-desktop.serpro.gov.br:65166` no navegador e aceite o certificado self-signed
3. No Firefox, o fluxo de autorização do certificado é mais simples que no Chrome
4. Abra o console do navegador (F12) — em desenvolvimento, logs detalhados de tentativa de conexão são exibidos

### Sessão expirada logo após login

Verifique se o relógio do servidor está sincronizado (NTP). O D1 usa timestamps UTC. Uma diferença grande de fuso pode invalidar sessões prematuramente.

### Migrações em produção falham

1. Certifique-se de que o Wrangler está autenticado: `wrangler whoami`
2. Verifique se o `database_id` em `wrangler.toml` corresponde ao banco correto no dashboard
3. Confira o arquivo `migrations/meta/_journal.json` — ele rastreia quais migrações já foram aplicadas

### Análise de bundle

Para inspecionar o tamanho dos chunks após o build:

```bash
npm run build
# Abre bundle-stats.html no navegador
```

---

_Em caso de dúvidas técnicas, comece pelos arquivos `+page.server.ts` da rota em questão — eles contêm a lógica de negócio mais próxima do banco. Para dúvidas de produto, consulte a liderança técnica do time._
