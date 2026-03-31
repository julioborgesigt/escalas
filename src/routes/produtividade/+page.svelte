<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import Chart from 'chart.js/auto';

	let { data } = $props();
	
	// Filters
	let filterSeccional = $state('');
	let filterInicio = $state('');
	let filterFim = $state('');

	// Derived Data (Exclusive to "Operacional" teams)
	let filteredData = $derived(
		(data.lista || []).filter((item: any) => {
			const date = item.data_inicio;
			const tipo = (item.equipe_tipo || '').toLowerCase();
			if (tipo === 'seint') return false; // Explicitamente oculta SEINT
			if (filterSeccional && item.seccional_id !== Number(filterSeccional)) return false;
			if (filterInicio && date < filterInicio) return false;
			if (filterFim && date > filterFim) return false;
			return true;
		})
	);

	// Stats Calculation
	let stats = $derived.by(() => {
		let s = { 
			procedimentos: 0, mandados: 0, apreensoes: 0, presos: 0, armas: 0,
			local_crime: 0, ordem_missao: 0, abordagens: 0, oitivas: 0,
			drogasGeral: 0, drogasPorTipo: {} as Record<string, number>
		};
		filteredData.forEach((item: any) => {
			const res = JSON.parse(item.respostas || '{}');
			s.procedimentos += Number(res.procedimentos_inteiros) || 0;
			s.mandados += Number(res.mandados_qtd) || 0;
			s.apreensoes += Number(res.apreensoes_qtd) || 0;
			s.presos += Number(res.prisoes_apreensoes_flagrante) || 0;
			s.armas += Number(res.apreensoes_armas) || 0;
			s.local_crime += Number(res.local_crime) || 0;
			s.ordem_missao += Number(res.ordem_missao) || 0;
			s.abordagens += Number(res.abordagens) || 0;
			s.oitivas += Number(res.oitivas) || 0;
			if (res.drogas_detalhe) {
				Object.entries(res.drogas_detalhe).forEach(([tipo, peso]) => {
					const unidade = (res.drogas_unidade && res.drogas_unidade[tipo]) || 'g';
					let pesoNormalizado = Number(peso) || 0;
					if (unidade === 'kg') pesoNormalizado *= 1000;
					s.drogasPorTipo[tipo] = (s.drogasPorTipo[tipo] || 0) + pesoNormalizado;
					s.drogasGeral += pesoNormalizado;
				});
			}
		});
		return s;
	});

	// Charts references
	let chartPresos: any, chartMandados: any, chartArmas: any, chartResumo: any;
	let canvasPresos: HTMLCanvasElement, canvasMandados: HTMLCanvasElement, canvasArmas: HTMLCanvasElement, canvasResumo: HTMLCanvasElement;

	function createTrendChart(canvas: HTMLCanvasElement, label: string, color: string, dataMap: Map<string, number>) {
		if (!canvas) return null;
		const sortedDates = Array.from(dataMap.keys()).sort();
		return new Chart(canvas, {
			type: 'line',
			data: {
				labels: sortedDates.map(d => d.split('-').reverse().join('/')),
				datasets: [{
					label, data: sortedDates.map(d => dataMap.get(d)),
					borderColor: color, backgroundColor: color + '15',
					tension: 0.4, fill: true, pointRadius: 2, borderWidth: 2
				}]
			},
			options: {
				responsive: true, maintainAspectRatio: false,
				plugins: { legend: { display: false } },
				scales: { x: { display: false }, y: { beginAtZero: true, ticks: { display: false }, grid: { display: false } } }
			}
		});
	}

	function updateCharts(list: any[]) {
		if (!canvasPresos || !canvasMandados || !canvasArmas || !canvasResumo) return;

		// Data processing for trends
		const mapPresos = new Map(), mapMandados = new Map(), mapArmas = new Map();
		list.forEach(item => {
			const d = item.data_inicio;
			const res = JSON.parse(item.respostas || '{}');
			mapPresos.set(d, (mapPresos.get(d) || 0) + (Number(res.prisoes_apreensoes_flagrante) || 0));
			mapMandados.set(d, (mapMandados.get(d) || 0) + (Number(res.mandados_qtd) || 0));
			mapArmas.set(d, (mapArmas.get(d) || 0) + (Number(res.apreensoes_armas) || 0));
		});

		if (chartPresos) chartPresos.destroy();
		chartPresos = createTrendChart(canvasPresos, 'Prisões', '#f43f5e', mapPresos);

		if (chartMandados) chartMandados.destroy();
		chartMandados = createTrendChart(canvasMandados, 'Mandados', '#10b981', mapMandados);

		if (chartArmas) chartArmas.destroy();
		chartArmas = createTrendChart(canvasArmas, 'Armas', '#8b5cf6', mapArmas);

		// Bar Chart
		if (chartResumo) chartResumo.destroy();
		chartResumo = new Chart(canvasResumo, {
			type: 'bar',
			data: {
				labels: ['Procedimentos', 'Apreensões ECA', 'Intervenção Crime', 'Abordagens', 'Oitivas'],
				datasets: [{
					label: 'Volume Total',
					data: [stats.procedimentos, stats.apreensoes, stats.local_crime, stats.abordagens, stats.oitivas],
					backgroundColor: ['#3b82f6', '#f59e0b', '#06b6d4', '#ec4899', '#6366f1'],
					borderRadius: 10
				}]
			},
			options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
		});
	}

	$effect(() => { untrack(() => updateCharts(filteredData)); });
	onMount(() => { updateCharts(filteredData); });
