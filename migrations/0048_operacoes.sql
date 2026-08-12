-- Operações extraordinárias como CADASTRO, não como código.
--
-- Até aqui o módulo assumia UMA operação: `gise_modelo_formulario` tinha uma
-- linha por `tipo` (operacional/seint) e o formulário de produtividade era
-- global. Isso deixou de valer — GISE, OPERAÇÃO CRAJUBAR e EDGE podem coexistir,
-- cada uma com seus indicadores, e a EDGE pode ter só um tipo de equipe.
--
-- Operação NÃO SE EXCLUI, desativa-se (`ativo = 0`), pela mesma razão de
-- `unidades.ativo`: escala histórica e PDF já assinado continuam apontando para
-- ela, e apagar a linha deixaria um documento entregue sem a operação que o
-- originou.
CREATE TABLE IF NOT EXISTS `operacoes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nome` text NOT NULL UNIQUE,
	`sigla` text NOT NULL DEFAULT '',
	`descricao` text NOT NULL DEFAULT '',
	-- Quais tipos de equipe a operação usa. A EDGE pode ser só operacional ou só
	-- SEINT; o par (0,0) não é impedido pelo banco mas é recusado na aplicação —
	-- operação sem tipo de equipe não escala ninguém.
	`usa_equipe_operacional` integer NOT NULL DEFAULT 1,
	`usa_equipe_seint` integer NOT NULL DEFAULT 1,
	-- Ciclo operacional (o plano da CRAJUBAR fala em 90 dias). Ambos opcionais:
	-- a GISE é permanente e não tem data de fim.
	`data_inicio` text,
	`data_fim` text,
	`ativo` integer NOT NULL DEFAULT 1,
	`created_at` text NOT NULL DEFAULT (datetime('now', '-3 hours'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_operacoes_ativo` ON `operacoes` (`ativo`);
--> statement-breakpoint

-- A operação que já existia, sem nome. Tudo o que está no banco hoje é dela, e
-- é para ela que os dois backfills abaixo apontam. `INSERT OR IGNORE` porque
-- `nome` é UNIQUE e a migração precisa ser idempotente em re-execução manual.
INSERT OR IGNORE INTO `operacoes` (`nome`, `sigla`, `descricao`)
VALUES ('GISE', 'GISE', 'Grupo de Investigação e Seguimento Especial');
--> statement-breakpoint

-- ---- Vínculo das escalas ----
--
-- Nullable com backfill, e não NOT NULL: mesmo precedente de
-- `gise_membros.gise_id` (migração 0044). A coluna é preenchida no INSERT pela
-- aplicação e uma escala não muda de operação — não há janela em que possa
-- divergir. NULL só existiria numa linha anterior a esta migração, e o backfill
-- logo abaixo não deixa nenhuma.
ALTER TABLE `gise_escalas` ADD COLUMN `operacao_id` integer;
--> statement-breakpoint
UPDATE `gise_escalas`
SET `operacao_id` = (SELECT `id` FROM `operacoes` WHERE `nome` = 'GISE')
WHERE `operacao_id` IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_gise_escalas_operacao` ON `gise_escalas` (`operacao_id`);
--> statement-breakpoint

-- ---- Vínculo do modelo de formulário ----
--
-- O formulário passa a ser por (operação, tipo de equipe). Sem esta coluna,
-- editar o formulário da CRAJUBAR reescreveria o do GISE.
ALTER TABLE `gise_modelo_formulario` ADD COLUMN `operacao_id` integer;
--> statement-breakpoint
UPDATE `gise_modelo_formulario`
SET `operacao_id` = (SELECT `id` FROM `operacoes` WHERE `nome` = 'GISE')
WHERE `operacao_id` IS NULL;
--> statement-breakpoint

-- Nunca houve UNIQUE em `tipo` — `buscarGiseModeloFormulario` fazia `.get()` e
-- pegava a PRIMEIRA linha. Duas linhas do mesmo tipo, portanto, são possíveis no
-- banco atual, e impediriam o índice único abaixo de ser criado. Mantém a de
-- menor `id`, que é a que a aplicação vinha lendo — descartar a outra não muda
-- comportamento nenhum, só apaga uma linha que já estava invisível.
DELETE FROM `gise_modelo_formulario`
WHERE `id` NOT IN (
	SELECT MIN(`id`) FROM `gise_modelo_formulario` GROUP BY `operacao_id`, `tipo`
);
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_gise_modelo_tipo`;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_gise_modelo_operacao_tipo`
	ON `gise_modelo_formulario` (`operacao_id`, `tipo`);
