<script lang="ts">
	/**
	 * Recado quando a avançada em tela não é oferecida por falta de chave.
	 * No celular, o CTA leva a Meu Perfil. No desktop, o Token A3 permanece.
	 */
	import { mensagemConviteChave } from '$lib/chave-assinatura-ui';

	const { isMobile, compact = false }: { isMobile: boolean; compact?: boolean } = $props();
</script>

<p
	class="{compact ? 'text-3xs' : 'text-xs'} text-surface-600 dark:text-surface-400 leading-relaxed"
>
	{mensagemConviteChave(isMobile)}
	{#if isMobile}
		<a href="/perfil" class="underline hover:text-primary-500 font-semibold whitespace-nowrap"
			>Meu Perfil</a
		>
	{/if}
</p>
