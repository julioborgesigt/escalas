-- Migration: GISE Presenças Selfies
-- Adiciona as colunas de selfie que foram omitidas na refatoração 0034.

ALTER TABLE gise_presencas ADD COLUMN entrada_selfie_key TEXT;
ALTER TABLE gise_presencas ADD COLUMN saida_selfie_key TEXT;
