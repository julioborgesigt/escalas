-- Migration 0001: latitude / longitude como REAL (graus decimais WGS-84)
--
-- Contexto: o schema Drizzle e a migração inicial (0000) já declaram colunas
-- `latitude` e `longitude` como REAL nas tabelas:
--   escala_documentos, gise_documentos, gise_presencas, gise_assinaturas_relatorios
--
-- SQLite não suporta ALTER COLUMN para mudar o tipo declarado. Bancos legados que
-- tenham sido criados com INTEGER precisariam de recriação de tabela
-- (CREATE TABLE _new …, INSERT SELECT …, DROP, ALTER RENAME). Este projeto padroniza
-- em REAL desde 0000; abaixo apenas normalizamos valores para armazenamento float
-- (CAST idempotente quando já são decimais).
--
--> statement-breakpoint
UPDATE `escala_documentos` SET `latitude` = CAST(`latitude` AS REAL) WHERE `latitude` IS NOT NULL;
--> statement-breakpoint
UPDATE `escala_documentos` SET `longitude` = CAST(`longitude` AS REAL) WHERE `longitude` IS NOT NULL;
--> statement-breakpoint
UPDATE `gise_documentos` SET `latitude` = CAST(`latitude` AS REAL) WHERE `latitude` IS NOT NULL;
--> statement-breakpoint
UPDATE `gise_documentos` SET `longitude` = CAST(`longitude` AS REAL) WHERE `longitude` IS NOT NULL;
--> statement-breakpoint
UPDATE `gise_presencas` SET `latitude` = CAST(`latitude` AS REAL) WHERE `latitude` IS NOT NULL;
--> statement-breakpoint
UPDATE `gise_presencas` SET `longitude` = CAST(`longitude` AS REAL) WHERE `longitude` IS NOT NULL;
--> statement-breakpoint
UPDATE `gise_assinaturas_relatorios` SET `latitude` = CAST(`latitude` AS REAL) WHERE `latitude` IS NOT NULL;
--> statement-breakpoint
UPDATE `gise_assinaturas_relatorios` SET `longitude` = CAST(`longitude` AS REAL) WHERE `longitude` IS NOT NULL;
