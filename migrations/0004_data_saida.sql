-- Add data_saida column to escala_policiais for shifts spanning multiple days
ALTER TABLE escala_policiais ADD COLUMN data_saida TEXT NOT NULL DEFAULT '';
