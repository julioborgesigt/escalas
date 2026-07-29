-- Defesa em profundidade: `gise_assinaturas_relatorios.seccional_id` passa de
-- ON DELETE CASCADE para ON DELETE RESTRICT.
--
-- O problema, verificado empiricamente no D1 (que aplica FK de verdade):
-- apagar uma linha de `unidades` levava junto o REGISTRO DO ATO DE ASSINAR —
-- assinante, CPF, rubrica, selfie, IP, GPS, hash do arquivo e a chave do PDF no
-- R2. Consequência prática: o portal público `/validar` passava a responder
-- "documento não encontrado" para um papel que já estava em mãos de alguém,
-- indistinguível de documento falso, e o PDF virava órfão no R2 sem nenhum
-- ponteiro.
--
-- A partir da migração 0037 unidade não é mais excluída pela aplicação, só
-- desativada — então este CASCADE já é inalcançável pela interface. Esta
-- migração fecha o caminho que sobra: DELETE manual (`wrangler d1 execute` numa
-- madrugada de incidente), script de manutenção ou endpoint futuro. Com
-- RESTRICT, o BANCO recusa, e não importa por qual caminho a exclusão veio.
--
-- É o mesmo tratamento que `gise_seccionais.seccional_id` já tinha desde o
-- início ("bloqueia remoção de unidades que têm GISE histórico vinculado").
-- Duas tabelas irmãs resolviam a mesma preocupação de formas opostas, e a que
-- guardava a assinatura era justamente a permissiva.
--
-- `gise_id` continua CASCADE de propósito: excluir a GISE DEVE levar seus
-- documentos, e isso agora é avisado com números na confirmação da tela.
--
-- SQLite não tem ALTER TABLE ... DROP CONSTRAINT: a troca exige rebuild
-- completo (criar nova → copiar → dropar → renomear → recriar índices).

PRAGMA foreign_keys=OFF;
--> statement-breakpoint

CREATE TABLE `gise_assinaturas_relatorios_nova` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gise_id` integer NOT NULL,
	`seccional_id` integer NOT NULL,
	`tipo` text NOT NULL,
	`assinante_id` integer,
	`assinante_nome` text NOT NULL,
	`assinante_cpf` text,
	`assinante_email` text,
	`tipo_assinatura` text NOT NULL,
	`rubrica` text,
	`selfie_key` text,
	`arquivo_hash` text,
	`verification_hash` text,
	`ip_address` text,
	`user_agent` text,
	`user_agent_raw` text,
	`latitude` real,
	`longitude` real,
	`r2_key` text,
	`tipo_carimbo_tempo` text DEFAULT 'servidor',
	`created_at` text DEFAULT (datetime('now', '-3 hours')),
	FOREIGN KEY (`gise_id`) REFERENCES `gise_escalas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`seccional_id`) REFERENCES `unidades`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint

INSERT INTO `gise_assinaturas_relatorios_nova` (
	`id`, `gise_id`, `seccional_id`, `tipo`, `assinante_id`, `assinante_nome`,
	`assinante_cpf`, `assinante_email`, `tipo_assinatura`, `rubrica`, `selfie_key`,
	`arquivo_hash`, `verification_hash`, `ip_address`, `user_agent`, `user_agent_raw`,
	`latitude`, `longitude`, `r2_key`, `tipo_carimbo_tempo`, `created_at`
)
SELECT
	`id`, `gise_id`, `seccional_id`, `tipo`, `assinante_id`, `assinante_nome`,
	`assinante_cpf`, `assinante_email`, `tipo_assinatura`, `rubrica`, `selfie_key`,
	`arquivo_hash`, `verification_hash`, `ip_address`, `user_agent`, `user_agent_raw`,
	`latitude`, `longitude`, `r2_key`, `tipo_carimbo_tempo`, `created_at`
FROM `gise_assinaturas_relatorios`;
--> statement-breakpoint

DROP TABLE `gise_assinaturas_relatorios`;
--> statement-breakpoint

ALTER TABLE `gise_assinaturas_relatorios_nova` RENAME TO `gise_assinaturas_relatorios`;
--> statement-breakpoint

-- Índices recriados exatamente como em 0000_initial_schema.sql.
CREATE UNIQUE INDEX IF NOT EXISTS `gise_assinaturas_relatorios_verification_hash_unique` ON `gise_assinaturas_relatorios` (`verification_hash`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_gise_ass_rel_gise` ON `gise_assinaturas_relatorios` (`gise_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_gise_ass_rel` ON `gise_assinaturas_relatorios` (`gise_id`,`seccional_id`,`tipo`);
--> statement-breakpoint

PRAGMA foreign_keys=ON;
