<script lang="ts">
	import { Dialog } from '@skeletonlabs/skeleton-svelte';

	interface Props {
		open: boolean;
		pending?: boolean;
		onOpenChange: (open: boolean) => void;
		onConfirm: () => void | Promise<void>;
	}

	const { open, pending = false, onOpenChange, onConfirm }: Props = $props();
</script>

<Dialog {open} onOpenChange={(e) => !pending && onOpenChange(e.open)}>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="card p-4 sm:p-6 max-w-sm w-full max-h-[calc(100dvh-2rem)] overflow-y-auto bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10"
		>
			<Dialog.Title class="text-lg font-bold mb-2">Remover seccional?</Dialog.Title>
			<Dialog.Description class="text-sm text-surface-600 dark:text-surface-300 mb-6">
				Todos os policiais escalados nesta seccional serão removidos. Esta ação não pode ser
				desfeita.
			</Dialog.Description>
			<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
				<button
					type="button"
					class="btn preset-outlined-surface-500"
					onclick={() => onOpenChange(false)}
					disabled={pending}
				>
					Cancelar
				</button>
				<button type="button" class="btn preset-filled-error-500" onclick={onConfirm} disabled={pending}>
					{pending ? 'Removendo...' : 'Remover'}
				</button>
			</div>
		</div>
	</Dialog.Content>
</Dialog>
