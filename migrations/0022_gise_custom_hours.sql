-- Migration to add custom GISE hours per seccional/equipe
ALTER TABLE gise_seccionais ADD COLUMN hora_entrada_sabado TEXT;
ALTER TABLE gise_seccionais ADD COLUMN hora_saida_sabado TEXT;
ALTER TABLE gise_seccionais ADD COLUMN hora_entrada_domingo TEXT;
ALTER TABLE gise_seccionais ADD COLUMN hora_saida_domingo TEXT;

ALTER TABLE gise_equipes ADD COLUMN hora_entrada_sabado TEXT;
ALTER TABLE gise_equipes ADD COLUMN hora_saida_sabado TEXT;
ALTER TABLE gise_equipes ADD COLUMN hora_entrada_domingo TEXT;
ALTER TABLE gise_equipes ADD COLUMN hora_saida_domingo TEXT;
