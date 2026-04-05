/**
 * 1. login/+server.ts — pula 2FA quando primeiro_acesso=1; adiciona admin geral via env vars
 * 2. login/+page.svelte — remove maxlength="8" do campo senha
 */
const fs = require('fs');
const path = require('path');

function r(p) { return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'); }
function w(p, c) { fs.writeFileSync(p, c.replace(/\n/g, '\r\n'), 'utf8'); console.log('  Written:', path.basename(p)); }
function rep(src, old, neu, label) {
  if (!src.includes(old)) { console.error('  [ERR]', label); return src; }
  console.log('  [OK]', label);
  return src.replace(old, neu);
}

// ============================================================
// 1. api/auth/login/+server.ts
// ============================================================
const loginPath = path.join(__dirname, 'src', 'routes', 'api', 'auth', 'login', '+server.ts');
let s = r(loginPath);

// 1a. Pular 2FA para policial com primeiro_acesso = 1
s = rep(s,
  '\t// 2FA: se o policial tiver e-mail cadastrado, exige verificação\n\tif (policial.email) {',
  '\t// 2FA: exige verificação apenas se NÃO for primeiro acesso (já verificou via e-mail ao receber senha provisória)\n\tif (policial.email && policial.primeiro_acesso !== 1) {',
  'skip 2FA primeiro_acesso policial'
);

// 1b. Pular 2FA para admin com primeiro_acesso = 1 (DB admins)
s = rep(s,
  '\t\t// 2FA: se o admin tiver e-mail cadastrado, exige verificação\n\t\tif (admin.email) {',
  '\t\t// 2FA: exige verificação apenas se não for primeiro acesso\n\t\tif (admin.email && admin.primeiro_acesso !== 1) {',
  'skip 2FA primeiro_acesso admin'
);

// 1c. Inserir bloco de admin geral via env vars antes da busca de admin no DB
s = rep(s,
  '\tif (tipo === \'admin\') {\n\t\tconst admin = await db',
  `\tif (tipo === 'admin') {
\t\t// --- Admin Geral via variáveis de ambiente ---
\t\tconst _env = (platform as { env?: Record<string, string> } | undefined)?.env ?? {};
\t\tconst envLogin = _env.ADMIN_GERAL_LOGIN?.trim() ?? '';
\t\tconst envSenha = _env.ADMIN_GERAL_SENHA ?? '';

\t\tif (envLogin && envSenha && matricula === envLogin) {
\t\t\tif (senha !== envSenha) {
\t\t\t\tawait recordAttempt(db, ip, false);
\t\t\t\treturn json({ error: 'Login ou senha inválidos' }, { status: 401 });
\t\t\t}
\t\t\t// Busca ou cria o registro no DB (necessário para a sessão)
\t\t\tlet envAdmin = await db
\t\t\t\t.select()
\t\t\t\t.from(administradores)
\t\t\t\t.where(eq(administradores.login, envLogin))
\t\t\t\t.get();
\t\t\tif (!envAdmin) {
\t\t\t\tconst senhaHash = await hashSenha(crypto.randomUUID());
\t\t\t\tawait db.insert(administradores).values({
\t\t\t\t\tlogin: envLogin,
\t\t\t\t\tnome: 'Administrador Geral',
\t\t\t\t\tsenha: senhaHash,
\t\t\t\t\tprimeiro_acesso: 0
\t\t\t\t});
\t\t\t\tenvAdmin = await db
\t\t\t\t\t.select()
\t\t\t\t\t.from(administradores)
\t\t\t\t\t.where(eq(administradores.login, envLogin))
\t\t\t\t\t.get();
\t\t\t}
\t\t\tif (!envAdmin) return json({ error: 'Erro ao inicializar administrador.' }, { status: 500 });
\t\t\tawait recordAttempt(db, ip, true);
\t\t\tconst token = await criarSessao(db, 'admin', envAdmin.id);
\t\t\tcookies.set('session_token', token, cookieOptions(url));
\t\t\treturn json({ success: true, primeiro_acesso: false, nome: envAdmin.nome });
\t\t}
\t\t// --- Fim admin geral via env ---

\t\tconst admin = await db`,
  'env admin block'
);

w(loginPath, s);

// ============================================================
// 2. login/+page.svelte — remove maxlength="8" do campo senha
// ============================================================
const loginPagePath = path.join(__dirname, 'src', 'routes', 'login', '+page.svelte');
let p = r(loginPagePath);

p = rep(p,
  '\t\t\t\t\t<input\n\t\t\t\t\t\tclass="input"\n\t\t\t\t\t\ttype="password"\n\t\t\t\t\t\tbind:value={senha}\n\t\t\t\t\t\tplaceholder="Digite sua senha"\n\t\t\t\t\t\tmaxlength="8"\n\t\t\t\t\t\trequired\n\t\t\t\t\t/>',
  '\t\t\t\t\t<input\n\t\t\t\t\t\tclass="input"\n\t\t\t\t\t\ttype="password"\n\t\t\t\t\t\tbind:value={senha}\n\t\t\t\t\t\tplaceholder="Digite sua senha"\n\t\t\t\t\t\trequired\n\t\t\t\t\t/>',
  'remove maxlength senha login'
);

w(loginPagePath, p);

console.log('\nDone.');
