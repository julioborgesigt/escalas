<script lang="ts">
	/**
	 * Os BOTÕES de paginação — anterior, números, reticências, próxima.
	 *
	 * Só o controle: sem contador ("Exibindo X–Y de Z") e sem container. Cada
	 * tela tem o seu texto e o seu espaçamento, e forçá-los a props deixaria a
	 * API pior do que a duplicação. O que estava copiado em quatro lugares — e é
	 * o que este componente centraliza — eram as ~35 linhas de `Pagination.*`
	 * com as classes de estilo dos botões.
	 *
	 * `page` é controlado pelo pai: o componente não guarda estado, só avisa a
	 * mudança por `onPageChange`.
	 */
	import { Pagination } from '@skeletonlabs/skeleton-svelte';
	import { ChevronLeft, ChevronRight } from 'lucide-svelte';

	const {
		count,
		pageSize,
		page,
		onPageChange
	}: {
		count: number;
		pageSize: number;
		page: number;
		onPageChange: (pagina: number) => void;
	} = $props();
</script>

<Pagination {count} {pageSize} {page} onPageChange={(e) => onPageChange(e.page)} siblingCount={1}>
	<Pagination.PrevTrigger
		class="btn btn-sm preset-outlined-surface-500"
		aria-label="Página anterior"
	>
		<ChevronLeft size={16} />
	</Pagination.PrevTrigger>

	<Pagination.Context>
		{#snippet children(pagination)}
			{#each pagination().pages as p, index (p)}
				{#if p.type === 'page'}
					<Pagination.Item
						{...p}
						class="btn btn-sm min-w-[32px] {p.value === page
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

	<Pagination.NextTrigger
		class="btn btn-sm preset-outlined-surface-500"
		aria-label="Próxima página"
	>
		<ChevronRight size={16} />
	</Pagination.NextTrigger>
</Pagination>
