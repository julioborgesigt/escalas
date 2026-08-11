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
	getArmasKey,
	blocosFixosDisponiveis,
	calculateStats,
	calculateRanking,
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
	type RankingItem,
	type DetailItem
} from '$lib/export-charts';

type ChartJs = (typeof import('chart.js/auto'))['default'];

export type ProdutividadeListaItem = GiseRespostaListagemItem;
export type ProdutividadeParsedRow = ProdutividadeListaItem & {
	respostasParsed: Record<string, unknown>;
};

/**
 * Os cards de cada bloco fixo, na ordem em que a tela os mostra.
 *
 * Não é mais uma lista só: cada bloco entra ou não conforme o formulário da
 * operação tenha a pergunta que o alimenta (`blocosFixosDisponiveis`). Contar os
 * seis sempre fazia "Selecionar Todos (N)" prometer cards inexistentes e a
 * exportação gerar PNG zerado de uma pergunta que ninguém fez.
 */
const IDS_POR_BLOCO = {
	prisoes: ['rank-prisoes', 'detail-prisoes'],
	drogas: ['rank-drogas', 'detail-drogas'],
	armas: ['rank-armas', 'detail-armas']
} as const;

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
	 * desabilitado. Mesma regra do editor de formulário (`useResGise`), e por isso
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

	// Questions mapeadas via utilitário
	const QUESTIONS = $derived(
		mapQuestions(filterTipo === 'seint' ? data.modeloSeint : data.modeloOperacional)
	);

	/**
	 * Quais dos três blocos fixos esta operação comporta.
	 *
	 * Sempre do modelo OPERACIONAL: a seção inteira só aparece nesse tipo de
	 * equipe, e é lá que moram as perguntas de droga, arma e flagrante.
	 */
	const blocosFixos = $derived(blocosFixosDisponiveis(data.modeloOperacional));

	/** Os ids dos blocos fixos que estão na tela AGORA — nada mais é exportável. */
	const idsFixosVisiveis = $derived(
		filterTipo === 'operacional'
			? (Object.keys(IDS_POR_BLOCO) as Array<keyof typeof IDS_POR_BLOCO>).flatMap((bloco) =>
					blocosFixos[bloco] ? [...IDS_POR_BLOCO[bloco]] : []
				)
			: []
	);

	const idsExportaveis = $derived<Array<number | string>>([
		...QUESTIONS.map((q) => q.id),
		...idsFixosVisiveis
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
	const toggleChartSelection = selection.toggle;

	const allChartsCount = $derived(idsExportaveis.length);

	// Armas key via utilitário
	const armasKey = $derived(getArmasKey(data.modeloOperacional));

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
	const stats = $derived(calculateStats(parsedData, QUESTIONS, armasKey));

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

	// Rankings via utilitário
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

	const rankingDrogasPeso = $derived(
		porTotal(
			calculateRanking(
				grupos,
				parsedData,
				(res) => {
					let total = 0;
					if (res.drogas_detalhe) {
						Object.entries(res.drogas_detalhe).forEach(([tipo, peso]) => {
							const unidade =
								(res.drogas_unidade && (res.drogas_unidade as Record<string, string>)[tipo]) || 'g';
							let p = Number(peso) || 0;
							if (unidade === 'kg') p *= 1000;
							total += p;
						});
					}
					return total;
				},
				chaveGrupo
			)
		)
	);

	const rankingArmas = $derived(
		porTotal(
			calculateRanking(
				grupos,
				parsedData,
				(res) => {
					let val = 0;
					if (res[armasKey] === 'Sim' && res.armas_detalhe) {
						Object.values(res.armas_detalhe).forEach((q) => (val += Number(q) || 0));
					}
					return val;
				},
				chaveGrupo
			)
		)
	);

	// Charts via composable
	const charts = useCharts(() => Chart);
	const canvasElements = charts.canvasElements;

	// Destroy all stale chart instances when question set changes
	$effect(() => {
		// Set efêmero passado a destroyStaleCharts (API tipada em Set) — não vive em $state.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- argumento pontual
		const currentIds = new Set(QUESTIONS.map((q) => q.id));
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
		charts.updateCharts(QUESTIONS as Question[], list, grupos, chaveGrupo, porTotal);
	}

	// Único effect: redesenha quando dados, perguntas, filtro ou canvases mudam.
	// O `tick()` garante que <canvas> estejam montados antes de Chart.js anexar.
	$effect(() => {
		const list = parsedData;
		// Deps explícitas: o eixo e o recorte mudam sem que `parsedData` mude.
		const _grupos = grupos;
		const _recorte = [ordem, quantidade];
		const allCanvasesReady = QUESTIONS.length > 0 && QUESTIONS.every((q) => !!canvasElements[q.id]);
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
				const isVirtual = typeof id === 'string';
				const virtualConfig = VIRTUAL_CHARTS[id as string];

				if (!isVirtual) {
					const q = QUESTIONS.find((qi) => qi.id === id);
					if (!q) continue;
					const sourceCanvas = canvasElements[id as number];
					if (!sourceCanvas) continue;
					const { canvas, filename } = exportChartAsPng(
						{ label: q.label, color: q.color, sourceCanvas, type: 'chart' },
						payload
					);
					await downloadCanvas(canvas, filename);
				} else if (virtualConfig && virtualConfig.type === 'ranking') {
					let ranking: RankingItem[] = [];
					let unit = '';
					if (id === 'rank-prisoes') {
						ranking = rankingPrisoes;
					} else if (id === 'rank-drogas') {
						ranking = rankingDrogasPeso;
						unit = 'kg';
					} else if (id === 'rank-armas') {
						ranking = rankingArmas;
					}
					const { canvas, filename } = exportRankingAsPng(
						virtualConfig.label,
						virtualConfig.color,
						ranking,
						unit,
						payload
					);
					await downloadCanvas(canvas, filename);
				} else if (virtualConfig && virtualConfig.type === 'detail') {
					let details: DetailItem[] = [];
					let total = 0;
					let unit = '';
					if (id === 'detail-prisoes') {
						details = [
							{ label: 'Flagrantes (P4)', value: stats.prisaoFlagrante },
							{ label: 'Mandados (P5)', value: stats.prisaoMandado },
							{ label: 'Total de Presos (P7)', value: stats.prisoesTotal }
						];
						total = Math.max(stats.prisoesTotal, stats.prisaoFlagrante, stats.prisaoMandado);
					} else if (id === 'detail-drogas') {
						details = (Object.entries(stats.drogasPorTipo) as [string, number][])
							.sort((a, b) => b[1] - a[1])
							.slice(0, 8)
							.map(([l, v]) => ({ label: l, value: v }));
						total = stats.drogasGeral;
						unit = 'g';
					} else if (id === 'detail-armas') {
						details = (Object.entries(stats.armasPorTipo) as [string, number][])
							.sort((a, b) => b[1] - a[1])
							.slice(0, 8)
							.map(([l, v]) => ({ label: l, value: v }));
						total = stats.apreensoes_armas;
					}
					const { canvas, filename } = exportDetailAsPng(
						virtualConfig.label,
						virtualConfig.color,
						details,
						total,
						unit,
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
		get QUESTIONS() {
			return QUESTIONS;
		},
		/** Quais blocos fixos (prisões/drogas/armas) esta operação comporta. */
		get blocosFixos() {
			return blocosFixos;
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
		get rankingDrogasPeso() {
			return rankingDrogasPeso;
		},
		get rankingArmas() {
			return rankingArmas;
		},
		canvasElements,
		exportChartsAsImages
	};
}
