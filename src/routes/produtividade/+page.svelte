<script lang="ts">
	/**
	 * Painel de PRODUTIVIDADE: agrega as respostas dos formulários GISE em
	 * gráficos, rankings por unidade e detalhamentos exportáveis em PNG.
	 *
	 * A página recebe do servidor a LISTA CRUA de respostas (blobs JSON) e faz
	 * toda a agregação no cliente. É deliberado: os filtros recombinam os mesmos
	 * dados, e refazer a consulta a cada mexida de filtro seria uma ida ao
	 * servidor por clique.
	 *
	 * A barra tem DUAS linhas, e a divisão é semântica: em cima o que se compara
	 * (operação, eixo, quantas unidades, em que ordem) e embaixo o que entra na
	 * conta (tipo de equipe, período). Só os de baixo recortam dado — trocar de
	 * eixo não muda o total do painel, só a quebra.
	 *
	 * A cadeia de `$derived` mora em `_components/useProdutividade.svelte.ts`,
	 * nesta ordem por causa de custo:
	 *   filteredData → parsedData → stats / rankings / gráficos
	 * `parsedData` faz `JSON.parse` UMA vez por resposta; sem esse degrau, cada
	 * estatística e cada ranking reparsearia os mesmos blobs.
	 *
	 * As PERGUNTAS não são fixas: vêm do modelo salvo em
	 * `gise_modelo_formulario` e passam por `mapQuestions`, que descarta os tipos
	 * não graficáveis. Um formulário editado pelo assessor muda os gráficos sem
	 * tocar esta tela — e por isso nada aqui indexa resposta por posição.
	 *
	 * Chart.js entra por `import()` dinâmico (~200 KB): a página abre com os
	 * filtros e a tabela antes de a biblioteca chegar.
	 */
	import type { PageProps } from './$types';
	import { goto } from '$app/navigation';
	import { slide } from 'svelte/transition';
	import Spinner from '$lib/components/Spinner.svelte';
	import { useProdutividade } from './_components/useProdutividade.svelte';
	import SecaoRankings from './_components/SecaoRankings.svelte';
	import SecaoGraficos from './_components/SecaoGraficos.svelte';
	import SecaoIndicadores from './_components/SecaoIndicadores.svelte';

	const { data }: PageProps = $props();
	const p = useProdutividade(() => data);

	// A barra tem sete controles com três formas repetidas (rótulo, campo,
	// segmento). Constantes em vez de string repetida: era assim que o "Tipo de
	// equipe" e a "Seccional" já divergiam em padding entre si.
	const ROTULO =
		'text-3xs font-black uppercase tracking-widest text-surface-400 dark:text-surface-500 pl-0.5 block';
	const CAMPO =
		'w-full px-3 py-2.5 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-bold';
	const SEGMENTO = 'flex-1 rounded-lg py-1.5 text-xs font-bold transition-colors';
	const SEG_ON = 'bg-white dark:bg-surface-700 shadow text-primary-600';
	const SEG_OFF = 'text-surface-600 dark:text-surface-400';
	/** Tipo de equipe que a operação não usa: visível, apagado e sem clique. */
	const SEG_OFF_DISABLED = 'opacity-40 cursor-not-allowed';
</script>

<svelte:head>
	<title>Produtividade — Escalas PC-CE</title>
</svelte:head>

