-- Solicitações de alteração cadastral feitas pelo próprio policial na página
-- "Meu perfil" (telefone, classe, regime, lotação). Toda alteração desses
-- campos exige aprovação do Admin Geral na aba "Solicitações"; e-mail pessoal
-- tem fluxo próprio (OTP) e NÃO passa por aqui.
--
-- Uma linha por campo alterado; nova solicitação pendente do mesmo campo
-- substitui a anterior (o app remove a pendente antes de inserir).

CREATE TABLE `cadastro_solicitacoes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`policial_id` integer NOT NULL,
	`campo` text NOT NULL,
	`valor_atual` text,
	`valor_novo` text NOT NULL,
	`status` text NOT NULL DEFAULT 'pendente',
	`decidido_por` integer,
	`decidido_em` text,
	`created_at` text NOT NULL DEFAULT (datetime('now', '-3 hours'))
);--> statement-breakpoint
CREATE INDEX `idx_cadsol_status` ON `cadastro_solicitacoes` (`status`);--> statement-breakpoint
CREATE INDEX `idx_cadsol_policial` ON `cadastro_solicitacoes` (`policial_id`, `status`);
