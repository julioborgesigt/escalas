<script lang="ts">
	/**
	 * Paginação de `/auditoria` e `/auditoria/logs` — mesmo bloco Anterior/Próxima
	 * nas duas telas, cada uma com sua própria `queryString()` que preserva
	 * filtros. `href` é a função de montagem do link, não a página em si.
	 */
	const {
		page,
		totalPages,
		href
	}: {
		page: number;
		totalPages: number;
		href: (page: number) => string;
	} = $props();
</script>

{#if totalPages > 1}
	<div class="flex items-center justify-center gap-2">
		{#if page > 1}
			<a href={href(page - 1)} class="btn preset-outlined-surface-500 text-sm"> Anterior </a>
		{/if}
		<span class="text-sm text-surface-600 dark:text-surface-400">
			Página {page} de {totalPages}
		</span>
		{#if page < totalPages}
			<a href={href(page + 1)} class="btn preset-outlined-surface-500 text-sm"> Próxima </a>
		{/if}
	</div>
{/if}
