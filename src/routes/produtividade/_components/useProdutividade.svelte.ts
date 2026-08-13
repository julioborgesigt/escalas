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
import type { PageData } from '../$types';
import { toaster } from '$lib/toast';
import type { GiseRespostaListagemItem } from '$lib/db/gise';
import { useMultiSelect, useCharts } from '$lib/composables';
import {
	mapQuestions,
	temBlocoPrisoes,
	calculateStats,
	calculateRanking,
	valorDaResposta,
	detalhePorTipo,
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
 * Os dois cards do bloco de PRISÕES — o único que continua escrito no código.
 *
 * Drogas e armas eram blocos como este e viraram marcação da pergunta. Prisões
 * não cabe numa marca porque o detalhamento dele atravessa três perguntas; ver
 * `temBlocoPrisoes`.
 */
const IDS_PRISOES = ['rank-prisoes', 'detail-prisoes'] as const;

/**
 * O id de exportação de cada card gerado por uma pergunta.
 *
 * Prefixados e derivados do id da pergunta porque a seleção guarda uma lista
 * plana de ids: sem o prefixo, o ranking e o detalhamento da mesma pergunta
 * seriam o mesmo item, e marcar um marcaria o outro.
 */
function idRanking(perguntaId: number): string {
	return `rank-q${perguntaId}`;
}
function idDetalhe(perguntaId: number): string {
	return `det-q${perguntaId}`;
}

/**
 * Um card de listagem gerado por uma pergunta.
 *
 * União discriminada por `forma`, e não um objeto com campos opcionais: é ela que
 * faz o compilador cobrar do template e da exportação o ramo certo, em vez de
 * deixá-los ler um `ranking` que não existe num card de detalhamento.
 */
export type CardListagem =
	| {
			forma: 'ranking';
			id: string;
			titulo: string;
			cor: string;
			unidade: string;
			ranking: RankingItem[];
	  }
	| {
			forma: 'detalhe';
			id: string;
			titulo: string;
			cor: string;
			unidade: string;
			linhas: [string, number][];
			total: number;
	  };

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
	let filterInicio = $state('');
	let filterFim = $state('');

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

	// Year filter — defaults to current year; 'personalizado' shows date pickers.
	// Leitura pontual (não fica em estado reativo) — SvelteDate não agrega nada aqui.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- getFullYear() one-shot
	const currentYear = new Date().getFullYear();
	const anos = Array.from({ length: 4 }, (_, i) => currentYear - i);
	let filterAno = $state(String(currentYear));

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

	/**
	 * Todas as perguntas marcadas do modelo em foco, com as formas de cada uma.
	 *
	 * Uma pergunta pode gerar até três cards, e os três saem daqui: a marca no
	 * editor é a fonte única de quem aparece no painel.
	 */
	const QUESTIONS = $derived(
		mapQuestions(filterTipo === 'seint' ? data.modeloSeint : data.modeloOperacional)
	);

	/** As que viram gráfico de barras — as únicas que precisam de `<canvas>`. */
	const questoesColunas = $derived(QUESTIONS.filter((q) => q.formas.colunas));

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
		}))
	);

	/** Ordena e corta pelo total — nos volumes, "melhor" é o maior número. */
	function porTotal<T extends { total: number }>(itens: T[]): T[] {
		return ordenarERecortar(itens, { ordem, quantidade, valor: (i) => i.total });
	}

	/** O ranking de prisões — do bloco fixo, somando o total de presos (P7). */
	const rankingPrisoes = $derived(
		porTotal(
			calculateRanking(
				grupos,
				parsedData,
				(res) => Number(res.prisoes_apreensoes_flagrante) || 0,
				chaveGrupo
			)
		)
	);

	/**
	 * Os cards de ranking e detalhamento gerados pelas perguntas, NA ORDEM DO
	 * FORMULÁRIO.
	 *
	 * Uma lista só, e não duas, porque a ordem é o que preserva o pareamento: com
	 * "todos os rankings, depois todos os detalhamentos", o ranking de drogas cairia
	 * ao lado do de armas e o detalhamento de drogas iria para a linha de baixo. O
	 * painel sempre mostrou ranking e detalhamento do MESMO assunto lado a lado, e
	 * é assim que se lê — "quem apreendeu mais" ao lado de "o que foi apreendido".
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
		QUESTIONS.filter((q) => q.formas.ranking || q.formas.detalhe).flatMap((q) => {
			const comum = { titulo: q.titulo, cor: q.color, unidade: q.unidade };
			const cards: CardListagem[] = [];
			if (q.formas.ranking) {
				cards.push({
					...comum,
					forma: 'ranking',
					id: idRanking(q.id),
					ranking: porTotal(
						calculateRanking(grupos, parsedData, (res) => valorDaResposta(res, q), chaveGrupo)
					)
				});
			}
			if (q.formas.detalhe) {
				cards.push({
					...comum,
					forma: 'detalhe',
					id: idDetalhe(q.id),
					...detalhePorTipo(parsedData, q)
				});
			}
			return cards;
		})
	);

	/**
	 * Tudo o que está na tela e pode virar PNG, na ordem em que a tela mostra.
	 *
	 * Declarado DEPOIS dos cards de propósito: ele depende deles, e um `$derived`
	 * que referencia uma constante ainda não inicializada é erro de TDZ, não
	 * preguiça de avaliação.
	 */
	const idsExportaveis = $derived<Array<number | string>>([
		...questoesColunas.map((q) => q.id),
		...cardsListagem.map((c) => c.id),
		...(temPrisoes ? IDS_PRISOES : [])
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

				// Ranking e detalhamento de pergunta: os dados já estão montados nos
				// cards, e o PNG é desenhado do zero (não há canvas de origem).
				const card = cardsListagem.find((c) => c.id === id);
				if (card?.forma === 'ranking') {
					const { canvas, filename } = exportRankingAsPng(
						`Ranking de ${card.titulo}`,
						card.cor,
						card.ranking,
						// Peso vai em quilos no ranking, como no card da tela.
						card.unidade === 'g' ? 'kg' : card.unidade,
						payload
					);
					await downloadCanvas(canvas, filename);
					continue;
				}
				if (card?.forma === 'detalhe') {
					const { canvas, filename } = exportDetailAsPng(
						`Detalhamento de ${card.titulo}`,
						card.cor,
						card.linhas.map(([label, value]) => ({ label, value })),
						card.total,
						card.unidade,
						payload
					);
					await downloadCanvas(canvas, filename);
					continue;
				}

				// O que sobrou é o bloco fixo de prisões.
				const virtualConfig = VIRTUAL_CHARTS[id];
				if (!virtualConfig) continue;

				if (id === 'rank-prisoes') {
					const { canvas, filename } = exportRankingAsPng(
						virtualConfig.label,
						virtualConfig.color,
						rankingPrisoes,
						'',
						payload
					);
					await downloadCanvas(canvas, filename);
				} else if (id === 'detail-prisoes') {
					const { canvas, filename } = exportDetailAsPng(
						virtualConfig.label,
						virtualConfig.color,
						[
							{ label: 'Flagrantes (P4)', value: stats.prisaoFlagrante },
							{ label: 'Mandados (P5)', value: stats.prisaoMandado },
							{ label: 'Total de Presos (P7)', value: stats.prisoesTotal }
						],
						Math.max(stats.prisoesTotal, stats.prisaoFlagrante, stats.prisaoMandado),
						'',
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
		/** Rankings e detalhamentos gerados pelas perguntas, na ordem do formulário. */
		get cardsListagem() {
			return cardsListagem;
		},
		/** O bloco fixo de prisões aparece? É o único que sobrou escrito no código. */
		get temPrisoes() {
			return temPrisoes;
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
		get rankingPrisoes() {
			return rankingPrisoes;
		},
		canvasElements,
		exportChartsAsImages
	};
}
