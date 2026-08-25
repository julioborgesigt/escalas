<script lang="ts">
	/**
	 * Rodapé "Ou / Certificado Digital" nos modais de assinatura avançada no
	 * computador — oferece o caminho qualificado (Token A3) sem sair do fluxo.
	 */
	import KeyRound from '@lucide/svelte/icons/key-round';

	let {
		onAssinarToken,
		disabled = false
	}: {
		onAssinarToken: () => void;
		disabled?: boolean;
	} = $props();
</script>

<div class="mt-5 pt-5 border-t border-surface-200 dark:border-surface-700">
	<div class="relative flex items-center justify-center mb-4">
		<div class="absolute inset-0 flex items-center" aria-hidden="true">
			<div class="w-full border-t border-surface-200 dark:border-surface-700"></div>
		</div>
		<span
			class="relative bg-surface-50 dark:bg-surface-900 px-3 text-3xs font-bold uppercase tracking-wider text-surface-500"
		>
			Ou
		</span>
	</div>
	<button
		type="button"
		class="btn preset-outlined-surface-500 w-full rounded-xl text-xs font-bold uppercase py-3 flex items-center justify-center gap-2 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
		onclick={onAssinarToken}
		{disabled}
	>
		<KeyRound class="w-4 h-4 shrink-0" aria-hidden="true" />
		Certificado Digital
	</button>
</div>
