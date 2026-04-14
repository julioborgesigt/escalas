-- Tabela para associar múltiplas unidades operacionais a uma seccional do dia GISE.
-- Permite que o ADM seccional registre mais de uma unidade em operação simultânea.

CREATE TABLE gise_seccional_unidades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gise_seccional_id INTEGER NOT NULL REFERENCES gise_seccionais(id) ON DELETE CASCADE,
  unidade_id INTEGER NOT NULL REFERENCES unidades(id) ON DELETE CASCADE,
  UNIQUE(gise_seccional_id, unidade_id)
);

CREATE INDEX idx_gise_sec_unidades ON gise_seccional_unidades(gise_seccional_id);