<div class="space-y-8 pb-12 {p.selectedCharts.length > 0 ? 'has-selections' : ''}">
	<header class="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
		<div class="space-y-1">
			<h1 class="h1 text-2xl font-bold">
				Produção {p.filterTipo === 'seint' ? 'Inteligência' : 'Operacional'}
			</h1>
			<p class="text-surface-600 dark:text-surface-400 font-medium">
				Análise filtrada e segmentada dos resultados reais {p.filterTipo === 'seint'
					? '(SEINT)'
					: '(P4-P19)'}
			</p>
			{#if p.data.escopoRestrito}
				<!-- O recorte é do SERVIDOR, e quem o vê precisa saber: sem este aviso,
				     um total menor parece queda de produtividade em vez de recorte. -->
				<p class="text-2xs text-surface-600 dark:text-surface-400 mt-1">
					Exibindo apenas os dados das unidades que você administra nesta operação.
				</p>
			{/if}
		</div>
		<div class="flex flex-col items-start gap-2">
			<span
				class="text-xs font-bold uppercase tracking-widest text-surface-400 dark:text-surface-500"
				>Baixar gráficos</span
			>
			<div class="flex flex-wrap items-center gap-3">
				{#if p.allChartsCount > 0}
					<button
						type="button"
						class="btn text-3xs font-black uppercase tracking-widest px-4 py-2 rounded-xl transition-colors {p
							.selectedCharts.length >= p.allChartsCount
							? 'bg-surface-900 dark:bg-surface-50 text-white dark:text-surface-950'
							: 'bg-surface-200/60 dark:bg-surface-800/60 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700'}"
						onclick={p.selectAllCharts}
					>
						{p.selectedCharts.length >= p.allChartsCount
							? 'Desmarcar Todos'
							: `Selecionar Todos (${p.allChartsCount})`}
					</button>
				{/if}

				<button
					type="button"
					class="btn {p.selectedCharts.length > 0
						? 'bg-error-600 hover:bg-error-700 text-white'
						: 'bg-surface-200/80 dark:bg-surface-800/80 text-surface-500 dark:text-surface-400 cursor-not-allowed'} text-3xs font-black uppercase py-2 px-6 rounded-xl transition-colors flex items-center gap-2"
					onclick={p.exportChartsAsImages}
					disabled={p.selectedCharts.length === 0 || p.exporting}
				>
					{#if p.exporting}
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
						Baixar (imagem){p.selectedCharts.length > 0 ? ` (${p.selectedCharts.length})` : ''}
					{/if}
				</button>

				<button
					type="button"
					class="export-btn btn {p.selectedCharts.length > 0
						? 'bg-secondary-600 hover:bg-secondary-700 text-white'
						: 'bg-surface-200/80 dark:bg-surface-800/80 text-surface-500 dark:text-surface-400 cursor-not-allowed'} text-3xs font-black uppercase py-2 px-6 rounded-xl transition-colors flex items-center gap-2"
					onclick={() => window.print()}
					disabled={p.selectedCharts.length === 0}
				>
					<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="3"
							d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
						/></svg
					>
					Baixar (PDF){p.selectedCharts.length > 0 ? ` (${p.selectedCharts.length})` : ''}
				</button>
			</div>
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
				class="inline-flex items-center gap-1.5 rounded-xl border border-surface-300/80 bg-white px-3 py-1.5 text-xs font-semibold text-surface-700 transition-colors hover:border-primary-400/50 hover:bg-primary-500/5 dark:border-surface-600/80 dark:bg-surface-800 dark:text-surface-200 dark:hover:bg-surface-700/80 {p.mostrarFiltros
					? 'border-primary-500/50 bg-primary-500/5 dark:border-primary-500/40 dark:bg-primary-500/10'
					: ''}"
				onclick={() => (p.mostrarFiltros = !p.mostrarFiltros)}
				aria-expanded={p.mostrarFiltros}
			>
				<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
					/>
				</svg>
				{p.mostrarFiltros ? 'Ocultar filtros' : 'Filtros'}
				{#if p.filtrosAtivos}
					<span class="h-1.5 w-1.5 rounded-full bg-primary-500"></span>
				{/if}
			</button>
		</div>

		{#if p.mostrarFiltros}
			<section
				class="overflow-hidden rounded-3xl border border-surface-200 bg-white dark:border-surface-800 dark:bg-surface-900"
				transition:slide={{ duration: 250 }}
			>
				<div class="space-y-4 p-4 sm:p-5">
					<!-- LINHA 1 — o que se compara: operação, eixo, quantas unidades e
					     em que sentido. Os três últimos não recortam dado nenhum: só
					     mudam a quebra e a ordem da MESMA lista. -->
					<div class="grid grid-cols-1 gap-4 lg:grid-cols-12 items-end">
						<!-- Operação: navega (recarrega o `load`), porque trocar de operação
						     troca os MODELOS e as linhas de base — não é um recorte da
						     mesma lista, como os demais controles desta barra. -->
						{#if (p.data.operacoes ?? []).length > 1}
							<div class="space-y-1.5 lg:col-span-3">
								<label for="f-op" class={ROTULO}>Operação</label>
								<select
									id="f-op"
									value={p.data.operacaoSelecionadaId ?? ''}
									onchange={(e) => goto(`/produtividade?operacaoId=${e.currentTarget.value}`)}
									class={CAMPO}
								>
									{#each p.data.operacoes ?? [] as op (op.id)}
										<option value={op.id}>{op.nome}</option>
									{/each}
								</select>
							</div>
						{/if}

						<div class="space-y-1.5 lg:col-span-3">
							<p class={ROTULO}>Visualizar por</p>
							<div class="inline-flex w-full rounded-xl bg-surface-100 dark:bg-surface-800 p-1">
								<button
									type="button"
									class="{SEGMENTO} {p.modoVisualizacao === 'delegacias' ? SEG_ON : SEG_OFF}"
									onclick={() => (p.modoVisualizacao = 'delegacias')}>Delegacias</button
								>
								<button
									type="button"
									class="{SEGMENTO} {p.modoVisualizacao === 'seccionais' ? SEG_ON : SEG_OFF}"
									onclick={() => (p.modoVisualizacao = 'seccionais')}>Seccionais</button
								>
							</div>
						</div>

						<div class="space-y-1.5 lg:col-span-3">
							<label for="f-qtd" class={ROTULO}>Quantidade de unidades</label>
							<select
								id="f-qtd"
								value={String(p.quantidade)}
								onchange={(e) =>
									(p.quantidade =
										e.currentTarget.value === 'todas'
											? 'todas'
											: (Number(e.currentTarget.value) as 5 | 10))}
								class={CAMPO}
							>
								<option value="5">5 unidades</option>
								<option value="10">10 unidades</option>
								<option value="todas">Todas</option>
							</select>
						</div>

						<div class="space-y-1.5 lg:col-span-3">
							<label for="f-ordem" class={ROTULO}>Ordem</label>
							<select id="f-ordem" bind:value={p.ordem} class={CAMPO}>
								<option value="melhores">Melhores primeiro</option>
								<option value="piores">Piores primeiro</option>
							</select>
						</div>
					</div>

					<!-- LINHA 2 — o que entra na conta: recortes de verdade sobre os dados. -->
					<div
						class="grid grid-cols-1 gap-4 lg:grid-cols-12 items-end border-t border-surface-200/70 dark:border-white/10 pt-4"
					>
						<div class="space-y-1.5 lg:col-span-4">
							<p class={ROTULO}>Tipo de equipe</p>
							<div class="inline-flex w-full rounded-xl bg-surface-100 dark:bg-surface-800 p-1">
								<!-- Desabilitado, e não escondido: o botão apagado diz que a
								     operação NÃO tem aquele tipo de equipe. Escondê-lo faria a
								     barra parecer diferente sem explicar por quê. -->
								<button
									type="button"
									disabled={!p.tiposDisponiveis.includes('operacional')}
									title={p.tiposDisponiveis.includes('operacional')
										? undefined
										: 'Esta operação não usa equipe operacional'}
									class="{SEGMENTO} {p.filterTipo === 'operacional'
										? SEG_ON
										: SEG_OFF} {p.tiposDisponiveis.includes('operacional') ? '' : SEG_OFF_DISABLED}"
									onclick={() => (p.filterTipo = 'operacional')}>Operacional</button
								>
								<button
									type="button"
									disabled={!p.tiposDisponiveis.includes('seint')}
									title={p.tiposDisponiveis.includes('seint')
										? undefined
										: 'Esta operação não usa equipe de inteligência'}
									class="{SEGMENTO} {p.filterTipo === 'seint'
										? SEG_ON
										: SEG_OFF} {p.tiposDisponiveis.includes('seint') ? '' : SEG_OFF_DISABLED}"
									onclick={() => (p.filterTipo = 'seint')}>Inteligência</button
								>
							</div>
						</div>

						<div class="space-y-1.5 lg:col-span-8">
							<label for="f-ano" class={ROTULO}>Período</label>
							<div class="flex flex-wrap lg:flex-nowrap items-end gap-2">
								<select
									id="f-ano"
									bind:value={p.filterAno}
									class="w-full lg:w-auto min-w-[120px] px-3 py-2.5 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-bold"
								>
									{#each p.anos as ano (ano)}
										<option value={String(ano)}>{ano}</option>
									{/each}
									<option value="personalizado">Personalizado</option>
								</select>

								{#if p.filterAno === 'personalizado'}
									<div class="flex items-end gap-2 w-full lg:w-auto">
										<div class="space-y-0.5 flex-1 lg:flex-initial">
											<label
												for="f-ini"
												class="text-3xs font-black text-surface-600 dark:text-surface-400 uppercase tracking-widest block pl-0.5"
												>De</label
											>
											<input
												id="f-ini"
												type="date"
												bind:value={p.filterInicio}
												class="w-full px-3 py-2 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-bold"
											/>
										</div>
										<span class="text-surface-400 pb-2">—</span>
										<div class="space-y-0.5 flex-1 lg:flex-initial">
											<label
												for="f-fim"
												class="text-3xs font-black text-surface-600 dark:text-surface-400 uppercase tracking-widest block pl-0.5"
												>Até</label
											>
											<input
												id="f-fim"
												type="date"
												bind:value={p.filterFim}
												class="w-full px-3 py-2 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-bold"
											/>
										</div>
									</div>
								{/if}
							</div>
						</div>
					</div>
				</div>
			</section>
		{/if}
	</div>

	<!-- Antes dos rankings e dos gráficos por pergunta: é a leitura que a
	     operação existe para produzir ("chegamos onde prometemos?"), e o resto
	     é o detalhamento dela. -->
	<SecaoIndicadores paineis={p.paineisIndicadores} Chart={p.ChartCtor} />

	{#if p.filterTipo === 'operacional'}
		<SecaoRankings
			rankingPrisoes={p.rankingPrisoes}
			rankingDrogasPeso={p.rankingDrogasPeso}
			rankingArmas={p.rankingArmas}
			stats={p.stats}
			rotuloGrupo={p.modoVisualizacao === 'delegacias' ? 'Delegacia' : 'Seccional'}
			selectedCharts={p.selectedCharts}
			onToggle={p.toggleChartSelection}
		/>
	{/if}

	<SecaoGraficos
		questions={p.QUESTIONS}
		stats={p.stats}
		parsedData={p.parsedData}
		canvasElements={p.canvasElements}
		selectedCharts={p.selectedCharts}
		modoVisualizacao={p.modoVisualizacao}
		onToggle={p.toggleChartSelection}
	/>
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
</style>
