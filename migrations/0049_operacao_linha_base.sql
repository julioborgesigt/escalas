-- Linha de base dos indicadores: o valor inicial contra o qual a meta é medida.
--
-- O Plano Operacional da CRAJUBAR registra o próprio problema que esta tabela
-- resolve, em "Riscos e Medidas de Mitigação": *"Dificuldade de mensuração por
-- ausência de linha de base consolidada"*. A meta é "redução mínima de 20% do
-- acervo de inquéritos pendentes" — 20% DE QUÊ só a delegacia sabe, e o sistema
-- não tinha onde guardar essa resposta.
--
-- Um valor por (operação, unidade, indicador): é o parâmetro FIXO do ciclo, o
-- "volume verificado no mês anterior ao início da Força Tarefa" do plano. Não é
-- série temporal — o realizado vem das respostas de produtividade, que já são
-- datadas. Se um dia for preciso rebaselinar por mês, o caminho é acrescentar
-- `competencia` ao índice único, não uma segunda tabela.
CREATE TABLE IF NOT EXISTS `operacao_linha_base` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`operacao_id` integer NOT NULL REFERENCES `operacoes`(`id`) ON DELETE cascade,
	-- onDelete: restrict — a linha de base é o parâmetro de um resultado que vai
	-- ser divulgado. Mesma razão de `gise_assinaturas_relatorios` (migração
	-- 0038): a aplicação nem exclui unidade (só desativa), e isto fecha o DELETE
	-- manual que apagaria a base sob um percentual já publicado.
	`unidade_id` integer NOT NULL REFERENCES `unidades`(`id`) ON DELETE restrict,
	-- `pergunta.key` do modelo — gerada na criação e não editável em lugar nenhum
	-- da UI, que é o que torna a referência estável. Guardar a `key` da PERGUNTA
	-- (e não a chave da resposta) porque nos tipos de lista a resposta mora em
	-- `${key}__qtd`; a tradução é de `chavesLista()`, em $lib/gise/tipos-pergunta.
	`indicador_key` text NOT NULL,
	-- real, não integer: "tempo médio de conclusão do inquérito" é medido em dias
	-- e tem casa decimal.
	`valor` real NOT NULL,
	`observacao` text NOT NULL DEFAULT '',
	`informado_por_id` integer,
	-- Nome COPIADO para a linha, como nas demais tabelas de prova: o valor é
	-- parâmetro de um resultado divulgado, e precisa continuar dizendo quem o
	-- informou depois que o cadastro do policial mudar ou sair.
	`informado_por_nome` text NOT NULL DEFAULT '',
	-- 'aba' = preenchido em /dados-base pelo admin da unidade;
	-- 'formulario' = capturado no relatório de produtividade, quando a unidade
	-- chegou à hora de responder sem ter informado a base.
	`origem` text NOT NULL DEFAULT 'aba',
	`created_at` text NOT NULL DEFAULT (datetime('now', '-3 hours')),
	`updated_at` text NOT NULL DEFAULT (datetime('now', '-3 hours'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_operacao_linha_base`
	ON `operacao_linha_base` (`operacao_id`, `unidade_id`, `indicador_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_operacao_linha_base_operacao`
	ON `operacao_linha_base` (`operacao_id`);
