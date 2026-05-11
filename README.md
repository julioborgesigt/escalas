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

| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| Meta-framework | SvelteKit | 2.50.2 |
| UI | Svelte 5 (runes) | 5.51.0 |
| Estilização | Tailwind CSS v4 + Skeleton UI v4 | 4.2.2 / 4.13.0 |
| ORM | Drizzle ORM | 0.45.1 |
| Banco de dados | Cloudflare D1 (SQLite serverless) | — |
| Armazenamento | Cloudflare R2 (PDFs, selfies, documentos) | — |
| Hospedagem | Cloudflare Pages (edge runtime) | — |
| Validação | Zod | 4.3.6 |
| Assinatura digital | pdf-lib + @signpdf + node-forge + web-pki | — |
| Reconhecimento facial | @vladmandic/face-api (TensorFlow.js) | 1.7.15 |
| E-mail | Nodemailer (SMTP Gmail) | 8.0.4 |
| Geração de documentos | jsPDF + ExcelJS + docx | — |
| Monitoramento | Sentry (Cloudflare Workers) | 10.47.0 |
| Testes unitários | Vitest | 4.1.0 |
| Testes E2E | Playwright | 1.59.1 |
| Build | Vite | 7.3.1 |
| Linguagem | TypeScript | 5.9.3 |

---

## 2. Pré-requisitos

Antes de começar, certifique-se de ter instalado:

