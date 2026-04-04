# Runbook Operacional — Escalas

Guia operacional para deploy, manutenção e troubleshooting do sistema Escalas, hospedado no Cloudflare Pages com D1 (banco de dados) e R2 (armazenamento de documentos).

---

## 1. Pré-requisitos

| Ferramenta | Versão mínima | Instalação |
|---|---|---|
| Node.js | 20.x | `nvm install 20` |
| npm | 10.x | Incluído com Node 20 |
| Wrangler CLI | 4.x | `npm install -g wrangler` |
| Git | 2.x | Gerenciador de pacotes do SO |
| GitHub CLI (gh) | 2.x | `brew install gh` / `apt install gh` |

### Autenticação Wrangler

```bash
wrangler login
# Abre o navegador para autenticar com a conta Cloudflare
```

### Instalação de dependências

```bash
npm ci
```

---

## 2. Deploy

### 2.1 Deploy via CI/CD (recomendado)

O pipeline está configurado em `.github/workflows/deploy.yml`. O fluxo é:

| Branch | Ambiente | Trigger |
|---|---|---|
| `staging` | Staging | Push automático |
| `main` | Produção | Push automático |

**Etapas do pipeline:**

1. **test** — Executa `vitest run` e `svelte-check --threshold error`
2. **deploy-staging** — Build + deploy para Cloudflare Pages (branch staging)
3. **deploy-production** — Build + deploy para Cloudflare Pages (branch main)

**Para deploy em staging:**

```bash
git checkout staging
git merge minha-feature
git push origin staging
```

**Para deploy em produção:**

```bash
git checkout main
git merge staging
git push origin main
```

### 2.2 Deploy manual (emergência)

```bash
# Build local
npm run build

# Deploy para staging
wrangler pages deploy .svelte-kit/cloudflare --project-name=escalas --branch=staging

# Deploy para produção
wrangler pages deploy .svelte-kit/cloudflare --project-name=escalas
```

> **Nota:** Deploy manual exige `CLOUDFLARE_API_TOKEN` configurado ou login via `wrangler login`.

---

## 3. Migrations (Banco de Dados D1)

O projeto usa Cloudflare D1 (SQLite). As migrations ficam em `/migrations/` e são numeradas sequencialmente (`0001_init.sql`, `0002_horario_individual.sql`, etc.).

- **Database name:** `escalas-db`
- **Database ID:** `dc86ec72-7ed4-4e8c-9d29-67a4e509ea49`
- **Binding:** `escalas_db`

### 3.1 Aplicar migrations localmente

```bash
# Aplica todas as migrations no banco local
npm run db:migrate
```

Ou individualmente:

```bash
wrangler d1 execute escalas-db --local --file=./migrations/0040_rate_limit_table.sql
```

### 3.2 Aplicar migrations em produção (remoto)

```bash
# Aplicar migration específica
wrangler d1 execute escalas-db --remote --file=./migrations/0040_rate_limit_table.sql
```

Ou usar o script pré-configurado (quando disponível):

```bash
npm run db:migrate:prod
```

> **CUIDADO:** Sempre teste a migration localmente antes de aplicar em produção. Migrations D1 são irreversíveis por padrão.

### 3.3 Verificar estado do banco

```bash
# Listar tabelas (local)
wrangler d1 execute escalas-db --local --command="SELECT name FROM sqlite_master WHERE type='table'"

# Listar tabelas (remoto/produção)
wrangler d1 execute escalas-db --remote --command="SELECT name FROM sqlite_master WHERE type='table'"

# Consulta rápida
wrangler d1 execute escalas-db --remote --command="SELECT COUNT(*) FROM usuarios"
```

### 3.4 Criar nova migration

1. Crie o arquivo SQL em `/migrations/` com o próximo número sequencial:
   ```
   migrations/0041_descricao_da_mudanca.sql
   ```
2. Teste localmente: `wrangler d1 execute escalas-db --local --file=./migrations/0041_descricao_da_mudanca.sql`
3. Adicione ao script `db:migrate` no `package.json`
4. Aplique em produção após deploy

---

## 4. Rollback

### 4.1 Rollback de deploy

O Cloudflare Pages mantém histórico de deployments. Para reverter:

**Via Cloudflare Dashboard:**

