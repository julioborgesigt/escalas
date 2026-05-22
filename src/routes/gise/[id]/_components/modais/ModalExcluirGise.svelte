<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';

	interface Props {
		open: boolean;
		pendingCrud: boolean;
		onClose: () => void;
		onSubmit: SubmitFunction;
	}

	let { open, pendingCrud, onClose, onSubmit }: Props = $props();
</script>

<Dialog
	{open}
	onOpenChange={(e) => { if (!pendingCrud && !e.open) onClose(); }}
>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="bg-surface-50 dark:bg-surface-900 rounded-2xl shadow-2xl w-full max-w-sm max-h-[calc(100dvh-1.5rem)] overflow-y-auto p-4 sm:p-6 space-y-4 border border-surface-200 dark:border-white/10"
		>
			<Dialog.Title class="text-lg font-bold text-surface-900 dark:text-surface-50">Excluir Escala GISE</Dialog.Title>
			<Dialog.Description class="text-sm text-surface-600 dark:text-surface-400">
				Esta ação é <strong>irreversível</strong>. Todos os dados desta escala GISE serão
				permanentemente removidos, incluindo equipes, membros e assinatura digital.
			</Dialog.Description>
			<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
				<button
					type="button"
					class="btn preset-outlined-surface-500 text-sm px-4 py-2 rounded-xl"
					onclick={onClose}
					disabled={pendingCrud}>Cancelar</button
				>
				<form method="POST" action="?/excluirGise" use:enhance={onSubmit} class="contents">
					<button
						type="submit"
						class="btn preset-filled-error-500 text-sm px-4 py-2 rounded-xl"
						disabled={pendingCrud}
					>
						{pendingCrud ? 'Excluindo...' : 'Confirmar Exclusão'}
					</button>
				</form>
			</div>
		</div>
	</Dialog.Content>
</Dialog>
