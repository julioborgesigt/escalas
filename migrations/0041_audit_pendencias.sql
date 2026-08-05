-- Pendência de auditoria: o evento que NÃO conseguiu entrar na cadeia
-- (FLW-AUDIT-001).
--
-- `auditar()` nunca lança, de propósito: falha de trilha não pode derrubar a
-- operação do usuário. O preço era o evento sumir — a mutação persistia, a
-- resposta era sucesso, e só restava uma linha de log fora do banco. Numa
-- trilha que se propõe a ser forense, isso é o mesmo que não ter acontecido.
--
-- A política escolhida é registrar pendência durável e seguir: a mutação vale,
-- o evento espera aqui, e `reprocessarPendenciasAudit` o reinsere na cadeia.
--
-- A tabela é DELIBERADAMENTE burra — sem `seq`, sem hash encadeado, sem índice
-- único, payload num TEXT só. É o que dá a ela chance de gravar quando o append
-- encadeado não conseguiu: a maioria das falhas é específica da cadeia (corrida
-- de `seq`, chave de hash ausente, coluna recusando um valor). Se o próprio D1
-- estiver fora, os dois caminhos falham — e aí só resta o log. É um limite
-- honesto, não um descuido.
CREATE TABLE IF NOT EXISTS `audit_pendencias` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	-- Evento serializado como veio para `auditar()`, pronto para retentativa.
	`evento` text NOT NULL,
	-- Ação e entidade fora do JSON: dão triagem sem precisar desserializar tudo.
	`acao` text NOT NULL,
	`entidade` text,
	-- Por que a cadeia recusou. É o que diz ao operador se é corrida (some
	-- sozinho) ou defeito (volta sempre).
	`motivo` text NOT NULL,
	`tentativas` integer DEFAULT 0 NOT NULL,
	`ultima_tentativa_em` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
-- O reprocessamento drena em ordem de chegada.
CREATE INDEX IF NOT EXISTS `idx_audit_pendencias_created` ON `audit_pendencias` (`created_at`);
