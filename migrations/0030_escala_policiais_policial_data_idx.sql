-- Índice composto para a checagem de conflito de plantão (escala-conflict.ts):
-- as queries filtram `WHERE policial_id = ? AND data_plantao = ?`. O índice
-- existente em (policial_id) obrigava o SQLite a varrer todas as linhas do
-- policial para filtrar a data — custo que cresce com o histórico. Com o
-- composto, o lookup é direto (auditoria de performance, B-4).
--
-- O índice antigo idx_escala_policiais_policial fica: o composto o cobre para
-- buscas só por policial_id, mas removê-lo exigiria validar todos os planos de
-- query existentes — fora do escopo desta mudança.
CREATE INDEX IF NOT EXISTS idx_escala_policiais_policial_data
	ON escala_policiais (policial_id, data_plantao);
