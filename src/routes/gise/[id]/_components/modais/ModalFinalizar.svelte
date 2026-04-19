<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';

	interface Props {
		open: boolean;
		pendingCrud: boolean;
		onClose: () => void;
		onSubmit: SubmitFunction;
	}

	let { open, pendingCrud, onClose, onSubmit }: Props = $props();
</script>

{#if open}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
		<div
			class="bg-surface-50 dark:bg-surface-900 rounded-3xl shadow-2xl w-full max-w-md p-8 space-y-6 border border-white/10"
		>
			<div class="text-center space-y-2">
				<h2 class="text-2xl font-bold text-surface-900 dark:text-surface-50">
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
