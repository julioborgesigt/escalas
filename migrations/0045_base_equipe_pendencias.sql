-- Envio da Base_Equipe que não chegou ao destino (FLW-WEBHOOK-003).
--
-- A GISE é finalizada e SÓ ENTÃO o envio para a planilha é agendado
-- (`waitUntil`, fora da resposta ao cliente). Falhando, sobrava um
-- `logger.error`: nenhuma pendência, nenhuma correlação, nenhuma tentativa
-- persistida. A escala estava fechada no sistema e ausente da planilha que a
-- corporação usa para pagar o extraordinário, e ninguém era avisado.
--
-- Terceira tabela de pendência da auditoria, e a forma é deliberadamente a
-- mesma de `audit_pendencias` e `r2_pendencias`: alvo, motivo, tentativas,
-- última tentativa. O que muda em cada uma é a AÇÃO de reprocessamento, e é por
-- isso que são três tabelas e não uma com discriminador — uma tabela genérica
-- precisaria de payload em JSON e de um switch no drenador, o que é mais código
-- e não menos.
--
-- `gise_id` é único: a mesma escala falhando de novo é a mesma pendência. O
-- reenvio é idempotente do lado de cá (remonta as linhas do banco a cada
-- tentativa), e a `chave_idempotencia` viaja no payload para que o destino
-- possa deduplicar quando for corrigido.
CREATE TABLE IF NOT EXISTS `base_equipe_pendencias` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gise_id` integer NOT NULL UNIQUE REFERENCES `gise_escalas`(`id`) ON DELETE CASCADE,
	-- Estável por GISE: reenviar a mesma escala manda a mesma chave, e o destino
	-- consegue reconhecer a repetição em vez de duplicar linhas.
	`chave_idempotencia` text NOT NULL,
	`motivo` text NOT NULL,
	`tentativas` integer DEFAULT 0 NOT NULL,
	`ultima_tentativa_em` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_base_equipe_pendencias_created`
	ON `base_equipe_pendencias` (`created_at`);
