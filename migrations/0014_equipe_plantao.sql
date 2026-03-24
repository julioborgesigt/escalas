-- Adiciona campo equipe a escala_policiais para identificar a equipe de plantão do servidor
ALTER TABLE escala_policiais ADD COLUMN equipe TEXT NOT NULL DEFAULT '';
