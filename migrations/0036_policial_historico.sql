-- Histórico funcional do policial: linha do tempo append-only por servidor.
-- Registra movimentações (transferência de lotação), afastamentos
-- (férias/licenças), desvinculações (baixa) e o diff das edições cadastrais.
-- Cada evento pode ter um documento PDF anexo no R2 (`documento_r2_key`).
--
-- Complementa — não substitui — a trilha forense `audit_log` (Super Admin,
-- tamper-evident): esta tabela é a visão operacional de RH, restrita ao
-- Admin Geral, exibida na página do próprio policial.

CREATE TABLE `policial_historico` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`policial_id` integer NOT NULL,
	`tipo` text NOT NULL,
	`subtipo` text,
	`descricao` text,
	`unidade_origem` text,
	`unidade_destino` text,
	`data_evento` text,
	`data_inicio` text,
	`data_fim` text,
	`qtd_dias` integer,
	`nup` text,
	`documento_r2_key` text,
	`documento_nome` text,
	`dados_antes` text,
	`dados_depois` text,
	`registrado_por_id` integer,
	`registrado_por_nome` text,
	`created_at` text NOT NULL DEFAULT (datetime('now', '-3 hours')),
	FOREIGN KEY (`policial_id`) REFERENCES `policiais`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `idx_pol_hist_policial` ON `policial_historico` (`policial_id`, `created_at`);--> statement-breakpoint
CREATE INDEX `idx_pol_hist_tipo` ON `policial_historico` (`tipo`);
