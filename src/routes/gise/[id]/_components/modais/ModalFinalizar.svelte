<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import ModalShell from '$lib/components/ModalShell.svelte';

	import { modoDeFinalizacao, PENDENCIAS_DA_ANTECIPADA } from '$lib/gise/finalizacao';

	interface Props {
		open: boolean;
		pendingCrud: boolean;
		/** Status atual da GISE — decide se a finalização é antecipada. */
		status: string;
		onClose: () => void;
		onSubmit: SubmitFunction;
	}

	const { open, pendingCrud, status, onClose, onSubmit }: Props = $props();

	// A MESMA função que as duas rotas de finalização usam. Recalcular aqui
	// deixaria o aviso e o gate divergindo no primeiro estado novo da escada.
	const antecipada = $derived(modoDeFinalizacao(status) === 'antecipada');
</script>

<ModalShell
	{open}
	onOpenChange={(isOpen) => {
		if (!isOpen) onClose();
	}}
	title="Finalizar Escala GISE"
	familia="assinatura"
	largura="md"
	pending={pendingCrud}
	cancelLabel={null}
>
	{#snippet description()}
		A escala atual será marcada como <span
			class="font-bold text-surface-900 dark:text-surface-50 uppercase">Finalizada</span
		>. Esta ação não poderá ser desfeita e a escala sairá da lista de escalas ativas.
	{/snippet}

	{#if antecipada}
		<!--
			O ponto do FLW-GISE-005: a saída antecipada existe e continua
			existindo — o que não pode é ser silenciosa. Antes, o modal dizia
			apenas "não poderá ser desfeita", e quem clicava não tinha como
			saber que estava encerrando sem os relatórios.
		-->
		<div
			class="rounded-xl border border-warning-500/40 bg-warning-500/10 p-4 text-left space-y-2"
		>
			<p class="text-sm font-bold text-warning-700 dark:text-warning-300">
				Finalização antecipada
			</p>
			<p class="text-sm text-surface-700 dark:text-surface-300">
				Esta escala ainda não percorreu o fluxo completo. Finalizar agora encerra sem:
			</p>
			<ul class="text-sm text-surface-700 dark:text-surface-300 list-disc list-inside space-y-1">
				{#each PENDENCIAS_DA_ANTECIPADA as pendencia (pendencia)}
					<li>{pendencia}</li>
				{/each}
			</ul>
			<p class="text-xs text-surface-600 dark:text-surface-400">
				A ação fica registrada na trilha de auditoria como finalização antecipada.
			</p>
		</div>
	{/if}

	<div class="pt-2">
		<form method="POST" action="?/finalizarGise" use:enhance={onSubmit} class="contents">
			<button
				type="submit"
				class="w-full btn py-4 rounded-2xl flex items-center justify-center gap-2 group transition-all duration-300 bg-error-500 hover:bg-error-600 text-white font-bold"
				disabled={pendingCrud}
			>
				{pendingCrud ? 'Finalizando...' : 'Finalizar Agora'}
			</button>
		</form>

		<button
			type="button"
			class="w-full text-sm text-surface-600 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300 transition-colors py-4 mt-2"
			onclick={onClose}
			disabled={pendingCrud}
		>
			Cancelar e voltar
		</button>
	</div>
</ModalShell>
