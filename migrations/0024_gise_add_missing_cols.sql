-- Migration 0024: Add missing custom hours columns to gise_seccionais and gise_equipes
-- These columns exist in the Drizzle schema but were missing in production
-- (tables were created by partial 0017 execution before the full 0022 migration)

ALTER TABLE gise_seccionais ADD COLUMN hora_entrada_sabado TEXT;
ALTER TABLE gise_seccionais ADD COLUMN hora_saida_sabado TEXT;
ALTER TABLE gise_seccionais ADD COLUMN hora_entrada_domingo TEXT;
ALTER TABLE gise_seccionais ADD COLUMN hora_saida_domingo TEXT;

ALTER TABLE gise_equipes ADD COLUMN hora_entrada_sabado TEXT;
ALTER TABLE gise_equipes ADD COLUMN hora_saida_sabado TEXT;
ALTER TABLE gise_equipes ADD COLUMN hora_entrada_domingo TEXT;
ALTER TABLE gise_equipes ADD COLUMN hora_saida_domingo TEXT;
