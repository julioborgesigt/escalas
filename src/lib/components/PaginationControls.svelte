<script lang="ts">
	interface Props {
		paginaAtual: number;
		totalPaginas: number;
		totalItens: number;
		itensPorPagina?: number;
		labelSingular?: string;
		labelPlural?: string;
		onPageChange?: (pagina: number) => void;
	}

	let {
		paginaAtual,
		totalPaginas,
		totalItens,
		itensPorPagina = 10,
		labelSingular = 'escala',
		labelPlural = 'escala(s)',
		onPageChange
	}: Props = $props();

	function irParaPagina(p: number) {
		if (p < 1 || p > totalPaginas) return;
		onPageChange?.(p);
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	const itensInicio = $derived((paginaAtual - 1) * itensPorPagina + 1);
	const itensFim = $derived(Math.min(paginaAtual * itensPorPagina, totalItens));
</script>

<div
	class="mt-6 pt-6 border-t border-surface-200 dark:border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4"
>
	<p class="text-surface-500 text-xs px-1">
		Mostrando <strong>{totalItens > 0 ? itensInicio : 0}</strong>-<strong>{itensFim}</strong>
		de <strong>{totalItens}</strong> {totalItens === 1 ? labelSingular : labelPlural}
	</p>

	{#if totalPaginas > 1}
		<div class="flex items-center gap-2">
			<button type="button"
				class="btn btn-sm preset-outlined-surface"
				onclick={() => irParaPagina(paginaAtual - 1)}
				disabled={paginaAtual === 1}
			>
				Anterior
			</button>

			<div class="flex items-center gap-1">
				{#each Array.from({ length: totalPaginas }, (_, i) => i + 1) as p}
					{#if totalPaginas <= 5 || p === 1 || p === totalPaginas || (p >= paginaAtual - 1 && p <= paginaAtual + 1)}
						<button type="button"
							class="btn btn-sm {paginaAtual === p
								? 'preset-filled-primary-500'
								: 'preset-outlined-surface'} min-w-[32px]"
							onclick={() => irParaPagina(p)}
						>
							{p}
						</button>
					{:else if (p === 2 && paginaAtual > 3) || (p === totalPaginas - 1 && paginaAtual < totalPaginas - 2)}
						<span class="px-1 opacity-50">...</span>
					{/if}
				{/each}
			</div>

			<button type="button"
				class="btn btn-sm preset-outlined-surface"
				onclick={() => irParaPagina(paginaAtual + 1)}
				disabled={paginaAtual >= totalPaginas}
			>
				Próxima
			</button>
		</div>
	{/if}
</div>
