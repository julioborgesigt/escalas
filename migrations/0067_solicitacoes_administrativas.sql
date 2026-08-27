-- Solicitações de alteração cadastral passam a ser do ADMINISTRADOR com escopo
-- (seccional/unidade), não mais do próprio servidor.
--
-- Duas mudanças, e a segunda existe porque a primeira não comporta o pedido:
--
-- 1. `cadastro_solicitacoes` ganha QUEM PEDIU e POR QUÊ. O solicitante deixou de
--    ser sempre o titular (`policial_id`), então a coluna nova é o que distingue
--    "o servidor pediu" de "o admin da unidade dele pediu"; a justificativa (até
--    300 caracteres) é exigida em todo pedido novo. Linhas anteriores à migração
--    ficam com `solicitante_id` NULL — nelas o solicitante É o `policial_id`, e a
--    tela lê essa ausência assim.
--
-- 2. Movimentação, afastamento e desvinculação NÃO cabem em `campo/valor_novo`:
--    têm datas, NUP, subtipo e um PDF anexo. Ganham tabela própria, espelhando as
--    colunas de `policial_historico` — é para lá que a aprovação as copia, e
--    manter a mesma forma é o que permite ao aprovador executar exatamente o que
--    foi pedido, sem remontar o evento a partir de um JSON solto.
--
-- Lotação sai do fluxo de `cadastro_solicitacoes`: transferir servidor virou
-- pedido de MOVIMENTAÇÃO (com portaria anexa). O valor continua no enum do
-- schema para as linhas antigas continuarem legíveis.

ALTER TABLE `cadastro_solicitacoes` ADD COLUMN `solicitante_id` integer;--> statement-breakpoint
ALTER TABLE `cadastro_solicitacoes` ADD COLUMN `solicitante_nome` text;--> statement-breakpoint
ALTER TABLE `cadastro_solicitacoes` ADD COLUMN `justificativa` text;--> statement-breakpoint

CREATE TABLE `policial_acao_solicitacoes` (
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
	`justificativa` text NOT NULL,
	`solicitante_id` integer,
	`solicitante_nome` text,
	`status` text NOT NULL DEFAULT 'pendente',
	`decidido_por` integer,
	`decidido_em` text,
	`created_at` text NOT NULL DEFAULT (datetime('now', '-3 hours')),
	FOREIGN KEY (`policial_id`) REFERENCES `policiais`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `idx_acaosol_status` ON `policial_acao_solicitacoes` (`status`);--> statement-breakpoint
CREATE INDEX `idx_acaosol_policial` ON `policial_acao_solicitacoes` (`policial_id`, `status`);
