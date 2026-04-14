-- Remove a restrição de unicidade (gise_seccional_id, tipo) de gise_equipes,
-- permitindo múltiplas equipes do mesmo tipo (operacional ou seint) por seccional.
-- SQLite não suporta DROP CONSTRAINT; é necessário recriar a tabela.

CREATE TABLE gise_equipes_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gise_seccional_id INTEGER NOT NULL REFERENCES gise_seccionais(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK(tipo IN ('operacional','seint')),
  slots_dpc INTEGER NOT NULL DEFAULT 0,
  slots_oip INTEGER NOT NULL DEFAULT 0,
  hora_entrada TEXT,
  hora_saida TEXT
);

INSERT INTO gise_equipes_new SELECT * FROM gise_equipes;
DROP TABLE gise_equipes;
ALTER TABLE gise_equipes_new RENAME TO gise_equipes;
CREATE INDEX idx_gise_equipes_sec ON gise_equipes(gise_seccional_id);
