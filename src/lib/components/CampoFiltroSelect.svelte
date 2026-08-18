<script lang="ts">
	/**
	 * Campo de filtro rotulado (label + `SearchableSelect`) — o mesmo par
	 * repetido em toda barra de filtros com dropdown de busca (painel,
	 * recebidos: Seccional/Unidade/Ano/Mês).
	 */
	import SearchableSelect from './SearchableSelect.svelte';

	type Option = { value: unknown; label: string };

	let {
		label,
		width = '',
		options,
		value = $bindable<unknown>(null),
		ariaLabel,
		placeholder = 'Selecione...'
	}: {
		label: string;
		/** Classe(s) de largura no breakpoint lg, ex.: "lg:w-36". */
		width?: string;
		options: Option[];
		value: unknown;
		ariaLabel: string;
		placeholder?: string;
	} = $props();
</script>

<div class="flex flex-col gap-1 w-full {width}">
	<span class="label-text text-sm font-semibold">{label}</span>
	<SearchableSelect {options} bind:value {ariaLabel} {placeholder} />
</div>
