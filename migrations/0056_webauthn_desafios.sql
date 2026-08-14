-- Desafio da cerimônia de REGISTRO de passkey.
--
-- Tabela própria em vez de mais um `tipo` em `dois_fatores_tokens`: aquela
-- carrega `CHECK(tipo IN (...))` desde a migração 0010, então aceitar um tipo
-- novo obrigaria a recriar a tabela — rebuild no caminho de autenticação para
-- hospedar um nonce de cadastro. O custo não se paga.
--
-- O desafio da ASSINATURA não passa por aqui: é o hash do PDF preparado, e vive
-- em `assinatura_intencoes`, que já resolve alvo, ator, uso único e expiração.
--
-- Uso único e vida curta. A expurga por retenção (`lib/db/lgpd/retencao.ts`)
-- trata esta tabela como token temporário, não como registro probatório.

CREATE TABLE `webauthn_desafios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`desafio_id` text NOT NULL,
	`usuario_tipo` text NOT NULL,
	`usuario_id` integer NOT NULL,
	-- Bytes do desafio em base64url — o mesmo alfabeto que o navegador devolve
	-- no `clientDataJSON`, para a comparação ser literal.
	`desafio` text NOT NULL,
	`usado` integer DEFAULT 0 NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now', '-3 hours')) NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX `webauthn_desafios_desafio_id_unique` ON `webauthn_desafios` (`desafio_id`);
--> statement-breakpoint
CREATE INDEX `idx_webauthn_desafio` ON `webauthn_desafios` (`desafio_id`);
