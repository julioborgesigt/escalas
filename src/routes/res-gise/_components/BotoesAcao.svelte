<script module lang="ts">
	/**
	 * Snippets de botão compartilhados pelas telas de `/res-gise`.
	 *
	 * Os mesmos 29 linhas (`btnIcon` + `actionButton`) estavam copiados byte a
	 * byte em `+page.svelte`, `ConfigurarFormulario.svelte` e
	 * `FormularioServico.svelte`. Snippets declarados no topo de um `.svelte`
	 * podem ser exportados pelo `<script module>` desde que não referenciem
	 * nada do `<script>` de instância — por isso o `loading` é importado aqui.
	 * https://svelte.dev/docs/svelte/snippet
	 */
	import { loading } from '$lib/loading.svelte';

	export { btnIcon, actionButton };
</script>

{#snippet btnIcon(path: string)}
	<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
		<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d={path} />
	</svg>
{/snippet}

{#snippet actionButton(
	label: string,
	iconPath?: string,
	variant = 'primary',
	type = 'outlined',
	onclick?: ((e: MouseEvent) => void) | undefined,
	disabled = false,
	loadingState = false,
	classes = '',
	btnType: 'button' | 'submit' = 'button',
	size = 'sm'
)}
	{@const baseClass = `btn btn-${size} preset-${type}-${variant}-500 rounded-xl font-bold whitespace-nowrap transition-all flex items-center justify-center gap-2 ${classes}`}
	<button
		type={btnType}
		class={baseClass}
		{onclick}
		disabled={disabled || loading.active || loadingState}
	>
		{#if iconPath}{@render btnIcon(iconPath)}{/if}
		<span>{loading.active && loadingState ? 'Carregando...' : label}</span>
	</button>
{/snippet}
