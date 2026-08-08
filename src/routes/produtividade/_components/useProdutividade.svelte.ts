/**
 * Cadeia reativa do painel de PRODUTIVIDADE.
 *
 * Ordem documentada (custo): filteredData → parsedData → stats / rankings / gráficos.
 * `parsedData` faz `JSON.parse` UMA vez por resposta; sem esse degrau, cada
 * estatística e cada ranking reparsearia os mesmos blobs.
 *
 * Chart.js entra por `import()` dinâmico (~200 KB).
 */
import { tick } from 'svelte';
import type { PageData } from '../$types';
import { toaster } from '$lib/toast';
import type { Unidade } from '$lib/types';
import type { GiseRespostaListagemItem } from '$lib/db/gise';
import { useMultiSelect, useCharts } from '$lib/composables';
import {
	mapQuestions,
	getArmasKey,
	calculateStats,
	calculateRanking,
	type Question
} from '$lib/produtividade';
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

const TOP_IDS = [
	'rank-prisoes',
	'detail-prisoes',
	'rank-drogas',
	'detail-drogas',
	'rank-armas',
	'detail-armas'
] as const;

export function useProdutividade(getData: () => PageData) {
	const data = $derived(getData());

	let Chart: ChartJs | null = null;
	let exporting = $state(false);

	async function loadChart() {
		if (!Chart) {
			Chart = (await import('chart.js/auto')).default;
		}
	}

	// Filters
	let filterTipo = $state('operacional');
	let filterSeccional = $state('');
	let filterInicio = $state('');
	let filterFim = $state('');

	// Year filter — defaults to current year; 'personalizado' shows date pickers.
	// Leitura pontual (não fica em estado reativo) — SvelteDate não agrega nada aqui.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- getFullYear() one-shot
	const currentYear = new Date().getFullYear();
	const anos = Array.from({ length: 4 }, (_, i) => currentYear - i);
	let filterAno = $state(String(currentYear));

	let mostrarFiltros = $state(true);
	const filtrosAtivos = $derived(
		filterSeccional !== '' ||
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

	function selectAllCharts() {
		selection.selectAll([...QUESTIONS.map((q) => q.id), ...TOP_IDS]);
	}

	// Alias para compatibilidade com template
	const selectedCharts = $derived(selection.selected);
	const toggleChartSelection = selection.toggle;

	// Questions mapeadas via utilitário
	const QUESTIONS = $derived(
		mapQuestions(filterTipo === 'seint' ? data.modeloSeint : data.modeloOperacional)
	);

	const allChartsCount = $derived(QUESTIONS.length + TOP_IDS.length);

	// Armas key via utilitário
	const armasKey = $derived(getArmasKey(data.modeloOperacional));

	// Derived Data
	const filteredData = $derived(
		(data.lista || []).filter((item: ProdutividadeListaItem) => {
			const date = item.data_inicio;
			const tipo = (item.equipe_tipo || 'operacional').toLowerCase();
			if (tipo !== filterTipo) return false;
			if (filterSeccional && item.seccional_id !== Number(filterSeccional)) return false;
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

	// Stats via utilitário
	const stats = $derived(calculateStats(parsedData, QUESTIONS, armasKey));

	// Rankings via utilitário
	const rankingPrisoes = $derived(
		calculateRanking(
			data.seccionais ?? [],
			parsedData,
			(res) => Number(res.prisoes_apreensoes_flagrante) || 0
		)
	);

	const rankingDrogasPeso = $derived(
		calculateRanking(data.seccionais ?? [], parsedData, (res) => {
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
		})
	);

	const rankingArmas = $derived(
		calculateRanking(data.seccionais ?? [], parsedData, (res) => {
			let val = 0;
			if (res[armasKey] === 'Sim' && res.armas_detalhe) {
				Object.values(res.armas_detalhe).forEach((q) => (val += Number(q) || 0));
			}
			return val;
		})
	);

	// Charts via composable
	const charts = useCharts(
		() => Chart,
		() => data
	);
	const canvasElements = charts.canvasElements;

	// Destroy all stale chart instances when question set changes
	$effect(() => {
		// Set efêmero passado a destroyStaleCharts (API tipada em Set) — não vive em $state.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- argumento pontual
		const currentIds = new Set(QUESTIONS.map((q) => q.id));
		charts.destroyStaleCharts(currentIds);
	});

	async function updateChartsFn(list: ProdutividadeParsedRow[]) {
		await loadChart();
		// Pass parsed data (respostas already parsed)
		charts.updateCharts(QUESTIONS as Question[], list, filterSeccional);
	}

	// Único effect: redesenha quando dados, perguntas, filtro ou canvases mudam.
	// O `tick()` garante que <canvas> estejam montados antes de Chart.js anexar.
	$effect(() => {
		const list = parsedData;
		const _filter = filterSeccional; // dep explícita: redesenha ao trocar seccional
		const allCanvasesReady = QUESTIONS.length > 0 && QUESTIONS.every((q) => !!canvasElements[q.id]);
		if (list && allCanvasesReady) {
			void _filter;
			tick().then(() => updateChartsFn(list));
		}
	});

	async function exportChartsAsImages() {
		if (selectedCharts.length === 0 || exporting) return;
		exporting = true;
		try {
			const seccionalName =
				data.seccionais?.find((s: Unidade) => s.id === Number(filterSeccional))?.nome ||
				'Todas as Seccionais';
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
						const prisoesFlagrante = (stats['prisoes_apreensoes_flagrante'] as number) || 0;
						details = [
							{ label: 'Flagrantes (P4)', value: stats.prisaoFlagrante },
							{ label: 'Mandados (P5)', value: stats.prisaoMandado },
							{ label: 'Total de Presos (P7)', value: prisoesFlagrante }
						];
						total = Math.max(prisoesFlagrante, stats.prisaoFlagrante, stats.prisaoMandado);
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
		get filterSeccional() {
			return filterSeccional;
		},
		set filterSeccional(v: string) {
			filterSeccional = v;
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
