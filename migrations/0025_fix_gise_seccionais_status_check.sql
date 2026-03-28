-- Migration 0025: Fix gise_seccionais status CHECK constraint to include 'retificada'
-- Migration 0017 created the table with CHECK(status IN ('pendente','preenchida')).
-- SQLite requires table recreation to modify CHECK constraints.

PRAGMA foreign_keys = OFF;

CREATE TABLE gise_seccionais_new (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  gise_id                INTEGER NOT NULL REFERENCES gise_escalas(id) ON DELETE CASCADE,
  seccional_id           INTEGER NOT NULL REFERENCES unidades(id),
  unidade_operacional_id INTEGER REFERENCES unidades(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK(status IN ('pendente','preenchida','retificada')),
  hora_entrada_sabado  TEXT,
  hora_saida_sabado    TEXT,
  hora_entrada_domingo TEXT,
  hora_saida_domingo   TEXT,
  UNIQUE(gise_id, seccional_id)
);

-- Copy only core columns (hora_* may not exist in older DB states)
INSERT INTO gise_seccionais_new (id, gise_id, seccional_id, unidade_operacional_id, status)
SELECT id, gise_id, seccional_id, unidade_operacional_id, status
FROM gise_seccionais;

DROP TABLE gise_seccionais;

ALTER TABLE gise_seccionais_new RENAME TO gise_seccionais;

CREATE INDEX IF NOT EXISTS idx_gise_seccionais_gise ON gise_seccionais(gise_id);

PRAGMA foreign_keys = ON;
