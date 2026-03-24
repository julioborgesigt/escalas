-- Adiciona campo regime aos policiais para diferenciar servidores de plantão e expediente
ALTER TABLE policiais ADD COLUMN regime TEXT CHECK(regime IN ('plantao', 'expediente', 'ambos')) NOT NULL DEFAULT 'ambos';
