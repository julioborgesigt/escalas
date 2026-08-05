-- Um policial ocupa um dia da escala uma vez só — FLW-ESC-005.
--
-- A regra já existia, mas só como consulta antes do INSERT
-- (`verificarConflitoGlobal` com `-1`, que "impede duplicatas"). Entre a
-- consulta e a gravação cabe outra requisição, e o `repetir` chega a montar um
-- `Set` de `policial|data` em memória para filtrar — proteção que vale apenas
-- dentro daquela chamada.
--
-- Duplicata aqui não é registro repetido inofensivo: a escala é o documento que
-- vai para assinatura, e a pessoa aparece duas vezes no mesmo dia. Quem confere
-- não tem como saber se é erro de digitação ou dois turnos.
--
-- Duplicatas pré-existentes: mantém a de menor `id`, que é a que foi lançada
-- primeiro.
DELETE FROM `escala_policiais`
WHERE `id` NOT IN (
	SELECT MIN(`id`) FROM `escala_policiais`
	GROUP BY `escala_id`, `policial_id`, `data_plantao`
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_escala_policiais_dia`
	ON `escala_policiais` (`escala_id`, `policial_id`, `data_plantao`);
