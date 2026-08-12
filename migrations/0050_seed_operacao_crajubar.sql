-- OPERAÇÃO CRAJUBAR (Força Tarefa Juazeiro do Norte / Crato / Barbalha).
--
-- Semeada aqui, e não deixada para o Admin Geral criar na tela, porque ela é a
-- razão de existir desta leva de migrações e precisa estar pronta no go-live.
-- O formulário sai CLONADO do GISE — é o fluxo que a tela de operações também
-- oferece ("basear o formulário em") — e recebe, ao fim, os cinco indicadores
-- da tabela §9 do Plano Operacional Estratégico.
--
-- Os valores semeados são ponto de partida EDITÁVEL: objetivo, meta e rótulo
-- ficam no editor de formulário, por operação. Dois pontos onde a leitura do
-- plano virou decisão, e que o Admin Geral pode querer rever:
--
--  - "100% de cobertura programada" (atendimentos do GISE em fins de semana)
--    não é percentual sobre linha de base — não há acervo a reduzir. Virou meta
--    ABSOLUTA de no mínimo 1 atendimento por unidade na escala, que é o proxy
--    operacional da cobertura;
--  - "Mínimo de 1 por unidade/mês" (ORCRIM/tráfico com apoio do DRCO) já é
--    absoluto no próprio plano.
--
-- Meta absoluta não pede linha de base à delegacia: não há valor anterior contra
-- o que comparar. Só os três indicadores percentuais entram na aba /dados-base.
INSERT OR IGNORE INTO `operacoes` (`nome`, `sigla`, `descricao`)
VALUES (
	'OPERAÇÃO CRAJUBAR',
	'CRAJUBAR',
	'Força Tarefa da Região do Crajubar — Juazeiro do Norte, Crato e Barbalha (DPI Sul)'
);
--> statement-breakpoint

-- Um modelo por tipo de equipe. `INSERT OR IGNORE` se apoia no índice único
-- `uq_gise_modelo_operacao_tipo` da migração 0048 para ser idempotente.
INSERT OR IGNORE INTO `gise_modelo_formulario` (`operacao_id`, `tipo`, `config`)
SELECT o.`id`, t.`tipo`, '[]'
FROM `operacoes` o
CROSS JOIN (SELECT 'operacional' AS `tipo` UNION ALL SELECT 'seint') t
WHERE o.`nome` = 'OPERAÇÃO CRAJUBAR';
--> statement-breakpoint

-- Clona o conteúdo do GISE. `COALESCE(..., '[]')` cobre a instalação NOVA, em
-- que o GISE ainda não tem modelo gravado — nela a CRAJUBAR nasce só com os
-- cinco indicadores, porque não há de onde clonar as perguntas padrão (elas
-- vivem em `DEFAULT_QUESTIONS_FORM_OPERACIONAL`, no código, e SQL não as
-- alcança). Num banco em uso, que é o caso da produção, o GISE tem a linha e a
-- CRAJUBAR nasce completa. Em qualquer um dos dois o Admin Geral resolve pelo
-- editor, que é onde o clone entre operações também é oferecido.
UPDATE `gise_modelo_formulario`
SET `config` = COALESCE(
	(
		SELECT g.`config`
		FROM `gise_modelo_formulario` g
		JOIN `operacoes` og ON og.`id` = g.`operacao_id`
		WHERE og.`nome` = 'GISE' AND g.`tipo` = `gise_modelo_formulario`.`tipo`
	),
	'[]'
)
WHERE `operacao_id` = (SELECT `id` FROM `operacoes` WHERE `nome` = 'OPERAÇÃO CRAJUBAR');
--> statement-breakpoint

