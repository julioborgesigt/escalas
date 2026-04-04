-- Migration: add_gise_r2_key
-- Description: Adiciona a coluna r2_key para armazenar o caminho do PDF assinado no R2

ALTER TABLE gise_assinaturas_relatorios ADD COLUMN r2_key TEXT;
