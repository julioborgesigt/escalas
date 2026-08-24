<script lang="ts">
	/**
	 * Provedor global de Toast — o `Toast.Group` do Skeleton com o visual do app.
	 *
	 * Sem props e sem estado: consome o `toaster` de `$lib/toast`, que é o
	 * singleton para o qual toda a aplicação chama `toaster.create(...)`. Só
	 * existe como arquivo porque eram ~40 linhas de markup e estilo no
	 * `+layout.svelte`, sem relação nenhuma com o resto de lá.
	 *
	 * Posição e empilhamento vêm dos estilos inline do Zag (`placement:
	 * 'bottom-end'` definido em `toast.ts`); classe de posição AQUI entraria em
	 * conflito com eles e desalinharia a pilha.
	 */
	import { Toast } from '@skeletonlabs/skeleton-svelte';
	import { toaster } from '$lib/toast';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
</script>

<Toast.Group {toaster}>
	{#snippet children(toast)}
		<Toast
			{toast}
			class="bg-surface-900 dark:bg-surface-100 text-surface-50 dark:text-surface-900 px-6 py-4 rounded-xl shadow-2xl pointer-events-auto border border-surface-700 dark:border-surface-300 w-[calc(100vw-2rem)] sm:w-auto sm:min-w-[320px] sm:max-w-md"
		>
			<div class="flex items-center gap-3">
				{#if toast.type === 'success'}
					<CheckCircle2 class="w-6 h-6 text-success-500" aria-hidden="true" />
				{:else if toast.type === 'error'}
					<AlertCircle class="w-6 h-6 text-error-500" aria-hidden="true" />
				{/if}
				<div class="flex-1">
					<Toast.Title class="font-bold text-base">{toast.title}</Toast.Title>
					{#if toast.description}
						<Toast.Description class="text-sm opacity-75">{toast.description}</Toast.Description>
					{/if}
				</div>
				<Toast.CloseTrigger
					class="btn-icon btn-sm opacity-50 hover:opacity-100 transition-opacity"
					aria-label="Fechar notificação"
				>
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						/></svg
					>
				</Toast.CloseTrigger>
			</div>
		</Toast>
	{/snippet}
</Toast.Group>
