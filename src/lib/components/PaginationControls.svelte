<script lang="ts">
	import { Pagination } from '@skeletonlabs/skeleton-svelte';
	import { ChevronLeft, ChevronRight } from 'lucide-svelte';

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

	const itensInicio = $derived((paginaAtual - 1) * itensPorPagina + 1);
	const itensFim = $derived(Math.min(paginaAtual * itensPorPagina, totalItens));

	function handlePageChange(event: { page: number }) {
		onPageChange?.(event.page);
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}
</script>

<div class="mt-6 pt-6 border-t border-surface-200 dark:border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4">
	<p class="text-surface-500 text-xs px-1">
		Mostrando <strong>{totalItens > 0 ? itensInicio : 0}</strong>–<strong>{itensFim}</strong>
		de <strong>{totalItens}</strong> {totalItens === 1 ? labelSingular : labelPlural}
	</p>

	{#if totalPaginas > 1}
		<Pagination
			count={totalItens}
			pageSize={itensPorPagina}
			page={paginaAtual}
			onPageChange={handlePageChange}
			siblingCount={1}
		>
			<Pagination.PrevTrigger class="btn btn-sm preset-outlined-surface-500" aria-label="Página anterior">
				<ChevronLeft size={16} />
			</Pagination.PrevTrigger>

			<Pagination.Context>
				{#snippet children(pagination)}
					{#each pagination().pages as p, index (p)}
						{#if p.type === 'page'}
							<Pagination.Item
								{...p}
								class="btn btn-sm min-w-[32px] {p.value === paginaAtual
									? 'preset-filled-primary-500'
									: 'preset-outlined-surface-500'}"
							>
								{p.value}
							</Pagination.Item>
						{:else}
							<Pagination.Ellipsis {index} class="px-1 opacity-50">&#8230;</Pagination.Ellipsis>
						{/if}
					{/each}
				{/snippet}
			</Pagination.Context>

			<Pagination.NextTrigger class="btn btn-sm preset-outlined-surface-500" aria-label="Próxima página">
				<ChevronRight size={16} />
			</Pagination.NextTrigger>
		</Pagination>
	{/if}
</div>
