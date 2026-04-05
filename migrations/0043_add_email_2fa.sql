-- Adicionar e-mail aos policiais (para autenticação de dois fatores)
ALTER TABLE policiais ADD COLUMN email TEXT;

-- Adicionar e-mail aos administradores
ALTER TABLE administradores ADD COLUMN email TEXT;

-- Tabela de desafios 2FA (códigos temporários enviados por e-mail)
CREATE TABLE IF NOT EXISTS dois_fatores_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    desafio_id TEXT NOT NULL UNIQUE,
    tipo TEXT NOT NULL CHECK(tipo IN ('policial', 'admin')),
    usuario_id INTEGER NOT NULL,
    codigo TEXT NOT NULL,
    tentativas INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    usado INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);

CREATE INDEX IF NOT EXISTS idx_2fa_desafio ON dois_fatores_tokens(desafio_id);
CREATE INDEX IF NOT EXISTS idx_2fa_expires ON dois_fatores_tokens(expires_at);
