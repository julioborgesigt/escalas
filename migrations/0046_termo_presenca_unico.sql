-- Um termo de presença por policial, por tipo, por GISE — FLW-GISE-008.
--
-- `salvarTermoPresencaGise` é um INSERT puro. Repetir a finalização gravava
-- outro termo, com outro `verification_hash`, para o mesmo ato — e os dois
-- resolvem em `/validar`. Dois documentos assinados atestando a mesma entrada é
-- prova que se contradiz sozinha.
--
-- Duplicatas pré-existentes: mantém a MAIS ANTIGA, que é o termo que a pessoa
-- efetivamente recebeu; as demais são o sintoma da repetição que este índice
-- passa a impedir.
DELETE FROM `gise_presenca_termos`
WHERE `id` NOT IN (
	SELECT MIN(`id`) FROM `gise_presenca_termos`
	GROUP BY `gise_id`, `policial_id`, `tipo`
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_gise_presenca_termos_ato`
	ON `gise_presenca_termos` (`gise_id`, `policial_id`, `tipo`);
