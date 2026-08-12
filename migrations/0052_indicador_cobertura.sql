-- Converte o indicador de fins de semana da CRAJUBAR para COBERTURA.
--
-- O Plano Operacional Estratégico pede "100% de cobertura programada" nos
-- atendimentos de fim de semana. A migração 0050 semeou isso como meta ABSOLUTA
-- de no mínimo 1 atendimento por unidade — o proxy possível na época, porque não
-- existia tipo de pergunta capaz de guardar um denominador.
--
-- O proxy media a coisa errada: 12 atendimentos são ótimos se houve 12
-- ocorrências e ruins se houve 40, e a meta absoluta dava "atingida" nos dois
-- casos. O tipo `proporcao` (dois campos na mesma pergunta, total e parte)
-- passou a existir justamente para isso, e o indicador vira meta de cobertura de
-- 100%.
--
-- ## Por que não editar a 0050
--
-- Ela já rodou em produção. Migração aplicada é história, não rascunho — quem já
-- migrou não roda de novo. Onde a 0050 ainda não passou, ela semeia a forma
-- antiga e esta corrige logo em seguida; o resultado final é o mesmo nos dois
-- caminhos.
--
-- ## Resposta já gravada
--
-- Nenhuma: a chave muda de `crajubar_atendimentos_fds` para o par
-- `crajubar_atendimentos_fds__total` / `__parte`, e a operação CRAJUBAR ainda não
-- tem relatório entregue com esse campo. Se tivesse, o número antigo continuaria
-- no blob, sem denominador — e apareceria como "sem ocorrências" no painel, que
-- é a leitura honesta de um dado ao qual falta metade.
UPDATE `gise_modelo_formulario`
SET `config` = json_replace(
	`config`,
	'$[' || (
		SELECT `key`
		FROM json_each(`gise_modelo_formulario`.`config`)
		WHERE json_extract(`value`, '$.key') = 'crajubar_atendimentos_fds'
		LIMIT 1
	) || ']',
	json('{"id":9004,"texto":"Atendimentos do GISE em fins de semana","tipo":"proporcao","key":"crajubar_atendimentos_fds","obrigatoria":true,"etapa":"Indicadores CRAJUBAR","filhos":[],"subtexto_total":"Ocorrências de fim de semana no período","subtexto_parte":"Ocorrências atendidas pelo GISE","indicador":{"metaTipo":"proporcao","metaValor":100,"unidadeMedida":"ocorrências"}}')
)
WHERE json_valid(`config`)
  AND json_type(`config`) = 'array'
  AND EXISTS (
	SELECT 1
	FROM json_each(`gise_modelo_formulario`.`config`)
	WHERE json_extract(`value`, '$.key') = 'crajubar_atendimentos_fds'
	  AND json_extract(`value`, '$.tipo') = 'numero'
  );