1. Acesse **Workers & Pages > escalas > Deployments**
2. Encontre o deployment anterior estável
3. Clique em **"Rollback to this deploy"**

**Via CLI:**

```bash
# Listar deployments
wrangler pages deployment list --project-name=escalas

# Reverter para um deployment específico (por ID)
wrangler pages deployment rollback --project-name=escalas <deployment-id>
```

**Via Git (novo deploy com código antigo):**

```bash
git revert HEAD
git push origin main
```

### 4.2 Rollback de banco de dados

D1 **não tem rollback automático**. Estratégias:

1. **Migration reversa** — Crie uma nova migration que desfaz as mudanças:
   ```sql
   -- 0042_rollback_0041.sql
   ALTER TABLE tabela DROP COLUMN coluna_nova;
   ```

2. **Backup antes de migrar** — Sempre exporte antes de migrations arriscadas:
   ```bash
   # Exportar dados
   wrangler d1 export escalas-db --remote --output=backup_$(date +%Y%m%d).sql
   ```

3. **Time Travel (D1)** — D1 suporta restauração point-in-time via dashboard:
   - Acesse **Workers & Pages > D1 > escalas-db > Time Travel**
   - Selecione um ponto no tempo anterior à migration problemática

---

## 5. Logs e Monitoramento

### 5.1 Logs estruturados

O sistema usa um logger estruturado (`src/lib/server/logger.ts`) que emite JSON compatível com Cloudflare Workers Logs:

```json
{
  "level": "error",
  "message": "Erro não tratado",
  "timestamp": "2026-04-04T12:00:00.000Z",
  "errorId": "a1b2c3d4",
  "path": "/api/escalas",
  "method": "POST"
}
```

Níveis disponíveis: `debug`, `info`, `warn`, `error`.

Para logs correlacionados por requisição, use `createRequestLogger(requestId, path)`.

### 5.2 Visualizar logs em tempo real

```bash
# Logs do Workers (tail em tempo real)
wrangler pages deployment tail --project-name=escalas
```

### 5.3 Sentry

Erros não tratados são capturados automaticamente pelo Sentry via `@sentry/cloudflare` (configurado em `src/hooks.server.ts`).

