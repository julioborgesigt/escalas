<script lang="ts">
	import { Dialog } from '@skeletonlabs/skeleton-svelte';

	type DialogInfo = {
		titulo: string;
		linhas: string[];
		acao?: { label: string; fn: () => void };
	};

	let {
		dialogInfo,
		onClose
	}: {
		dialogInfo: DialogInfo | null;
		onClose: () => void;
	} = $props();
</script>

<Dialog
	open={dialogInfo !== null}
	onOpenChange={(e) => { if (!e.open) onClose(); }}
>
	<Dialog.Content
		class="fixed inset-0 z-[100] flex items-center justify-center bg-surface-950/60 p-4 backdrop-blur-sm"
	>
		{#if dialogInfo}
			<div
				class="w-full max-w-sm rounded-2xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 p-6 shadow-xl space-y-4"
			>
				<div class="flex items-start gap-3">
					<div
						class="mt-0.5 shrink-0 rounded-lg p-2 {dialogInfo.acao
							? 'bg-tertiary-500/10'
							: 'bg-warning-500/10'}"
					>
						{#if dialogInfo.acao}
							<svg
								class="w-5 h-5 text-tertiary-500"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
								/>
							</svg>
						{:else}
							<svg
								class="w-5 h-5 text-warning-500"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
								/>
							</svg>
						{/if}
					</div>
					<div class="min-w-0 flex-1">
						<Dialog.Title class="text-base font-bold text-surface-900 dark:text-surface-50">
							{dialogInfo.titulo}
						</Dialog.Title>
					</div>
				</div>

				<ul class="space-y-1.5 pl-1">
					{#each dialogInfo.linhas as linha}
						<li class="flex items-start gap-2 text-sm text-surface-600 dark:text-surface-300">
							<span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-surface-400"></span>
							{linha}
						</li>
					{/each}
				</ul>

				<div class="flex justify-end gap-3 pt-1">
					<button
						type="button"
						class="btn preset-tonal-surface-500 rounded-xl px-4 py-2 text-sm font-semibold"
						onclick={onClose}
					>
						{dialogInfo.acao ? 'Cancelar' : 'Entendi'}
					</button>
					{#if dialogInfo.acao}
						{@const acao = dialogInfo.acao}
						<button
							type="button"
							class="btn preset-filled-tertiary-500 rounded-xl px-4 py-2 text-sm font-bold"
							onclick={acao.fn}
						>
							{acao.label}
						</button>
					{/if}
				</div>
			</div>
		{/if}
	</Dialog.Content>
</Dialog>
