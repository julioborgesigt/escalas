<script lang="ts">
	import { fade } from 'svelte/transition';
	import { Progress } from '@skeletonlabs/skeleton-svelte';
	import { useScrollLock } from '$lib/composables';

	const {
		active = false,
		message = 'Carregando...',
		zIndex = 10000,
		offsetSidebar = true
	}: {
		active: boolean;
		message?: string;
		zIndex?: number;
		/** Quando true (padrão), em desktop o conteúdo é deslocado para a direita
		 * pela largura do sidebar (w-60), centralizando visualmente dentro da área
		 * de conteúdo principal. Use `false` em telas sem sidebar (login, etc). */
		offsetSidebar?: boolean;
	} = $props();

	useScrollLock(() => active);
</script>

{#if active}
	<div
		transition:fade={{ duration: 200 }}
		class="fixed inset-0 bg-surface-50/80 dark:bg-surface-950/80 backdrop-blur-sm pointer-events-auto cursor-wait"
		style="z-index: {zIndex};"
		aria-busy="true"
		aria-live="polite"
	>
		<!-- Conteúdo offsetado pela largura do sidebar (w-60) em desktop, para
		     ficar visualmente centrado dentro da área de conteúdo principal. -->
		<div
			class="absolute inset-0 {offsetSidebar
				? 'min-[900px]:left-60'
				: ''} flex flex-col items-center justify-center"
		>
			<div class="flex flex-col items-center gap-6">
				<Progress
					value={null}
					aria-label={message}
					style="display: inline-flex; flex-direction: row; width: auto; gap: 0;"
				>
					<Progress.Circle style="--size: 4rem; --thickness: 0.25rem;">
						<Progress.CircleTrack class="stroke-surface-200 dark:stroke-surface-700 opacity-30" />
						<Progress.CircleRange class="stroke-primary-500" />
					</Progress.Circle>
				</Progress>

				<!-- Message -->
				<div class="flex flex-col items-center gap-2 px-4 text-center">
					<p
						class="text-surface-900 dark:text-surface-100 font-bold uppercase tracking-[0.2em] text-sm animate-pulse"
					>
						{message}
					</p>
					<p
						class="text-surface-500 dark:text-surface-400 text-3xs uppercase font-medium tracking-widest opacity-60"
					>
						Aguarde um instante
					</p>
				</div>
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
