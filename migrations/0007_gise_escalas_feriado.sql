-- Marca se o dia da escala GISE é feriado (uso em regras e relatórios futuros)
ALTER TABLE `gise_escalas` ADD `feriado` integer DEFAULT 0 NOT NULL;
