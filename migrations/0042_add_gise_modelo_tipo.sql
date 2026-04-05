-- Migration: add_gise_modelo_tipo
-- Description: Adiciona a coluna tipo para separar modelos de Operacional e SEINT

ALTER TABLE gise_modelo_formulario ADD COLUMN tipo TEXT NOT NULL DEFAULT 'operacional';

-- Garante que o modelo atual seja o operacional
UPDATE gise_modelo_formulario SET tipo = 'operacional' WHERE id = 1;
