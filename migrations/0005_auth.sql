-- Adicionar campos de autenticação na tabela policiais
ALTER TABLE policiais ADD COLUMN senha TEXT NOT NULL DEFAULT 'ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f';
ALTER TABLE policiais ADD COLUMN primeiro_acesso INTEGER NOT NULL DEFAULT 1;

-- Tabela de administradores
CREATE TABLE IF NOT EXISTS administradores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT NOT NULL UNIQUE,
    senha TEXT NOT NULL,
    nome TEXT NOT NULL,
    primeiro_acesso INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Admin padrão: login=admin, senha=admin123 (SHA-256 hash)
INSERT INTO administradores (login, senha, nome) VALUES ('admin', '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', 'Administrador');

-- Tabela de sessões
CREATE TABLE IF NOT EXISTS sessoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    tipo TEXT NOT NULL CHECK(tipo IN ('policial', 'admin')),
    usuario_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessoes_token ON sessoes(token);
CREATE INDEX IF NOT EXISTS idx_sessoes_expires ON sessoes(expires_at);

-- Adicionar lotacao nas escalas para filtrar por unidade
ALTER TABLE escalas ADD COLUMN lotacao TEXT NOT NULL DEFAULT '';
