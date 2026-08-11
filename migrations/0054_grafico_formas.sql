-- A marca de gráfico deixa de ser sim/não e passa a dizer a FORMA do card.
--
-- Três formas, que acumulam na mesma pergunta: `colunas` (barras por unidade),
-- `ranking` (as mesmas unidades numa lista numerada) e `detalhe` (quebra por
-- categoria dentro da resposta — por tipo de droga, por tipo de arma).
--
-- Duas conversões, e as duas existem para a tela não mudar:
--
-- 1. **`grafico: true` vira `{"colunas": true}`.** É o que a 0053 carimbou, e
--    colunas é o que ela queria dizer: naquele momento era a única forma.
-- 2. **Droga e arma nascem com `{"ranking": true, "detalhe": true}`.** Elas nunca
--    tiveram marca — a 0053 as ignorou porque `drogas_complex` e `armas_complex`
--    não estavam na lista de tipos graficáveis. O painel as desenhava por fora,
--    em seis cards escritos no código, e é justamente esse par (ranking +
--    detalhamento) que os blocos fixos mostravam. Marcá-las é o que permite
--    aposentar os blocos sem tirar nada da tela — e é o que passa a dar ao
--    assessor o controle de desligar um deles.
--
-- O bloco de PRISÕES não é convertido e continua escrito no código: o
-- detalhamento dele soma três perguntas diferentes (flagrantes, mandados e total
-- de presos), e uma marca que vive numa pergunta não descreve um card que
-- atravessa três. Ver `temBlocoPrisoes`.
--
-- `json_each` anda na RAIZ do array, então esta conversão alcança o nível 0 e não
-- desce nos `filhos`. Uma sub-pergunta marcada entre a 0053 e agora fica com o
-- booleano antigo, e quem a traduz é `formasDaMarca`
-- (`$lib/produtividade/apresentacao`) na leitura — recursão em SQL sobre uma
-- árvore de profundidade livre custaria mais do que a compatibilidade de uma
-- linha em TypeScript, que ainda por cima vale para qualquer nível.
--
-- `json(CASE ... END)` pelo mesmo motivo da 0053: o CASE descarta o subtipo JSON
-- do SQLite, e sem ele `json_group_array` embutiria cada pergunta como string
-- escapada — o modelo viraria um array de textos e o formulário abriria vazio.
UPDATE `gise_modelo_formulario`
SET `config` = (
	SELECT json_group_array(
		json(
			CASE
				-- Droga e arma: as duas formas que os blocos fixos já desenhavam.
				WHEN json_extract(`je`.`value`, '$.tipo') IN ('drogas_complex', 'armas_complex')
					THEN json_set(`je`.`value`, '$.grafico', json('{"ranking":true,"detalhe":true}'))
				-- O booleano da 0053 queria dizer "colunas".
				WHEN json_extract(`je`.`value`, '$.grafico') = 1
					THEN json_set(`je`.`value`, '$.grafico', json('{"colunas":true}'))
				ELSE `je`.`value`
			END
		)
	)
	FROM json_each(`gise_modelo_formulario`.`config`) AS `je`
)
WHERE json_valid(`config`)
  AND json_type(`config`) = 'array'
  AND json_array_length(`config`) > 0;
