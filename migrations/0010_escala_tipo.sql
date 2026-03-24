-- Add tipo column to escalas to support plantao/expediente/fds classification
ALTER TABLE escalas ADD COLUMN tipo TEXT CHECK(tipo IN ('plantao', 'expediente', 'fds'));
