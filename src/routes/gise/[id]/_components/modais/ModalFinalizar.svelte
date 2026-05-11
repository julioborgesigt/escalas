<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { useScrollLock } from '$lib/composables';

	interface Props {
		open: boolean;
		pendingCrud: boolean;
		onClose: () => void;
		onSubmit: SubmitFunction;
	}

	let { open, pendingCrud, onClose, onSubmit }: Props = $props();

	useScrollLock(() => open);
</script>

<svelte:window onkeydown={(e) => { if (open && e.key === 'Escape' && !pendingCrud) onClose(); }} />

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm overflow-y-auto"
		role="presentation"
		onclick={(e) => e.target === e.currentTarget && !pendingCrud && onClose()}
	>
		<div
			class="bg-surface-50 dark:bg-surface-900 rounded-3xl shadow-2xl w-full max-w-md max-h-[calc(100dvh-1.5rem)] overflow-y-auto p-5 sm:p-8 space-y-5 sm:space-y-6 border border-white/10"
			role="dialog"
			aria-modal="true"
		>
			<div class="text-center space-y-2">
				<h2 class="text-xl sm:text-2xl font-bold text-surface-900 dark:text-surface-50">
					Finalizar Escala GISE
				</h2>
				<p class="text-sm text-surface-500">
					A escala atual será marcada como <span
						class="font-bold text-surface-900 dark:text-surface-50 uppercase">Finalizada</span
					>. Esta ação não poderá ser desfeita e a escala sairá da lista de escalas ativas.
				</p>
			</div>

			<div class="pt-2">
				<form method="POST" action="?/finalizarGise" use:enhance={onSubmit} class="contents">
					<button
						type="submit"
						class="w-full btn py-4 rounded-2xl flex items-center justify-center gap-2 group transition-all duration-300 bg-error-500 hover:bg-error-600 text-white font-bold"
						disabled={pendingCrud}
					>
						Finalizar Agora
					</button>
				</form>

				<button
					type="button"
					class="w-full text-sm text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors py-4 mt-2"
					onclick={onClose}
					disabled={pendingCrud}
				>
					Cancelar e voltar
				</button>
			</div>
		</div>
	</div>
{/if}
