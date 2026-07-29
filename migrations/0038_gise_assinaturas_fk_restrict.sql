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
--
-- `gise_id` continua CASCADE de propósito: excluir a GISE DEVE levar seus
-- documentos, e isso é avisado com números na confirmação da tela.
--
-- ATENÇÃO AO REBUILD. SQLite não tem ALTER TABLE ... DROP CONSTRAINT, então a
-- troca exige recriar a tabela. A lista de colunas abaixo tem de refletir o
-- estado ATUAL — não o de `0000_initial_schema.sql`. Esta tabela recebeu
-- colunas depois:
--   * 0012_signature_verification_metadata: cert_issuer, cert_serial,
--     cert_valido_de, cert_valido_ate, cms_sha256, ocsp_response_b64,
--     ocsp_consultado_em, tst_token_b64  (metadados CAdES-LT — OCSP e carimbo
--     de tempo, ou seja, exatamente a prova que esta migração quer preservar);
--   * 0025_user_agent_raw: user_agent_raw.
-- São 29 colunas no total. Copiar a definição de 0000 dropa silenciosamente as
-- 9 acrescentadas depois, e o sintoma aparece longe daqui: INSERT de assinatura
-- falhando com "no such column".

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
	`latitude` real,
	`longitude` real,
	`r2_key` text,
	`tipo_carimbo_tempo` text DEFAULT 'servidor',
	`created_at` text DEFAULT (datetime('now', '-3 hours')),
	`cert_issuer` text,
	`cert_serial` text,
	`cert_valido_de` text,
	`cert_valido_ate` text,
	`cms_sha256` text,
	`ocsp_response_b64` text,
	`ocsp_consultado_em` text,
	`tst_token_b64` text,
	`user_agent_raw` text,
	FOREIGN KEY (`gise_id`) REFERENCES `gise_escalas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`seccional_id`) REFERENCES `unidades`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint

INSERT INTO `gise_assinaturas_relatorios_nova` (
	`id`, `gise_id`, `seccional_id`, `tipo`, `assinante_id`, `assinante_nome`,
	`assinante_cpf`, `assinante_email`, `tipo_assinatura`, `rubrica`, `selfie_key`,
	`arquivo_hash`, `verification_hash`, `ip_address`, `user_agent`,
	`latitude`, `longitude`, `r2_key`, `tipo_carimbo_tempo`, `created_at`,
	`cert_issuer`, `cert_serial`, `cert_valido_de`, `cert_valido_ate`, `cms_sha256`,
	`ocsp_response_b64`, `ocsp_consultado_em`, `tst_token_b64`, `user_agent_raw`
)
SELECT
	`id`, `gise_id`, `seccional_id`, `tipo`, `assinante_id`, `assinante_nome`,
	`assinante_cpf`, `assinante_email`, `tipo_assinatura`, `rubrica`, `selfie_key`,
	`arquivo_hash`, `verification_hash`, `ip_address`, `user_agent`,
	`latitude`, `longitude`, `r2_key`, `tipo_carimbo_tempo`, `created_at`,
	`cert_issuer`, `cert_serial`, `cert_valido_de`, `cert_valido_ate`, `cms_sha256`,
	`ocsp_response_b64`, `ocsp_consultado_em`, `tst_token_b64`, `user_agent_raw`
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
