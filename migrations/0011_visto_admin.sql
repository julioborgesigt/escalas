-- Add visto_por_admin column to the escalas table
ALTER TABLE escalas ADD COLUMN visto_por_admin INTEGER NOT NULL DEFAULT 0;
