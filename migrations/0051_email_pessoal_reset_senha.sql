-- Colunas de e-mail pessoal (opcional, para recuperação de senha)
ALTER TABLE policiais ADD COLUMN email_pessoal TEXT;
ALTER TABLE policiais ADD COLUMN email_pessoal_verificado INTEGER NOT NULL DEFAULT 0;

ALTER TABLE administradores ADD COLUMN email_pessoal TEXT;
ALTER TABLE administradores ADD COLUMN email_pessoal_verificado INTEGER NOT NULL DEFAULT 0;

-- Tabela de tokens para redefinição de senha (256 bits, uso único, expira em 1 hora)
CREATE TABLE IF NOT EXISTS reset_senha_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    tipo_usuario TEXT NOT NULL CHECK(tipo_usuario IN ('policial', 'admin')),
    usuario_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    usado INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);
CREATE INDEX IF NOT EXISTS idx_reset_senha_token ON reset_senha_tokens(token);
CREATE INDEX IF NOT EXISTS idx_reset_senha_usuario
    ON reset_senha_tokens(tipo_usuario, usuario_id, created_at);
