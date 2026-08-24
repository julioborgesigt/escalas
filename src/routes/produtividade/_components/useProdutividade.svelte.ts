/**
 * Cadeia reativa do painel de PRODUTIVIDADE.
 *
 * Ordem documentada (custo): filteredData → parsedData → stats / rankings / gráficos.
 * `parsedData` faz `JSON.parse` UMA vez por resposta; sem esse degrau, cada
 * estatística e cada ranking reparsearia os mesmos blobs.
 *
 * Chart.js entra por `import()` dinâmico (~200 KB).
 */
import { tick, untrack } from 'svelte';
import { goto, invalidateAll } from '$app/navigation';
import type { PageData } from '../$types';
import { toaster } from '$lib/toast';
import { apiFetch } from '$lib/api-fetch';
import type { GiseRespostaListagemItem } from '$lib/db/gise';
import { useMultiSelect, useCharts } from '$lib/composables';
import {
	mapQuestions,
	temBlocoPrisoes,
	calculateStats,
	calculateRanking,
	valorDaResposta,
	detalhePorTipo,
	ordenarCardsDoPainel,
	moverNaLista,
	idCardColunas,
	idCardRanking,
	idCardDetalhe,
	idCardIndicador,
	type Question
} from '$lib/produtividade';
import { montarPainelIndicadores } from '$lib/produtividade/metas';
import {
	chaveDoGrupo,
	gruposDaVisualizacao,
	ordenarERecortar,
	descreverRecorte,
	type ModoVisualizacao,
	type Ordem,
	type Quantidade
} from '$lib/produtividade/agrupamento';
import { extrairIndicadoresDeModelos } from '$lib/gise/indicadores';
import { tiposEquipeHabilitados } from '$lib/gise/tipos-equipe';
import {
	VIRTUAL_CHARTS,
	exportChartAsPng,
	exportRankingAsPng,
	exportDetailAsPng,
	downloadCanvas,
	type RankingItem
} from '$lib/export-charts';

type ChartJs = (typeof import('chart.js/auto'))['default'];

export type ProdutividadeListaItem = GiseRespostaListagemItem;
export type ProdutividadeParsedRow = ProdutividadeListaItem & {
	respostasParsed: Record<string, unknown>;
};

/**
 * As três faixas do painel, na ordem em que a tela as empilha.
 *
 * A seção é a FORMA do card, não uma escolha: um gráfico de colunas é uma faixa
 * inteira com `<canvas>` e não cabe na grade de dois dos rankings; um ranking não
 * cabe na faixa das colunas. Por isso arrastar move o card DENTRO da seção dele —
 * é o que a ordenação sabe fazer sem inventar um layout que os componentes não
 * têm.
 */
export type SecaoPainel = 'indicadores' | 'listagem' | 'colunas';

/**
 * Um card de listagem — ranking por unidade ou detalhamento por categoria.
 *
 * União discriminada por `forma`, e não um objeto com campos opcionais: é ela que
 * faz o compilador cobrar do template e da exportação o ramo certo, em vez de
 * deixá-los ler um `ranking` que não existe num card de detalhamento.
 *
 * O bloco de PRISÕES entra nesta mesma lista, apesar de continuar escrito no
 * código (ver `temBlocoPrisoes`): ele era desenhado numa `<section>` própria
 * ACIMA dos demais, o que o pregava no topo — e um card pregado no topo é
 * exatamente o que a ordem do painel existe para desfazer. O que ele guarda de
 * diferente é o ÍCONE, e é só isso que `icone` carrega.
 *
 * `titulo` é o título COMPLETO do card ("Ranking de Drogas"), não o assunto. Os
 * prefixos eram montados em dois lugares — no componente e na exportação — e o
 * bloco de prisões, que traz o título pronto de `VIRTUAL_CHARTS`, não passava por
 * nenhum dos dois.
 *
 * `unidade` é a de EXIBIÇÃO, já resolvida por forma: peso de droga é somado em
 * gramas, o ranking o mostra em quilos e o detalhamento em gramas. A conversão
 * mora aqui porque o card e o PNG precisavam dela, e a mesma linha
 * (`unidade === 'g' ? 'kg' : unidade`) vivia copiada nos dois.
 */
export type CardListagem = { id: string; titulo: string; cor: string; unidade: string } & (
	| { forma: 'ranking'; icone: 'prisoes' | 'grafico'; ranking: RankingItem[] }
	| { forma: 'detalhe'; linhas: [string, number][]; total: number }
);

