-- Conta de teste para VALIDAR o A3 (PBKDF2 600k) no Worker de STAGING.
-- O hash abaixo tem iter=600000 EMBUTIDO; verificarSenha (auth.ts) deriva 600k
-- ao logar — exatamente o caminho que dava Error 1102 / HTTP 500 no Pages.
-- NAO requer mudanca de codigo nem redeploy (verify honra o iter do hash).
--
-- Rodar SOMENTE no staging:
--   npx wrangler d1 execute escalas-db-staging --remote --file scripts/seed-staging-600k-login.sql
--
-- Depois, logar em https://escalas-staging.julio-aparecido3.workers.dev/login com:
--   Matricula: TESTE600K
--   Senha:     Validacao600k!2026
-- email=NULL de proposito: apos a derivacao 600k (sucesso), o fail-closed A1
-- responde 403 "contate o administrador" — o que PROVA que a verificacao de
-- senha rodou 600k e passou, sem estourar a CPU (no Pages, daria 500/1102).
--
-- Limpeza: DELETE FROM policiais WHERE id=99200;

INSERT OR REPLACE INTO policiais
  (id, matricula, nome, cargo, lotacao, senha, primeiro_acesso, email, ativo)
VALUES
  (99200, 'TESTE600K', 'Teste PBKDF2 600k', 'OIP', 'DELEGACIA DEMO STAGING', 'pbkdf2v2:600000:c280a3779894908b02e3df355e20edbb:14be9535e493726683e733c0bcf2a8f604bdf275da7deee171ca9b6cfa945d9d', 0, NULL, 1);
