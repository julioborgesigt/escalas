-- Migration 0019: Flexibilidade de horários sábado/domingo e status retificada para GISE

-- Feature 1: Horários separados para sábado e domingo na escala GISE
ALTER TABLE gise_escalas ADD COLUMN hora_entrada_sabado TEXT NOT NULL DEFAULT '08';
ALTER TABLE gise_escalas ADD COLUMN hora_saida_sabado TEXT NOT NULL DEFAULT '16';
ALTER TABLE gise_escalas ADD COLUMN hora_entrada_domingo TEXT NOT NULL DEFAULT '08';
ALTER TABLE gise_escalas ADD COLUMN hora_saida_domingo TEXT NOT NULL DEFAULT '16';

-- Inicializar os novos campos com os valores atuais
UPDATE gise_escalas SET
  hora_entrada_sabado = hora_entrada,
  hora_saida_sabado = hora_saida,
  hora_entrada_domingo = hora_entrada,
  hora_saida_domingo = hora_saida;

-- Feature 4: Status 'retificada' para gise_seccionais
-- (SQLite não tem ADD CONSTRAINT em ALTER TABLE, mas a coluna aceita qualquer texto)
-- O enum é controlado pela aplicação; apenas documentamos os valores aceitos:
-- 'pendente' | 'preenchida' | 'retificada'

-- Feature 5: Campos de data editáveis (data_inicio e data_fim já existem, nenhuma alteração necessária)
