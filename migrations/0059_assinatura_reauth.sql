-- Janela de reautenticação por senha na cerimônia de assinatura avançada.
--
-- A sessão prova quem é; a senha reinserida prova vontade ATUAL (mesa
-- compartilhada / celular desbloqueado). O token opaco vive no cliente; o
-- banco guarda só o hash (`sha256:`), amarrado à sessão e ao usuário, com
-- validade de ~10 min — a mesma janela do código 2FA de assinatura, para
-- o lote não pedir senha a cada PDF.
--
-- Não se consome no POST de assinar: o lote reutiliza a janela. Expurga
-- junto com os demais segredos de curta duração (`lgpd/retencao.ts`).

CREATE TABLE `assinatura_reauth` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_hash` text NOT NULL,
	`usuario_tipo` text NOT NULL,
	`usuario_id` integer NOT NULL,
	`sessao_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now', '-3 hours')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assinatura_reauth_token_hash_unique` ON `assinatura_reauth` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `idx_assinatura_reauth_expires` ON `assinatura_reauth` (`expires_at`);
--> statement-breakpoint
CREATE INDEX `idx_assinatura_reauth_usuario` ON `assinatura_reauth` (`usuario_tipo`, `usuario_id`);
