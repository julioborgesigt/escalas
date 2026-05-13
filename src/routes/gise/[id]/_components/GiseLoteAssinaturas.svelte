<script lang="ts">
	import { slide } from 'svelte/transition';
	import { loading } from '$lib/loading.svelte';

	interface Props {
		quantidadePendentes: number;
		assinandoLote: boolean;
		etapaAssinatura: string;
		progressoLote: { atual: number; total: number };
		isMobile: boolean;
		restringirSmartphone: boolean;
		onAssinarManualLote: () => void;
		onAssinarDigitalLote: () => void | Promise<void>;
	}

	let {
		quantidadePendentes,
		assinandoLote,
		etapaAssinatura,
		progressoLote,
		isMobile,
		restringirSmartphone,
		onAssinarManualLote,
		onAssinarDigitalLote
	}: Props = $props();

	let expandido = $state(false);
</script>

<div class="flex flex-col gap-1.5">
	<p class="text-[0.6rem] font-bold uppercase tracking-wider text-surface-400 dark:text-surface-500">
		Assinaturas em lote
	</p>
	<div class="rounded-xl border border-surface-200/80 dark:border-surface-700/80 bg-white/70 dark:bg-surface-900/50 overflow-hidden">
		<!-- Header -->
		<button
			type="button"
			class="flex w-full items-center gap-2 p-3 text-left {isMobile ? 'cursor-pointer active:bg-surface-100/60 dark:active:bg-surface-700/40' : 'pointer-events-none'}"
			onclick={() => { if (isMobile) expandido = !expandido; }}
		>
			<div class="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg bg-warning-100 dark:bg-warning-900/30">
				<svg class="w-3.5 h-3.5 text-warning-600 dark:text-warning-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
				</svg>
			</div>
			<div class="min-w-0 flex-1">
				<span class="inline-flex items-center gap-1 rounded-full bg-warning-500/15 px-1.5 py-0.5 text-[0.58rem] font-bold uppercase text-warning-700 dark:text-warning-400">
					{quantidadePendentes} pendente{quantidadePendentes !== 1 ? 's' : ''}
				</span>
				<p class="text-xs font-semibold text-surface-700 dark:text-surface-200 mt-0.5">Assinaturas em lote</p>
			</div>
			{#if isMobile}
				<svg class="h-4 w-4 shrink-0 text-surface-400 transition-transform duration-200 {expandido ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
				</svg>
			{/if}
		</button>

		<!-- Body -->
		{#if !isMobile || expandido}
			<div
				transition:slide={{ duration: 200 }}
				class="px-3 pb-3 pt-2.5 border-t border-surface-200/50 dark:border-surface-700/50 flex flex-col gap-2.5"
			>
				<p class="text-[0.68rem] leading-snug text-surface-500 dark:text-surface-400">
					Assine todos os relatórios extraordinários pendentes de uma só vez.
				</p>

				{#if assinandoLote}
					<div class="flex flex-col gap-1.5">
						<p class="text-[0.6rem] font-bold uppercase tracking-widest text-warning-700 dark:text-warning-400 text-center">{etapaAssinatura}</p>
						<div class="w-full bg-surface-200 dark:bg-surface-700 rounded-full h-2 overflow-hidden">
							<div
								class="bg-warning-500 h-full transition-all duration-500 ease-out"
								style="width: {(progressoLote.atual / progressoLote.total) * 100}%"
							></div>
						</div>
						<p class="text-[0.6rem] text-surface-400 text-center">{progressoLote.atual} de {progressoLote.total}</p>
					</div>
				{:else}
					<div class="flex items-center gap-1.5 flex-wrap justify-end">
						<button
							type="button"
							class="btn btn-xs preset-filled-warning-500 border border-warning-600/30 px-2.5 py-1.5 text-[0.65rem] font-bold rounded-lg hover:border-warning-600 disabled:opacity-40"
							disabled={loading.active || (!isMobile && restringirSmartphone)}
							onclick={onAssinarManualLote}
						>
							Tela (lote)
						</button>
						<button
							type="button"
							class="btn btn-xs preset-filled-tertiary-500 border border-tertiary-600/30 px-2.5 py-1.5 text-[0.65rem] font-bold rounded-lg hover:border-tertiary-600 disabled:opacity-40"
							disabled={loading.active || isMobile}
							onclick={onAssinarDigitalLote}
						>
							Token (lote)
						</button>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>
