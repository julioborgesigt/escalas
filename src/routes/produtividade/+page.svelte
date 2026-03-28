<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import Chart from 'chart.js/auto';

	let { data } = $props();
	
	// Filters
	let filterSeccional = $state('');
	let filterInicio = $state('');
	let filterFim = $state('');

	// Derived Data (Exclusive to "Operacional" teams as requested)
	let filteredData = $derived(
		(data.lista || []).filter((item: any) => {
			const date = item.data_inicio;
			if (item.equipe_tipo !== 'operacional') return false; // Filter only Operacional
			if (filterSeccional && item.seccional_id !== Number(filterSeccional)) return false;
			if (filterInicio && date < filterInicio) return false;
			if (filterFim && date > filterFim) return false;
			return true;
		})
	);

	// Stats Calculation based on the 19 questions (specifically 4-19)
	let stats = $derived.by(() => {
		let s = { 
			procedimentos: 0, // Q4
			mandados: 0,      // Q5
			apreensoes: 0,    // Q6
			presos: 0,        // Q7
			armas: 0,         // Q11
			local_crime: 0,   // Q12
			ordem_missao: 0,  // Q13
			abordagens: 0,    // Q18
			oitivas: 0,       // Q15
			drogasGeral: 0,   // Q10 (g)
			drogasPorTipo: {} as Record<string, number>
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

	let chartEvolucao: any;
	let chartResumo: any;
	let canvasEvolucao: HTMLCanvasElement;
	let canvasResumo: HTMLCanvasElement;

	function updateCharts(list: any[]) {
		if (!canvasEvolucao || !canvasResumo) return;

		// 1. Evolução da Produção Bruta (Soma de resultados chaves: Mandados + Presos + Armas)
		const evolucaoMap = new Map();
		list.forEach((item: any) => {
			const d = item.data_inicio;
			const res = JSON.parse(item.respostas || '{}');
			const producao = (Number(res.mandados_qtd) || 0) + (Number(res.prisoes_apreensoes_flagrante) || 0) + (Number(res.apreensoes_armas) || 0);
			evolucaoMap.set(d, (evolucaoMap.get(d) || 0) + producao);
		});
		const sortedDates = Array.from(evolucaoMap.keys()).sort();
		
		if (chartEvolucao) chartEvolucao.destroy();
		chartEvolucao = new Chart(canvasEvolucao, {
			type: 'line',
			data: {
				labels: sortedDates.map((d: any) => d.split('-').reverse().join('/')),
				datasets: [{
					label: 'Volume de Produção (Presos+Mandados+Armas)',
					data: sortedDates.map(d => evolucaoMap.get(d)),
					borderColor: '#10b981',
					backgroundColor: 'rgba(16, 185, 129, 0.1)',
					tension: 0.4,
					fill: true,
					pointRadius: 4,
					pointHoverRadius: 6
				}]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				plugins: { legend: { display: false } },
				scales: { y: { beginAtZero: true } }
			}
		});

		// 2. Resumo Comparativo das 19 Perguntas (Principais Pontos Operacionais)
		if (chartResumo) chartResumo.destroy();
		chartResumo = new Chart(canvasResumo, {
			type: 'bar',
			data: {
				labels: ['Procedimentos', 'Mandados', 'Apreensões ECA', 'Prisões Flagrante', 'Armas', 'Intervenções Crime', 'Abordagens', 'Oitivas'],
				datasets: [{
					label: 'Acumulado Total',
					data: [
						stats.procedimentos,
						stats.mandados,
						stats.apreensoes,
						stats.presos,
						stats.armas,
						stats.local_crime,
						stats.abordagens,
						stats.oitivas
					],
					backgroundColor: [
						'#3b82f6', '#10b981', '#f59e0b', '#ef4444', 
						'#8b5cf6', '#06b6d4', '#ec4899', '#6366f1'
					],
					borderRadius: 12
				}]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				plugins: { legend: { display: false } },
				scales: { 
					x: { ticks: { font: { size: 10, weight: 'bold' } } },
					y: { beginAtZero: true }
				}
			}
		});
	}

	$effect(() => {
		untrack(() => updateCharts(filteredData));
	});

	onMount(() => {
		updateCharts(filteredData);
	});
</script>

<div class="space-y-8 pb-12">
	<header class="flex flex-col md:flex-row md:items-center justify-between gap-6">
		<div class="space-y-1">
			<h1 class="text-4xl font-black text-surface-900 dark:text-surface-50 uppercase tracking-tighter">Produção Operacional GISE</h1>
			<p class="text-surface-500 font-medium">Análise fiel das 19 perguntas de produtividade (P4-P19)</p>
		</div>
		
		<div class="flex gap-2">
			<button class="btn preset-filled-surface-200 dark:preset-filled-surface-800 text-xs font-bold uppercase py-3 px-6 rounded-2xl" onclick={() => window.print()}>
				<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
				Exportar PDF
			</button>
		</div>
	</header>

	<!-- Filters -->
	<section class="card p-6 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-3xl shadow-sm transition-all hover:shadow-md">
		<div class="grid grid-cols-1 md:grid-cols-3 gap-6">
			<div class="space-y-1.5">
				<label for="f-sec" class="text-[0.6rem] font-black text-surface-400 uppercase tracking-widest pl-1">Seccional / Regional</label>
				<select id="f-sec" bind:value={filterSeccional} class="w-full px-4 py-3 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-bold focus:ring-2 focus:ring-primary-500 transition-all">
					<option value="">Todas as Regionais</option>
					{#each data.seccionais as sec}
						<option value={sec.id}>{sec.nome}</option>
					{/each}
				</select>
			</div>

			<div class="space-y-1.5">
				<label for="f-ini" class="text-[0.6rem] font-black text-surface-400 uppercase tracking-widest pl-1">Início do Período</label>
				<input id="f-ini" type="date" bind:value={filterInicio} class="w-full px-4 py-3 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-bold focus:ring-2 focus:ring-primary-500 transition-all" />
			</div>

			<div class="space-y-1.5">
				<label for="f-fim" class="text-[0.6rem] font-black text-surface-400 uppercase tracking-widest pl-1">Fim do Período</label>
				<input id="f-fim" type="date" bind:value={filterFim} class="w-full px-4 py-3 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-bold focus:ring-2 focus:ring-primary-500 transition-all" />
			</div>
		</div>
	</section>

	<!-- Principal Stats Grid -->
	<section class="grid grid-cols-2 lg:grid-cols-4 gap-6">
		<div class="card p-6 bg-surface-900 dark:bg-white text-white dark:text-surface-900 rounded-3xl shadow-xl overflow-hidden relative group">
			<p class="text-[0.6rem] font-black uppercase tracking-widest opacity-60">Prisões Flagrante (P7)</p>
			<h3 class="text-5xl font-black mt-2 leading-none">{stats.presos}</h3>
			<div class="mt-4 flex items-center gap-2 text-[0.6rem] font-bold text-emerald-400">
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg>
				Resultados Reais
			</div>
		</div>

		<div class="card p-6 border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 rounded-3xl shadow-sm">
			<p class="text-[0.6rem] font-black uppercase tracking-widest text-surface-400">Mandados Cumpridos (P5)</p>
			<h3 class="text-4xl font-black mt-2 text-surface-900 dark:text-surface-50">{stats.mandados}</h3>
			<p class="text-[0.6rem] mt-2 font-medium text-surface-500">Ordens judiciais</p>
		</div>

		<div class="card p-6 border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 rounded-3xl shadow-sm">
			<p class="text-[0.6rem] font-black uppercase tracking-widest text-surface-400">Procedimentos (P4)</p>
			<h3 class="text-4xl font-black mt-2 text-surface-900 dark:text-surface-50">{stats.procedimentos}</h3>
			<p class="text-[0.6rem] mt-2 font-medium text-surface-500">Flagrantes lavrados</p>
		</div>

		<div class="card p-6 border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 rounded-3xl shadow-sm">
			<p class="text-[0.6rem] font-black uppercase tracking-widest text-surface-400">Armas de Fogo (P11)</p>
			<h3 class="text-4xl font-black mt-2 text-surface-900 dark:text-surface-50">{stats.armas}</h3>
			<p class="text-[0.6rem] mt-2 font-medium text-surface-500">Apreensões totais</p>
		</div>
	</section>

	<!-- Main Analytics -->
	<section class="grid grid-cols-1 lg:grid-cols-2 gap-6">
		<!-- Summary Bar Chart -->
		<div class="card p-8 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-3xl shadow-sm">
			<div class="flex items-center justify-between mb-8">
				<h3 class="text-lg font-black uppercase tracking-tighter text-surface-900 dark:text-surface-50">Resumo por Ponto Operacional</h3>
				<span class="text-[0.6rem] font-bold text-primary-500 bg-primary-500/10 px-2 py-1 rounded">Questões 4 a 18</span>
			</div>
			<div class="h-[350px] w-full relative">
				<canvas bind:this={canvasResumo}></canvas>
			</div>
		</div>

		<!-- Evolution Line Chart -->
		<div class="card p-8 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-3xl shadow-sm">
			<div class="flex items-center justify-between mb-8">
				<h3 class="text-lg font-black uppercase tracking-tighter text-surface-900 dark:text-surface-50">Volume de Produção Bruta</h3>
				<span class="text-[0.6rem] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded">Produtividade x Tempo</span>
			</div>
			<div class="h-[350px] w-full relative">
				<canvas bind:this={canvasEvolucao}></canvas>
			</div>
		</div>
	</section>

	<section class="grid grid-cols-1 lg:grid-cols-3 gap-6">
		<!-- More Stats List -->
		<div class="lg:col-span-1 card p-8 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-3xl shadow-sm">
			<h3 class="text-lg font-black uppercase tracking-tighter text-surface-900 dark:text-surface-50 mb-6">Outras Métricas</h3>
			<div class="space-y-4">
				<div class="flex items-center justify-between p-4 bg-surface-50 dark:bg-surface-800/50 rounded-2xl">
					<span class="text-xs font-bold text-surface-500 uppercase">Apreensões ECA (P6)</span>
					<span class="text-lg font-black text-surface-900 dark:text-surface-50">{stats.apreensoes}</span>
				</div>
				<div class="flex items-center justify-between p-4 bg-surface-50 dark:bg-surface-800/50 rounded-2xl">
					<span class="text-xs font-bold text-surface-500 uppercase">Intervenções Crime (P12)</span>
					<span class="text-lg font-black text-surface-900 dark:text-surface-50">{stats.local_crime}</span>
				</div>
				<div class="flex items-center justify-between p-4 bg-surface-50 dark:bg-surface-800/50 rounded-2xl">
					<span class="text-xs font-bold text-surface-500 uppercase">Abordagens (P18)</span>
					<span class="text-lg font-black text-surface-900 dark:text-surface-50">{stats.abordagens}</span>
				</div>
				<div class="flex items-center justify-between p-4 bg-surface-50 dark:bg-surface-800/50 rounded-2xl">
					<span class="text-xs font-bold text-surface-500 uppercase">Oitivas Realizadas (P15)</span>
					<span class="text-lg font-black text-surface-900 dark:text-surface-50">{stats.oitivas}</span>
				</div>
			</div>
		</div>

		<!-- Drugs Section -->
		<div class="lg:col-span-2 card p-8 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-3xl shadow-sm">
			<div class="flex items-center gap-3 mb-8">
				<div class="p-2 bg-error-500/10 rounded-lg">
					<svg class="w-5 h-5 text-error-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a2 2 0 00-1.96 1.414l-.392 1.177a2 2 0 001.414 2.526l2.354.47a2 2 0 002.526-1.414l.392-1.177a2 2 0 00-.925-2.472zM4.572 15.428a2 2 0 011.022-.547l2.387-.477a2 2 0 011.96 1.414l.392 1.177a2 2 0 01-1.414 2.526l-2.354.47a2 2 0 01-2.526-1.414l-.392-1.177a2 2 0 01.925-2.472zM12 2a2 2 0 012 2v12a2 2 0 01-2 2 2 2 0 01-2-2V4a2 2 0 012-2z" /></svg>
				</div>
				<h3 class="text-lg font-black uppercase tracking-tighter text-surface-900 dark:text-surface-50">Produção de Apreensão (Drogas - P10)</h3>
			</div>

			<div class="grid grid-cols-1 md:grid-cols-2 gap-8">
				<div class="space-y-4">
					{#each Object.entries(stats.drogasPorTipo).sort((a,b) => b[1] - a[1]) as [tipo, peso]}
						<div class="space-y-1.5 p-3 hover:bg-surface-50 dark:hover:bg-surface-800/50 rounded-2xl transition-all">
							<div class="flex justify-between text-xs font-bold uppercase">
								<span class="text-surface-600">{tipo}</span>
								<span class="text-error-500">{peso.toLocaleString()}g</span>
							</div>
							<div class="h-2 w-full bg-surface-100 dark:bg-surface-800 rounded-full overflow-hidden">
								<div class="h-full bg-error-500 rounded-full transition-all duration-1000" style="width: {(peso / (stats.drogasGeral || 1) * 100) || 0}%"></div>
							</div>
						</div>
					{:else}
						<p class="text-center text-xs text-surface-400 italic py-12">Nenhuma apreensão detalhada registrada.</p>
					{/each}
				</div>
				
				<div class="bg-surface-900 p-8 rounded-[2.5rem] flex flex-col items-center justify-center text-center">
					<p class="text-[0.6rem] font-black uppercase tracking-[0.2em] text-surface-400 mb-2">Total Apreendido</p>
					<h4 class="text-4xl font-black text-white">{(stats.drogasGeral / 1000).toFixed(2)}</h4>
					<p class="text-xl font-bold text-error-500">KILOGRAMAS</p>
					<div class="mt-4 w-12 h-1 bg-error-500 rounded-full"></div>
				</div>
			</div>
		</div>
	</section>
</div>
