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
	<div class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm">
		<div
			class="bg-surface-50 dark:bg-surface-900 rounded-2xl shadow-2xl w-full max-w-sm p-4 sm:p-6 space-y-4"
		>
			<h2 class="text-lg font-bold text-surface-900 dark:text-surface-50">Reabrir Escala GISE</h2>
			<p class="text-sm text-surface-600 dark:text-surface-400">
				A assinatura digital será <strong>revogada</strong> e será necessário que o supervisor assine
				novamente.
			</p>
			<div class="flex justify-end gap-3">
				<button
					type="button"
					class="btn preset-outlined-surface text-sm px-4 py-2 rounded-xl"
					onclick={onClose}>Cancelar</button
				>
				<form method="POST" action="?/reabrirEscala" use:enhance={onSubmit} class="contents">
					<button
						type="submit"
						class="btn preset-filled-warning-500 text-sm px-4 py-2 rounded-xl"
						disabled={pendingCrud}
					>
						{pendingCrud ? 'Reabrindo...' : 'Confirmar Reabertura'}
					</button>
				</form>
			</div>
		</div>
	</div>
{/if}
