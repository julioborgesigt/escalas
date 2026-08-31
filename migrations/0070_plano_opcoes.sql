-- Locais de briefing e cidades de destino viram LISTAS por plano.
--
-- Antes o plano tinha um `local_briefing_padrao` de texto e cada equipe
-- redigitava o seu destino. Numa operação com oito equipes saindo para três
-- cidades, isso é o mesmo nome escrito oito vezes — e basta uma diferir por um
-- acento para o Anexo I listar dois destinos onde só há um.
--
-- Agora o plano declara as opções UMA vez e a equipe escolhe num seletor. Uma
-- delas é a PADRÃO e vem pré-preenchida na equipe criada.
CREATE TABLE IF NOT EXISTS `plano_opcoes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`plano_id` integer NOT NULL,
	-- 'briefing' (onde a equipe se apresenta) ou 'destino' (para onde desloca).
	-- Uma tabela só para os dois: são a mesma forma — lista de texto com uma
	-- padrão — e separá-las duplicaria índice, action e componente de tela.
	`tipo` text NOT NULL,
	`valor` text NOT NULL,
	`padrao` integer NOT NULL DEFAULT 0,
	`ordem` integer NOT NULL DEFAULT 0,
	`created_at` text NOT NULL DEFAULT (datetime('now', '-3 hours')),
	FOREIGN KEY (`plano_id`) REFERENCES `planos_operacionais`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Uma PADRÃO por tipo, por plano. Índice PARCIAL, como o do chefe de equipe:
-- só as linhas com `padrao = 1` colidem, então trocar a padrão é uma gravação
-- que o banco arbitra — não uma consulta prévia que duas abas podem furar.
CREATE UNIQUE INDEX IF NOT EXISTS `uq_plano_opcoes_padrao` ON `plano_opcoes` (`plano_id`, `tipo`) WHERE `padrao` = 1;
--> statement-breakpoint
-- Sem valor repetido no mesmo tipo: duas entradas idênticas no seletor não
-- ajudam ninguém a escolher, e a segunda só existiria por engano de digitação.
CREATE UNIQUE INDEX IF NOT EXISTS `uq_plano_opcoes_valor` ON `plano_opcoes` (`plano_id`, `tipo`, `valor`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_plano_opcoes_plano` ON `plano_opcoes` (`plano_id`, `tipo`, `ordem`);
--> statement-breakpoint
-- O briefing padrão que cada plano já tinha vira a primeira opção, marcada como
-- padrão. Sem isso, um plano existente abriria com a lista vazia e a equipe
-- perderia o local que o documento dela já imprime.
INSERT INTO `plano_opcoes` (`plano_id`, `tipo`, `valor`, `padrao`, `ordem`)
SELECT `id`, 'briefing', TRIM(`local_briefing_padrao`), 1, 0
  FROM `planos_operacionais`
 WHERE TRIM(COALESCE(`local_briefing_padrao`, '')) <> '';
--> statement-breakpoint
-- E o destino que cada equipe já tem entra como opção do plano dela, para o
-- seletor abrir com o que a operação de fato usa. `DISTINCT` porque o mesmo
-- destino repetido em várias equipes é UMA opção.
INSERT OR IGNORE INTO `plano_opcoes` (`plano_id`, `tipo`, `valor`, `padrao`, `ordem`)
SELECT DISTINCT `plano_id`, 'destino', TRIM(`cidade_destino`), 0, 0
  FROM `plano_equipes`
 WHERE TRIM(COALESCE(`cidade_destino`, '')) <> '';
--> statement-breakpoint
-- A coluna antiga sai: manter as duas fontes do "briefing padrão do plano" é a
-- duplicação que o CLAUDE.md cataloga — uma seria corrigida e a outra não.
ALTER TABLE `planos_operacionais` DROP COLUMN `local_briefing_padrao`;
