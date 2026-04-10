PRAGMA foreign_keys=OFF;

CREATE TABLE dois_fatores_tokens_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    desafio_id TEXT NOT NULL UNIQUE,
    tipo TEXT NOT NULL CHECK(tipo IN ('policial', 'admin', 'assinatura')),
    usuario_id INTEGER NOT NULL,
    codigo TEXT NOT NULL,
    tentativas INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    usado INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);

INSERT INTO dois_fatores_tokens_new (id, desafio_id, tipo, usuario_id, codigo, tentativas, expires_at, usado, created_at)
SELECT id, desafio_id, tipo, usuario_id, codigo, tentativas, expires_at, usado, created_at FROM dois_fatores_tokens;

DROP TABLE dois_fatores_tokens;
ALTER TABLE dois_fatores_tokens_new RENAME TO dois_fatores_tokens;

CREATE INDEX idx_2fa_desafio ON dois_fatores_tokens (desafio_id);

PRAGMA foreign_keys=ON;
