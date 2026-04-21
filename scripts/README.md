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

### `reset-admin-password.ts`
- **Função:** gera hash PBKDF2 para uma nova senha de admin e imprime SQL pronto para execução no D1.
- **Atalho npm:** não possui.
- **Comando direto:**
  - `npx tsx scripts/reset-admin-password.ts "NovaSenha123"`

## Integração com Google Sheets

### `GoogleAppsScript_Sync.gs`
- **Função:** script Apps Script da planilha para sincronização de:
  - unidades (`DB_UNIDADES`) -> D1
  - servidores (`DB_SERVIDORES`) -> D1
  - reset de base (com proteção por token e confirmação)
- **Atalho npm:** não se aplica (executado dentro do Google Apps Script).