</script>

<div class="space-y-8 pb-12">
	<header class="flex flex-col md:flex-row md:items-center justify-between gap-6">
		<div class="space-y-1">
			<h1 class="text-2xl sm:text-4xl font-black text-surface-900 dark:text-surface-50 uppercase tracking-tighter">Produção Operacional GISE</h1>
			<p class="text-surface-500 font-medium">Análise filtrada e segmentada dos resultados reais (P4-P19)</p>
		</div>
		<button class="btn preset-filled-surface-200 dark:preset-filled-surface-800 text-xs font-bold uppercase py-3 px-6 rounded-2xl" onclick={() => window.print()}>
			Exportar PDF
		</button>
	</header>

	<!-- Filters -->
	<section class="card p-6 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-3xl shadow-sm">
		<div class="grid grid-cols-1 md:grid-cols-3 gap-6">
			<div class="space-y-1.5">
				<label for="f-sec" class="text-[0.6rem] font-black text-surface-400 uppercase tracking-widest pl-1">Regional</label>
				<select id="f-sec" bind:value={filterSeccional} class="w-full px-4 py-3 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-bold">
					<option value="">Todas as Regionais</option>
					{#each data.seccionais as sec} <option value={sec.id}>{sec.nome}</option> {/each}
				</select>
			</div>
			<div class="space-y-1.5">
				<label for="f-ini" class="text-[0.6rem] font-black text-surface-400 uppercase tracking-widest pl-1">De</label>
				<input id="f-ini" type="date" bind:value={filterInicio} class="w-full px-4 py-3 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-bold" />
			</div>
			<div class="space-y-1.5">
				<label for="f-fim" class="text-[0.6rem] font-black text-surface-400 uppercase tracking-widest pl-1">Até</label>
				<input id="f-fim" type="date" bind:value={filterFim} class="w-full px-4 py-3 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-bold" />
			</div>
		</div>
	</section>

	<!-- Evolutionary Trends (3 Graphs as requested) -->
	<section class="grid grid-cols-1 md:grid-cols-3 gap-6">
		<div class="card p-6 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-3xl overflow-hidden shadow-sm">
			<div class="flex justify-between items-start mb-2">
				<div>
					<p class="text-[0.6rem] font-black text-surface-400 uppercase tracking-widest">Evolução Prisões (P7)</p>
					<h3 class="text-3xl font-black text-rose-500">{stats.presos}</h3>
				</div>
				<span class="text-[0.6rem] font-bold bg-rose-500/10 text-rose-500 px-2 py-1 rounded">Total Período</span>
			</div>
			<div class="h-24 w-full -mx-2 -mb-2">
				<canvas bind:this={canvasPresos}></canvas>
			</div>
		</div>

		<div class="card p-6 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-3xl overflow-hidden shadow-sm">
			<div class="flex justify-between items-start mb-2">
				<div>
					<p class="text-[0.6rem] font-black text-surface-400 uppercase tracking-widest">Evolução Mandados (P5)</p>
					<h3 class="text-3xl font-black text-emerald-500">{stats.mandados}</h3>
				</div>
				<span class="text-[0.6rem] font-bold bg-emerald-500/10 text-emerald-500 px-2 py-1 rounded">Total Período</span>
			</div>
			<div class="h-24 w-full -mx-2 -mb-2">
				<canvas bind:this={canvasMandados}></canvas>
			</div>
		</div>

		<div class="card p-6 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-3xl overflow-hidden shadow-sm">
			<div class="flex justify-between items-start mb-2">
				<div>
					<p class="text-[0.6rem] font-black text-surface-400 uppercase tracking-widest">Evolução Armas (P11)</p>
					<h3 class="text-3xl font-black text-violet-500">{stats.armas}</h3>
				</div>
				<span class="text-[0.6rem] font-bold bg-violet-500/10 text-violet-500 px-2 py-1 rounded">Total Período</span>
			</div>
			<div class="h-24 w-full -mx-2 -mb-2">
				<canvas bind:this={canvasArmas}></canvas>
			</div>
		</div>
	</section>

	<section class="grid grid-cols-1 lg:grid-cols-2 gap-6">
		<!-- Summary Bar Chart -->
		<div class="card p-4 sm:p-8 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-3xl shadow-sm">
			<div class="flex items-center justify-between mb-6 sm:mb-8">
				<h3 class="text-lg font-black uppercase tracking-tighter text-surface-900 dark:text-surface-50">Resumo por Ponto Operacional</h3>
				<span class="text-[0.6rem] font-bold text-primary-500 bg-primary-500/10 px-2 py-1 rounded">Métricas Adicionais</span>
			</div>
			<div class="h-[300px] w-full relative">
				<canvas bind:this={canvasResumo}></canvas>
			</div>
		</div>

		<!-- Drugs Section -->
		<div class="card p-4 sm:p-8 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-3xl shadow-sm">
			<div class="flex items-center gap-3 mb-6 sm:mb-8">
				<div class="p-2 bg-error-500/10 rounded-lg">
					<svg class="w-5 h-5 text-error-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a2 2 0 00-1.96 1.414l-.392 1.177a2 2 0 001.414 2.526l2.354.47a2 2 0 002.526-1.414l.392-1.177a2 2 0 00-.925-2.472z" /></svg>
				</div>
				<h3 class="text-lg font-black uppercase tracking-tighter text-surface-900 dark:text-surface-50">Apreensão de Drogas (P10)</h3>
			</div>
			<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
				<div class="space-y-4">
					{#each Object.entries(stats.drogasPorTipo).sort((a,b) => b[1] - a[1]) as [tipo, peso]}
						<div class="space-y-1">
							<div class="flex justify-between text-[0.6rem] font-black uppercase">
								<span>{tipo}</span> <span class="text-error-500">{peso.toLocaleString()}g</span>
							</div>
							<div class="h-1.5 w-full bg-surface-100 dark:bg-surface-800 rounded-full overflow-hidden">
								<div class="h-full bg-error-500 transition-all duration-1000" style="width: {(peso / (stats.drogasGeral || 1) * 100) || 0}%"></div>
							</div>
						</div>
					{:else}
						<p class="text-center text-xs text-surface-400 italic py-8">Sem registros.</p>
					{/each}
				</div>
				<div class="bg-surface-950 p-6 rounded-3xl flex flex-col items-center justify-center text-center">
					<p class="text-[0.5rem] font-black uppercase tracking-widest text-surface-500 mb-1">Massa Total</p>
					<h4 class="text-4xl font-black text-white">{(stats.drogasGeral / 1000).toFixed(2)}</h4>
					<p class="text-xs font-bold text-error-500">KILOGRAMAS</p>
				</div>
			</div>
		</div>
	</section>

	<!-- Secondary Analytics -->
	<section class="grid grid-cols-1 md:grid-cols-3 gap-6">
		<div class="md:col-span-1 space-y-4">
			<div class="card p-6 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-3xl shadow-sm">
				<p class="text-[0.6rem] font-black text-surface-400 uppercase mb-4">Procedimentos (P4)</p>
				<h3 class="text-3xl font-black text-surface-900 dark:text-surface-50">{stats.procedimentos}</h3>
				<p class="text-[0.6rem] font-medium text-surface-500">Flagrantes lavrados</p>
			</div>
			<div class="card p-6 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-3xl shadow-sm">
				<p class="text-[0.6rem] font-black text-surface-400 uppercase mb-4">Apreensões ECA (P6)</p>
				<h3 class="text-3xl font-black text-surface-900 dark:text-surface-50">{stats.apreensoes}</h3>
				<p class="text-[0.6rem] font-medium text-surface-500">Menores em conflito</p>
			</div>
		</div>

		<div class="md:col-span-2 card p-4 sm:p-8 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-3xl shadow-sm">
			<div class="flex items-center gap-3 mb-6">
				<svg class="w-5 h-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
				<h3 class="text-lg font-black uppercase tracking-tighter text-surface-900 dark:text-surface-50">Últimos Resultados Operacionais</h3>
			</div>
			<div class="overflow-x-auto">
				<table class="w-full text-left">
					<thead class="text-[0.6rem] font-black text-surface-400 uppercase border-b border-surface-100 dark:border-surface-800">
						<tr><th class="pb-3">Regional</th><th class="pb-3 text-center">Data</th><th class="pb-3 text-right">Prisões</th><th class="pb-3 text-right">Mandados</th></tr>
					</thead>
					<tbody class="divide-y divide-surface-100 dark:divide-surface-800">
						{#each filteredData.slice(0, 5) as item}
							{@const res = JSON.parse(item.respostas || '{}')}
							<tr class="group">
								<td class="py-3 text-xs font-bold text-surface-800 dark:text-surface-200 uppercase">{item.seccional_nome}</td>
								<td class="py-3 text-center text-xs text-surface-500">{item.data_inicio?.split('-').reverse().join('/')}</td>
								<td class="py-3 text-right text-xs font-black text-rose-500">{res.prisoes_apreensoes_flagrante || 0}</td>
								<td class="py-3 text-right text-xs font-black text-emerald-500">{res.mandados_qtd || 0}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	</section>
</div>
