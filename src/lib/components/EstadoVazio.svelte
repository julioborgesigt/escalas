<script lang="ts">
	/**
	 * Empty state padrão de listagens: bloco centrado com padding e tom muted.
	 * Aceita `mensagem` simples ou `children` quando há CTA / markup extra.
	 */
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';

	const {
		mensagem,
		tom = 'default',
		class: className = '',
		children
	}: {
		mensagem?: string;
		/** `muted` = `text-surface-500` (ex.: TabelaServidores); default = 600/400. */
		tom?: 'muted' | 'default';
		class?: ClassValue;
		children?: Snippet;
	} = $props();

	const tomCls = $derived(
		tom === 'muted' ? 'text-surface-500' : 'text-surface-600 dark:text-surface-400'
	);
</script>

<div class={['text-center py-12', tomCls, className]}>
	{#if children}
		{@render children()}
	{:else if mensagem}
		<p>{mensagem}</p>
	{/if}
</div>