- **DSN:** Configurado via variável de ambiente `SENTRY_DSN` no Cloudflare Pages
- **Contexto do usuário:** Adicionado automaticamente via `setUser()` no hook
- **Error ID:** Cada erro gera um `errorId` correlacionado entre logs e Sentry
- **Dashboard:** Acesse o projeto no [sentry.io](https://sentry.io)

### 5.4 Verificação de erros

O `handleError` em `hooks.server.ts` captura todos os erros não tratados e:
1. Gera um `errorId` único
2. Loga com contexto (path, method, stack trace)
3. Envia ao Sentry com tags e extras
4. Retorna mensagem genérica ao usuário

---

## 6. Verificacao de Saude

O endpoint `/api/health` verifica o estado dos serviços:

```bash
curl https://escalas.pages.dev/api/health
```

**Resposta saudável (200):**

```json
{
  "status": "healthy",
  "checks": {
    "database": "ok",
    "r2": "ok"
  },
  "timestamp": "2026-04-04T12:00:00.000Z"
}
```

**Resposta degradada (503):**

```json
{
  "status": "degraded",
  "checks": {
    "database": "ok",
    "r2": "error"
  },
  "timestamp": "2026-04-04T12:00:00.000Z"
}
```

**Verificações realizadas:**

| Check | O que valida |
|---|---|
| `database` | Executa `SELECT 1` no D1 |
| `r2` | Verifica se o binding `escalas_docs` está disponível |

Utilize este endpoint para monitoramento externo (UptimeRobot, Checkly, etc.).

---

## 7. R2 Storage

O bucket R2 `escalas-docs` (binding `escalas_docs`) armazena documentos PDF assinados de escalas e GISE.

### 7.1 Listar objetos

```bash
# Listar objetos no bucket
wrangler r2 object list escalas-docs

# Listar com prefixo
wrangler r2 object list escalas-docs --prefix="escalas/"
```

### 7.2 Baixar arquivo

```bash
wrangler r2 object get escalas-docs/<chave-do-objeto> --file=documento.pdf
```

### 7.3 Upload manual (emergência)

```bash
wrangler r2 object put escalas-docs/<chave-do-objeto> --file=documento.pdf --content-type="application/pdf"
```

### 7.4 Remover arquivo

```bash
wrangler r2 object delete escalas-docs/<chave-do-objeto>
```

### 7.5 Verificar uso do bucket

Acesse o dashboard do Cloudflare: **R2 > escalas-docs > Metrics** para ver armazenamento total e operações.

---

## 8. Troubleshooting

### Build falha com erro de tipos

```
Error: svelte-check found errors
```

**Solucao:**
```bash
npx svelte-kit sync
npx svelte-check --threshold error
```

### Migration falha em producao

```
D1_ERROR: SQL error
```

**Solucao:**
1. Verifique se a migration ja foi aplicada: `wrangler d1 execute escalas-db --remote --command="SELECT name FROM sqlite_master WHERE type='table'"`
2. Teste localmente antes de reaplicar
3. Se necessario, crie migration corretiva

### Erro 401 em endpoints da API

O sistema exige autenticacao via cookie `session_token` para todas as rotas exceto:
- `/login`
- `/api/auth/login`
- `/validar`
- `/api/validar`
- `/api/health`

**Solucao:** Verifique se o token de sessao esta sendo enviado e se a sessao nao expirou.

### Primeiro acesso redireciona para /alterar-senha

Comportamento esperado. Usuarios com `primeiro_acesso = true` sao redirecionados para troca de senha obrigatoria.

### R2 retorna "error" no health check

**Solucao:**
1. Verifique se o binding `escalas_docs` esta configurado no `wrangler.toml`
2. Verifique se o bucket `escalas-docs` existe: `wrangler r2 bucket list`
3. Recrie se necessario: `wrangler r2 bucket create escalas-docs`

### Deploy manual falha com erro de autenticacao

```
Authentication error
```

**Solucao:**
```bash
wrangler login
# ou configure a variavel de ambiente
export CLOUDFLARE_API_TOKEN=seu-token
```

### Sentry nao recebe erros

**Solucao:**
1. Verifique se `SENTRY_DSN` esta configurado nas variaveis de ambiente do Cloudflare Pages
2. Acesse **Workers & Pages > escalas > Settings > Environment variables**
3. Confirme que o DSN esta correto para o ambiente (staging/production)

### Pagina retorna "Ocorreu um erro interno"

1. Anote o `errorId` exibido ao usuario
2. Busque nos logs do Cloudflare ou no Sentry usando esse ID
3. O log tera path, method e stack trace completos

---

## 9. Variaveis de Ambiente

### Secrets do GitHub Actions (CI/CD)

| Variavel | Descricao | Obrigatoria |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Token de API do Cloudflare para deploy | Sim |
| `CLOUDFLARE_ACCOUNT_ID` | ID da conta Cloudflare | Sim |

Configurar em: **GitHub > Settings > Environments > staging / production > Secrets**

### Bindings do Cloudflare (wrangler.toml)

| Binding | Tipo | Recurso |
|---|---|---|
| `escalas_db` | D1 Database | `escalas-db` (ID: `dc86ec72-7ed4-4e8c-9d29-67a4e509ea49`) |
| `escalas_docs` | R2 Bucket | `escalas-docs` |

### Variaveis de ambiente do Cloudflare Pages

| Variavel | Descricao | Obrigatoria |
|---|---|---|
| `SENTRY_DSN` | DSN do projeto Sentry para captura de erros | Nao (recomendada) |

Configurar em: **Cloudflare Dashboard > Workers & Pages > escalas > Settings > Environment variables**

> **Nota:** Os bindings D1 e R2 sao configurados automaticamente pelo `wrangler.toml` e nao precisam ser definidos como variaveis de ambiente.

---

## Referencia Rapida de Comandos

```bash
# Desenvolvimento local
npm run dev

# Build
npm run build

# Testes
npm run test

# Type checking
npm run check

# Migrations locais
npm run db:migrate

# Migration individual (remoto)
wrangler d1 execute escalas-db --remote --file=./migrations/XXXX_nome.sql

# Deploy manual producao
npm run build && wrangler pages deploy .svelte-kit/cloudflare --project-name=escalas

# Logs em tempo real
wrangler pages deployment tail --project-name=escalas

# Health check
curl https://escalas.pages.dev/api/health
```
