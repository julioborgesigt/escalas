-- Carimba `grafico: true` no que JÁ é gráfico hoje.
--
-- A partir daqui, quem decide se uma pergunta vira gráfico no painel de
-- produtividade é a marca `grafico` dela, e não o tipo do campo. A regra antiga
-- ("tipo contável → vira gráfico") não era escolha de ninguém: fazia a
-- quilometragem inicial e a final da viatura ocuparem dois cards ao lado das
-- prisões, e o único jeito de tirá-las era apagar o campo do formulário — o que
-- apagaria também a coleta.
--
-- ## Por que carimbar em vez de começar do zero
--
-- Sem esta migração, o painel da GISE e o da CRAJUBAR ficariam SEM gráfico
-- nenhum no deploy, até alguém reabrir cada formulário e remarcar pergunta por
-- pergunta. Carimbando, a virada é invisível: a tela continua idêntica, e o que
-- passa a existir é a possibilidade de DESMARCAR.
--
-- ## Só o nível 0
--
-- `mapQuestions` nunca desceu nos `filhos`, então sub-pergunta nunca virou
-- gráfico. Ela passa a poder, marcada no editor — mas carimbá-la aqui
-- ACRESCENTARIA gráficos que ninguém pediu, e esta migração existe justamente
-- para não mudar nada. `json_each` sobre a raiz do array já dá exatamente o
-- nível 0.
--
-- ## A lista de tipos, repetida
--
-- É `TIPOS_GRAFICAVEIS` (`src/lib/gise/tipos-pergunta.ts`) escrita à mão em SQL,
-- porque migração não importa TypeScript. A duplicação é aceitável por ser
-- CONGELADA: esta migração carimba o estado de ago/2026 e nunca mais roda.
-- Acrescentar um tipo à lista de lá não pede tocar aqui — pede uma migração
-- nova, se e quando alguém quiser carimbar o novo tipo retroativamente.
--
-- `json(CASE ... END)` e não `CASE ... END` direto: o CASE descarta o subtipo
-- JSON do SQLite, e sem ele `json_group_array` embutiria cada pergunta como
-- STRING escapada — o modelo inteiro viraria um array de textos, e o formulário
-- abriria vazio.
UPDATE `gise_modelo_formulario`
SET `config` = (
	SELECT json_group_array(
		json(
			CASE
				WHEN json_extract(`je`.`value`, '$.tipo') IN (
					'numero',
					'select_99',
					'select_999',
					'sim_nao',
					'celulares_complex',
					'analise_complex',
					'relatorios_seint_complex',
					'foragidos_complex',
					'operacoes_seint_complex',
					'operacoes_seint_pura'
				)
				THEN json_set(`je`.`value`, '$.grafico', json('true'))
				ELSE `je`.`value`
			END
		)
	)
	FROM json_each(`gise_modelo_formulario`.`config`) AS `je`
)
WHERE json_valid(`config`)
  AND json_type(`config`) = 'array'
  AND json_array_length(`config`) > 0;
