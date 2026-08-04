-- Intenção de assinatura: amarra o PDF preparado ao RECURSO, ao ATOR e a UM
-- único uso (FLW-DOC-001).
--
-- Antes, `preparar-assinatura` devolvia o PDF ao cliente e `finalizar-assinatura`
-- aceitava de volta qualquer `preparedPdf`, gravando-o no recurso da URL. A
-- assinatura era criptograficamente válida e o CPF conferia com o do usuário —
-- só o DOCUMENTO podia ser outro. Preparar na escala A e finalizar na B
-- guardava o PDF de A como documento assinado de B, e a mesma preparação podia
-- ser finalizada quantas vezes quisessem.
--
-- `token` guarda o SHA-256 (`sha256:`) do valor entregue ao cliente, como
-- `sessoes` e `reset_senha_tokens`: um dump do D1 não permite finalizar nada.
CREATE TABLE IF NOT EXISTS `assinatura_intencoes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token` text NOT NULL,
	-- Que tipo de documento esta preparação virou: 'escala', 'gise',
	-- 'gise_presenca' ou 'gise_relatorio'.
	`recurso` text NOT NULL,
	`recurso_id` integer NOT NULL,
	-- Segundo eixo do alvo, quando existe (a seccional do relatório). NULL nos
	-- recursos de eixo único.
	`escopo_id` integer,
	`usuario_id` integer NOT NULL,
	`usuario_tipo` text NOT NULL,
	-- SHA-256 do `preparedPdf` que o servidor gerou. É o que impede devolver
	-- outro PDF no finalizar.
	`documento_hash` text NOT NULL,
	-- Código público de validação, decidido pelo SERVIDOR. Antes vinha do
	-- cliente no finalizar, então ele escolhia a chave R2 e o código do /validar.
	`verificacao_hash` text NOT NULL,
	`usado` integer DEFAULT 0 NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now', '-3 hours')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `assinatura_intencoes_token_unique` ON `assinatura_intencoes` (`token`);--> statement-breakpoint
-- A limpeza de retenção varre por `expires_at`.
CREATE INDEX IF NOT EXISTS `idx_assinatura_intencoes_expires` ON `assinatura_intencoes` (`expires_at`);
