# Verificação local (rodar o app de verdade)

Receita testada para subir o app e dirigi-lo com Playwright num ambiente
descartável (container/CI), incluindo login em todos os perfis.

## Subir o app

```bash
# 1. Secrets locais mínimos (gitignored) — os logins de bootstrap dispensam DB:
cat > .dev.vars <<'EOF'
SYNC_TOKEN=dev-sync-token
RESET_TOKEN=dev-reset-token
ADMIN_GERAL_LOGIN=admgeral
ADMIN_GERAL_SENHA=SenhaForteDev123!
SUPER_ADMIN_LOGIN=superadm
SUPER_ADMIN_SENHA=SenhaForteDev456!
EOF

npm ci
npm run db:migrate      # D1 local (Miniflare, .wrangler/state) — demora ~4min
npm run dev             # http://127.0.0.1:5173
```

## Logins por perfil

- **Admin Geral / Super Admin (bootstrap por env)**: tela de login → aba
  "Administrador" → escolher módulo (atenção: o padrão do seletor é **GISE**,
  clique em "Escalas ordinárias" explicitamente) → login/senha do `.dev.vars`. Sem 2FA
  quando `ADMIN_GERAL_EMAIL`/`SUPER_ADMIN_EMAIL` não estão definidos.
- **Policial comum**: o login normal exige 2FA por e-mail (sem provedor
  local, inviável). Contorno para teste local: criar o policial via SQL e
  **forjar uma sessão legada** (token em claro de 64 hex é aceito pelo
  fallback de `buscarSessaoValida` e promovido a hash):

```bash
npx wrangler d1 execute escalas-db --local --command \
  "INSERT INTO policiais (nome, matricula, cargo, lotacao, senha) \
   VALUES ('Teste', '99887766', 'OIP', 'DELEGACIA TESTE', 'x');"
TOK=$(openssl rand -hex 32)
npx wrangler d1 execute escalas-db --local --command \
  "INSERT INTO sessoes (token, tipo, usuario_id, expires_at) \
   SELECT '$TOK', 'policial', id, datetime('now','+1 day') \
   FROM policiais WHERE matricula='99887766';"
# No Playwright: addCookies([{ name: 'session_token', value: TOK, url: BASE }])
```

  Se cair em `/aceitar-termo`, basta submeter o form da página.
  `primeiro_acesso=1` força troca de senha + verificação de e-mail pessoal
  (código por e-mail — trave local); zere com
  `UPDATE policiais SET primeiro_acesso=0 WHERE matricula='...';`.

## Dirigir com Playwright

Chromium pré-instalado no runner: `chromium.launch({ executablePath:
'/opt/pw-browsers/chromium' })`, requerendo
`/home/user/escalas/node_modules/@playwright/test` por caminho absoluto num
script `.cjs` fora do repo. Tema: perfil limpo abre no claro; para escuro,
`addInitScript(() => localStorage.setItem('color-theme', 'dark'))` (a classe
`dark` fica no `<html>`).

## Pegadinhas

- `npm run db:migrate` roda um `wrangler d1 execute` por migration — não
  assuma travamento antes de ~5 min.
- Formulário de login: campos `matricula` e `senha`; botão de módulo dentro
  de `label:has-text("Módulo de Acesso")` (há "Escalas ordinárias"/"GISE" duplicados
  fora dele).
- A ordem de tabulação passa pela sidebar inteira antes do conteúdo.
