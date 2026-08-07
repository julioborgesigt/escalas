<script lang="ts">
	/**
	 * Grade de gráficos Chart.js + totais por pergunta do modelo.
	 * Canvas bound via `canvasElements` do composable `useCharts`.
	 */
	import { Check, Plus } from '@lucide/svelte';
	import type { Question } from '$lib/produtividade';
	import type { ProdutividadeParsedRow } from './useProdutividade.svelte';

	const {
		questions,
		stats,
		parsedData,
		canvasElements,
		selectedCharts,
		filterSeccional,
		onToggle
	}: {
		questions: Question[];
		stats: Record<string, unknown> & {
			drogasGeral: number;
		};
		parsedData: ProdutividadeParsedRow[];
		canvasElements: Record<number, HTMLCanvasElement>;
		selectedCharts: (number | string)[];
		filterSeccional: string;
		onToggle: (id: string | number) => void;
	} = $props();
</script>

<section class="space-y-8">
	{#each questions as q (q.id)}
		<div
			class="card relative p-4 sm:p-6 lg:p-8 bg-white dark:bg-surface-900 border-2 transition-all {selectedCharts.includes(
				q.id
			)
				? 'selected-for-export border-primary-500 shadow-xl shadow-primary-500/10'
				: 'border-surface-100 dark:border-surface-800 shadow-sm'} rounded-3xl overflow-hidden flex flex-col md:flex-row gap-4"
		>
			<button
				type="button"
				onclick={() => onToggle(q.id)}
				aria-pressed={selectedCharts.includes(q.id)}
				aria-label={selectedCharts.includes(q.id)
					? 'Remover gráfico da seleção de exportação'
					: 'Selecionar gráfico para exportação'}
				class="absolute top-2 right-2 md:top-3 md:right-3 w-6 h-6 md:w-8 md:h-8 rounded-lg md:rounded-xl flex items-center justify-center transition-all {selectedCharts.includes(
					q.id
				)
					? 'bg-primary-500 text-white scale-110 shadow-lg'
					: 'bg-surface-100 dark:bg-surface-800 text-surface-500 hover:scale-105'}"
			>
				{#if selectedCharts.includes(q.id)}
					<Check class="w-4 h-4 md:w-6 md:h-6" strokeWidth={4} aria-hidden="true" />
				{:else}
					<Plus class="w-3 h-3 md:w-5 md:h-5 opacity-40" strokeWidth={3} aria-hidden="true" />
				{/if}
			</button>
			<div class="md:w-1/6 flex flex-col justify-center">
				<p
					class="text-3xs font-black text-surface-600 dark:text-surface-400 uppercase tracking-widest mb-1"
				>
					{q.label}
				</p>
				<h3 class="text-5xl font-black" style="color: {q.color}">
					{#if q.specialStore === 'drogasGeral'}
						{(stats.drogasGeral / 1000).toFixed(2)}<span class="text-sm ml-1 opacity-60">kg</span>
					{:else if q.isBool}
						{parsedData.filter((i) => i.respostasParsed[q.key] === 'Sim').length}
					{:else}
						{stats[q.key] ??
							parsedData.reduce(
								(acc: number, i) => acc + (Number(i.respostasParsed[q.key]) || 0),
								0
							)}
					{/if}
				</h3>
				<div class="mt-4 flex gap-2">
					<span
						class="text-3xs font-bold px-2 py-1 rounded uppercase bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400"
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