export function useProdutividade(getData: () => PageData) {
	const data = $derived(getData());

	/**
	 * `$state`, e não um `let` cru: a seção de indicadores monta os próprios
	 * gráficos e só pode fazê-lo depois que o construtor chega. Sem reatividade
	 * aqui, ela ficaria em branco até algum outro filtro forçar um redesenho.
	 */
	let Chart = $state<ChartJs | null>(null);
	let exporting = $state(false);

	async function loadChart() {
		if (!Chart) {
			Chart = (await import('chart.js/auto')).default;
		}
	}

	// Filters
	let filterTipo = $state('operacional');

	/**
	 * A janela que o SERVIDOR aplicou, traduzida para o par
	 * (seletor de ano, datas livres). Ano cheio vira o item do ano; qualquer
	 * outra janela é `personalizado`, com as datas nos pickers.
	 */
	const janelaInicial = (() => {
		const { inicio, fim } = getData().janela;
		const ano = inicio.slice(0, 4);
		const anoCheio = inicio === `${ano}-01-01` && fim === `${ano}-12-31`;
		return anoCheio ? { ano, inicio: '', fim: '' } : { ano: 'personalizado', inicio, fim };
	})();

	let filterInicio = $state(janelaInicial.inicio);
	let filterFim = $state(janelaInicial.fim);

	/**
	 * O EIXO da comparação. Padrão `seccionais`, que é o comportamento histórico
	 * do painel — quem abre a tela vê o que via antes.
	 *
	 * Substituiu o antigo filtro de seccional, e a diferença é de natureza: aquele
	 * RECORTAVA os dados a uma seccional; este só troca por qual chave a mesma
	 * lista é somada. O total do painel não muda ao alternar, só a quebra.
	 */
	let modoVisualizacao = $state<ModoVisualizacao>('seccionais');
	/** Quantas unidades entram no ranking. `'todas'` mantém o comportamento de antes. */
	let quantidade = $state<Quantidade>('todas');
	/** Semântica, não numérica: "melhores" segue o valor de desempenho de cada seção. */
	let ordem = $state<Ordem>('melhores');

	// Year filter — 'personalizado' mostra os date pickers.
	// Leitura pontual (não fica em estado reativo) — SvelteDate não agrega nada aqui.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- getFullYear() one-shot
	const currentYear = new Date().getFullYear();
	const anos = Array.from({ length: 4 }, (_, i) => currentYear - i);

	/**
	 * O filtro nasce da JANELA QUE O SERVIDOR APLICOU (`janelaInicial`), não de
	 * `currentYear`.
	 *
	 * Antes o servidor mandava o histórico inteiro e a tela recortava; o seletor
	 * podia dizer o que quisesse porque o dado estava todo aqui. Agora o recorte
	 * é do SERVIDOR (B-1), e um seletor que discorde dele mostra números de um
	 * período com o rótulo de outro.
	 */
	let filterAno = $state(janelaInicial.ano);

	let mostrarFiltros = $state(true);
	const filtrosAtivos = $derived(
		modoVisualizacao !== 'seccionais' ||
			quantidade !== 'todas' ||
			ordem !== 'melhores' ||
			filterInicio !== '' ||
			filterFim !== '' ||
			filterAno !== String(currentYear)
	);

	const defaultStart = `${currentYear}-01-01`;
	const defaultEnd = `${currentYear}-12-31`;

	const effectiveStart = $derived(
		filterAno === 'personalizado' ? filterInicio || defaultStart : `${filterAno}-01-01`
	);
	const effectiveEnd = $derived(
		filterAno === 'personalizado' ? filterFim || defaultEnd : `${filterAno}-12-31`
	);
	/**
	 * Leva a janela escolhida para a URL, que é o que faz o SERVIDOR recarregar.
	 *
	 * Trocar de ano deixou de ser recorte instantâneo no cliente e virou ida ao
	 * servidor — é o preço de o payload parar de crescer com o histórico (B-1).
	 * Um round-trip por troca de ano contra carregar 4+ anos em toda abertura da
	 * tela.
	 *
	 * Não há laço: navegar recarrega `data.janela` com os MESMOS valores que
	 * dispararam a navegação, então a comparação abaixo passa a ser falsa. E
	 * `keepFocus`/`noScroll` porque isto é troca de filtro, não navegação de
	 * verdade — sem eles o foco salta do seletor e a página volta ao topo.
	 */
	$effect(() => {
		const inicio = effectiveStart;
		const fim = effectiveEnd;
		const atual = untrack(() => data.janela);
		if (inicio === atual.inicio && fim === atual.fim) return;

		// URL descartável para montar o destino — não é estado reativo, mesmo caso
		// do `getFullYear()` acima. `SvelteURL` só faria sentido se alguém
		// observasse esta instância, e ela morre na linha seguinte.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- destino de goto, uso único
		const destino = new URL(window.location.href);
		destino.searchParams.set('inicio', inicio);
		destino.searchParams.set('fim', fim);
		// `operacaoId` e demais parâmetros seguem intactos: partimos da URL atual.
		void goto(destino, { keepFocus: true, noScroll: true, replaceState: true });
	});

	const selection = useMultiSelect<number | string>();

	/**
	 * Os tipos de equipe que a operação em foco usa — o outro botão do seletor sai
	 * desabilitado. Mesma regra do editor de formulário (`useEditorModelo`), e por isso
	 * extraída para `$lib/gise/tipos-equipe` em vez de reescrita aqui.
	 */
	const operacaoSelecionada = $derived(
		(data.operacoes ?? []).find((o) => o.id === data.operacaoSelecionadaId) ?? null
	);
	const tiposDisponiveis = $derived(tiposEquipeHabilitados(operacaoSelecionada));

	// Trocar de operação pode deixar o tipo corrente indisponível (estava em
	// "Operacional" e a nova operação é só SEINT). Cai no primeiro disponível em
	// vez de manter um filtro que a operação não tem — o que mostraria um painel
	// vazio sem explicação.
	$effect(() => {
		const disponiveis = tiposDisponiveis;
		if (!disponiveis.includes(untrack(() => filterTipo) as 'operacional' | 'seint')) {
			filterTipo = disponiveis[0];
		}
	});

	function selectAllCharts() {
		selection.selectAll(idsExportaveis);
	}

	// ---- ORDEM DO PAINEL ----
	//
	// A ordem é um dado PRÓPRIO da operação (`painel_ordem`, migração 0064), e não
	// a do formulário: mover um card no editor de perguntas renumeraria o
	// enunciado e reordenaria o que o policial preenche — reordenar a leitura
	// mexeria na coleta.

	/** A ordem gravada para o tipo em foco. Vazia = ordem do formulário. */
	const ordemSalva = $derived(
		filterTipo === 'seint' ? (data.painelOrdem?.seint ?? []) : (data.painelOrdem?.operacional ?? [])
	);

	/**
	 * O rascunho do arraste, POR TIPO DE EQUIPE.
	 *
	 * Por tipo, e não uma lista só, porque o seletor "Operacional / Inteligência"
	 * é de tela: trocar de aba no meio da organização não pode descartar o que já
	 * foi arrastado na outra. `null` = nada arrastado ali, vale o que veio do
	 * servidor.
	 *
	 * Trocar de OPERAÇÃO é outra história — aquilo navega e recarrega os modelos,
	 * e um rascunho sobrevivente seria aplicado a cards de outra operação. Por isso
	 * o seletor de operação sai desabilitado enquanto se organiza (ver
	 * `organizando`), que evita a perda em vez de avisar depois dela.
	 */
	let rascunhoOrdem = $state<Record<'operacional' | 'seint', string[] | null>>({
		operacional: null,
		seint: null
	});

	/** A ordem que a tela ESTÁ mostrando: o rascunho, se houver; senão a salva. */
	const ordemVigente = $derived(
		rascunhoOrdem[filterTipo === 'seint' ? 'seint' : 'operacional'] ?? ordemSalva
	);

	/** Modo de organização ligado (só o Admin Geral chega a ligá-lo). */
	let organizando = $state(false);
	let salvandoOrdem = $state(false);

	/** Há arraste não gravado no tipo em foco? Move o rótulo do botão de salvar. */
	const ordemAlterada = $derived(
		rascunhoOrdem[filterTipo === 'seint' ? 'seint' : 'operacional'] !== null
	);

	/**
	 * Todas as perguntas marcadas do modelo em foco, com as formas de cada uma.
	 *
	 * Uma pergunta pode gerar até três cards, e os três saem daqui: a marca no
	 * editor é a fonte única de quem aparece no painel.
	 */
	const QUESTIONS = $derived(
		mapQuestions(filterTipo === 'seint' ? data.modeloSeint : data.modeloOperacional)
	);

	/**
	 * As que viram gráfico de barras — as únicas que precisam de `<canvas>` —, já
	 * na ordem do painel.
	 *
	 * A ordenação é aqui e não dentro de `mapQuestions` de propósito: é lá que cada
	 * pergunta recebe a COR pela posição no formulário, e ordenar antes faria a
	 * mesma pergunta trocar de cor a cada arraste.
	 */
	const questoesColunas = $derived(
		ordenarCardsDoPainel(
			QUESTIONS.filter((q) => q.formas.colunas),
			ordemVigente,
			(q) => idCardColunas(q.id)
		)
	);

	/**
	 * O bloco de prisões, único que sobrou escrito no código.
	 *
	 * Sempre do modelo OPERACIONAL: a seção só aparece nesse tipo de equipe, e é
	 * lá que moram as perguntas de flagrante e de mandado.
	 */
	const temPrisoes = $derived(
		filterTipo === 'operacional' && temBlocoPrisoes(data.modeloOperacional)
	);

	const toggleChartSelection = selection.toggle;

	// Derived Data
	const filteredData = $derived(
		(data.lista || []).filter((item: ProdutividadeListaItem) => {
			const date = item.data_inicio;
			const tipo = (item.equipe_tipo || 'operacional').toLowerCase();
			if (tipo !== filterTipo) return false;
			if (date < effectiveStart) return false;
			if (date > effectiveEnd) return false;
			return true;
		})
	);

	// Parse respostas UMA VEZ — evita JSON.parse duplicado em stats, rankings e charts
	const parsedData = $derived(
		filteredData.map((item: ProdutividadeListaItem): ProdutividadeParsedRow => ({
			...item,
			respostasParsed: JSON.parse(item.respostas || '{}') as Record<string, unknown>
		}))
	);

	/**
	 * As mesmas respostas do período, SEM o recorte por tipo de equipe — a base
	 * dos indicadores de meta.
	 *
	 * A meta é da UNIDADE e do indicador: o acervo de inquéritos da Delegacia do
	 * Crato não é "o acervo da equipe operacional" mais "o acervo da equipe de
	 * inteligência". Aplicar `filterTipo` aqui contaria metade do resultado da
	 * unidade contra a meta inteira dela.
	 */
	const filteredSemTipo = $derived(
		(data.lista || []).filter((item: ProdutividadeListaItem) => {
			const date = item.data_inicio;
			if (date < effectiveStart) return false;
			if (date > effectiveEnd) return false;
			return true;
		})
	);

	const parsedDataSemTipo = $derived(
		filteredSemTipo.map((item: ProdutividadeListaItem) => ({
			unidade_id: item.unidade_id ?? null,
			respostasParsed: JSON.parse(item.respostas || '{}') as Record<string, unknown>
		}))
	);

	/**
	 * O eixo do painel: quem vira barra e linha de ranking, já recortado.
	 *
	 * Uma fonte só para as três seções (rankings, gráficos por pergunta e
	 * exportação): o UNIVERSO de unidades, ainda sem recorte.
	 *
	 * O Top-N é aplicado depois, por seção, porque cada uma ordena pela SUA
	 * métrica: o ranking de prisões pelo total de presos, o gráfico de drogas pelo
	 * peso, os indicadores pelo % de atingimento. Recortar aqui daria a todos o
	 * ranking do primeiro — cinco cards afirmando um ranking que só vale para um.
	 */
	const grupos = $derived(
		gruposDaVisualizacao(modoVisualizacao, {
			seccionais: data.seccionais ?? [],
			unidadesDaOperacao: data.unidadesDaOperacao ?? [],
			linhas: data.lista ?? []
		})
	);
	const chaveGrupo = $derived(chaveDoGrupo(modoVisualizacao));

	// Stats via utilitário
	const stats = $derived(calculateStats(parsedData, QUESTIONS));

	/**
	 * Indicadores da operação, dos DOIS formulários dela (operacional e SEINT).
	 *
	 * Unificados por `key` porque a linha de base é da UNIDADE, não da equipe: o
	 * mesmo indicador nos dois formulários é um indicador só.
	 */
	const indicadores = $derived(
		extrairIndicadoresDeModelos([data.modeloOperacional, data.modeloSeint])
	);

	/**
	 * O cruzamento base × realizado × meta.
	 *
	 * Consome `parsedData` — a MESMA lista já recortada pelos filtros da tela —,
	 * e não a lista crua: um filtro reaplicado aqui dentro divergiria do que o
	 * resto do painel mostra, sem ninguém perceber.
	 *
	 * Duas diferenças deliberadas em relação aos demais gráficos:
	 *
	 * - o recorte por TIPO DE EQUIPE não se aplica. A meta é da unidade e do
	 *   indicador; separar por operacional/SEINT contaria metade do resultado dela;
	 * - o seletor "Visualizar por" também não. A linha de base é informada POR
	 *   DELEGACIA (`operacao_linha_base.unidade_id`), e agregá-la por seccional
	 *   exigiria somar bases — o que funciona para o acervo de inquéritos e produz
	 *   um número sem sentido no indicador de tempo MÉDIO. Ordem e Top-N valem;
	 *   o eixo, não.
	 */
	const paineisIndicadores = $derived(
		ordenarCardsDoPainel(
			montarPainelIndicadores(
				indicadores,
				data.unidadesDaOperacao ?? [],
				parsedDataSemTipo,
				data.linhaBase ?? []
			).map((painel) => ({
				...painel,
				// Ordena e corta por ATINGIMENTO, não pelo realizado: num indicador de
				// redução a unidade com o menor número é a melhor, e ordenar pelo número
				// cru poria a pior no topo de "melhores primeiro".
				//
				// Só as LINHAS são recortadas. Os contadores do card (`unidadesAtingiram`
				// / `unidadesComMeta`) continuam sobre o conjunto inteiro: "2 de 12 na
				// meta" é verdade mesmo mostrando cinco.
				linhas: ordenarERecortar(painel.linhas, {
					ordem,
					quantidade,
					valor: (l) => l.atingimento
				})
			})),
			// A ordenação de fora é a dos CARDS entre si; a de dentro, a das unidades
			// dentro de um card. Homônimas e independentes.
			ordemVigente,
			(p) => idCardIndicador(p.indicador.key)
		)
	);

	/** Ordena e corta pelo total — nos volumes, "melhor" é o maior número. */
	function porTotal<T extends { total: number }>(itens: T[]): T[] {
		return ordenarERecortar(itens, { ordem, quantidade, valor: (i) => i.total });
	}

	/**
	 * Os dois cards do bloco fixo de PRISÕES, quando a operação o tem.
	 *
	 * Continua escrito no código porque o detalhamento dele soma TRÊS perguntas
	 * (flagrantes, mandados e total de presos) e uma marca vive numa pergunta só —
	 * ver `temBlocoPrisoes`. O que mudou é o lugar: ele era desenhado numa
	 * `<section>` própria acima dos demais, o que o pregava no topo. Entrando na
	 * MESMA lista, ele passa a ser arrastável como qualquer outro, e a diferença
	 * fica onde ela de fato existe — no ícone e nos rótulos.
	 *
	 * O total de presos (P7) é somado por chave fixa e não pelo laço das perguntas
	 * marcadas: fosse pelo laço, desmarcar a P7 zeraria o card — um número errado,
	 * que é pior que um card ausente.
	 */
	const cardsPrisoes = $derived<CardListagem[]>(
		!temPrisoes
			? []
			: [
					{
						forma: 'ranking',
						icone: 'prisoes',
						id: 'rank-prisoes',
						titulo: VIRTUAL_CHARTS['rank-prisoes'].label,
						cor: VIRTUAL_CHARTS['rank-prisoes'].color,
						unidade: '',
						ranking: porTotal(
							calculateRanking(
								grupos,
								parsedData,
								(res) => Number(res.prisoes_apreensoes_flagrante) || 0,
								chaveGrupo
							)
						)
					},
					{
						forma: 'detalhe',
						id: 'detail-prisoes',
						titulo: VIRTUAL_CHARTS['detail-prisoes'].label,
						cor: VIRTUAL_CHARTS['detail-prisoes'].color,
						unidade: '',
						linhas: [
							['Flagrantes (P4)', stats.prisaoFlagrante],
							['Mandados (P5)', stats.prisaoMandado],
							['Total de Presos (P7)', stats.prisoesTotal]
						],
						total: Math.max(stats.prisoesTotal, stats.prisaoFlagrante, stats.prisaoMandado)
					}
				]
	);

	/**
	 * Os cards de ranking e detalhamento — o bloco de prisões e os das perguntas
	 * marcadas —, na ORDEM DO PAINEL.
	 *
	 * Uma lista só, e não duas, porque a ordem é o que preserva o pareamento: com
	 * "todos os rankings, depois todos os detalhamentos", o ranking de drogas cairia
	 * ao lado do de armas e o detalhamento de drogas iria para a linha de baixo. O
	 * painel sempre mostrou ranking e detalhamento do MESMO assunto lado a lado, e
	 * é assim que se lê — "quem apreendeu mais" ao lado de "o que foi apreendido".
	 * Sem ordem salva é o que continua saindo daqui; com ela, o par só se separa se
	 * alguém arrastar um dos dois.
	 *
	 * O extrator do ranking é `valorDaResposta`, o mesmo que desenha as barras e o
	 * mesmo que soma o total. Antes havia um extrator escrito à mão por bloco aqui,
	 * e o de armas já divergia dos outros dois: somava `armas_detalhe` sem o gate
	 * booleano.
	 *
	 * No detalhamento NÃO entram ordem nem Top-N: eles recortam UNIDADES, e este
	 * card não fala de unidades. O corte dele é o das oito categorias maiores, e
	 * mora em `detalhePorTipo`.
	 */
	const cardsListagem = $derived<CardListagem[]>(
		ordenarCardsDoPainel(
			[
				...cardsPrisoes,
				...QUESTIONS.filter((q) => q.formas.ranking || q.formas.detalhe).flatMap((q) => {
					const cards: CardListagem[] = [];
					if (q.formas.ranking) {
						cards.push({
							forma: 'ranking',
							icone: 'grafico',
							id: idCardRanking(q.id),
							titulo: `Ranking de ${q.titulo}`,
							cor: q.color,
							// Peso de droga é somado em GRAMAS e lido em QUILOS: o ranking
							// lista totais de unidades (números grandes), o detalhamento lista
							// tipos de droga dentro da barra.
							unidade: q.unidade === 'g' ? 'kg' : q.unidade,
							ranking: porTotal(
								calculateRanking(grupos, parsedData, (res) => valorDaResposta(res, q), chaveGrupo)
							)
						});
					}
					if (q.formas.detalhe) {
						cards.push({
							forma: 'detalhe',
							id: idCardDetalhe(q.id),
							titulo: `Detalhamento de ${q.titulo}`,
							cor: q.color,
							unidade: q.unidade,
							...detalhePorTipo(parsedData, q)
						});
					}
					return cards;
				})
			],
			ordemVigente,
			(c) => c.id
		)
	);

	/**
	 * Tudo o que está na tela e pode virar PNG, na ordem em que a tela mostra.
	 *
	 * Declarado DEPOIS dos cards de propósito: ele depende deles, e um `$derived`
	 * que referencia uma constante ainda não inicializada é erro de TDZ, não
	 * preguiça de avaliação.
	 *
	 * A ordem é a das SEÇÕES na página — listagem e depois colunas —, e é o que
	 * decide a sequência dos PNGs de "Selecionar todos". Ela estava trocada
	 * (colunas primeiro, prisões no fim) desde antes de haver ordem a escolher.
	 */
	const idsExportaveis = $derived<Array<number | string>>([
		...cardsListagem.map((c) => c.id),
		...questoesColunas.map((q) => q.id)
	]);

	/**
	 * Os ids de TODOS os cards na tela, na ordem em que ela os mostra — o que o
	 * botão "Salvar ordem" grava.
	 *
	 * Inclui os indicadores, que não são exportáveis e por isso não estão em
	 * `idsExportaveis`. As três seções entram concatenadas na ordem da página; a
	 * leitura depois só consulta a posição de cada id, então o que separa as seções
	 * na lista salva é irrelevante.
	 */
	const idsNaOrdemDaTela = $derived<string[]>([
		...paineisIndicadores.map((p) => idCardIndicador(p.indicador.key)),
		...cardsListagem.map((c) => c.id),
		...questoesColunas.map((q) => idCardColunas(q.id))
	]);

	/**
	 * A seleção, recortada ao que está na tela.
	 *
	 * Trocar de operação ou de tipo de equipe NÃO limpa a seleção — a página não
	 * remonta —, e um card marcado que sumiu continuaria contando no botão e
	 * geraria um PNG vazio na exportação. Filtrar aqui resolve os três usos de uma
	 * vez (o `includes` da UI, a contagem e o laço de exportação) sem um `$effect`
	 * que apagasse escolha do usuário pelas costas.
	 */
	const selectedCharts = $derived(selection.selected.filter((id) => idsExportaveis.includes(id)));

	const allChartsCount = $derived(idsExportaveis.length);

	// Charts via composable
	const charts = useCharts(() => Chart);
	const canvasElements = charts.canvasElements;

	// Destroy all stale chart instances when question set changes
	$effect(() => {
		// Set efêmero passado a destroyStaleCharts (API tipada em Set) — não vive em $state.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- argumento pontual
		const currentIds = new Set(questoesColunas.map((q) => q.id));
		charts.destroyStaleCharts(currentIds);
	});

	// Uma operação pode ter indicadores e NENHUMA pergunta "gráficável" no modelo
	// — nesse caso o efeito dos gráficos por pergunta nunca dispara, e a seção de
	// indicadores ficaria esperando um Chart.js que ninguém pediu.
	$effect(() => {
		if (paineisIndicadores.length > 0 && !Chart) void loadChart();
	});

	async function updateChartsFn(list: ProdutividadeParsedRow[]) {
		await loadChart();
		// Pass parsed data (respostas already parsed)
		charts.updateCharts(questoesColunas as Question[], list, grupos, chaveGrupo, porTotal);
	}

	// Único effect: redesenha quando dados, perguntas, filtro ou canvases mudam.
	// O `tick()` garante que <canvas> estejam montados antes de Chart.js anexar.
	$effect(() => {
		const list = parsedData;
		// Deps explícitas: o eixo e o recorte mudam sem que `parsedData` mude.
		const _grupos = grupos;
		const _recorte = [ordem, quantidade];
		const allCanvasesReady =
			questoesColunas.length > 0 && questoesColunas.every((q) => !!canvasElements[q.id]);
		if (list && allCanvasesReady) {
			void _grupos;
			void _recorte;
			tick().then(() => updateChartsFn(list));
		}
	});

	async function exportChartsAsImages() {
		if (selectedCharts.length === 0 || exporting) return;
		exporting = true;
		try {
			// O PNG circula sozinho: sem dizer que é um Top 5, o gráfico afirma ser a
			// operação inteira.
			const seccionalName = descreverRecorte(modoVisualizacao, quantidade, ordem);
			const start = effectiveStart;
			const end = effectiveEnd;
			const periodText = `${start.split('-').reverse().join('/')} a ${end.split('-').reverse().join('/')}`;
			const payload = { seccionalName, periodText };

			for (const id of selectedCharts) {
				// Gráfico de barras: o id é o da PERGUNTA (número), e a imagem é o
				// próprio canvas do Chart.js.
				if (typeof id === 'number') {
					const q = questoesColunas.find((qi) => qi.id === id);
					const sourceCanvas = canvasElements[id];
					if (!q || !sourceCanvas) continue;
					const { canvas, filename } = exportChartAsPng(
						{ label: q.titulo, color: q.color, sourceCanvas, type: 'chart' },
						payload
					);
					await downloadCanvas(canvas, filename);
					continue;
				}

				// Ranking e detalhamento: os dados já estão montados nos cards, e o PNG
				// é desenhado do zero (não há canvas de origem). O bloco de prisões
				// entra por aqui como qualquer outro — era o `else` de baixo, com o
				// título e a unidade montados por conta própria, e foi assim que ele
				// ficou de fora da correção de unidade que os demais receberam.
				const card = cardsListagem.find((c) => c.id === id);
				if (!card) continue;
				if (card.forma === 'ranking') {
					const { canvas, filename } = exportRankingAsPng(
						card.titulo,
						card.cor,
						card.ranking,
						card.unidade,
						payload
					);
					await downloadCanvas(canvas, filename);
				} else {
					const { canvas, filename } = exportDetailAsPng(
						card.titulo,
						card.cor,
						card.linhas.map(([label, value]) => ({ label, value })),
						card.total,
						card.unidade,
						payload
					);
					await downloadCanvas(canvas, filename);
				}
			}
			toaster.create({
				title: `${selectedCharts.length} imagem${selectedCharts.length > 1 ? 'ns exportadas' : ' exportada'}`,
				type: 'success'
			});
		} catch {
			toaster.create({ title: 'Erro ao exportar imagens', type: 'error' });
		} finally {
			exporting = false;
		}
	}

	// ---- ORGANIZAR: arrastar, salvar, desfazer ----

	/**
	 * Move um card DENTRO da seção dele e regrava a ordem inteira no rascunho.
	 *
	 * A ordem salva é uma lista só para as três seções, então mover em uma exige
	 * reescrever a concatenação — o que `idsNaOrdemDaTela` já é, sobre a lista
	 * corrente. A seção movida entra com o splice aplicado; as outras duas entram
	 * como estão.
	 *
	 * Um id que não está na lista da seção não pode ser movido para dentro de
	 * outra: `moverNaLista` opera sobre a lista da própria seção, e o índice vem do
	 * `{#each}` dela. É o que garante que o arraste nunca produza um card de
	 * colunas na grade dos rankings — layout que os componentes não têm.
	 */
	function moverCard(secao: SecaoPainel, de: number, para: number) {
		const secoes: Record<SecaoPainel, string[]> = {
			indicadores: paineisIndicadores.map((p) => idCardIndicador(p.indicador.key)),
			listagem: cardsListagem.map((c) => c.id),
			colunas: questoesColunas.map((q) => idCardColunas(q.id))
		};
		secoes[secao] = moverNaLista(secoes[secao], de, para);
		rascunhoOrdem = {
			...rascunhoOrdem,
			[filterTipo === 'seint' ? 'seint' : 'operacional']: [
				...secoes.indicadores,
				...secoes.listagem,
				...secoes.colunas
			]
		};
	}

	/** Descarta o arraste do tipo em foco e volta ao que está gravado. */
	function descartarOrdem() {
		rascunhoOrdem = {
			...rascunhoOrdem,
			[filterTipo === 'seint' ? 'seint' : 'operacional']: null
		};
	}

	/**
	 * Volta o painel à ordem do FORMULÁRIO — a lista VAZIA.
	 *
	 * Vazia, e não "a ordem do formulário escrita por extenso". As duas dariam o
	 * mesmo painel hoje e divergiriam amanhã: a lista explícita CONGELA a ordem
	 * atual das perguntas, e reordená-las no editor deixaria de chegar ao painel.
	 * "Ordem do formulário" quer dizer *seguir* o formulário, não copiá-lo uma vez.
	 * É `salvarOrdem` quem preserva essa intenção até a gravação.
	 *
	 * Vira rascunho, não gravação: o admin vê o resultado antes de confirmar, do
	 * mesmo jeito que vê cada arraste. Um botão que gravasse direto seria o único
	 * da barra sem volta.
	 */
	function restaurarOrdemPadrao() {
		rascunhoOrdem = {
			...rascunhoOrdem,
			[filterTipo === 'seint' ? 'seint' : 'operacional']: []
		};
	}

	/**
	 * Grava a ordem do tipo em foco.
	 *
	 * Manda `idsNaOrdemDaTela` — o que a tela mostra AGORA —, e não o rascunho: os
	 * dois coincidem depois de um arraste, mas o rascunho pode carregar id de card
	 * que sumiu (a pergunta foi desmarcada em outra aba) e não carrega os que
	 * apareceram depois. Gravar o que está na tela é o que mantém a lista limpa
	 * sem uma poda à parte.
	 *
	 * A exceção é o rascunho VAZIO, que é "Ordem do formulário" e precisa ser
	 * gravado como vazio: mandar a tela ali gravaria a ordem atual das perguntas
	 * como escolha explícita, e o painel deixaria de acompanhar o editor daí em
	 * diante — o oposto do que o botão diz.
	 *
	 * `invalidateAll` no fim porque o `load` é a fonte da ordem salva: sem
	 * recarregar, `ordemSalva` continuaria a anterior e descartar o rascunho
	 * desfaria o que acabou de ser gravado. O rascunho só é solto DEPOIS que os
	 * dados novos chegam, senão a tela pisca na ordem antiga no meio do caminho.
	 */
	async function salvarOrdem() {
		const operacaoId = data.operacaoSelecionadaId;
		if (!operacaoId || salvandoOrdem) return;
		const rascunho = rascunhoOrdem[filterTipo === 'seint' ? 'seint' : 'operacional'];
		salvandoOrdem = true;
		try {
			await apiFetch('/api/produtividade/ordem', {
				method: 'PUT',
				body: JSON.stringify({
					operacaoId,
					tipo: filterTipo === 'seint' ? 'seint' : 'operacional',
					ordem: rascunho?.length === 0 ? [] : idsNaOrdemDaTela
				})
			});
			await invalidateAll();
			descartarOrdem();
			organizando = false;
			toaster.success({ title: 'Ordem do painel salva' });
		} catch (err) {
			toaster.error({ title: err instanceof Error ? err.message : 'Erro ao salvar a ordem' });
		} finally {
			salvandoOrdem = false;
		}
	}

	/** Sai do modo de organização descartando o que não foi gravado. */
	function cancelarOrganizacao() {
		rascunhoOrdem = { operacional: null, seint: null };
		organizando = false;
	}

	return {
		get data() {
			return data;
		},
		get exporting() {
			return exporting;
		},
		get filterTipo() {
			return filterTipo;
		},
		set filterTipo(v: string) {
			filterTipo = v;
		},
		get modoVisualizacao() {
			return modoVisualizacao;
		},
		set modoVisualizacao(v: ModoVisualizacao) {
			modoVisualizacao = v;
		},
		get quantidade() {
			return quantidade;
		},
		set quantidade(v: Quantidade) {
			quantidade = v;
		},
		get ordem() {
			return ordem;
		},
		set ordem(v: Ordem) {
			ordem = v;
		},
		/** Tipos de equipe que a operação usa — o outro sai desabilitado no seletor. */
		get tiposDisponiveis() {
			return tiposDisponiveis;
		},
		get filterInicio() {
			return filterInicio;
		},
		set filterInicio(v: string) {
			filterInicio = v;
		},
		get filterFim() {
			return filterFim;
		},
		set filterFim(v: string) {
			filterFim = v;
		},
		anos,
		get filterAno() {
			return filterAno;
		},
		set filterAno(v: string) {
			filterAno = v;
		},
		get mostrarFiltros() {
			return mostrarFiltros;
		},
		set mostrarFiltros(v: boolean) {
			mostrarFiltros = v;
		},
		get filtrosAtivos() {
			return filtrosAtivos;
		},
		/** As perguntas que viram gráfico de BARRAS — as únicas com `<canvas>`. */
		get QUESTIONS() {
			return questoesColunas;
		},
		/** Rankings e detalhamentos (prisões incluído), na ordem do painel. */
		get cardsListagem() {
			return cardsListagem;
		},
		/**
		 * Não há o que mostrar: nem indicador, nem bloco fixo, nem pergunta marcada
		 * como gráfico. A tela diz isso em vez de ficar só com a barra de filtros —
		 * painel em branco parece defeito, e o conserto (marcar no formulário) não
		 * está nesta página.
		 */
		get painelVazio() {
			return paineisIndicadores.length === 0 && idsExportaveis.length === 0;
		},
		/** Base × realizado × meta por unidade, para a seção "Indicadores e metas". */
		get paineisIndicadores() {
			return paineisIndicadores;
		},
		/** Chart.js já carregado (ou `null`): a seção de indicadores monta os próprios gráficos. */
		get ChartCtor() {
			return Chart;
		},
		get allChartsCount() {
			return allChartsCount;
		},
		get selectedCharts() {
			return selectedCharts;
		},
		toggleChartSelection,
		selectAllCharts,
		get parsedData() {
			return parsedData;
		},
		get stats() {
			return stats;
		},
		canvasElements,
		exportChartsAsImages,

		// ---- Organizar o painel (Admin Geral) ----

		/** O botão "Organizar" aparece? A recusa de verdade é do servidor, no PUT. */
		get podeOrganizar() {
			return data.podeOrganizar === true;
		},
		/** Modo de arraste ligado: os cards ganham alça, setas e ficam inertes. */
		get organizando() {
			return organizando;
		},
		set organizando(v: boolean) {
			organizando = v;
		},
		/** Há arraste não gravado no tipo em foco? */
		get ordemAlterada() {
			return ordemAlterada;
		},
		get salvandoOrdem() {
			return salvandoOrdem;
		},
		/**
		 * O painel já foi organizado alguma vez neste tipo?
		 *
		 * É o que decide se "Restaurar padrão" tem o que desfazer — sem ordem
		 * gravada, o painel JÁ está na ordem do formulário.
		 */
		get temOrdemPropria() {
			return ordemVigente.length > 0;
		},
		moverCard,
		salvarOrdem,
		descartarOrdem,
		restaurarOrdemPadrao,
		cancelarOrganizacao
	};
}
