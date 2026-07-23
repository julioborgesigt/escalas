<script lang="ts">
	import { Switch } from '@skeletonlabs/skeleton-svelte';
	import type { Snippet } from 'svelte';

	/**
	 * Chave liga/desliga estilizada sobre o `Switch` (headless) do Skeleton v4.
	 * Centraliza o estilo do toggle (trilho + thumb, verde quando ligado) para
	 * não repetir as classes de `data-[state=...]` em cada call site.
	 */
	interface Props {
		checked: boolean;
		disabled?: boolean;
		onCheckedChange?: (checked: boolean) => void;
		/** Conteúdo do rótulo ao lado da chave (opcional). */
		children?: Snippet;
		/** Rótulo à ESQUERDA e a chave à direita, ocupando a largura toda. */
		reverse?: boolean;
	}

	const { checked, disabled = false, onCheckedChange, children, reverse = false }: Props = $props();
</script>

<Switch
	{checked}
	{disabled}
	onCheckedChange={(e) => onCheckedChange?.(e.checked)}
	class="inline-flex items-center gap-2.5 rounded-full focus-within:ring-2 focus-within:ring-primary-500 focus-within:ring-offset-1 focus-within:ring-offset-surface-50 dark:focus-within:ring-offset-surface-900 {reverse
		? 'w-full flex-row-reverse justify-between'
		: ''} {disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}"
>
	<Switch.Control
		class="inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors bg-surface-300 dark:bg-surface-600 data-[state=checked]:bg-success-500"
	>
		<Switch.Thumb
			class="h-5 w-5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-5"
		/>
	</Switch.Control>
	{#if children}
		<Switch.Label>{@render children()}</Switch.Label>
	{/if}
	<Switch.HiddenInput />
</Switch>