- **Node.js v20+** — [nodejs.org](https://nodejs.org)
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
# Opcional — só se quiser testar envio de e-mail:
# GMAIL_USER=seu-email@gmail.com
# GMAIL_APP_PASSWORD=senha-de-app-16-chars
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

| Variável | Obrigatória | Descrição |
|----------|:-----------:|-----------|
| `SYNC_TOKEN` | ✅ | Bearer token para os webhooks de sincronização (`/api/webhook/sync-policiais`, `/api/webhook/sync-unidades`). Gere com `openssl rand -hex 32`. |
| `RESET_TOKEN` | ⚠️ | Token **separado** do `SYNC_TOKEN` para o endpoint destrutivo `/api/webhook/reset-policiais`. Se não definido, o endpoint retorna 401 (fail-closed seguro). |
| `GMAIL_USER` | ⚠️ | Endereço de e-mail para envio via SMTP do Gmail. Recomenda-se uma conta de serviço dedicada. |
| `GMAIL_APP_PASSWORD` | ⚠️ | [App Password do Gmail](https://support.google.com/accounts/answer/185833) (16 caracteres). **Nunca use a senha normal da conta.** |
| `ADMIN_GERAL_LOGIN` | ❌ | Login do Admin Geral via env (apenas para bootstrap inicial). **Remova em produção** — essa conta bypassa o 2FA. |
| `ADMIN_GERAL_SENHA` | ❌ | Senha do Admin Geral via env (apenas para bootstrap inicial). |
| `GISE_BASE_EQUIPE_WEBHOOK_URL` | ❌ | URL do Google Apps Script que popula a aba `Base_Equipe` da planilha. Ex: `https://script.google.com/macros/s/AKfy.../exec` |
| `GISE_BASE_EQUIPE_SECRET` | ❌ | Segredo compartilhado com `ScriptProperties.BASE_EQUIPE_SECRET` no Apps Script. Gere com `openssl rand -hex 32`. |

> **Dica:** Use `openssl rand -hex 32` para gerar qualquer token seguro de 256 bits.

### Bindings Cloudflare (`wrangler.toml`)

Não são variáveis de ambiente, mas recursos Cloudflare vinculados automaticamente:

| Binding | Tipo | Descrição |
|---------|------|-----------|
| `escalas_db` | D1 Database | Banco de dados SQLite serverless principal |
| `escalas_docs` | R2 Bucket | Armazenamento de PDFs, selfies e documentos assinados |

---

## 5. Banco de Dados

### Tecnologia

O projeto usa **Cloudflare D1** (SQLite serverless) via **Drizzle ORM**. O schema está em `src/lib/server/schema.ts`.

- **Local**: SQLite gerenciado pelo Wrangler em `.wrangler/state/v3/d1/`
- **Produção**: D1 na infraestrutura Cloudflare

### Principais tabelas

| Tabela | Descrição |
|--------|-----------|
| `policiais` | Servidores (matrícula, CPF, cargo, lotação, senha PBKDF2, papel RBAC) |
| `administradores` | Admins gerais do sistema |
| `sessoes` | Sessões ativas (token, tipo, expiração em 12h) |
| `escalas` | Escalas de plantão, expediente e FDS |
| `escala_policiais` | Associação policial ↔ escala (data, horário, equipe) |
| `escala_documentos` | PDFs assinados com metadados CAdES-LT (OCSP, TST, selfie, GPS, IP) |
| `escala_solicitacoes_assinatura` | Solicitações de assinatura por unidade/respondência |
| `unidades` | Hierarquia: departamento → seccional → delegacia |
| `gise_escalas` | GISE operacionais (status, supervisor, assessor, configuração) |
| `gise_seccionais` | Seccionais dentro de uma GISE |
| `gise_equipes` | Equipes (operacional/SEINT) com slots DPC/OIP |
| `gise_membros` | Associação policial ↔ equipe GISE |
| `gise_presencas` | Registros de entrada/saída (GPS, selfie, rubrica) |
| `gise_documentos` | PDFs assinados de GISE |
| `gise_respostas_formulario` | Respostas de formulários (JSON) por policial/equipe |
| `gise_assinaturas_relatorios` | Assinaturas de relatórios de extra/produtividade |
| `aceites_termos` | Histórico de aceite de termos de uso (versão, hash, IP, user-agent) |

### Comandos de migração

```bash
# Aplicar migrações localmente
npm run db:migrate

# Aplicar migrações em produção (requer Wrangler autenticado)
npm run db:migrate:prod

# Gerar nova migração após alterar src/lib/server/schema.ts
npx drizzle-kit generate --dialect sqlite
```

> **Importante:** nunca edite arquivos em `migrations/` manualmente. Sempre edite o schema e deixe o Drizzle gerar o SQL.

### Histórico de migrações

| # | Arquivo | O que faz |
|---|---------|-----------|
| 0 | `0000_initial_schema.sql` | Schema completo inicial |
| 1 | `0001_lat_lng_real_normalize.sql` | Normaliza lat/lng para `REAL` |
| 2 | `0002_auth_legacy_password_deadline.sql` | Deadline para hashes SHA-256 legados |
| 3 | `0003_gise_supervisao_extra_unidade.sql` | Supervisão extra por unidade |
| 4 | `0004_unidades_departamentos.sql` | Hierarquia de departamentos |
| 5 | `0005_supervisao_extra_para_departamento.sql` | Supervisão extra por departamento |
| 6 | `0006_seed_departamento_supervisao_extra.sql` | Seed inicial de departamentos |
| 7 | `0007_gise_escalas_feriado.sql` | Coluna `feriado` em GISE |
| 8 | `0008_gise_breve_relatorio_textos.sql` | Configuração de breve relatório |
| 9 | `0009_gise_planilha_base_equipe_alimentada.sql` | Timestamp de sincronização com planilha |
| 10 | `0010_expandir_tipos_dois_fatores_tokens.sql` | Novos tipos de desafio 2FA |
| 11 | `0011_gise_assessor_email_notificacao.sql` | E-mail customizado de notificação GISE |
| 12 | `0012_signature_verification_metadata.sql` | Metadados CAdES-LT (issuer, serial, OCSP, TST) |
| 13 | `0013_termos_uso.sql` | Versionamento de termos de uso |
| 14 | `0014_fds_finalizada.sql` | Status de FDS finalizada |
| 15 | `0015_fds_email_envio.sql` | E-mail de envio de FDS |
| 16 | `0016_escala_solicitacoes_assinatura.sql` | Solicitações de assinatura |

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
npm run lint               # ESLint (falha com qualquer warning)
npm run lint:fix           # ESLint com auto-fix
npm run format             # Prettier (formata todos os arquivos)
npm run format:check       # Prettier sem alterar (só verifica)

# Testes
npm run test               # Vitest (run once)
npm run test:watch         # Vitest (watch mode)

# Banco de dados
npm run db:migrate         # Aplica migrações localmente
npm run db:migrate:prod    # Aplica migrações em produção

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
│   │   │   └── health/             # Health check
│   │   ├── login/                  # Página de login + 2FA
│   │   ├── alterar-senha/          # Troca de senha obrigatória (primeiro acesso)
│   │   ├── redefinir-senha/        # Reset de senha via token
│   │   ├── aceitar-termo/          # Aceite de termo de uso
│   │   ├── escalas/                # Gestão de escalas (lista, nova, detalhe)
│   │   ├── painel/                 # Dashboard admin
│   │   ├── recebidos/              # Caixa de entrada de escalas recebidas
│   │   ├── gise/                   # GISE (lista, detalhe, config de questões)
│   │   ├── res-gise/               # Presença e relatórios GISE (visão do membro)
│   │   ├── policiais/              # Gestão de policiais (lista, detalhe, upload CSV)
│   │   ├── unidades/               # Gestão de unidades
│   │   ├── produtividade/          # Dashboard de produtividade
│   │   ├── conf-ass/               # Configuração de assinatura
│   │   ├── validar/                # Validação pública de PDF assinado
│   │   ├── termo/[versao]/         # Consulta pública do termo de uso
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
│   │   │   ├── useLocalStorageFilters.svelte.ts # Filtros persistidos
│   │   │   └── ...
│   │   ├── server/                 # Backend puro — nunca importar no cliente
│   │   │   ├── schema.ts           # Schema Drizzle (fonte de verdade do banco)
│   │   │   ├── pdf-signing.ts      # Geração e assinatura de PDFs
│   │   │   ├── pdf-verification.ts # Validação de assinaturas (OCSP, CAdES)
│   │   │   ├── icp-brasil/         # Trust store ICP-Brasil
│   │   │   ├── email.ts            # Envio de e-mail via Nodemailer
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
- Registro de presença (entrada/saída com GPS, selfie e rubrica)
- Preenchimento de formulários operacionais e SEINT por membros
- Assinatura de relatórios de extra/produtividade
- Relatórios e dashboards de produtividade

### Assinatura Digital

Três modalidades suportadas:

| Modalidade | Mecanismo | Dados coletados |
|-----------|-----------|-----------------|
| **Qualificada** | e-CPF ICP-Brasil via WebPKI (Lacuna) ou Assinador SERPRO Desktop | Certificado, OCSP, carimbo de tempo (CAdES-LT) |
| **Avançada** | Selfie + rubrica gráfica + GPS + IP | Foto, coordenadas, user-agent, timestamp |
| **Simples** | Confirmação textual | IP, user-agent, timestamp |

### Validação Pública

A rota `/validar/[hash]` é **pública e sem autenticação**. Qualquer pessoa pode verificar a autenticidade de um documento assinado informando o hash SHA-256 exibido no PDF.

---

## 9. Autenticação e Autorização

### Fluxo de login

1. Usuário informa matrícula + senha
2. Servidor verifica com PBKDF2 (100k iterações, salt 16 bytes, timing-safe)
3. Se `exigir_2fa` habilitado: gera código de 6 dígitos e envia por e-mail (válido por 10 min)
4. Sessão criada com token de 256 bits, expira em 12 horas
5. Sessão armazenada em cookie `session_token` (httpOnly, secure, SameSite=strict)

### Primeiro acesso

Após criar um policial/admin, a conta fica bloqueada até o usuário definir sua própria senha (`primeiro_acesso = true`). O sistema redireciona automaticamente para `/alterar-senha`.

### Termo de uso

O aceite do termo de uso é obrigatório a cada nova versão. Qualquer mudança no arquivo `src/lib/server/termo/termo-vigente.ts` gera um novo hash que invalida aceites anteriores e exige reaceite na próxima sessão.

### Papéis (RBAC)

| Tipo | Papel | Acesso |
|------|-------|--------|
| `admin` | — | Acesso total ao sistema (painel, policiais, unidades, GISE, escalas) |
| `policial` | `admin_seccional` | Gerencia escalas e policiais da sua seccional |
| `policial` | `admin_unidade` | Gerencia escalas da sua unidade |
| `policial` | — | Acessa apenas suas próprias escalas e GISE |

Membros de GISE têm papéis adicionais (`supervisor`, `assessor/SEINT`, `membro`) calculados dinamicamente a partir da tabela `gise_membros`.

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
		get valor() { return valor; },
		get dobro() { return dobro; },
		incrementar() { valor++; }
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

---

## 11. Testes

### Testes unitários (Vitest)

```bash
npm run test          # Executa uma vez
npm run test:watch    # Watch mode (recomendado durante desenvolvimento)
```

Arquivos de teste ficam em `src/` com o padrão `*.test.ts`:

- `src/lib/__tests__/auth.test.ts` — lógica de autenticação (PBKDF2, sessões, 2FA)
- `src/lib/__tests__/security.test.ts` — CSRF, headers de segurança
- `src/lib/__tests__/utils.test.ts` — funções utilitárias
- `src/lib/__tests__/api-helpers.test.ts` — helpers de API

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

Os testes E2E fazem build + preview automático antes de rodar. Configure credenciais de teste em `e2e/global-setup.ts`.

### Testes manuais

O arquivo [`TESTING.md`](TESTING.md) contém mais de 100 casos de teste documentados cobrindo todos os fluxos de negócio: login, 2FA, assinaturas, GISE, escalas, validação de documentos. Use-o como guia de regressão antes de releases importantes.

---

## 12. Deploy em Produção

> Para o runbook completo de operações, leia [`DEPLOY.md`](DEPLOY.md).

### Pré-requisitos

- Wrangler autenticado: `wrangler login`
- Variáveis de ambiente configuradas no **Cloudflare Pages → Settings → Environment Variables**
- Projeto Pages criado no dashboard Cloudflare

### Deploy via CI/CD (recomendado)

Faça push ou abra PR para as branches `main` ou `staging`. O GitHub Actions (`.github/workflows/deploy.yml`) executa automaticamente:

1. `npm run lint` + `npm run format:check`
2. `npm run check`
3. `npm run test`
4. `npx playwright test`
5. `npm run build`
6. `wrangler pages deploy`

### Deploy manual

```bash
# 1. Aplicar migrações de banco em produção (SEMPRE antes de deploiar código novo)
npm run db:migrate:prod

# 2. Build
npm ci
npm run build

# 3. Deploy
wrangler pages deploy .svelte-kit/cloudflare --project-name=escalas
```

### Checklist pré-deploy

- [ ] Todas as variáveis de ambiente estão configuradas no dashboard Cloudflare
- [ ] `RESET_TOKEN` é diferente de `SYNC_TOKEN` (ou intencionalmente vazio)
- [ ] Migrações aplicadas: `npm run db:migrate:prod`
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

O arquivo `scripts/GoogleAppsScript_Sync.gs` é um Apps Script configurado em uma planilha Google que sincroniza policiais e unidades. Ele chama os webhooks da aplicação autenticado pelo `SYNC_TOKEN`.

Para configurar:
1. Abra a planilha Google no modo de script
2. Cole o conteúdo de `Código.gs`
3. Configure `PropertiesService` com `SYNC_TOKEN`, `RESET_TOKEN` e a URL da aplicação
4. Publique como Web App (acesso: "Somente eu")

### Reconhecimento facial (face-api)

Os modelos de IA do `@vladmandic/face-api` estão em `static/face-api/` e são **servidos pelo próprio projeto** (sem dependência externa de CDN). Isso garante conformidade com a CSP e evita _rate limiting_.

Para atualizar os modelos: siga as instruções em `static/face-api/README.md`.

### SMTP Gmail

Configure uma conta de serviço dedicada para envio de e-mails:

1. Crie uma conta Gmail específica para o sistema
2. Ative a verificação em dois fatores
3. Gere uma [App Password](https://support.google.com/accounts/answer/185833) de 16 caracteres
4. Configure `GMAIL_USER` e `GMAIL_APP_PASSWORD` nas variáveis de ambiente

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

*Em caso de dúvidas técnicas, comece pelos arquivos `+page.server.ts` da rota em questão — eles contêm a lógica de negócio mais próxima do banco. Para dúvidas de produto, consulte a liderança técnica do time.*
