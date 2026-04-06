-- Tabela para rate limiting de tentativas de login por IP
CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    attempted_at TEXT NOT NULL DEFAULT (datetime('now')),
    success INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_login_attempts_ip_time ON login_attempts (ip, attempted_at);
