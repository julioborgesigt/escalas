-- Logs técnicos da aplicação: persiste os `logger.warn` / `logger.error`
-- emitidos durante as requests, que antes só existiam em Cloudflare Logs /
-- Sentry (fora do app). Consultável no console /auditoria/logs (Super Admin),
-- correlacionável com a trilha forense `audit_log` via `request_id`.
--
-- Retenção: purgado pela limpeza LGPD (`lgpd.retencao.app_log_dias`, default 90).
CREATE TABLE IF NOT EXISTS `app_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`level` text NOT NULL,
	`message` text NOT NULL,
	`contexto` text,
	`request_id` text,
	`usuario_id` text,
	`rota` text,
	`created_at` text NOT NULL DEFAULT (datetime('now'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_applog_created` ON `app_log` (`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_applog_level` ON `app_log` (`level`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_applog_request` ON `app_log` (`request_id`);
