<script lang="ts">
	import { fade } from 'svelte/transition';
	import { useScrollLock } from '$lib/composables';

	let {
		active = false,
		message = 'Carregando...',
		zIndex = 10000
	}: {
		active: boolean;
		message?: string;
		zIndex?: number;
	} = $props();

	useScrollLock(() => active);
</script>

{#if active}
	<div 
		transition:fade={{ duration: 200 }}
		class="fixed inset-0 flex flex-col items-center justify-center bg-surface-50/80 dark:bg-surface-950/80 backdrop-blur-sm pointer-events-auto cursor-wait"
		style="z-index: {zIndex};"
		aria-busy="true"
		aria-live="polite"
	>
		<div class="flex flex-col items-center gap-6">
			<!-- Spinner -->
			<div class="relative w-16 h-16">
				<!-- Outer ring -->
				<div class="absolute inset-0 border-4 border-surface-200 dark:border-surface-700 rounded-full opacity-30"></div>
				<!-- Inner spinning ring -->
				<div class="absolute inset-0 border-4 border-transparent border-t-primary-500 rounded-full animate-spin"></div>
			</div>
			
			<!-- Message -->
			<div class="flex flex-col items-center gap-2">
				<p class="text-surface-900 dark:text-surface-100 font-bold uppercase tracking-[0.2em] text-sm animate-pulse">
					{message}
				</p>
				<p class="text-surface-500 dark:text-surface-400 text-[0.65rem] uppercase font-medium tracking-widest opacity-60">
					Aguarde um instante
				</p>
			</div>
		</div>
	</div>
{/if}

<style>
	/* Garantir que o backdrop-blur seja aplicado suavemente */
	div {
		will-change: backdrop-filter;
	}
</style>
