<script lang="ts">
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { toaster } from '$lib/toast';
	import type { ActionResult } from '@sveltejs/kit';

	let {
		open = $bindable(false),
		unidade
	}: {
		open: boolean;
		unidade: { id: number; nome: string } | null;
	} = $props();

	let pending = $state(false);

	function handleExcluir() {
		pending = true;
		return async ({ result }: { result: ActionResult }) => {
			pending = false;
			if (result.type === 'success') {
				await invalidateAll();
				toaster.create({
					title: `Unidade "${unidade?.nome}" removida com sucesso`,
					type: 'success'
				});
				open = false;
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				toaster.create({ title: String(d?.error || 'Erro ao remover DP'), type: 'error' });
			}
		};
	}
</script>

<Dialog {open} onOpenChange={(e) => (open = e.open)}>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="card p-4 sm:p-6 max-w-sm w-full max-h-[calc(100dvh-2rem)] overflow-y-auto bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10"
		>
			<Dialog.Title class="h3 font-bold mb-2">Excluir Unidade?</Dialog.Title>
			<Dialog.Description class="text-surface-600 dark:text-surface-400 mb-6">
				Tem certeza que deseja excluir a unidade "{unidade?.nome}"? Esta ação não afeta os policiais
				já lotados nela.
			</Dialog.Description>
			<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
				<Dialog.CloseTrigger class="btn preset-outlined-surface-500" disabled={pending}
					>Cancelar</Dialog.CloseTrigger
				>
				<form method="POST" action="?/excluir" use:enhance={handleExcluir} class="contents">
					<input type="hidden" name="unidade_id" value={unidade?.id} />
					<button
						type="submit"
						class="btn preset-filled-error-500 flex items-center gap-2 active:scale-95 transition-all"
						disabled={pending}
					>
						{pending ? 'Excluindo...' : 'Excluir'}
					</button>
				</form>
			</div>
		</div>
	</Dialog.Content>
</Dialog>
