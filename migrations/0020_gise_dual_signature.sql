-- Migration 0020: Dual signature support for GISE scales
-- Allows separate documents for Saturday and Sunday

-- 1. Create the new table without the unique constraint on gise_id
CREATE TABLE gise_documentos_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gise_id INTEGER NOT NULL REFERENCES gise_escalas(id) ON DELETE CASCADE,
    dia TEXT NOT NULL CHECK (dia IN ('sabado', 'domingo', 'ambos')),
    r2_key TEXT NOT NULL,
    assinante_id INTEGER,
    assinante_nome TEXT NOT NULL DEFAULT '',
    assinante_cpf TEXT NOT NULL DEFAULT '',
    verificacao_hash TEXT UNIQUE,
    created_at TEXT DEFAULT (datetime('now'))
);

-- 2. Migrate existing data
-- Existing documents are treated as 'sabado' by default or we can use 'ambos' for legacy.
-- Given the new requirement, 'ambos' reflects the legacy state where one signature covered both.
INSERT INTO gise_documentos_new (id, gise_id, dia, r2_key, assinante_id, assinante_nome, assinante_cpf, verificacao_hash, created_at)
SELECT id, gise_id, 'ambos', r2_key, assinante_id, assinante_nome, assinante_cpf, verificacao_hash, created_at
FROM gise_documentos;

-- 3. Replace the old table
DROP TABLE gise_documentos;
ALTER TABLE gise_documentos_new RENAME TO gise_documentos;

-- 4. Create unique index for (gise_id, dia)
-- Note: 'ambos' is allowed once, 'sabado' once, 'domingo' once.
CREATE UNIQUE INDEX idx_gise_documentos_gise_dia ON gise_documentos(gise_id, dia);
