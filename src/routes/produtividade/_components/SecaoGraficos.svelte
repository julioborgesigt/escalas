<script lang="ts">
	/**
	 * Grade de gráficos Chart.js + o total de cada pergunta marcada com a forma
	 * COLUNAS. Canvas bound via `canvasElements` do composable `useCharts`.
	 *
	 * O número grande vem de `stats[q.key]`, e não de uma conta local: quem soma é
	 * `valorDaResposta` (`$lib/produtividade/apresentacao`), o mesmo que desenha a
	 * barra. Este componente já teve a sua própria soma — contando `'Sim'` para
	 * booleanas e lendo `drogasGeral` para drogas — e era a quarta cópia da regra.
	 */
	import Check from '@lucide/svelte/icons/check';
	import Plus from '@lucide/svelte/icons/plus';
	import type { Question } from '$lib/produtividade';

	const {
		questions,
		stats,
		canvasElements,
		selectedCharts,
		modoVisualizacao,
		onToggle
	}: {
		questions: Question[];
		stats: Record<string, unknown>;
		canvasElements: Record<number, HTMLCanvasElement>;
		selectedCharts: (number | string)[];
		modoVisualizacao: 'delegacias' | 'seccionais';
		onToggle: (id: string | number) => void;
	} = $props();
</script>

<section class="space-y-8">
	{#each questions as q (q.id)}
		{@const total = Number(stats[q.key]) || 0}
		<div
			class="card relative p-4 sm:p-6 lg:p-8 bg-white dark:bg-surface-900 border-2 transition-colors {selectedCharts.includes(
				q.id
			)
				? 'selected-for-export border-primary-500'
				: 'border-surface-200 dark:border-surface-800'} rounded-3xl overflow-hidden flex flex-col md:flex-row gap-4"
		>
			<button
				type="button"
				onclick={() => onToggle(q.id)}
				aria-pressed={selectedCharts.includes(q.id)}
				aria-label={selectedCharts.includes(q.id)
					? 'Remover gráfico da seleção de exportação'
					: 'Selecionar gráfico para exportação'}
				class="absolute top-2 right-2 md:top-3 md:right-3 w-6 h-6 md:w-8 md:h-8 rounded-lg md:rounded-xl flex items-center justify-center transition-colors {selectedCharts.includes(
					q.id
				)
					? 'bg-primary-500 text-white'
					: 'bg-surface-100 dark:bg-surface-800 text-surface-500'}"
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
					<!-- Peso é somado em gramas e lido em quilos — a unidade vem da
					     pergunta, não do card. Ver `identidadeDaPergunta`. -->
					{#if q.unidade === 'g'}
						{(total / 1000).toFixed(2)}<span class="text-sm ml-1 opacity-60">kg</span>
					{:else}
						{total.toLocaleString('pt-BR')}
					{/if}
				</h3>
				<div class="mt-4 flex gap-2">
					<span
						class="text-3xs font-bold px-2 py-1 rounded uppercase bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400"
					>
						{modoVisualizacao === 'delegacias'
							? 'Comparação por delegacia'
							: 'Comparação por seccional'}
					</span>
				</div>
			</div>
			<div class="flex-1 min-h-[250px] w-full">
				<canvas bind:this={canvasElements[q.id]}></canvas>
			</div>
		</div>
	{/each}
</section>
