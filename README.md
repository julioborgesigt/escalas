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
# Gere cada um com `openssl rand -hex 32`. NÃO use uma string curta qualquer:
# os webhooks recusam SYNC_TOKEN com menos de 32 caracteres (fail-closed contra
# segredo fraco em produção), e a suíte E2E falha com 401 se você encurtar.
SYNC_TOKEN=<openssl rand -hex 32>
RESET_TOKEN=<outro openssl rand -hex 32, diferente do SYNC_TOKEN>
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

### 3.5 Modelos de reconhecimento facial

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
| `audit_pendencias`               | Evento de auditoria que a cadeia recusou — reprocessado pelo cron de retenção                                       |
| `assinatura_intencoes`           | Amarra cada PDF preparado ao documento, ao assinante e a um único uso (15 min)                                      |
| `escala_solicitacoes_assinatura` | Solicitações de assinatura por unidade/respondência                                                                 |
| `unidades`                       | Hierarquia: departamento → seccional → delegacia. Ligada por **nome** (ver abaixo)                                  |
| `operacoes`                      | Operações extraordinárias (GISE, CRAJUBAR, EDGE): tipos de equipe, ciclo, `ativo` e a config de escala da operação  |
| `operacao_linha_base`            | Valor inicial de cada indicador por (operação, unidade) — o denominador das metas percentuais                       |
| `gise_escalas`                   | Escalas extras (status, supervisor, assessor, configuração) — cada uma pertence a uma `operacao`                    |
| `gise_seccionais`                | Seccionais dentro de uma GISE                                                                                       |
| `gise_equipes`                   | Equipes (operacional/SEINT) com slots DPC/OIP                                                                       |
| `gise_membros`                   | Associação policial ↔ equipe GISE                                                                                   |
| `gise_presencas`                 | Registros de entrada/saída (GPS, selfie, rubrica)                                                                   |
| `gise_documentos`                | PDFs assinados de GISE                                                                                              |
| `gise_modelo_formulario`         | Modelo do formulário de produtividade em JSON, um por (operação, tipo de equipe)                                    |
| `gise_respostas_formulario`      | Respostas de formulários (JSON) por policial/equipe                                                                 |
| `gise_assinaturas_relatorios`    | Assinaturas de relatórios de extra/produtividade                                                                    |
| `aceites_termos`                 | Histórico de aceite de termos de uso (versão, hash, IP, user-agent)                                                 |
| `audit_log`                      | Trilha de auditoria forense (eventos de negócio, cadeia de hash tamper-evident)                                     |
| `app_log`                        | Logs técnicos do servidor (warn/error do logger, correlacionados por `request_id`)                                  |

### Unidade é referenciada por NOME

Herança da planilha que originou o sistema: `policiais.lotacao` e
`escalas.lotacao` guardam o **nome** da unidade, não uma chave estrangeira. Duas
consequências que valem para qualquer mudança nessa área:

- **Renomear cascateia.** `atualizarUnidade` propaga o nome novo para policiais e
  escalas na mesma operação. Um `UPDATE` direto no banco quebraria os vínculos.
- **Unidade NÃO se exclui — só se desativa.** Não existe ação de excluir na
  interface nem função de DELETE na camada de dados: `definirUnidadeAtiva` marca
  `ativo = 0`, a unidade some das listas de escolha (`listarUnidades`) e continua
  existindo para todo o resto. A tela de gestão usa `listarTodasUnidades` e a
  exibe marcada como "Desativada", com botão de reativar.

  O motivo é a assinatura: `gise_assinaturas_relatorios.seccional_id` referencia
  `unidades(id)`, e o D1 aplica chave estrangeira de verdade. Apagar a unidade
  levava junto o registro do ato de assinar — assinante, CPF, rubrica, selfie,
  IP, GPS, hash do arquivo e a chave do PDF no R2 — e o portal público
  `/validar` passava a responder "documento não encontrado" para um papel já
  entregue, indistinguível de documento falso. Escala e lotação, que ligam por
  NOME e sem FK, ficavam órfãs sem erro nenhum.

  Como defesa em profundidade, a FK passou de `CASCADE` para `RESTRICT`
  (migração `0038`): mesmo um `DELETE` manual fora da aplicação é recusado pelo
  banco.

### Comandos de migração

```bash
# Aplicar migrações localmente
npm run db:migrate

# Aplicar migrações em staging (D1 dedicado escalas-db-staging)
npm run db:migrate:staging

# Aplicar migrações em produção (requer Wrangler autenticado; --yes obrigatório)
npm run db:migrate:prod -- --yes
```

> **Importante:** as migrações são **escritas à mão**, e editar
> `src/lib/server/schema.ts` **não cria tabela nenhuma** — muda só o tipo visto
> pelo TypeScript. Uma coluna que existe só no schema compila, passa no `check` e
> falha no primeiro `SELECT`. Toda alteração precisa do par: schema **+** um
> `migrations/00NN_descricao.sql` novo.
>
> Não use `drizzle-kit generate`. O `drizzle.config.ts` ainda aponta para o
> schema e as 12 primeiras migrações saíram dele, mas o gerador não produz o
> _rebuild_ de tabela (criar nova → copiar → dropar → renomear) que o SQLite do
> D1 exige para quase todo `ALTER` real.

### Histórico de migrações

O histórico completo está na própria pasta [`migrations/`](migrations/) — os nomes dos arquivos são autoexplicativos (`0000_initial_schema.sql` … `0052_indicador_cobertura.sql`). Para entender uma migração específica, leia o SQL dela e o trecho correspondente do [`src/lib/server/schema.ts`](src/lib/server/schema.ts).

O que já rodou em cada ambiente é rastreado pela tabela `_migrations_aplicadas`, gravada pelo runner [`scripts/migrate.ts`](scripts/migrate.ts). (O `migrations/meta/` do `drizzle-kit` foi removido em jul/2026: ficou parado em 2 entradas para dezenas de arquivos e só induzia a erro.)

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
npm run format             # Prettier em src/ (escreve)
npm run format:check       # Prettier em src/ sem alterar (só verifica)
npm run format:e2e         # Prettier em e2e/ (escreve)
npm run format:check:e2e   # Prettier em e2e/ sem alterar (gate próprio no CI)
npm run knip               # Detecção de código/exports mortos
npm run docs:inventario    # Inventário de documentação (cabeçalhos, contratos, opacos)
npm run docs:guard         # Falha se arquivo NOVO em lib/db vier sem doc (roda no CI)
npm run guard:autorizacao  # Falha se operação material não recusar ninguém (roda no CI)
npm run guard:duplicacao   # Falha em bloco de 10 linhas copiado entre arquivos (roda no CI)

# Testes
npm run test               # Vitest (run once)
npm run test:watch         # Vitest (watch mode)
npm run test:coverage      # Vitest com cobertura
npm run test:e2e           # Playwright (build + preview automáticos)
npm run test:e2e:ui        # Playwright com UI de debug
npm run test:e2e:report    # Abre o relatório da última execução E2E

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

