-- Admin Geral vinculado: a linha de `administradores` passa a poder referenciar
-- um `policiais.id`. Quando preenchido, a conta admin NÃO tem senha própria — o
-- login de administrador autentica contra as credenciais do policial vinculado
-- (mesma senha/e-mail/2FA). Nulo = admin standalone (bootstrap por env).
ALTER TABLE administradores ADD COLUMN policial_id INTEGER;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_administradores_policial_id ON administradores (policial_id);
