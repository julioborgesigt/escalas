-- Replace single horario with hora_entrada and hora_saida in escala_policiais
ALTER TABLE escala_policiais ADD COLUMN hora_entrada TEXT NOT NULL DEFAULT '';
ALTER TABLE escala_policiais ADD COLUMN hora_saida TEXT NOT NULL DEFAULT '';

-- Replace single horario with hora_entrada and hora_saida in escalas
ALTER TABLE escalas ADD COLUMN hora_entrada TEXT NOT NULL DEFAULT '08';
ALTER TABLE escalas ADD COLUMN hora_saida TEXT NOT NULL DEFAULT '08';
