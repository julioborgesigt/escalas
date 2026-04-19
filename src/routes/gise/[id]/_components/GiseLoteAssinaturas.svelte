<script lang="ts">
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

	let expandirLoteManual = $state(false);
	let expandirLoteDigital = $state(false);
</script>

<div
	class="rounded-2xl border border-warning-500/30 bg-warning-50 dark:bg-warning-900/10 p-5 mb-5 shadow-sm space-y-4"
>
	<div>
		<h3 class="font-bold text-warning-800 dark:text-warning-400 flex items-center gap-2">
			<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
				><path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
				/></svg
			>
			Assinaturas Pendentes
		</h3>
		<p class="text-sm text-warning-700 dark:text-warning-300 mt-1">
			Você possui <strong>{quantidadePendentes} relatório(s) extraordinário(s)</strong> aptos
			para assinatura em lote.
		</p>
	</div>

	{#if assinandoLote}
		<div
			class="flex flex-col items-center gap-1 bg-white/50 dark:bg-surface-800/50 p-6 rounded-3xl border border-warning-500/20 shadow-xl"
		>
			<div class="text-xs font-bold text-warning-700 uppercase tracking-widest mb-2">
				{etapaAssinatura}
			</div>
			<div
				class="w-full bg-surface-200 dark:bg-surface-700 rounded-full h-3 overflow-visible shadow-inner"
			>
				<div
					class="bg-warning-500 h-full transition-all duration-500 ease-out flex items-center justify-center text-[0.5rem] text-white font-bold"
					style="width: {(progressoLote.atual / progressoLote.total) * 100}%"
				>
					{Math.round((progressoLote.atual / progressoLote.total) * 100)}%
				</div>
			</div>
			<div class="mt-2 text-[0.6rem] text-surface-500 font-medium">
				Item {progressoLote.atual} de {progressoLote.total}
			</div>
		</div>
	{:else}
		<div class="flex flex-col gap-4">
			<div
				class="card p-4 bg-white/40 dark:bg-surface-800/40 border border-warning-500/20 rounded-2xl flex flex-col gap-3 shadow-sm"
			>
				<button
					type="button"
					class="w-full text-left flex items-center justify-between"
					onclick={() => (expandirLoteManual = !expandirLoteManual)}
				>
					<div class="flex items-center gap-2">
						<div class="p-1.5 bg-warning-500/10 rounded-lg text-warning-600">
							<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
								/>
							</svg>
						</div>
						<h4
							class="font-bold text-xs text-warning-800 dark:text-warning-400 uppercase tracking-tight"
						>
							Assinatura Manual (Lote - Tela)
						</h4>
					</div>
					<svg
						class="w-4 h-4 text-warning-400 transition-transform duration-300 {expandirLoteManual
							? 'rotate-180'
							: ''}"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M19 9l-7 7-7-7"
						/>
					</svg>
				</button>

				{#if expandirLoteManual}
					<div class="pt-3 border-t border-warning-500/10 flex flex-col gap-3">
						<p class="text-[0.65rem] text-surface-500 leading-tight">
							Aplica sua rubrica manual em todos os relatórios extraordinários pendentes de uma só
							vez.
						</p>
						{#if isMobile || !restringirSmartphone}
							<button
								type="button"
								class="btn btn-sm preset-filled-warning-500 font-bold w-full flex items-center justify-center gap-2 py-2 rounded-xl"
								onclick={onAssinarManualLote}
							>
								<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
									/></svg
								>
								Assinar Agora
							</button>
						{:else}
							<div class="bg-error-500/5 p-2 rounded-lg border border-error-500/10">
								<p class="text-[0.6rem] text-error-600 font-bold uppercase text-center">
									Indisponível no PC. Use o Token A3.
								</p>
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<div
				class="card p-4 bg-white/40 dark:bg-surface-800/40 border border-warning-500/20 rounded-2xl flex flex-col gap-3 shadow-sm"
			>
				<button
					type="button"
					class="w-full text-left flex items-center justify-between"
					onclick={() => (expandirLoteDigital = !expandirLoteDigital)}
				>
					<div class="flex items-center gap-2">
						<div class="p-1.5 bg-tertiary-500/10 rounded-lg text-tertiary-600">
							<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
								/>
							</svg>
						</div>
						<h4
							class="font-bold text-xs text-tertiary-700 dark:text-tertiary-400 uppercase tracking-tight"
						>
							Assinatura Digital (Lote - Token A3)
						</h4>
					</div>
					<svg
						class="w-4 h-4 text-tertiary-400 transition-transform duration-300 {expandirLoteDigital
							? 'rotate-180'
							: ''}"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M19 9l-7 7-7-7"
						/>
					</svg>
				</button>

				{#if expandirLoteDigital}
					<div class="pt-3 border-t border-warning-500/10 flex flex-col gap-3">
						<p class="text-[0.65rem] text-surface-500 leading-tight">
							Assine todos os relatórios digitalmente usando seu Token A3 através do assinador
							SERPRO.
						</p>
						{#if !isMobile}
							<div class="flex flex-col gap-2">
								<button
									type="button"
									class="btn btn-sm preset-filled-tertiary-500 font-bold w-full flex items-center justify-center gap-2 py-2 rounded-xl"
									onclick={onAssinarDigitalLote}
									disabled={loading.active}
								>
									Assinar Lote com SERPRO
								</button>
								<p class="text-[0.55rem] text-surface-400 italic text-center">
									Requer o <a
										href="https://www.serpro.gov.br/links-fixos-superiores/assinador-digital/assinador-serpro"
										target="_blank"
										class="underline">Assinador Desktop</a
									> instalado e aberto.
								</p>
							</div>
						{:else}
							<div
								class="bg-surface-200 dark:bg-surface-700/30 p-2 rounded-xl border border-surface-300 dark:border-surface-600/30"
							>
								<p
									class="text-[0.6rem] text-surface-500 font-bold uppercase text-center leading-tight"
								>
									Certificados físicos só podem ser lidos em computadores.
								</p>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