> **Duplicação / código morto:** além do `knip`, o repositório versiona [`.fallowrc.json`](.fallowrc.json) para o [`fallow`](https://github.com/fallow-rs/fallow) (`fallow dupes`) — sinal de investigação nas auditorias de compreensibilidade, não gate de CI.

### Revisão de PR grande: `npm run docs:inventario`

Antes de abrir (ou revisar) um PR que mexe em muitos arquivos, rode:

```bash
npm run docs:inventario          # resumo por categoria
npm run docs:inventario -- --lista   # backlog completo
```

Ele mede três coisas, na ordem de retorno que importa:

| métrica             | o que significa                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------ |
| **sem cabeçalho**   | o arquivo não diz o que é nem quem o usa — comentário de maior retorno                     |
| **opacos**          | ≥ 12 pontos de decisão por 100 linhas e < 6% de comentário: regra de negócio irrecuperável |
| **exports sem doc** | contrato público sem dizer o que devolve, o que assume e que efeito tem                    |

É heurística para PRIORIZAR, não gate: componente com 800 linhas de markup e
2% de comentário pode estar certo — o que ele precisa é do cabeçalho. O gate
automático é só para arquivo novo em `lib/db` (`npm run docs:guard`, no CI).

O histórico da varredura que zerou esse backlog está arquivado — ver
[`docs/HISTORICO.md`](docs/HISTORICO.md).

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
│   │   ├── _components/            # Regras de navegação compartilhadas pelas rotas:
│   │   │                           #   menu-visibilidade.ts (sidebar) e
│   │   │                           #   bem-vindo-cards.ts (quadros) — as duas do MESMO par de flags
│   │   ├── bem-vindo/              # Boas-vindas pós-login (+ escalas/bem-vindo e gise/bem-vindo por módulo)
│   │   ├── super-admin/            # Console de boas-vindas do Super Admin
│   │   ├── escalas/                # Gestão de escalas (lista, nova, detalhe)
│   │   ├── painel/                 # Dashboard admin
│   │   ├── recebidos/              # Caixa de entrada de escalas recebidas
│   │   ├── gise/                   # GISE (lista, detalhe, config de questões)
│   │   ├── res-gise/               # GISE do membro: "Presença GISE" (ativas) e "Histórico GISE" (?status=finalizadas) — duas abas da sidebar, mesma rota
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
│   │   │   │                       # Raiz = infra transversal; subpastas = domínio
│   │   │   ├── schema.ts           # Schema Drizzle (fonte de verdade do banco)
│   │   │   ├── api.ts              # Helpers de erro da API (ErrorCode, requireAuth…)
│   │   │   ├── email.ts            # Envio de e-mail (binding EMAIL / Resend)
│   │   │   ├── logger.ts           # Logger com contexto de request + persistência
│   │   │   ├── r2-cleanup.ts       # Limpeza de objetos no R2
│   │   │   ├── policial-permissao.ts  # Escopo administrativo sobre o cadastro
│   │   │   ├── assinatura/         # Assinatura digital: PAdES/CAdES, OCSP, TSA, selo
│   │   │   │   ├── pdf-signing.ts      # Geração e assinatura de PDFs
│   │   │   │   ├── pdf-verification.ts # Validação de assinaturas (OCSP, CAdES)
│   │   │   │   ├── icp-brasil/         # Trust store ICP-Brasil
│   │   │   │   └── ...
│   │   │   ├── auth/               # Login, certificado A3, sessão, CSRF, webhooks
│   │   │   ├── escalas/            # Regras de escala: conflito, exclusão, permissão
│   │   │   ├── gise/               # Regras GISE: permissão, papéis, termo de presença
│   │   │   ├── export/             # Geração de PDF/XLSX/DOCX
│   │   │   ├── sync/               # Contrato de resposta dos webhooks de sincronização
│   │   │   ├── termo/              # Conteúdo e hash do termo de uso vigente
│   │   │   └── ...
│   │   ├── db/                     # Camada de acesso ao banco (queries tipadas)
│   │   │   ├── core.ts             # getDB()/getR2(), paginação e timestamps SQLite
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
│   │   ├── api-fetch.ts            # Fetch da API interna (CSRF + erro tipado) — obrigatório
│   │   ├── assinatura-token.ts     # Fluxo preparar → assinar → finalizar com certificado
│   │   ├── enhance-handler.ts      # Resultado de form action → toast (fonte única)
│   │   ├── sync-estado.ts          # Poll de revalidação no cliente (par de server/*/sync-estado)
│   │   ├── institucional.ts        # Nome oficial da corporação e dos órgãos (timbre e prosa)
│   │   ├── serpro.ts               # Cliente WebSocket para Assinador SERPRO Desktop
│   │   ├── csrf.ts                 # Helpers CSRF (cliente)
│   │   ├── loading.svelte.ts       # Estado global de loading
│   │   ├── toast.ts                # Sistema de toasts
│   │   ├── crypto/                 # Primitivas: hash, token opaco, timing-safe, envelope AES
│   │   ├── utils/                  # Utilidades puras (sem barrel — importe o módulo)
│   │   │   ├── datas.ts            # Datas/calendário BR (ISO YYYY-MM-DD, fuso)
│   │   │   ├── formato.ts          # Máscaras de entrada (CPF, telefone, NUP)
│   │   │   ├── pii.ts              # Mascaramento de dado pessoal para exibição
│   │   │   ├── download.ts         # Download de blob no navegador
│   │   │   └── localStorage.ts     # Acesso seguro ao localStorage
│   │   └── logger.ts               # Logger estruturado
│   ├── hooks.server.ts             # Middleware global (CSRF, auth, headers de segurança)
│   ├── app.d.ts                    # Tipos globais (bindings CF, App.Locals)
│   ├── app.css                     # Estilos globais
│   ├── app.html                    # HTML raiz
│   └── theme.css                   # Variáveis CSS do tema
├── migrations/                     # Migrações SQL versionadas (escritas à mão)
├── scripts/                        # Scripts utilitários Node.js
│   ├── migrate.ts                  # Runner de migrações
│   ├── guard-autorizacao.mjs       # Gate CI: operação material precisa recusar alguém
│   ├── guard-docs-novos.mjs        # Gate CI: arquivo novo em lib/db com cabeçalho/JSDoc
│   ├── inventario-docs.mjs         # Inventário de documentação (`docs:inventario`)
│   ├── set-default-password-all-users.ts
│   ├── clear-passwords-non-admins.ts
│   ├── gerar-selo-institucional.mjs
│   └── GoogleAppsScript_Sync.gs   # Google Apps Script (sync planilha)
├── e2e/                            # Testes E2E Playwright
├── docs/                           # Documentação complementar (ver docs/README.md)
│   ├── QA_ASSINATURA_A3_DESKTOP.md # Roteiro de QA manual do fluxo Token A3
│   ├── HISTORICO.md                # Catálogo das auditorias/decisões arquivadas (preservadas no Git)
│   └── auditorias/                 # Auditorias em tratamento (depois vão para o HISTORICO)
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

### Escala extra (operações)

Gerenciamento das escalas extraordinárias. A GISE deixou de ser a única: a aba
`/gise` chama-se **Escala extra** e lista as escalas de TODAS as operações, com
filtro por operação na própria página.

**Operação** (`/gise/operacoes`, Admin Geral) é cadastro: nome, sigla, ciclo, e
quais tipos de equipe usa — uma operação pode ter só equipe operacional, só de
inteligência, ou as duas. Cada operação é dona dos SEUS formulários de
produtividade (um por tipo de equipe habilitado), e criar uma nova pede em qual
operação basear o formulário, para não começar do zero.

**Operação COM escala não se exclui, desativa-se**: escala histórica e PDF
assinado continuam apontando para ela, e apagá-la deixaria documento entregue sem
origem. Operação que nunca recebeu escala nenhuma — a criada por engano, a de
teste — não é história de nada e ganha **Excluir**, levando junto os formulários
dela. Quem recusa é a action, recontando as escalas no servidor: a contagem que a
tela mostrou pode ter envelhecido, e o botão escondido nunca foi autorização.

A tela é um **slider de dois painéis**, no mesmo desenho do fluxo de presença de
`/res-gise`: a lista à esquerda, o formulário à direita. O painel aberto vive na
URL (`?form=nova` ou `?form=<id>`), e não num estado local — é o que faz o
"voltar" do navegador desfazer a abertura e o que permite ao endereço antigo
`/gise/operacoes/[id]/config` redirecionar para o painel certo.

A LISTA não tem botão de voltar: Operações tem entrada própria na barra lateral,
e botão de voltar é de tela de DETALHE, alcançada de dentro de outra. O único
"Voltar às operações" da tela é o do painel do formulário, que fecha o painel. Os
botões de cada linha usam a faixa de navegação do §10 (`py-1.5`) e ficam
ancorados no topo à direita — o grupo quebra dentro de si, nunca em bloco, para
que todas as linhas terminem na mesma margem.

**Identidade e configuração são o MESMO formulário**, na criação e na edição:
nome, sigla, ciclo e tipos de equipe junto de vagas padrão, horário padrão e os
textos do bloco "Breve relatório" dos PDFs de extra. Antes eram dois botões e
duas telas, e quem criava uma operação saía com metade dela por preencher, sem
nada indicando isso. **Campo vazio herda o padrão do sistema**, e é isso que
torna a unificação inócua para o que já existe. Zero não é vazio (`0` = "esta
equipe não tem essa vaga").

A precedência, do mais específico ao mais geral:

```
colunas de gise_escalas → colunas de operacoes → configuracoes → constante do código
```

**Como se chega a cada coisa.** O editor do formulário de produtividade
(`/res-gise`) saiu da barra lateral do Admin Geral: formulário é DE uma operação,
e o item solto obrigava a escolher a operação depois de entrar. O caminho é o
botão **Formulário** de cada linha, e a tela tem o "voltar às operações" acima do
título.

**A barra lateral tem DOIS NÍVEIS.** Tudo que é de escala extra — Escalas,
Produtividade, Dados base, Minha presença, Meu histórico — vive sob o item
**"Escala extra"**, que ao ser clicado SUBSTITUI o conteúdo da barra pelo
submenu. Antes eram até cinco linhas soltas, e o admin seccional via oito itens
de uma vez sem que nada dissesse que cinco eram do mesmo assunto — estavam só
perto uns dos outros.

Três decisões registradas:

- **substitui, não expande.** Cinco itens indentados sob um pai devolveriam a
  lista comprida que o agrupamento veio desfazer;
- **o nível é decidido ao ABRIR, pela rota** (`openSidebar`). Abrir o menu em
  `/produtividade` e cair na raiz esconderia justamente onde a pessoa está;
- **`/gise/operacoes` fica na RAIZ.** É cadastro, não operação do dia a dia, e
  acompanha os outros itens de gestão do Admin Geral.

O filho que leva a `/gise` chama-se **"Escalas"**, e não "Escalas ativas": a
página lista ativas **e** histórico, com o filtro dentro dela — o rótulo mentiria.

Quem vê cada filho é `filhosExtra` (`+layout.svelte`), com as MESMAS condições de
antes do agrupamento, uma por uma. O pai só aparece se a lista não estiver vazia,
para nunca abrir num submenu vazio. E agrupar é apresentação: o recorte de verdade
segue no servidor — esconder item de menu nunca foi autorização.

**`/dados-base` na barra lateral** aparece só para admin de unidade/seccional que
tenha efetivamente base a informar — unidade escalada em operação ativa com
indicador percentual (`temLinhaBaseAPreencher`). Antes aparecia para todo admin de
unidade, inclusive os de delegacias fora de qualquer operação, que abriam uma
tela vazia. Para o Admin Geral, o acesso é o botão **Dados base** na linha da
operação em `/gise/operacoes` — e ele só existe na operação que PEDE base
(`operacoesComLinhaBase`, o mesmo critério da flag do menu). Nada disso é
autorização: quem recusa continua sendo `unidadesLinhaBaseAdministradas`, no
servidor.

**A operação vai no CAMINHO, não num seletor.** O preenchimento vive em
`/dados-base/[operacaoId]`; `/dados-base` é só o índice, que redireciona quando há
uma pendência só e oferece a lista quando há mais. Até ago/2026 a operação vinha
de `?operacaoId=` e a tela trazia um `<select>` ao lado dos campos — e o valor
digitado ali é o denominador de um percentual divulgado: gravá-lo sob a operação
errada muda o atingimento de uma unidade sem tocar em relatório nenhum. Com a
operação no caminho não há controle a errar, e a escolha acontece antes de
qualquer campo aparecer.

O **destino do "Voltar"** dessa tela vem do `load`, não é fixo: Admin Geral volta
a `/gise/operacoes`, que é a porta por onde ele entrou; admin de unidade volta ao
índice **só quando há mais de uma** pendência. Com uma só não há botão — o índice
redirecionaria de volta para a mesma tela, e um "Voltar" que não sai do lugar é
pior que nenhum.

Sobre a rota ser `/dados-base` e não `/gise/dados-base`: `/gise` é o prefixo
LEGADO — a GISE virou uma operação entre várias, e aninhar telas novas sob ele
espalharia um nome que o domínio já superou. Não há `+layout` compartilhado sob
`/gise`, então o aninhamento também não compraria autorização nem dados comuns. Se
um dia a coerência de prefixo for perseguida, o caminho é renomear o módulo
inteiro, não estender o nome antigo.

**Indicadores e metas.** No editor do formulário (`/res-gise`), uma pergunta
contável pode ser marcada como indicador. São **três tipos de meta**, e é o
`metaTipo` que discrimina a união `IndicadorConfig` (`src/lib/types.ts`):

| `metaTipo`   | O que mede                            | Objetivo            | Linha de base |
| ------------ | ------------------------------------- | ------------------- | ------------- |
| `percentual` | variação sobre o valor inicial (−20%) | aumentar / diminuir | **exige**     |
| `absoluto`   | alvo fixo (mínimo de 1 por unidade)   | aumentar / diminuir | não usa       |
| `proporcao`  | cobertura: % do total atendido (100%) | **não tem**         | não usa       |

A meta percentual exige uma **linha de base** — o valor de partida da unidade —,
informada pelo admin de unidade/seccional em **`/dados-base`**; se ela não foi
informada, o valor é pedido dentro do próprio formulário de produtividade.

`proporcao` é o tipo de **cobertura**, e anda junto com o tipo de campo
homônimo: uma pergunta só com dois números (o total existente e a parte
atendida), gravados em `${key}__total` e `${key}__parte`. Existe porque "atender
100% das ocorrências" não se mede com um número solto — 12 atendimentos são
ótimos se houve 12 ocorrências e ruins se houve 40. Ela não tem `objetivo`
(cobrir um todo não é aumentar nem diminuir) e não pede base: o denominador vem
no mesmo relatório. Só o tipo de campo `proporcao` aceita esta meta.

`/produtividade` mostra base × realizado × meta por unidade, com filtro por
operação — e, nos indicadores de cobertura, a **porcentagem coberta** com a meta
como limiar constante, porque contagem e porcentagem não compartilham eixo.

### O que entra no painel, e em que forma

Tudo em `/produtividade` sai do MODELO do formulário, e cada seção entra por um
critério diferente. Confundi-los foi a origem dos bugs corrigidos em ago/2026.

| Seção                 | Entra quando…                                            |
| --------------------- | -------------------------------------------------------- |
| Indicadores e metas   | a pergunta tem `indicador`                               |
| Colunas por unidade   | a pergunta tem `grafico.colunas`                         |
| Ranking de unidades   | a pergunta tem `grafico.ranking`                         |
| Detalhamento por tipo | a pergunta tem `grafico.detalhe` **e** comporta a quebra |
| Prisões (bloco fixo)  | o formulário TEM `prisoes_maiores` ou `mandados_maiores` |

**A marca é uma escolha, não uma consequência do tipo.** Até ago/2026 toda
pergunta de tipo contável virava card sozinha, e a quilometragem inicial da
viatura ocupava espaço ao lado das prisões — sem jeito de tirá-la a não ser
apagando o campo, o que apagaria a coleta. Agora o bloco "Mostrar na
produtividade" fica no editor, ao lado do de indicador, com uma caixinha por
forma. Marca e indicador são independentes: gráfico é uma leitura, indicador é
uma promessa com meta e linha de base.

**O título do card não é o enunciado da pergunta.** São públicos diferentes: a
pergunta é escrita para quem PREENCHE ("10. HOUVE APREENSÃO DE DROGAS?" —
numerada, em caixa alta, interrogativa), e o card é lido por quem ACOMPANHA, onde
serve o substantivo. O campo **"Título no painel de produtividade"** aparece no
editor assim que a pergunta ganha qualquer marca — gráfico ou indicador — e grava
em `rotulo_painel`. Um campo só para as duas marcas, porque o valor é um só e a
pergunta pode ser as duas coisas.

Quem resolve é `tituloNoPainel` (`$lib/produtividade/apresentacao`), em três
degraus: **rótulo próprio** → **identidade do tipo** (`Drogas`, `Armas`) →
**texto da pergunta**. O rótulo ganha até de `Drogas`, que é padrão de fábrica e
não decisão de quem montou a operação. Uma função só porque as duas seções do
painel fazem a mesma pergunta, e escrever a precedência duas vezes é o começo de
"o gráfico respeita o rótulo e o indicador não". Cor e unidade **não** cedem ao
campo: `'g'` diz onde o número foi somado, e trocá-la por digitação faria o card
mostrar gramas chamando-as de outra coisa. Nada disso entra no relatório
assinado — o PDF continua saindo com o enunciado que a pessoa respondeu.

**A ordem dos blocos no card do editor** é identidade da pergunta (etapa, texto,
tipo) → rótulos dos campos → marcas de painel → título do card: do que a pergunta
É para o que ela VIRA. As marcas ficavam no MEIO e empurravam para baixo o campo
que se usa toda vez, em favor de duas caixas que se marcam uma vez.

**As formas acumulam.** A pergunta de armas mostra ranking E detalhamento, que é
como o painel sempre a desenhou — e agora dá para desligar um dos dois. Ranking e
colunas são a MESMA conta em apresentações diferentes (valor por unidade); o
detalhamento é outra pergunta: quebra por categoria DENTRO da resposta.

**Detalhamento só onde existe a quebra.** Ela vive num objeto
`{ categoria: valor }` do blob, e só `drogas_complex` (`drogas_detalhe`) e
`armas_complex` (`armas_detalhe`) o gravam — `podeDetalhar` é quem responde. Nas
demais a caixinha aparece **desabilitada com a explicação**, mesmo padrão do tipo
de meta "Cobertura". Uma pergunta de número tem um valor só; o "detalhamento"
dela seria um card de uma barra.

**Como cada pergunta é somada** é decisão de `valorDaResposta`
(`$lib/produtividade/apresentacao`), e vale igual para as três formas: `sim_nao`
conta ocorrências, droga soma peso normalizado em gramas (mostrado em kg), e os
tipos de lista somam a chave de QUANTIDADE. Eram três cópias dessa regra até
ago/2026, cada uma com a sua tabela de chaves.

**O gate do "Sim".** Nos tipos que perguntam "houve X? → se sim, quantos", a
quantidade só conta com a resposta em `'Sim'` (`exigeSimParaContar`). O blob
guarda o que foi digitado: quem preenche a listagem, muda de ideia e responde
"Não" deixa o número lá. O relatório assinado sempre ignorou esse resto — ele só
expande a lista sob um "Sim" —, e o painel não ignorava. As duas leituras do
mesmo dado discordavam, e a do painel contava produção que o PDF não mostra.

**Prisões é o único bloco que continua escrito no código**, porque o detalhamento
dele soma três perguntas (flagrantes, mandados e total de presos) e uma marca
vive em uma pergunta só. O total de presos (P7) é somado por chave fixa junto do
bloco, e não pelo laço das perguntas marcadas: fosse pelo laço, desmarcar a P7
zeraria o card — um número errado, que é pior que um card ausente.

Duas migrações fizeram a virada sem mudar a tela: a `0053` carimbou o que já era
gráfico e a `0054` converteu esse carimbo em formas, marcando droga e arma com o
par ranking + detalhamento que os blocos fixos desenhavam.

Operação sem indicador, sem bloco e sem pergunta marcada mostra um aviso dizendo
onde é o conserto (o editor do formulário), em vez de uma página só com a barra
de filtros.

### O eixo do painel: delegacias ou seccionais

A barra de filtros de `/produtividade` tem **duas linhas**, e a divisão é
semântica: em cima o que se COMPARA (operação, "Visualizar por", quantidade de
unidades, ordem) e embaixo o que entra na CONTA (tipo de equipe, período). Só os
de baixo recortam dado.

"Visualizar por" é um EIXO, não um filtro: a mesma resposta pertence às duas
chaves — `seccional_id` e `unidade_id` (este resolvido em
`listarTodasRespostasGise` como `COALESCE(slot, unidade_operacional, seccional)`).
Trocar de modo não recorta nada, só muda por qual delas a lista é somada, e é por
isso que o total do painel não muda ao alternar. Padrão: **Seccionais**, que é o
comportamento histórico.

Quem responde por agrupar, ordenar e recortar é `$lib/produtividade/agrupamento`
— fonte única dos três consumidores (cards de ranking, gráficos por pergunta e o
cabeçalho do PNG exportado). Três decisões dele valem registro:

- **equipe sem slot de delegacia** resolve `unidade_id` para a própria seccional,
  e ela entra no modo Delegacias como linha própria. Sem isso a soma das linhas
  ficaria menor que o total do painel, sem nada explicando a diferença;
- **a ordem é semântica** ("melhores"/"piores", não "maior"/"menor"): quem chama
  informa o valor pelo qual "melhor" se mede. Nos volumes é o total; nos
  indicadores, o **% de atingimento** — num indicador de redução, ordenar pelo
  número cru poria a pior unidade no topo de "melhores primeiro";
- **valor não avaliável** (`null` — unidade sem linha de base, período sem
  ocorrência) vai sempre para o fim, nos dois sentidos: não é a pior, é a que não
  se sabe.

A seção **Indicadores e metas** é a exceção deliberada: continua sempre por
DELEGACIA, porque a linha de base é informada por ela (`operacao_linha_base` é
por unidade) e agregá-la por seccional exigiria somar bases — o que funciona para
o acervo de inquéritos e produz um número sem sentido no indicador de tempo
MÉDIO. Ordem e Top-N valem nela; o eixo, não.

### Baixar os gráficos: PNG e PDF são dois caminhos diferentes

**"Baixar (imagem)"** desenha cada card do zero num canvas próprio
(`$lib/export-charts`) e salva um PNG por gráfico selecionado — com o recorte
descrito no cabeçalho, porque o PNG circula sozinho.

**"Baixar (PDF)"** é `window.print()`: quem pagina é o NAVEGADOR, e a folha é o
que o `@media print` da rota descreve. As duas consequências que importam:

- **quem controla a quebra é CSS**, não um gerador. O card é a unidade
  indivisível (`break-inside: avoid`), então ele só parte quando não cabe inteiro
  numa A4 — que é o que se quer. `overflow: visible` acompanha, porque scroll
  interno (o ranking rola na tela) vira corte no papel, e o teto de largura no
  `<canvas>` existe porque o Chart.js carrega para o papel a largura em px que o
  gráfico tinha na TELA;
- **os seletores são `:global()`, de propósito.** Todo card do painel vem de um
  componente filho (`SecaoGraficos`, `SecaoRankings`, `SecaoIndicadores`), e o
  CSS de componente do Svelte só alcança o markup do próprio arquivo. Escrito
  sem `:global()`, o bloco compilava para `.card.svelte-hash` e não casava com
  card nenhum: as regras existiam desde sempre e nunca valeram — era esse o
  gráfico partido ao meio relatado em ago/2026. O prefixo
  `.pagina-produtividade` devolve o limite que o escopo dava.

O cromo da tela (barra do topo, gaveta, filtros e os próprios botões de baixar)
sai por `print:hidden`, e com seleção ativa o papel leva só os cards
selecionados. Cabeçalho e rodapé do PDF (data, URL, número da página) são do
navegador, não da página: quem imprime tira em **Mais definições → Cabeçalhos e
rodapés**. Coberto por `e2e/produtividade-graficos.spec.ts`, que roda as
asserções em `media: print` — na tela as regras não valem, e CSS compilado
"existe" mesmo quando não seleciona nada.

O tipo de equipe indisponível na operação aparece **desabilitado**, não escondido:
o botão apagado diz que a operação não usa aquele tipo (`tiposEquipeHabilitados`,
em `$lib/gise/tipos-equipe`, compartilhado com o editor de formulário).

Os indicadores da OPERAÇÃO CRAJUBAR vêm semeados pela migração `0050` a partir
da tabela §9 do Plano Operacional Estratégico; a `0052` converte o de
atendimentos em fins de semana para cobertura de 100%, que é o que o plano pede.

O resto do fluxo:

- Criação e configuração pelo supervisor (seccionais, equipes, questões)
- Visão do membro em duas abas da sidebar: **Presença GISE** (só aparece com escala ativa — confirmar entrada, relatório e saída) e **Histórico GISE** (participações já encerradas). Ambas usam a rota `/res-gise`; o histórico é `?status=finalizadas`
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

A rota `/validar/[hash]` é **pública e sem autenticação**. Qualquer pessoa pode verificar a autenticidade de um documento assinado informando o código exibido no PDF. Visitante **autenticado** vê também o recorte da chave de assinatura (o mesmo da linha `CHAVE DE ASSINATURA` no manifesto) para confrontar com a ficha do servidor, sem abrir o banco. O anônimo não recebe esse recorte. O titular vê o mesmo recorte em Meu Perfil, com a data do último uso; o sistema não guarda o modelo do celular.

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

### Uma senha, duas identidades (Admin Geral vinculado)

O Admin Geral **vinculado** é uma pessoa com DUAS linhas: uma em `policiais` e
uma em `administradores` com `policial_id` apontando para ela. A linha admin não
tem senha própria — recebe um placeholder aleatório que ninguém lê. O login de
administrador autentica contra `policiais.senha`, a mesma senha do modo usuário.

Daí saem duas perguntas que todo fluxo de credencial precisa responder, e que
são fáceis de responder pela metade. As duas têm resposta única em
[`server/auth/credencial.ts`](src/lib/server/auth/credencial.ts):

| pergunta                  | resposta                                             |
| ------------------------- | ---------------------------------------------------- |
| onde gravar a senha nova? | `resolverCredencial().dono` — a linha que o login LÊ |
| quais sessões derrubar?   | `revogarSessoesDaCredencial()` — as DUAS identidades |

Gravar na linha errada não muda nada: a senha nova não passa a valer e a antiga
continua valendo. Derrubar só o cookie do modo atual deixa vivo o outro,
destravado pela mesma senha. Desativar o policial fecha os dois modos —
`buscarAdminAtivo` confere o vínculo, e a desativação revoga as sessões abertas.

Sessão em cache não vale para quem MUTA: `ttlCacheSessaoParaMetodo` devolve 0
em `POST`/`PUT`/`PATCH`/`DELETE`. Leitura pode estar até um TTL atrasada; ação,
não — o Cache API é por colo, e nenhuma invalidação local alcança outro data
center.

### Fluxo de login

1. Usuário informa matrícula + senha
2. Servidor verifica com PBKDF2-HMAC-SHA256 (100k iterações — teto do runtime da Cloudflare —, salt 16 bytes, timing-safe). Em produção, a senha passa antes por HMAC com o `PASSWORD_PEPPER` (formato `pbkdf2v3`) — ver [`DEPLOY.md`](DEPLOY.md#hashing-de-senha-e-o-password_pepper)
3. 2FA: gera código de 6 dígitos e envia por e-mail (fail-closed — conta sem e-mail cadastrado não recebe sessão)
4. Sessão criada com token de 256 bits, expira em 8 horas (`SESSION_TTL_MS` em `src/lib/auth.ts`)
5. Sessão armazenada em cookie `session_token` (httpOnly, secure, SameSite=strict)

Alternativa: **login por certificado digital A3** (e-CPF ICP-Brasil) via `/api/auth/certificado/*`, dispensa senha e 2FA por e-mail. Além da assinatura do desafio e da cadeia ICP-Brasil, o login consulta a **revogação (OCSP)** do certificado: um e-CPF revogado é recusado; se o responder da AC estiver indisponível, o login prossegue e registra `metadados.ocsp = 'unknown'` na auditoria (soft-fail). O botão existe nas duas abas do `/login`: na aba **Policial** cria sessão operacional; na aba **Administrador** (`comoAdmin`) resolve a conta admin vinculada ao policial do certificado e cria sessão de administrador no módulo escolhido.

### Alternância de acesso (ADM Geral ↔ Usuário)

Quem tem **Admin Geral vinculado** (linha em `administradores` ligada ao seu policial) pode alternar entre o modo Administrador e o modo Usuário **sem sair e logar de novo**, por um botão na barra superior à direita (`/api/auth/alternar-acesso`). A troca só recria a sessão apontando para a outra identidade da **mesma pessoa** — **não concede privilégio novo**: quem não tem a conta vinculada não vê o botão e o endpoint responde 403. Como a pessoa já passou pelo 2FA no login (o admin vinculado usa o mesmo e-mail/2FA), a troca é imediata, análoga ao swap de módulo GISE/Escalas. Cada alternância é auditada (`alternar_acesso`).

### Primeiro acesso

Após criar um policial/admin, a conta fica bloqueada até o usuário definir sua própria senha (`primeiro_acesso = true`). O sistema redireciona automaticamente para `/alterar-senha`.

### Termo de uso

O aceite do termo de uso é obrigatório a cada nova versão. Qualquer mudança no arquivo `src/lib/server/termo/termo-vigente.ts` gera um novo hash que invalida aceites anteriores e exige reaceite na próxima sessão.

### Papéis (RBAC)

| Tipo                     | Papel             | Acesso                                                                                                                                                  |
| ------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin` + `isSuperAdmin` | Super Admin       | Tudo do Admin Geral **mais**: promover admins, gerenciar policiais/unidades, configurar política de assinatura, baixar o forense pelo portal `/validar` |
| `admin`                  | Admin Geral       | Operação global (escalas, GISE, LGPD/compliance) em todas as unidades — não remodela a base; consoles de auditoria são do Super Admin                   |
| `policial`               | `admin_seccional` | Gerencia escalas e policiais da sua seccional; informa a linha de base dos indicadores das unidades dela (`/dados-base`) e vê `/produtividade` escopado |
| `policial`               | `admin_unidade`   | Gerencia escalas da sua unidade; informa a linha de base dos indicadores dela e vê `/produtividade` escopado à unidade                                  |
| `policial`               | —                 | Acessa apenas suas próprias escalas e GISE                                                                                                              |

A matriz completa de capacidades por papel está em [`DEPLOY.md`](DEPLOY.md#papéis-e-privilégios-de-administrador). Membros de GISE têm papéis adicionais (`supervisor`, `assessor/SEINT`, `membro`) calculados dinamicamente a partir da tabela `gise_membros`.

### Autorização das operações materiais

Esconder o botão na tela não é autorização: o POST direto tem de morrer no
servidor. Toda mutação de API (`POST`/`PUT`/`PATCH`/`DELETE`) e form action do
SvelteKit é **operação material**, e `npm run guard:autorizacao` (rodado no CI)
verifica que cada uma recusa alguém — o próprio comando imprime o total atual.

O guard não procura o nome de um helper, e isso é deliberado. A decisão de
autorização é tomada de treze formas diferentes, porque ela genuinamente difere
por domínio: escala vai por lotação mais solicitação de assinatura
(`verificarPermissaoEscala`), GISE vai por participação da seccional, quadro de
supervisão ou vínculo de equipe (`verificarPermissaoGise`,
`resolverParticipacaoGisePolicial`), policial vai por escopo administrado
(`lotacoesAdministradas`), e várias rotas resolvem no preâmbulo local do próprio
arquivo (`autorizarAcao`, `carregarEscalaComPermissao`). Uma lista de nomes
nunca estaria completa — e deixaria passar justamente o handler novo com o
resolvedor novo, que é o caso perigoso.

O que o guard olha é o RESULTADO, que é fechado:

| nível | o que a operação faz     | como aparece                                                                        |
| ----- | ------------------------ | ----------------------------------------------------------------------------------- |
| 2     | recusa por **permissão** | `fail(403)`, `forbidden()`, `requireAdmin`, `requireSuperAdmin`, `exigirAdminGeral` |
| 1     | só exige **sessão**      | `fail(401)`, `unauthorized()`, `requireAuth`                                        |
| 0     | não recusa ninguém       | —                                                                                   |

Nível 0 e 1 existem legitimamente: login não tem sessão para exigir, trocar a
própria senha não tem segundo sujeito para autorizar, e webhook se autentica por
segredo compartilhado. As dispensas ficam declaradas **com motivo** em
`scripts/guard-autorizacao.mjs` — a diferença entre "público de propósito" e
"esqueceram o guard" não está no código, só na cabeça de quem escreveu; ali ela
fica escrita. Encolher aquela lista é progresso.

O guard reprova em quatro situações, e a última é a que impede falso verde:
operação nova em nível 0/1 sem declaração; dispensa que virou nível 2 (lista
mentindo); dispensa que aponta para operação inexistente; e **handler declarado
que o parser não conseguiu ler** — rota que o guard não enxerga é rota que ele
não protege.

Nas regressões já vistas (assinar com ACL de leitura, GISE `finalizada`,
lotação fora do escopo, presença fora da janela), `HELPERS_OBRIGATORIOS` exige
o helper **no corpo** do handler — import no arquivo ou 403 genérico não
bastam. A lista cresce só com achado novo.

### Proteção CSRF

O projeto usa o padrão _double-submit cookie_:

- Geração: cookie `csrf_token` com token aleatório de 256 bits (não httpOnly)
- Verificação: todos os métodos mutantes (`POST`, `PUT`, `PATCH`, `DELETE`) em `/api/*` exigem o header `x-csrf-token` igual ao cookie
- Rotas isentas: `/api/auth/login`, `/api/health`, `/api/webhook` (autenticados por bearer token próprio)

---

## 10. Padrões de Código

> Diretrizes obrigatórias de API, pastas `server/`, `api-fetch`, autorização e
> goldens jurídicos: [`CLAUDE.md`](CLAUDE.md). Abaixo: runes, Server-first e UI.

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

### Constantes e snippets compartilhados

Antes de declarar uma constante "óbvia" no componente, verifique se ela já existe
em [`src/lib/utils/datas.ts`](src/lib/utils/datas.ts):

- `MESES_PT` — nomes dos meses, índice 0 = Janeiro (base de `Date.getMonth()`;
  para mês 1-12 do banco/URL use `MESES_PT[mes - 1]`);
- `opcoesMeses()` / `opcoesMeses(true)` — as mesmas opções no formato
  `{ value, label }` do `SearchableSelect`, com a entrada "Todos" (valores
  numéricos ou string);
- `DIAS_SEMANA_CURTO` — `Dom…Sáb`, índice 0 = domingo.

Snippets de UI repetidos entre componentes irmãos vão para um `.svelte` próprio e
são **exportados pelo `<script module>`** — só funciona se o snippet não
referenciar nada do `<script>` de instância, então os imports de que ele depende
também ficam no bloco `module` ([docs](https://svelte.dev/docs/svelte/snippet)).
Exemplo: [`src/routes/res-gise/_components/BotoesAcao.svelte`](src/routes/res-gise/_components/BotoesAcao.svelte).

### SvelteKit — Server-first

Devolva no `load()` apenas o que a página realmente consome: papéis do usuário
não precisam ir no payload (a UI lê `page.data.usuario` via `useAutorizacao`), e
parâmetros de URL usados só para montar a query ficam no servidor.

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

**Contraste** — texto informativo em superfícies claras usa no mínimo
`text-surface-600`; em superfícies escuras, `dark:text-surface-400`. Este é o
par padrão: `text-surface-600 dark:text-surface-400`. `text-surface-500` não
é permitido sobre `surface-50` ou branco (não atinge AA) e só se justifica em
uma superfície escura fixa, onde seu contraste tenha sido verificado.
`text-surface-400` puro fica restrito a ícones decorativos, placeholders e
estados `disabled`/inativos.

**Foco de teclado** — nunca `outline-none`/`focus:outline-none` sem substituto visível (`focus-visible:ring-2 focus-visible:ring-primary-500 …` ou `focus-within:ring` no container).

**Estilizar componente do Skeleton — `transform` não se anula com `translate-*`** (auditoria visual de ago/2026). Os utilitários `translate-*`/`scale-*`/`rotate-*` do Tailwind v4 escrevem as **propriedades individuais** (`translate`, `scale`, `rotate`); o CSS de componente do Skeleton posiciona peças com a propriedade **`transform`**. São propriedades diferentes: o navegador aplica as duas e os deslocamentos **somam**. A classe parece sobrescrever e não sobrescreve — não gera erro, não gera aviso, só sai do lugar.

Foi a causa única dos dois "desalinhamentos" relatados: o thumb do `ToggleSwitch` saía 14 px **fora** do trilho (`translate-x-5` + `translateX(16px)` = 36 px de curso num trilho que só tem 20 px) e o chevron do `SearchableSelect` subia 12 px, vazando 7 px acima do campo (`!translate-y-0` não cancelava `translateY(-50%)`).

Para neutralizar um `transform` do Skeleton, zere **`transform`** — as duas ocorrências estão resolvidas de uma vez no `app.css`, por seletor `[data-scope=…][data-part=…]`, e não classe por classe. Dos componentes em uso, só combobox e switch aplicam `transform` (`tree-view` também, mas não é usado); ao adotar um componente novo do Skeleton, confira o `.css` dele em `@skeletonlabs/skeleton-common/src/components/` antes de posicionar peças por classe.

**Contorno de campo e iOS** — `.input`/`.select`/`.textarea` do Skeleton desenham o contorno com `border-width: 0` **mais um ring inset (`box-shadow`)**. iOS não pinta `box-shadow` em campo de formulário com aparência nativa, então no iPhone os campos ficavam **sem contorno nenhum** — login e senha inclusive. O `app.css` corrige na raiz: `appearance: none` em `.input`/`.textarea` (devolve o desenho ao CSS, sem mexer no box model) e, em `select.select`, uma **borda de verdade** com o ring de repouso neutralizado — `<select>` fica sem `appearance: none` de propósito, que levaria a seta nativa embora. Não volte a depender de `box-shadow` para a aresta de um campo.

Essas regras ficam **fora de `@layer`** no `app.css`: CSS sem camada vence qualquer `@layer` (inclusive `utilities`), que é o único jeito determinístico de ganhar do CSS de componente do Skeleton sem espalhar `!important`. O preço é que elas vencem também os utilitários do call site — por isso só tocam propriedades que ninguém sobrescreve. Não acrescente `border-*` de `.input` ali (quebraria o `border-2` de erro do `SignaturePad`), e não use os pares `--color-*-200-800` do Skeleton, que são `light-dark()` e seguem `color-scheme`: o tema escuro deste app é a **classe** `.dark`, então o par resolveria sempre para o valor claro.

**Superfícies elevadas** — `card-elevated` (fundo canônico de modal/card sobre a página) e `card-elevated-2` (sub-card aninhado); translúcidas: `card-glass` / `card-glass-auth`. Hierarquia: glass/blur só na chrome (sidebar/topbar); conteúdo da página preferir `card-elevated` opaco — evita empilhar translucidez com a folha xl. Não montar pares `bg-* dark:bg-*` à mão.

**Modais** — código novo usa `$lib/components/ModalShell.svelte`, que mantém
o `Dialog` do Skeleton por dentro e centraliza backdrop, painel, rodapé,
camadas, `Portal` e bloqueio de fechamento durante `pending`. Use `z-50` na
base, `camada="empilhado"`/`"duplo"` para `z-[60]`/`z-[70]` e
`portal={true}` somente sob ancestral com `transform`/`contain`. Não
reimplemente foco, Escape, ARIA ou scroll lock. Um modal que não cabe nesse
contrato permanece explícito e registra no próprio arquivo a diferença de
interação ou regra de domínio.

**Botões (semântica dos presets)** — CTA `preset-filled-primary-500` · destrutivo `preset-filled-error-500` · cancelar/neutro `preset-outlined-surface-500`. O feedback tátil de clique (afundar 5% pressionado) é **global e automático** para `.btn`/`.btn-icon` (regra em `app.css`) — não adicionar `active:scale-95` inline; use-o apenas em elementos interativos custom fora dessas classes.

**Tamanho de botão** — `.btn-sm` do tema NÃO embute padding vertical: sem `py-*` o botão fica em ~24px de altura. A escala em uso é `py-1.5` (~34px, botões de navegação como o Voltar), `py-2.5` (~40px, CTA de modal/formulário) e `py-3.5` (~48px, ação final de página). Nada de `py-4 text-lg`, que produz um bloco de ~64px destoante do resto da tela.

**Voltar** — usar `$lib/components/BotaoVoltar.svelte`, sempre **acima do `<h1>`**, nunca no rodapé. `href` para mudar de rota, `onclick` para desfazer estado local. Não repetir a palavra "Voltar" em outro controle da mesma tela (o passo anterior de um wizard é "Anterior") — duas coisas diferentes com o mesmo rótulo trocam de lugar na cabeça de quem usa.

**Rodapé de ação em tela longa** — usar `$lib/components/RodapeAcoes.svelte`: status à esquerda, botões à direita, `sticky bottom-0`. É para a tela em que a ação principal é frequente e ficaria presa no fim do documento — o wizard do relatório e o editor do modelo, os dois com formulários de dezenas de campos. `sticky` e não `fixed`: `fixed` sai do fluxo, passa por cima do conteúdo e exige um `padding-bottom` de reserva que ninguém mantém quando a altura do rodapé muda. Não funciona dentro de ancestral com `overflow` — ele gruda no ancestral que ROLA, e um container `overflow-hidden` não rola.

O status **tem de dizer algo que mude**. A barra do editor nasceu com dois estados — "Salvando…", que dura o tempo da requisição, e "Pronto para salvar", que era o `else` — e dizia a mesma frase tendo-se mexido em algo ou não. Hoje ela compara o que está na tela com o modelo carregado (`alteracoesNaoSalvas`), que é o que torna concreto o aviso de que nada é gravado até clicar em Salvar.

**Estado de tarefa (marcador)** — o mesmo lugar mostra os dois estados: `Check` em círculo `bg-success-500` cumprida, `Clock` em círculo `bg-warning-500` pendente. Não usar ponto cinza para "falta fazer" (lê-se como "desligado"), e não variar a cor de concluído por tipo de tarefa — na mesma linha, um quadro verde e outro cinza parecem estados diferentes quando são o mesmo.

**Border-radius** — o tema define `--radius-base` (= `rounded-xl`, botões/inputs) e `--radius-container` (= `rounded-2xl`, cards/modais); pills/chips usam `rounded-full`. Em código novo, não usar `rounded`/`rounded-md`; reservar `rounded-lg` para elementos ≤ 32 px de altura.

**Z-index (escala)** — `z-10` elementos locais · `z-20`/`z-30` overlays locais e FABs (acima do conteúdo da página, abaixo da chrome) · `z-40` topbar mobile + backdrop da sidebar · `z-50` sidebar, modais e popovers em portal · `z-[60]`/`z-[70]` modal sobre modal · `z-[100]` diálogos globais (logout, avisos) · `9999` toasts · `10000` LoadingOverlay e barra de progresso de navegação. Não inventar valores fora da escala.

**Breakpoints** — `xs:` (400 px, definido no `@theme`) para telefones estreitos; demais são os padrões do Tailwind. Exceção documentada: o corte da sidebar no `+layout.svelte` é `min-[900px]` (deliberado — não migrar para `lg:`).

**Largura de conteúdo** — páginas usam o container do layout (`max-w-6xl`); telas de detalhe não travam largura. Ambiente e folha xl usam `bg-white` / `surface-900` (teste visual). A folha em `xl` acrescenta borda e `rounded-2xl` (sem blur/ring). Glass/blur ficam na chrome (sidebar/topbar), não no canvas. As regras de `max-w` continuam as mesmas. Quando uma página precisa ser mais estreita, a trava envolve **a página toda, `<header>` incluído** (`config-geral` = `max-w-3xl`, `solicitacoes` = `max-w-5xl`) — travar só um bloco do meio desalinha o card do título. Dentro de um card largo, o certo é o inverso: o conteúdo que ganha com a largura (formulário, tabela) fica solto, e só os elementos intrinsecamente estreitos — stepper, CTA, estado vazio, selo de status — recebem teto.

**Tipografia (ênfase)** — corpo Inter; títulos/wordmark Outfit (`font-heading` ou `.h1`/`.h2`). Régua de peso: page title = `font-bold`; labels e cabeçalhos de coluna = `font-semibold`/`font-bold`; wordmark da chrome = `font-bold` sólido (sem `bg-clip-text`/gradient). Evitar `font-extrabold`/`font-black` em código novo — reservar `font-black` só para KPI numérico isolado que precise gritar. O legado migra oportunisticamente ao tocar no arquivo.

**Container queries** — quando o layout de um bloco depende do espaço que sobra **para ele** (e não do tamanho da tela), use `@container` no ancestral e as variantes `@2xl:`/`@4xl:` nos filhos, em vez de `sm:`/`lg:`. Cuidado: `container-type: inline-size` implica `contain: layout`, ou seja o elemento passa a ser containing block de descendentes `position: fixed` — nunca colocar `@container` acima de um `Dialog`/overlay, ou o modal fica preso dentro do card.

**Tarefa longa vira modal — formulário longo vira rota** — quando uma tela tem passos sequenciais (confirmar presença → entregar relatório → confirmar saída), a página mostra o **estado** (barra de progresso + um quadro compacto por passo, lado a lado na ordem de execução) e cada passo abre um modal com o seu formulário. Ver `res-gise/_components/FormularioServico.svelte`. Empilhar os passos como seções do mesmo card foi o que gerou faixas de ~1050px com o conteúdo perdido no meio no desktop.

O modal é para o passo que cabe em uma tela. Passando disso — o relatório de produtividade tem 19 perguntas de nível 0 mais os filhos condicionais — o passo vira **rota própria com wizard**: `res-gise/relatorio/[giseId]`. Uma etapa por tela, navegador de etapas (`lg:` coluna lateral `sticky`, no celular faixa rolável — a MESMA `<ol>`, com `lg:flex-col`), coluna de conteúdo em `max-w-3xl` e rodapé `sticky` com Voltar/Avançar. Rota, e não modal, porque o preenchimento tem endereço, sobrevive a um reload e admite rascunho.

**Rascunho local (autosave)** — formulário longo grava o blob no `localStorage` a cada pausa de digitação (debounce 800 ms), com chave por (registro, dono). Restaurar exige uma regra explícita: aplique sozinho **só quando não há nada no servidor**; havendo, o servidor manda e o rascunho vira uma oferta com botão. Nunca decida por comparação de relógios — os carimbos do banco são hora local em texto e o do navegador é do aparelho. Limpe o rascunho ao entregar **e** trave o autosave nesse instante, senão um timer pendente regrava o que acabou de ser apagado.

**Reordenar lista onde a posição é informação** — arraste (HTML5 DnD com alça: a alça liga o `draggable` no `mousedown`, senão não dá para selecionar texto nos campos do card) **mais** setas ↑/↓, que são o único caminho no toque e no teclado. Arraste sozinho é inacessível. E se a ordem aparece escrita no conteúdo (o "4." dentro do texto da pergunta), reordenar tem de reescrever esse conteúdo — ver `$lib/gise/renumerar-perguntas.ts`; um badge derivado de `indexOf` se acerta sozinho e esconde o problema.

**Tipos de pergunta do formulário de produtividade** — a tabela é `$lib/gise/tipos-pergunta.ts`: quais tipos abrem listagem, quais aceitam sub-pergunta e **onde cada um grava no blob**. Mexer em tipo de pergunta começa por lá, nunca pelos componentes. `chavesLista` é a fonte ÚNICA da chave da resposta, e é ela que o indicador de meta, o gráfico e a expansão do relatório consultam — uma tabela paralela escrita à mão já custou aos tipos de lista o direito de virar gráfico, e ninguém notou porque o indicador continuava funcionando.

Três tipos estão **aposentados** (`TIPOS_LISTA_APOSENTADOS`): `mandados_maiores`, `prisoes_maiores` e `apreensoes_menores`. Eles fazem exatamente o que `lista_detalhada` faz — mesmo widget, mesma forma de item, mesma expansão —, só que gravando em **chave fixa**, o que os limita a **uma ocorrência por formulário**. O genérico deriva as chaves da `key` da pergunta e por isso se repete; quem quer nomear a linha no PDF usa `subtexto_item` ("Procedimento 1" em vez de "Item 1"). Eles não foram removidos porque trocar o tipo de uma pergunta troca a chave da resposta — na prática, apaga o histórico dela —, e o editor os oferece apenas na pergunta que **já** está com um deles: escondê-los sempre faria o `<select>` cair na primeira opção e mudar o tipo sozinho ao salvar.

Ao acrescentar um tipo, a expansão em `db/gise/respostas.ts` é obrigatória no mesmo passo: sem ela o policial preenche, o dado é gravado e **some do PDF assinado sem erro nenhum**.

**A URL manda na seleção** — se uma tela escreve o item selecionado na query string (`?giseId=`), ela precisa **ler de volta**, senão recarregar ou voltar de outra rota cai na lista com a URL apontando para um item que não está na tela. O efeito que faz isso escreve o mesmo estado que lê: a guarda de igualdade é o que faz a segunda passada parar.

**Ícones** — código novo usa
[`@lucide/svelte`](https://lucide.dev) (já é dependência; herda
`currentColor`). **Nunca emoji como ícone** (✍️ ✅ 🔒…): renderizam diferente
por SO e ignoram a cor do tema. O SVG inline legado migra oportunisticamente
ao tocar no arquivo.

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

Arquivos de teste ficam em `src/` com o padrão `*.test.ts`, **sempre** em pastas `__tests__/` junto do código testado (convenção verificada no CI; rode `npm run test` para o total atual). Os principais grupos:

- `src/lib/__tests__/` — autenticação (PBKDF2/pepper, sessões, 2FA), CSRF, headers de segurança, utilitários
- `src/lib/schemas/__tests__/` — schemas Zod (LGPD, formulários GISE)
- `src/lib/gise/__tests__/` — regras GISE puras: etapas do formulário, renumeração, tipos de pergunta
- `src/lib/crypto/__tests__/` — criptografia de campos e CPF, primitivas (hash, token, timing-safe)
- `src/lib/db/__tests__/` — camada de dados: auditoria forense, retenção LGPD, upserts de assinatura
- `src/lib/server/__tests__/` — infraestrutura transversal: e-mail, `r2-cleanup`, `request-context`, Sentry/PII, schema × migrações
- `src/lib/server/assinatura/__tests__/` — CAdES, OCSP, TSA, trust store ICP-Brasil, ByteRange, verificação, goldens dos carimbos visuais
- `src/lib/server/auth/__tests__/` — fluxo de login, login por certificado (e revogação), webhooks
- `src/lib/server/gise/__tests__/` — permissões GISE, termo de presença, carimbos de revalidação
- `src/lib/server/export/__tests__/` — goldens de PDF (escalas) e cabeçalho institucional
- `src/lib/server/escalas/__tests__/` — permissões de escala, carimbos de revalidação

### Testes E2E (Playwright)

```bash
# Instalar browsers (apenas uma vez)
npx playwright install --with-deps chromium

npm run test:e2e            # todos os specs
npm run test:e2e:ui         # interface visual (útil para debugar)
npm run test:e2e:report     # abre o relatório da última execução

npm run test:e2e -- e2e/auth.spec.ts       # um arquivo
npm run test:e2e -- --project=chromium     # só desktop (pula o projeto mobile)
```

> **`SYNC_TOKEN` curto derruba 4 specs com 401.** Os webhooks recusam segredo
> com menos de 32 caracteres, então um placeholder do tipo `token-de-dev` faz
> `webhook-sync.spec.ts` falhar inteiro — uma falha que parece bug do sistema e
> é só configuração. Gere com `openssl rand -hex 32`, como manda o
> [`.env.example`](.env.example).

> **O E2E roda contra o seu D1 local, não contra um banco limpo.** O
> `global-setup` purga o que a própria suíte cria (faixa de id 99xxx), mas não
> toca em dados reais — se você andou usando o app, eles continuam lá. Os specs
> são escritos para tolerar isso (asserções miradas na fixture); se algum falhar
> por dado alheio, é bug do spec, não do seu banco.

Os testes E2E fazem build + preview automático antes de rodar (via `e2e/servidor-e2e.ts`), e o `global-setup` aplica as migrations pendentes no D1 local e semeia os fixtures — não é preciso preparar o banco manualmente. Configure credenciais de teste em `e2e/global-setup.ts`. Além do projeto `chromium`, um projeto `mobile` (Pixel 7 emulado) reexecuta os specs de UI em viewport de celular.

**Cobertura negativa automática:** `autorizacao-negativa.spec.ts` varre
`src/routes/**` em tempo de teste e exerce **todas** as operações materiais em
dois cenários — anônimo, e policial de outra unidade contra um recurso real —
exigindo 401/403/404 e nenhum documento criado ou apagado. A tabela não é
escrita à mão: rota nova entra sozinha, sem depender de alguém lembrar. É o
complemento executável do `guard:autorizacao`, que só lê o código: o guard vê
_se_ existe gate, o spec vê se ele **vem antes do trabalho** e se olha o
**recurso**, não só o usuário. Foi ele que achou o FLW-GISE-004.

Duas armadilhas ao mexer nele: alvo protegido por outro motivo (escala já
assinada, GISE fechada) não testa permissão — o 409 chega primeiro e esconde a
falta do 403; e form action **não** usa o status HTTP, porque o `ActionResult`
viaja em JSON sob 200 mesmo quando a action executou.

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

1. `npm run lint:ci` + `npm run format:check` + `npm run format:check:e2e`
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

Todas elas são aplicadas **no servidor** — inclusive `restringir_smartphone`, que recusa a assinatura avançada por user-agent não-móvel em vez de só esconder o painel, e `exigir_passkey_assinatura`, que exige uma chave WebAuthn do celular na assinatura da escala. Ver [`DEPLOY.md`](DEPLOY.md#cache-edge-das-flags-de-assinatura) e [`DEPLOY.md`](DEPLOY.md#chave-de-assinatura-passkey--webauthn) para o alcance probatório de cada uma.

### Reset destrutivo (emergência)

O endpoint `/api/webhook/reset-policiais` **apaga todas as tabelas operacionais**. Requer quatro camadas simultâneas:

1. `Authorization: Bearer <SYNC_TOKEN>`
2. `X-Reset-Token: <RESET_TOKEN>`
3. `X-Confirm-Reset: <YYYY-MM-DD em UTC>` (confirmação explícita do dia)
4. `X-Webhook-Timestamp` + `X-Webhook-Nonce` (anti-replay, 5 min) — **obrigatórios aqui**, independentemente de `WEBHOOK_REPLAY_ENFORCE`, porque a camada 3 sozinha deixaria 24 h de janela para reenvio

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
3. Confira a tabela `_migrations_aplicadas` no D1 — é ela que rastreia o que já rodou:
   `npx wrangler d1 execute escalas-db --remote --command "SELECT * FROM _migrations_aplicadas ORDER BY id DESC LIMIT 10"`

### Análise de bundle

Para inspecionar o tamanho dos chunks após o build:

```bash
npm run build
# Abre bundle-stats.html no navegador
```

---

_Em caso de dúvidas técnicas, comece pelos arquivos `+page.server.ts` da rota em questão — eles contêm a lógica de negócio mais próxima do banco. Para dúvidas de produto, consulte a liderança técnica do time._
