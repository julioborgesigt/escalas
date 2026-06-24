-- Termo de Confirmação de Presença (entrada/saída) assinado por Token A3 no
-- computador. Diferente da presença em tela (gravada só em `gise_presencas`),
-- o fluxo desktop produz um PDF qualificado (CAdES-LT/PAdES), registrado aqui
-- para que `/validar/[hash]` reconheça e reconfira a assinatura.
--
-- Tabela DEDICADA (não reaproveita `gise_assinaturas_relatorios`) para não
-- poluir a detecção de "relatório assinado" / "escala assinada" na UI.
CREATE TABLE IF NOT EXISTS `gise_presenca_termos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gise_id` integer NOT NULL,
	`policial_id` integer NOT NULL,
	`tipo` text NOT NULL,
	`assinante_nome` text NOT NULL,
	`assinante_cpf` text,
	`assinante_email` text,
	`verification_hash` text,
	`r2_key` text,
	`arquivo_hash` text,
	`ip_address` text,
	`user_agent` text,
	`user_agent_raw` text,
	`latitude` real,
	`longitude` real,
	`tipo_carimbo_tempo` text DEFAULT 'servidor',
	`cert_issuer` text,
	`cert_serial` text,
	`cert_valido_de` text,
	`cert_valido_ate` text,
	`cms_sha256` text,
	`ocsp_response_b64` text,
	`ocsp_consultado_em` text,
	`tst_token_b64` text,
	`created_at` text DEFAULT (datetime('now', '-3 hours')),
	FOREIGN KEY (`gise_id`) REFERENCES `gise_escalas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `gise_presenca_termos_verification_hash_unique` ON `gise_presenca_termos` (`verification_hash`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_gise_presenca_termos_gise` ON `gise_presenca_termos` (`gise_id`);