-- Os cinco indicadores, acrescentados ao fim do array (`$[#]` é a posição
-- seguinte à última). Cada UPDATE se guarda por `instr(...) = 0`, então
-- reaplicar a migração à mão não duplica pergunta.
--
-- `json_type(config) = 'array'` é a defesa contra um `config` corrompido: sem
-- ela, `json_insert` aborta a migração inteira por causa de uma linha inválida.
--
-- Os `id` começam em 9001 só para não colidirem com os do modelo clonado; o
-- editor renumera tudo na primeira gravação ($lib/gise/renumerar-perguntas).
UPDATE `gise_modelo_formulario`
SET `config` = json_insert(`config`, '$[#]', json('{"id":9001,"texto":"Acervo de inquéritos pendentes ao fim do período","tipo":"numero","key":"crajubar_acervo_pendentes","obrigatoria":true,"etapa":"Indicadores CRAJUBAR","filhos":[],"indicador":{"objetivo":"diminuir","metaTipo":"percentual","metaValor":20,"unidadeMedida":"procedimentos","rotuloBase":"Acervo de inquéritos pendentes hoje, antes da operação"}}'))
WHERE `operacao_id` = (SELECT `id` FROM `operacoes` WHERE `nome` = 'OPERAÇÃO CRAJUBAR')
  AND json_valid(`config`) AND json_type(`config`) = 'array'
  AND instr(`config`, '"crajubar_acervo_pendentes"') = 0;
--> statement-breakpoint

UPDATE `gise_modelo_formulario`
SET `config` = json_insert(`config`, '$[#]', json('{"id":9002,"texto":"Inquéritos de CVLI concluídos no período","tipo":"numero","key":"crajubar_cvli_concluidos","obrigatoria":true,"etapa":"Indicadores CRAJUBAR","filhos":[],"indicador":{"objetivo":"aumentar","metaTipo":"percentual","metaValor":15,"unidadeMedida":"procedimentos/mês","rotuloBase":"Inquéritos de CVLI concluídos por mês, antes da operação"}}'))
WHERE `operacao_id` = (SELECT `id` FROM `operacoes` WHERE `nome` = 'OPERAÇÃO CRAJUBAR')
  AND json_valid(`config`) AND json_type(`config`) = 'array'
  AND instr(`config`, '"crajubar_cvli_concluidos"') = 0;
--> statement-breakpoint

UPDATE `gise_modelo_formulario`
SET `config` = json_insert(`config`, '$[#]', json('{"id":9003,"texto":"Tempo médio de conclusão do inquérito, em dias","tipo":"numero","key":"crajubar_tempo_medio_conclusao","obrigatoria":true,"etapa":"Indicadores CRAJUBAR","filhos":[],"indicador":{"objetivo":"diminuir","metaTipo":"percentual","metaValor":15,"unidadeMedida":"dias","rotuloBase":"Tempo médio de conclusão do inquérito hoje, em dias"}}'))
WHERE `operacao_id` = (SELECT `id` FROM `operacoes` WHERE `nome` = 'OPERAÇÃO CRAJUBAR')
  AND json_valid(`config`) AND json_type(`config`) = 'array'
  AND instr(`config`, '"crajubar_tempo_medio_conclusao"') = 0;
--> statement-breakpoint

UPDATE `gise_modelo_formulario`
SET `config` = json_insert(`config`, '$[#]', json('{"id":9004,"texto":"Atendimentos do GISE em fins de semana","tipo":"numero","key":"crajubar_atendimentos_fds","obrigatoria":true,"etapa":"Indicadores CRAJUBAR","filhos":[],"indicador":{"objetivo":"aumentar","metaTipo":"absoluto","metaValor":1,"unidadeMedida":"ocorrências atendidas","rotuloBase":""}}'))
WHERE `operacao_id` = (SELECT `id` FROM `operacoes` WHERE `nome` = 'OPERAÇÃO CRAJUBAR')
  AND json_valid(`config`) AND json_type(`config`) = 'array'
  AND instr(`config`, '"crajubar_atendimentos_fds"') = 0;
--> statement-breakpoint

UPDATE `gise_modelo_formulario`
SET `config` = json_insert(`config`, '$[#]', json('{"id":9005,"texto":"Investigações qualificadas de ORCRIM/tráfico com apoio do DRCO","tipo":"numero","key":"crajubar_orcrim_drco","obrigatoria":true,"etapa":"Indicadores CRAJUBAR","filhos":[],"indicador":{"objetivo":"aumentar","metaTipo":"absoluto","metaValor":1,"unidadeMedida":"operações/relatórios","rotuloBase":""}}'))
WHERE `operacao_id` = (SELECT `id` FROM `operacoes` WHERE `nome` = 'OPERAÇÃO CRAJUBAR')
  AND json_valid(`config`) AND json_type(`config`) = 'array'
  AND instr(`config`, '"crajubar_orcrim_drco"') = 0;
