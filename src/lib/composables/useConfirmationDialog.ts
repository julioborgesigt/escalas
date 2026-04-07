import { Dialog } from '@skeletonlabs/skeleton-svelte';

/**
 * Hook reutilizável para diálogos de confirmação (exclusão, etc).
 *
 * @returns Estado e funções para gerenciar diálogo de confirmação
 *
 * @example
 * const { open, item, openDialog, closeDialog, currentItem } = useConfirmationDialog<{id: number; nome: string}>();
 *
 * function solicitarExclusao(id: number, nome: string) {
 *   openDialog({ id, nome });
 * }
 */
export function useConfirmationDialog<T = unknown>() {
	let open = $state(false);
	let item = $state<T | null>(null);

	return {
		get isOpen() {
			return open;
		},
		set isOpen(value: boolean) {
			open = value;
		},
		get currentItem() {
			return item;
		},
		openDialog(data: T) {
			item = data;
			open = true;
		},
		closeDialog() {
			open = false;
			item = null;
		}
	};
}
