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
			class="bg-surface-50 dark:bg-surface-900 rounded-2xl shadow-2xl w-full max-w-sm max-h-[calc(100dvh-1.5rem)] overflow-y-auto p-4 sm:p-6 space-y-4"
			role="dialog"
			aria-modal="true"
		>
			<h2 class="text-lg font-bold text-surface-900 dark:text-surface-50">Reabrir Escala GISE</h2>
			<p class="text-sm text-surface-600 dark:text-surface-400">
				A assinatura digital será <strong>revogada</strong> e será necessário que o supervisor assine
				novamente.
			</p>
			<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
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
