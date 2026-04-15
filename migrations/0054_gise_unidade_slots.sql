-- Reestrutura unidades por seccional GISE:
-- 1. gise_seccional_unidades.unidade_id passa a ser NULLABLE (slot pode ser criado sem unidade definida)
-- 2. gise_equipes ganha gise_unidade_id (equipes agora pertencem a um slot de unidade, não à seccional)
-- 3. Migra dados existentes: unidade_operacional_id → slot, equipes existentes → primeiro slot

-- ----------------------------------------------------------------
-- Recriar gise_seccional_unidades com unidade_id nullable
-- ----------------------------------------------------------------
CREATE TABLE gise_seccional_unidades_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gise_seccional_id INTEGER NOT NULL REFERENCES gise_seccionais(id) ON DELETE CASCADE,
  unidade_id INTEGER REFERENCES unidades(id) ON DELETE SET NULL
);

CREATE INDEX idx_gise_sec_unid_v2 ON gise_seccional_unidades_v2(gise_seccional_id);

INSERT INTO gise_seccional_unidades_v2 (id, gise_seccional_id, unidade_id)
SELECT id, gise_seccional_id, unidade_id FROM gise_seccional_unidades;

DROP TABLE gise_seccional_unidades;
ALTER TABLE gise_seccional_unidades_v2 RENAME TO gise_seccional_unidades;

-- ----------------------------------------------------------------
-- Adiciona gise_unidade_id a gise_equipes
-- ----------------------------------------------------------------
ALTER TABLE gise_equipes ADD COLUMN gise_unidade_id INTEGER REFERENCES gise_seccional_unidades(id) ON DELETE CASCADE;
CREATE INDEX idx_gise_equipes_unidade ON gise_equipes(gise_unidade_id);

-- ----------------------------------------------------------------
-- Migra dados existentes
-- ----------------------------------------------------------------

-- Para seccionais com unidade_operacional_id definida, cria um slot de unidade
-- (se ainda não existir um slot para essa unidade nessa seccional)
INSERT INTO gise_seccional_unidades (gise_seccional_id, unidade_id)
SELECT id, unidade_operacional_id
FROM gise_seccionais
WHERE unidade_operacional_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM gise_seccional_unidades gsu
    WHERE gsu.gise_seccional_id = gise_seccionais.id
      AND gsu.unidade_id = gise_seccionais.unidade_operacional_id
  );

-- Para seccionais sem nenhum slot, cria um slot em branco
INSERT INTO gise_seccional_unidades (gise_seccional_id, unidade_id)
SELECT id, NULL
FROM gise_seccionais
WHERE NOT EXISTS (
  SELECT 1 FROM gise_seccional_unidades gsu
  WHERE gsu.gise_seccional_id = gise_seccionais.id
);

-- Associa equipes existentes (sem gise_unidade_id) ao primeiro slot da sua seccional
UPDATE gise_equipes
SET gise_unidade_id = (
  SELECT gsu.id
  FROM gise_seccional_unidades gsu
  WHERE gsu.gise_seccional_id = gise_equipes.gise_seccional_id
  ORDER BY gsu.id
  LIMIT 1
)
WHERE gise_unidade_id IS NULL;
