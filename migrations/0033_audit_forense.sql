-- Auditoria forense: evolui `audit_log` de um log simples para uma trilha de
-- eventos estruturada e à prova de adulteração, inspirada em modelos comerciais
-- (CloudTrail / Datadog Audit Trail / Stripe / Auth0 Logs).
--
-- TODAS as colunas são nullable / sem default obrigatório → 100% retrocompatível
-- com as ~25 chamadas existentes de `registrarAuditComContexto` e com as linhas
-- já gravadas (que ficam com os campos novos em NULL).
--
-- Eixos novos:
--  - Classificação: categoria, severidade, resultado (sucesso/falha/negado).
--  - Ator x Alvo: actor_tipo + alvo_tipo/alvo_id/alvo_nome (quem fez x sobre quem).
--  - Conteúdo estruturado: metadados (JSON), dados_antes/dados_depois (diff).
--  - Correlação: request_id, rota, metodo (liga o evento aos logs/Sentry).
--  - Privacidade forense: ip_cifrado (IP completo AES-GCM; `ip` segue anonimizado).
--  - Tamper-evidence: seq (sequência única) + hash_anterior/hash_registro
--    (cadeia de hash encadeada; ver verificarIntegridadeAudit em db/audit.ts).

ALTER TABLE `audit_log` ADD COLUMN `actor_tipo` text;--> statement-breakpoint
ALTER TABLE `audit_log` ADD COLUMN `categoria` text;--> statement-breakpoint
ALTER TABLE `audit_log` ADD COLUMN `severidade` text;--> statement-breakpoint
ALTER TABLE `audit_log` ADD COLUMN `resultado` text;--> statement-breakpoint
ALTER TABLE `audit_log` ADD COLUMN `alvo_tipo` text;--> statement-breakpoint
ALTER TABLE `audit_log` ADD COLUMN `alvo_id` integer;--> statement-breakpoint
ALTER TABLE `audit_log` ADD COLUMN `alvo_nome` text;--> statement-breakpoint
ALTER TABLE `audit_log` ADD COLUMN `metadados` text;--> statement-breakpoint
ALTER TABLE `audit_log` ADD COLUMN `dados_antes` text;--> statement-breakpoint
ALTER TABLE `audit_log` ADD COLUMN `dados_depois` text;--> statement-breakpoint
ALTER TABLE `audit_log` ADD COLUMN `request_id` text;--> statement-breakpoint
ALTER TABLE `audit_log` ADD COLUMN `rota` text;--> statement-breakpoint
ALTER TABLE `audit_log` ADD COLUMN `metodo` text;--> statement-breakpoint
ALTER TABLE `audit_log` ADD COLUMN `ip_cifrado` text;--> statement-breakpoint
ALTER TABLE `audit_log` ADD COLUMN `seq` integer;--> statement-breakpoint
ALTER TABLE `audit_log` ADD COLUMN `hash_anterior` text;--> statement-breakpoint
ALTER TABLE `audit_log` ADD COLUMN `hash_registro` text;--> statement-breakpoint
-- `seq` é UNIQUE para travar forks da cadeia: dois appends concorrentes não
-- conseguem reservar o mesmo número (o perdedor recebe erro e refaz a leitura
-- do topo). Múltiplos NULLs são permitidos em índice UNIQUE no SQLite, então as
-- linhas legadas (seq NULL) coexistem sem violar a restrição.
CREATE UNIQUE INDEX IF NOT EXISTS `idx_audit_seq` ON `audit_log` (`seq`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_audit_categoria` ON `audit_log` (`categoria`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_audit_severidade` ON `audit_log` (`severidade`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_audit_resultado` ON `audit_log` (`resultado`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_audit_alvo` ON `audit_log` (`alvo_tipo`,`alvo_id`);
