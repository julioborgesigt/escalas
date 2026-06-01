<script lang="ts">
	import { tick } from 'svelte';
	import { slide } from 'svelte/transition';
	import type { Snippet } from 'svelte';
	import { toaster } from '$lib/toast';
	import Spinner from '$lib/components/Spinner.svelte';
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

	type ProdutividadeListaItem = GiseRespostaListagemItem;
	type ProdutividadeParsedRow = ProdutividadeListaItem & {
		respostasParsed: Record<string, unknown>;
	};

	// Chart.js loaded lazily to save ~200KB on initial bundle
	let Chart: ChartJs | null = null;
	let chartLoaded = $state(false);
	let exporting = $state(false);

	async function loadChart() {
		if (!Chart) {
			Chart = (await import('chart.js/auto')).default;
			chartLoaded = true;
		}
	}

	const { data } = $props();

	// Filters
	let filterTipo = $state('operacional');
	let filterSeccional = $state('');
	let filterInicio = $state('');
	let filterFim = $state('');

	// Year filter — defaults to current year; 'personalizado' shows date pickers
	const currentYear = new Date().getFullYear();
	const anos = Array.from({ length: 4 }, (_, i) => currentYear - i);
	let filterAno = $state(String(currentYear));

	let mostrarFiltros = $state(false);
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
	const TOP_IDS = [
		'rank-prisoes',
		'detail-prisoes',
		'rank-drogas',
		'detail-drogas',
		'rank-armas',
		'detail-armas'
	];

	function selectAllCharts() {
		selection.selectAll([...QUESTIONS.map((q) => q.id), ...TOP_IDS]);
	}

	// Alias para compatibilidade com template
	const selectedCharts = $derived(selection.selected);
	const toggleChartSelection = selection.toggle;

	// Questions mapeadas via utilitário
	const QUESTIONS = $derived(
		mapQuestions(filterTipo === 'seint' ? data.modeloSeint : data.modeloOperacional, filterTipo)
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
		filteredData.map(
			(item: ProdutividadeListaItem): ProdutividadeParsedRow => ({
				...item,
				respostasParsed: JSON.parse(item.respostas || '{}') as Record<string, unknown>
			})
		)
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
					const unidade = (res.drogas_unidade && res.drogas_unidade[tipo]) || 'g';
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
</script>

{#snippet subRanking(
	id: string,
	title: string,
	ranking: RankingItem[],
	color: string,
	icon: Snippet<[string]>,
	labelUnit: string
)}
	<div
		class="card relative p-4 sm:p-6 bg-white dark:bg-surface-950 text-surface-900 dark:text-white border-2 transition-all {selectedCharts.includes(
			id
		)
			? 'selected-for-export border-primary-500 shadow-xl shadow-primary-500/10'
			: 'border-surface-200 dark:border-surface-800 shadow-xl'} rounded-3xl flex flex-col h-full"
	>
		<!-- Selection Badge -->
		<button
			type="button"
			onclick={() => toggleChartSelection(id)}
			class="absolute top-2 right-2 md:top-3 md:right-3 w-6 h-6 md:w-8 md:h-8 rounded-lg md:rounded-xl flex items-center justify-center transition-all {selectedCharts.includes(
				id
			)
				? 'bg-primary-500 text-white scale-110 shadow-lg'
				: 'bg-surface-100 dark:bg-surface-800 text-surface-500 hover:scale-105'}"
		>
			{#if selectedCharts.includes(id)}
				<svg class="w-4 h-4 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="4"
						d="M5 13l4 4L19 7"
					/></svg
				>
			{:else}
				<svg
					class="w-3 h-3 md:w-5 md:h-5 opacity-40"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="3"
						d="M12 6v6m0 0v6m0-6h6m-6 0H6"
					/></svg
				>
			{/if}
		</button>

		<div class="flex items-center gap-3 mb-6">
			<div class="p-2 rounded-lg" style="background: {color}20">
				{@render icon(color)}
			</div>
			<h3 class="text-lg font-black uppercase tracking-tighter">
				{title}
			</h3>
		</div>
		<div class="space-y-2 overflow-y-auto pr-2 custom-scrollbar flex-1">
			{#each ranking as item, idx (item.nome)}
				<div
					class="flex items-center gap-4 p-3 rounded-2xl bg-surface-50 dark:bg-white/5 border border-surface-100 dark:border-white/10 group transition-all hover:bg-surface-100 dark:hover:bg-white/10"
				>
					<span class="text-lg font-black text-surface-400 dark:text-surface-500 w-6 italic"
						>#{idx + 1}</span
					>
					<div class="flex-1">
						<p class="text-[0.6rem] font-black uppercase text-surface-400 leading-none mb-1">
							Seccional
						</p>
						<p class="text-xs font-bold leading-tight line-clamp-1">
							{item.nome.split(' do ')[0]}
						</p>
					</div>
					<div class="text-right">
						<p class="text-xl font-black" style="color: {color}">
							{labelUnit === 'kg' ? (item.total / 1000).toFixed(1) : item.total}<span
								class="text-[0.6rem] ml-0.5 opacity-50">{labelUnit}</span
							>
						</p>
						<p class="text-[0.5rem] font-bold uppercase opacity-50">Produção</p>
					</div>
				</div>
			{/each}
		</div>
	</div>
{/snippet}

{#snippet subDetailing(
	id: string,
	title: string,
	details: [string, number][],
	total: number,
	color: string,
	unit: string
)}
	<div
		class="card relative p-4 sm:p-6 bg-white dark:bg-surface-900 border-2 transition-all {selectedCharts.includes(
			id
		)
			? 'selected-for-export border-primary-500 shadow-xl shadow-primary-500/10'
			: 'border-surface-200 dark:border-surface-800 shadow-sm'} rounded-3xl flex flex-col h-full"
	>
		<!-- Selection Badge -->
		<button
			type="button"
			onclick={() => toggleChartSelection(id)}
			class="absolute top-2 right-2 md:top-3 md:right-3 w-6 h-6 md:w-8 md:h-8 rounded-lg md:rounded-xl flex items-center justify-center transition-all {selectedCharts.includes(
				id
			)
				? 'bg-primary-500 text-white scale-110 shadow-lg'
				: 'bg-surface-100 dark:bg-surface-800 text-surface-500 hover:scale-105'}"
		>
			{#if selectedCharts.includes(id)}
				<svg class="w-4 h-4 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="4"
						d="M5 13l4 4L19 7"
					/></svg
				>
			{:else}
				<svg
					class="w-3 h-3 md:w-5 md:h-5 opacity-40"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="3"
						d="M12 6v6m0 0v6m0-6h6m-6 0H6"
					/></svg
				>
			{/if}
		</button>

		<div class="flex items-center gap-3 mb-6">
			<div class="p-2 rounded-lg" style="background: {color}10">
				<svg
					class="w-5 h-5"
					style="color: {color}"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
					/></svg
				>
			</div>
			<h3
				class="text-lg font-black uppercase tracking-tighter text-surface-900 dark:text-surface-50"
			>
				{title}
			</h3>
		</div>
		<div class="space-y-4 flex-1">
			{#each details as [tipo, valor] (tipo)}
				<div class="space-y-1">
					<div class="flex justify-between text-[0.6rem] font-black uppercase">
						<span class="text-surface-500">{tipo}</span>
						<span style="color: {color}"
							>{unit === 'kg' ? (valor / 1000).toFixed(1) : valor.toLocaleString()}{unit}</span
						>
					</div>
					<div class="h-2 w-full bg-surface-100 dark:bg-surface-800 rounded-full overflow-hidden">
						<div
							class="h-full transition-all duration-1000"
							style="background: {color}; width: {(valor / (total || 1)) * 100}%"
						></div>
					</div>
				</div>
			{:else}
				<p class="text-center text-xs text-surface-400 italic py-8">Sem registros no período.</p>
			{/each}
		</div>
	</div>
{/snippet}

{#snippet iconPrison(color: string)}
	<svg class="w-5 h-5" style="color: {color}" fill="none" stroke="currentColor" viewBox="0 0 24 24"
		><path
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="2"
			d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
		/></svg
	>
{/snippet}
{#snippet iconDrug(color: string)}
	<svg class="w-5 h-5" style="color: {color}" fill="none" stroke="currentColor" viewBox="0 0 24 24"
		><path
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="2"
			d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
		/></svg
	>
{/snippet}
{#snippet iconWeapon(color: string)}
	<svg class="w-5 h-5" style="color: {color}" fill="none" stroke="currentColor" viewBox="0 0 24 24"
		><path
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="2"
			d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
		/></svg
	>
{/snippet}

<div class="space-y-8 pb-12 {selectedCharts.length > 0 ? 'has-selections' : ''}">
	<header class="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
		<div class="space-y-1">
			<h1 class="h1 text-2xl font-bold">
				Produção {filterTipo === 'seint' ? 'Inteligência' : 'Operacional'} GISE
			</h1>
			<p class="text-surface-500 font-medium">
				Análise filtrada e segmentada dos resultados reais {filterTipo === 'seint'
					? '(SEINT)'
					: '(P4-P19)'}
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-3">
			{#if allChartsCount > 0}
				<button
					type="button"
					class="btn text-[0.6rem] font-black uppercase tracking-widest px-4 py-2 rounded-xl transition-colors {selectedCharts.length >=
					allChartsCount
						? 'bg-surface-900 dark:bg-surface-50 text-white dark:text-surface-950 shadow-lg'
						: 'bg-surface-200/60 dark:bg-surface-800/60 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700'}"
					onclick={selectAllCharts}
				>
					{selectedCharts.length >= allChartsCount
						? 'Desmarcar Todos'
						: `Selecionar Todos (${allChartsCount})`}
				</button>
			{/if}

			<button
				type="button"
				class="btn {selectedCharts.length > 0
					? 'bg-rose-600 hover:bg-rose-700 shadow-rose-500/20 text-white'
					: 'bg-surface-200/80 dark:bg-surface-800/80 text-surface-500 dark:text-surface-400 cursor-not-allowed'} shadow-xl text-[0.65rem] font-black uppercase py-2 px-6 rounded-xl transition-all {selectedCharts.length >
				0
					? 'hover:scale-105 active:scale-95'
					: ''} flex items-center gap-2"
				onclick={exportChartsAsImages}
				disabled={selectedCharts.length === 0 || exporting}
			>
				{#if exporting}
					<Spinner size="sm" />
					Exportando...
				{:else}
					<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="3"
							d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
						/></svg
					>
					Baixar PNGs {selectedCharts.length > 0 ? `(${selectedCharts.length})` : ''}
				{/if}
			</button>

			<button
				type="button"
				class="export-btn btn {selectedCharts.length > 0
					? 'bg-secondary-600 hover:bg-secondary-700 shadow-secondary-500/20 text-white'
					: 'bg-surface-200/80 dark:bg-surface-800/80 text-surface-500 dark:text-surface-400 cursor-not-allowed'} shadow-xl text-[0.65rem] font-black uppercase py-2 px-6 rounded-xl transition-all {selectedCharts.length >
				0
					? 'hover:scale-105 active:scale-95'
					: ''} flex items-center gap-2"
				onclick={() => window.print()}
				disabled={selectedCharts.length === 0}
			>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="3"
						d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
					/></svg
				>
				Exportar PDF {selectedCharts.length > 0 ? `(${selectedCharts.length})` : ''}
			</button>
		</div>
	</header>

	<div class="space-y-3">
		<div class="flex items-center justify-between gap-2">
			<span
				class="text-xs font-bold uppercase tracking-widest text-surface-400 dark:text-surface-500"
				>Filtros</span
			>
			<button
				type="button"
				class="inline-flex items-center gap-1.5 rounded-xl border border-surface-300/80 bg-white px-3 py-1.5 text-xs font-semibold text-surface-700 shadow-sm transition-all hover:border-primary-400/50 hover:bg-primary-500/5 dark:border-surface-600/80 dark:bg-surface-800 dark:text-surface-200 dark:hover:bg-surface-700/80 {mostrarFiltros
					? 'border-primary-500/50 bg-primary-500/5 dark:border-primary-500/40 dark:bg-primary-500/10'
					: ''}"
				onclick={() => (mostrarFiltros = !mostrarFiltros)}
				aria-expanded={mostrarFiltros}
			>
				<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
					/>
				</svg>
				Filtros
				{#if filtrosAtivos}
					<span class="h-1.5 w-1.5 rounded-full bg-primary-500"></span>
				{/if}
			</button>
		</div>

		{#if mostrarFiltros}
			<section
				class="overflow-hidden rounded-3xl border border-surface-200 bg-white shadow-sm dark:border-surface-800 dark:bg-surface-900"
				transition:slide={{ duration: 250 }}
			>
				<div class="grid grid-cols-1 gap-4 p-4 sm:p-5 lg:grid-cols-12 items-end">
					<!-- 1. Tipo de equipe -->
					<div class="space-y-1.5 lg:col-span-3">
						<p
							class="text-[0.6rem] font-black uppercase tracking-widest text-surface-400 dark:text-surface-500 pl-0.5 block"
						>
							1. Tipo de equipe
						</p>
						<div
							class="inline-flex w-full rounded-xl border border-surface-200 bg-surface-100 p-0.5 dark:border-surface-700 dark:bg-surface-800/80"
						>
							<button
								type="button"
								class="flex-1 rounded-lg py-1.5 text-xs font-bold transition-all {filterTipo ===
								'operacional'
									? 'bg-warning-500 text-white shadow-sm'
									: 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200'}"
								onclick={() => (filterTipo = 'operacional')}>Operacional</button
							>
							<button
								type="button"
								class="flex-1 rounded-lg py-1.5 text-xs font-bold transition-all {filterTipo ===
								'seint'
									? 'bg-tertiary-500 text-white shadow-sm'
									: 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200'}"
								onclick={() => (filterTipo = 'seint')}>Inteligência</button
							>
						</div>
					</div>

					<!-- 2. Seccional -->
					<div class="space-y-1.5 lg:col-span-3">
						<label
							for="f-sec"
							class="text-[0.6rem] font-black uppercase tracking-widest text-surface-400 dark:text-surface-500 pl-0.5 block"
							>2. Seccional</label
						>
						<select
							id="f-sec"
							bind:value={filterSeccional}
							class="w-full px-3 py-2.5 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-bold"
						>
							<option value="">Todas as Seccionais</option>
							{#each data.seccionais ?? [] as sec}
								<option value={sec.id}>{sec.nome}</option>
							{/each}
						</select>
					</div>

					<!-- 3. Período -->
					<div class="space-y-1.5 lg:col-span-6">
						<label
							for="f-ano"
							class="text-[0.6rem] font-black uppercase tracking-widest text-surface-400 dark:text-surface-500 pl-0.5 block"
							>3. Período</label
						>
						<div class="flex flex-wrap lg:flex-nowrap items-end gap-2">
							<select
								id="f-ano"
								bind:value={filterAno}
								class="w-full lg:w-auto min-w-[120px] px-3 py-2.5 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-bold"
							>
								{#each anos as ano}
									<option value={String(ano)}>{ano}</option>
								{/each}
								<option value="personalizado">Personalizado</option>
							</select>

							{#if filterAno === 'personalizado'}
								<div class="flex items-end gap-2 w-full lg:w-auto">
									<div class="space-y-0.5 flex-1 lg:flex-initial">
										<label
											for="f-ini"
											class="text-[0.55rem] font-black text-surface-400 uppercase tracking-widest block pl-0.5"
											>De</label
										>
										<input
											id="f-ini"
											type="date"
											bind:value={filterInicio}
											class="w-full px-3 py-2 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-bold"
										/>
									</div>
									<span class="text-surface-400 pb-2">—</span>
									<div class="space-y-0.5 flex-1 lg:flex-initial">
										<label
											for="f-fim"
											class="text-[0.55rem] font-black text-surface-400 uppercase tracking-widest block pl-0.5"
											>Até</label
										>
										<input
											id="f-fim"
											type="date"
											bind:value={filterFim}
											class="w-full px-3 py-2 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-bold"
										/>
									</div>
								</div>
							{/if}
						</div>
					</div>
				</div>
			</section>
		{/if}
	</div>

	<!-- Highlights Analytics: 3 Strategic Rows [Ranking | Detailing] -->
	{#if filterTipo === 'operacional'}
		<div class="space-y-6 animate-in fade-in slide-in-from-top-4 duration-500">
			<!-- ROW 1: PRISONS -->
			<section class="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
				{@render subRanking(
					'rank-prisoes',
					'Ranking de Prisões (P7)',
					rankingPrisoes,
					'#f43f5e',
					iconPrison,
					''
				)}
				{@render subDetailing(
					'detail-prisoes',
					'Detalhamento de Prisões',
					(() => {
						const v = (stats['prisoes_apreensoes_flagrante'] as number) || 0;
						return [
							['Flagrantes (P4)', stats.prisaoFlagrante],
							['Mandados (P5)', stats.prisaoMandado],
							['Total de Presos (P7)', v]
						];
					})(),
					Math.max(
						(stats['prisoes_apreensoes_flagrante'] as number) || 0,
						stats.prisaoFlagrante,
						stats.prisaoMandado
					),
					'#f43f5e',
					''
				)}
			</section>

			<!-- ROW 2: DRUGS -->
			<section class="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
				{@render subRanking(
					'rank-drogas',
					'Ranking de Drogas (P10)',
					rankingDrogasPeso,
					'#ef4444',
					iconDrug,
					'kg'
				)}
				{@render subDetailing(
					'detail-drogas',
					'Detalhamento de Substâncias',
					(Object.entries(stats.drogasPorTipo) as [string, number][])
						.sort((a, b) => b[1] - a[1])
						.slice(0, 8),
					stats.drogasGeral,
					'#ef4444',
					'g'
				)}
			</section>

			<!-- ROW 3: WEAPONS -->
			<section class="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
				{@render subRanking(
					'rank-armas',
					'Ranking de Armas (P11)',
					rankingArmas,
					'#6366f1',
					iconWeapon,
					''
				)}
				{@render subDetailing(
					'detail-armas',
					'Detalhamento de Armas',
					(Object.entries(stats.armasPorTipo) as [string, number][])
						.sort((a, b) => b[1] - a[1])
						.slice(0, 8),
					stats.apreensoes_armas,
					'#6366f1',
					''
				)}
			</section>
		</div>
	{/if}

	<!-- Summary Display & Charts Grid (Single Column for better clarity with many regionals) -->
	<section class="space-y-8">
		{#each QUESTIONS as q (q.id)}
			<div
				class="card relative p-4 sm:p-6 lg:p-8 bg-white dark:bg-surface-900 border-2 transition-all {selectedCharts.includes(
					q.id
				)
					? 'selected-for-export border-primary-500 shadow-xl shadow-primary-500/10'
					: 'border-surface-100 dark:border-surface-800 shadow-sm'} rounded-3xl overflow-hidden flex flex-col md:flex-row gap-4"
			>
				<button
					type="button"
					onclick={() => toggleChartSelection(q.id)}
					class="absolute top-2 right-2 md:top-3 md:right-3 w-6 h-6 md:w-8 md:h-8 rounded-lg md:rounded-xl flex items-center justify-center transition-all {selectedCharts.includes(
						q.id
					)
						? 'bg-primary-500 text-white scale-110 shadow-lg'
						: 'bg-surface-100 dark:bg-surface-800 text-surface-500 hover:scale-105'}"
				>
					{#if selectedCharts.includes(q.id)}
						<svg class="w-4 h-4 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="4"
								d="M5 13l4 4L19 7"
							/></svg
						>
					{:else}
						<svg
							class="w-3 h-3 md:w-5 md:h-5 opacity-40"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="3"
								d="M12 6v6m0 0v6m0-6h6m-6 0H6"
							/></svg
						>
					{/if}
				</button>
				<div class="md:w-1/6 flex flex-col justify-center">
					<p class="text-[0.6rem] font-black text-surface-400 uppercase tracking-widest mb-1">
						{q.label}
					</p>
					<h3 class="text-5xl font-black" style="color: {q.color}">
						{#if q.specialStore === 'drogasGeral'}
							{(stats.drogasGeral / 1000).toFixed(2)}<span class="text-sm ml-1 opacity-60">kg</span>
						{:else if q.isBool}
							{parsedData.filter((i) => i.respostasParsed[q.key] === 'Sim').length}
						{:else}
							{stats[q.key as keyof typeof stats] ??
								parsedData.reduce(
									(acc: number, i) => acc + (Number(i.respostasParsed[q.key]) || 0),
									0
								)}
						{/if}
					</h3>
					<div class="mt-4 flex gap-2">
						<span
							class="text-[0.5rem] font-bold px-2 py-1 rounded uppercase bg-surface-100 dark:bg-surface-800 text-surface-500"
						>
							{filterSeccional ? 'Tendência' : 'Comparação Seccional'}
						</span>
					</div>
				</div>
				<div class="flex-1 min-h-[250px] w-full">
					<canvas bind:this={canvasElements[q.id]}></canvas>
				</div>
			</div>
		{/each}
	</section>
</div>

<style>
	@media print {
		.card {
			break-inside: avoid !important;
			page-break-inside: avoid !important;
			box-shadow: none !important;
			border-color: #e2e8f0 !important;
		}

		/* If selections exist, hide everything except selected cards */
		:global(.has-selections) .card:not(.selected-for-export) {
			display: none !important;
		}

		/* Also hide filters and extra texts if selection is active */
		:global(.has-selections) section:first-of-type,
		:global(.has-selections) header p {
			display: none !important;
		}

		.export-btn,
		header p {
			display: none !important;
		}

		:global(body) {
			background: white !important;
		}
	}

	.custom-scrollbar::-webkit-scrollbar {
		width: 4px;
	}
	.custom-scrollbar::-webkit-scrollbar-track {
		background: transparent;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb {
		background: #64748b30;
		border-radius: 10px;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb:hover {
		background: #64748b60;
	}
</style>
