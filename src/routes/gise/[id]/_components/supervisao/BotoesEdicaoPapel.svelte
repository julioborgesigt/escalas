<script lang="ts">
	/**
	 * Par Editar/Remover (Admin Geral) de um papel do quadro de supervisão —
	 * mesma marcação nos quatro slots. `compacto=false` só no supervisor
	 * (ícones 14px em vez de 12px). A checagem `podeGerenciar` fica no
	 * chamador: este componente só desenha os botões.
	 */
	import PenLine from '@lucide/svelte/icons/pen-line';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Spinner from '$lib/components/Spinner.svelte';

	const {
		temId,
		compacto = true,
		removendo,
		pending,
		onEditar,
		onRemover
	}: {
		temId: boolean;
		compacto?: boolean;
		removendo: boolean;
		pending: boolean;
		onEditar: () => void;
		onRemover: () => void;
	} = $props();
</script>

<div class="flex items-center gap-1 shrink-0">
	<button
		type="button"
		class="btn btn-xs preset-filled-surface-500 rounded p-1"
		title="Editar"
		aria-label="Editar"
		onclick={onEditar}
	>
		<PenLine size={compacto ? 12 : 14} />
	</button>
	{#if temId}
		<button
			type="button"
			class="btn btn-xs preset-outlined-error-500 rounded p-1"
			title="Remover"
			aria-label="Remover"
			onclick={onRemover}
			disabled={pending}
		>
			{#if pending && removendo}
				<Spinner size="xs" />
			{:else}
				<Trash2 size={compacto ? 12 : 14} />
			{/if}
		</button>
	{/if}
</div>
