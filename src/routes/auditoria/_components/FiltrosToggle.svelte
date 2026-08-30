<script lang="ts">
	/**
	 * Cabeçalho do painel de filtros de `/auditoria` e `/auditoria/logs` —
	 * badge de "N ativos" + botão de mostrar/ocultar em telas pequenas
	 * (o `lg:hidden` some no desktop, onde o painel já fica expandido).
	 */
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';

	let {
		ativos,
		expandidos = $bindable()
	}: {
		ativos: number;
		expandidos: boolean;
	} = $props();
</script>

<div class="flex items-center justify-between">
	<div class="flex items-center gap-2">
		<span class="font-semibold text-surface-900 dark:text-white">Filtros</span>
		{#if ativos > 0}
			<span class="badge preset-filled-primary-500 text-xs">
				{ativos}
				{ativos === 1 ? 'ativo' : 'ativos'}
			</span>
		{/if}
	</div>
	<button
		type="button"
		onclick={() => (expandidos = !expandidos)}
		class="btn btn-sm preset-outlined-surface-500 lg:hidden flex items-center gap-1 text-xs py-1 px-2.5"
	>
		{#if expandidos}
			Ocultar Filtros
			<ChevronUp class="w-3.5 h-3.5" />
		{:else}
			Mostrar Filtros
			<ChevronDown class="w-3.5 h-3.5" />
		{/if}
	</button>
</div>
