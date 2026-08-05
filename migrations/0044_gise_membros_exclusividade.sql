-- Exclusividade do policial por GISE, imposta pelo MODELO — FLW-GISE-009.
--
-- A regra ("um policial ocupa uma vaga por escala") era só uma consulta feita
-- antes do INSERT. Entre a consulta e a gravação cabe outra requisição: dois
-- admins de seccionais diferentes alocavam o mesmo policial ao mesmo tempo, e
-- os dois viam vaga livre. O resultado é uma pessoa escalada em dois lugares no
-- mesmo dia — que o termo de presença e o relatório de extra depois atestam.
--
-- `gise_id` é DENORMALIZADO aqui porque a unicidade precisa dele e o SQLite não
-- indexa através de join. Ele não é uma segunda fonte de verdade: é derivado no
-- próprio INSERT (`SELECT s.gise_id FROM gise_equipes ... JOIN gise_seccionais`),
-- e equipe não muda de GISE — não existe operação que a mova. Sendo derivado na
-- gravação, não há janela em que possa divergir da equipe.
ALTER TABLE `gise_membros` ADD COLUMN `gise_id` integer;
--> statement-breakpoint
-- Backfill: a GISE de cada membro sai da sua equipe → seccional.
UPDATE `gise_membros`
SET `gise_id` = (
	SELECT s.gise_id
	FROM gise_equipes e
	JOIN gise_seccionais s ON e.gise_seccional_id = s.id
	WHERE e.id = gise_membros.equipe_id
);
--> statement-breakpoint
-- Duplicatas pré-existentes impediriam o índice de ser criado. Mantém a mais
-- antiga (menor `id`), que é a alocação que de fato aconteceu primeiro; as
-- demais são o sintoma da corrida que este índice passa a impedir.
DELETE FROM `gise_membros`
WHERE `gise_id` IS NOT NULL
  AND `id` NOT IN (
	SELECT MIN(`id`) FROM `gise_membros`
	WHERE `gise_id` IS NOT NULL
	GROUP BY `gise_id`, `policial_id`
);
--> statement-breakpoint
-- O índice é o ponto: a exclusividade deixa de depender de quem lembrou de
-- consultar antes.
CREATE UNIQUE INDEX IF NOT EXISTS `uq_gise_membros_gise_policial`
	ON `gise_membros` (`gise_id`, `policial_id`);
