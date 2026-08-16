-- Desafios de 2FA da REPOSIÇÃO da chave de assinatura.
--
-- Dois e-mails (institucional e pessoal), os dois, só quando já há chave
-- ativa. O primeiro cadastro não passa por aqui. Não se acrescenta tipo em
-- `dois_fatores_tokens` — o CHECK da 0028 exigiria rebuild da tabela.
--
-- TOKEN: o cliente recebe `desafio_id` opaco; o banco guarda o HASH do
-- código (mesmo `sha256(codigo)` do 2FA de assinatura). Expurga com os
-- demais segredos de curta duração.

CREATE TABLE `passkey_reposicao` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`desafio_id` text NOT NULL,
	`usuario_tipo` text NOT NULL,
	`usuario_id` integer NOT NULL,
	`canal` text NOT NULL,
	`codigo_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`usado` integer DEFAULT 0 NOT NULL,
	`tentativas` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now', '-3 hours')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `passkey_reposicao_desafio_id_unique` ON `passkey_reposicao` (`desafio_id`);
--> statement-breakpoint
CREATE INDEX `idx_passkey_reposicao_usuario` ON `passkey_reposicao` (`usuario_tipo`, `usuario_id`);
--> statement-breakpoint
CREATE INDEX `idx_passkey_reposicao_expires` ON `passkey_reposicao` (`expires_at`);
