<script lang="ts">
	/**
	 * Linhas de skeleton para tabelas durante navegação same-path (filtros).
	 * `cols` = classes completas do placeholder por coluna (altura + largura).
	 */
	const {
		rows = 8,
		cols
	}: {
		rows?: number;
		cols: string[];
	} = $props();
</script>

{#each { length: rows } as _, i (i)}
	<tr class="animate-pulse">
		{#each cols as col, j (`${i}-${j}`)}
			<td class="px-4 py-3">
				<div class="mx-auto rounded bg-surface-200 dark:bg-surface-700 {col}"></div>
			</td>
		{/each}
	</tr>
{/each}
