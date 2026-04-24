# Scripts da pasta `scripts/`

Este arquivo descreve o objetivo de cada script utilitário e os comandos de atalho disponíveis.

## Migrações de banco (D1)

### `migrate.ts`
- **Função:** executa todas as migrations da pasta `migrations/` em ordem.
- **Atalhos:**
  - Local: `npm run db:migrate`
  - Produção (remoto): `npm run db:migrate:prod`
- **Comando direto:**
  - Local: `npx tsx scripts/migrate.ts`
  - Remoto: `npx tsx scripts/migrate.ts --remote`

### `renumber-migrations.ps1`
- **Função:** utilitário PowerShell para renumerar/reorganizar arquivos de migration.
- **Atalho npm:** não possui.
- **Comando direto (PowerShell):**
  - `.\scripts\renumber-migrations.ps1`

## Senhas / usuários

### `set-default-password-all-users.ts`
- **Função:** define senha padrão para **todos os usuários** (`policiais` e `administradores`) como `J1a2b3cd4j`, com hash PBKDF2.
- **Atalhos:**
  - Local: `npm run users:set-default-password`
  - Produção (remoto): `npm run users:set-default-password:prod`
- **Comando direto:**
  - Local: `npx tsx scripts/set-default-password-all-users.ts --yes`
  - Remoto: `npx tsx scripts/set-default-password-all-users.ts --remote --yes`

### `clear-passwords-non-admins.ts`
- **Função:** limpa senha de **todos os policiais**, preservando os `administradores`.
- **Atalhos:**
  - Local: `npm run users:clear-passwords-non-admins`
  - Produção (remoto): `npm run users:clear-passwords-non-admins:prod`
- **Comando direto:**
  - Local: `npx tsx scripts/clear-passwords-non-admins.ts --yes`
  - Remoto: `npx tsx scripts/clear-passwords-non-admins.ts --remote --yes`

## Integração com Google Sheets

### `GoogleAppsScript_Sync.gs`
- **Função:** script Apps Script da planilha para sincronização de:
  - unidades (`DB_UNIDADES`) -> D1
  - servidores (`DB_SERVIDORES`) -> D1
  - reset de base (com proteção por token e confirmação)
  - **Base_Equipe (GISE):** recebimento **do portal** quando uma escala GISE é **finalizada** (e reenvio manual pelo admin, se necessário)
- **Atalho npm:** não se aplica (executado dentro do Google Apps Script).

#### Base_Equipe — envio da GISE para a planilha

Ao **marcar a GISE como finalizada**, o servidor tenta enviar automaticamente as linhas da equipe para a aba **`Base_Equipe`** (uma linha por membro escalado; o script remove linhas antigas daquele `gise_id` e grava de novo). Se esse envio falhar (rede, timeout, secret incorreto, etc.), a finalização **não é desfeita**; o **Admin Geral** pode reenviar na página da GISE com o botão **“Enviar para a planilha”** (visível só com status **finalizada**).

**Configuração obrigatória no Cloudflare Pages** (variáveis disponíveis em **runtime** da função Pages / Worker — não só na etapa de *build*):

| Variável | Descrição |
|----------|-----------|
| `GISE_BASE_EQUIPE_WEBHOOK_URL` | URL do **Web App** do Apps Script (`https://script.google.com/macros/s/…/exec`). **Não** use URL do portal escalas (ex.: `*.pages.dev`); o POST iria para o site e retornaria redirecionamento para `/login`. Implantar como *executar como: Eu*; ver comentários no topo de `GoogleAppsScript_Sync.gs`. |
| `GISE_BASE_EQUIPE_SECRET` | Segredo compartilhado: **deve ser o mesmo valor** salvo na planilha em **Script Properties** como `BASE_EQUIPE_SECRET` (menu do script: **“Secret Base_Equipe (portal)”**). Sem as duas variáveis, o envio automático e o botão de reenvio retornam erro de configuração. |

No painel do Pages, cadastre as duas para o ambiente em que você acessa o site (**Production** e/ou **Preview**). Se aparecer *“URL ou secret ausente”* mesmo com valores corretos: confira se não estão só em variáveis de **build**; use **Variáveis e segredos** (runtime) e faça um **novo deploy** após alterar. O código do portal também lê essas chaves via `$env/dynamic/private` (comportamento recomendado pelo SvelteKit no adapter-cloudflare). Se um dia você cadastrou o link `docs.google.com/spreadsheets/...` no **`wrangler.toml`** (`[vars]`) ou em outro binding, **remova ou atualize** — esse valor antigo em `platform.env` pode sobrescrever o URL certo até você limpar; o servidor agora prefere automaticamente um `script.google.com/.../exec` quando as duas fontes divergem.

Abrir o URL `/exec` no navegador pode mostrar *“Script function not found: doGet”* — é esperado se só existir `doPost`; o portal usa **POST** com JSON.

**Desenvolvimento local:** use um arquivo **`.dev.vars`** na raiz do repositório (Wrangler) com as mesmas chaves, ou `wrangler pages dev` com variáveis configuradas — o `vite dev` sozinho pode não enxergar o mesmo `platform.env` que a produção.

**Na planilha (Apps Script):** use o menu para gravar o secret; confira se a aba **`Base_Equipe`** existe e está alinhada ao modelo esperado (colunas A–J, conforme documentado no próprio `.gs`). Sem configurar o **novo** `GISE_BASE_EQUIPE_SECRET` no Pages **e** o par correspondente na planilha, a integração Base_Equipe não autentica e o portal não consegue gravar na planilha.

**Web App e planilha:** em execução via POST, o Google costuma **não** expor `getActiveSpreadsheet()`. O script tenta `ScriptApp.getScriptContainerInfo()` **só se existir** (motor **V8** no Apps Script: *Projeto → Configurações do editor*). Caso contrário, use o menu **“ID planilha Base_Equipe (portal)”** (`BASE_EQUIPE_SPREADSHEET_ID` com o ID da URL `docs.google.com/.../d/ID/...`). Depois de alterar o `.gs`, **implante uma nova versão** do aplicativo da Web.

**Não confunda os links:** o URL do tipo `https://docs.google.com/spreadsheets/d/SEU_ID/edit` é só para **abrir a planilha** no navegador. Em **`GISE_BASE_EQUIPE_WEBHOOK_URL`** (Cloudflare) deve entrar **somente** o URL de **implantação do Web App** (`https://script.google.com/macros/s/…/exec`). O trecho `SEU_ID` da URL da planilha é o que você cola no menu **“ID planilha Base_Equipe (portal)”** *no Apps Script*, se o script não estiver vinculado ao arquivo — não vai no Cloudflare como webhook.

