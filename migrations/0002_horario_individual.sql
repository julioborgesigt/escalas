-- Add individual horario column to escala_policiais
ALTER TABLE escala_policiais ADD COLUMN horario TEXT NOT NULL DEFAULT '';
