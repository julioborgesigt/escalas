<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { loading } from '$lib/loading.svelte';

	interface Gise {
		id: number;
		status: string;
		data_inicio: string;
		hora_entrada: string;
		hora_saida: string;
	}

	interface Props {
		gise: Gise;
		statusLabel: (s: string) => string;
		statusColor: (s: string) => string;
		diaSemana: (s: string) => string;
		fmtDate: (s: string) => string;
		isAdminGeral: boolean;
		isSeccional: boolean;
		podeDownload: boolean;
		podeEditar: boolean;
		podeReabrir: boolean;
		podeFinalizar: boolean;
		editaBloqueado: boolean;
		modoEdicaoGeral: boolean;
		todasSeccionaisPreenchidas: boolean;
		documentoAssinadoExiste: boolean;
		pendingCrud: boolean;
		onToggleEdit: () => void;
		onAbrirDataHoras: () => void;
		onAbrirExcluir: () => void;
		onAbrirReabrir: () => void;
		onAbrirFinalizar: () => void;
		onSolicitarAssinatura: SubmitFunction;
		onRevogarPedido: SubmitFunction;
	}

	let {
		gise,
		statusLabel,
		statusColor,
		diaSemana,
		fmtDate,
		isAdminGeral,
		isSeccional,
		podeDownload,
		podeEditar,
		podeReabrir,
		podeFinalizar,
		editaBloqueado,
		modoEdicaoGeral,
		todasSeccionaisPreenchidas,
		documentoAssinadoExiste,
		pendingCrud,
		onToggleEdit,
		onAbrirDataHoras,
		onAbrirExcluir,
		onAbrirReabrir,
		onAbrirFinalizar,
		onSolicitarAssinatura,
		onRevogarPedido
	}: Props = $props();
</script>

<div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
	<div class="min-w-0">
		<button
			type="button"
			class="btn btn-sm mb-4 preset-outlined-surface-500 hover:bg-surface-50 dark:hover:bg-surface-900 px-3 py-1.5 rounded-xl transition-all flex items-center gap-2 group"
			onclick={() => goto('/gise')}
		>
			<svg
				class="w-4 h-4 transition-transform group-hover:-translate-x-1"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2.5"
					d="M10 19l-7-7m0 0l7-7m-7 7h18"
				/>
			</svg>
			<span class="text-sm font-bold uppercase tracking-wider">Voltar</span>
		</button>
		<h1 class="text-2xl font-bold text-surface-900 dark:text-surface-50">
			Escala GISE #{gise.id} — {diaSemana(gise.data_inicio)}, {fmtDate(gise.data_inicio)}
		</h1>
		<div class="flex items-center gap-2 mt-1">
			<span class="text-sm px-2 py-0.5 rounded-full font-semibold {statusColor(gise.status)}">
				{statusLabel(gise.status)}
			</span>
			<span class="text-sm text-surface-500 flex items-center gap-2">
				{gise.hora_entrada}h–{gise.hora_saida}h
				{#if isAdminGeral && podeEditar && modoEdicaoGeral}
					<button
						type="button"
						class="btn btn-xs preset-filled-surface-500 rounded p-1"
						onclick={onAbrirDataHoras}
						title="Editar Data/Horários"
					>
						<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
							/></svg
						>
					</button>
				{/if}
			</span>
		</div>
	</div>

	<div class="flex flex-wrap gap-2 sm:justify-end sm:shrink-0">
		{#if (isAdminGeral || isSeccional) && podeDownload}
			<a
				class="btn btn-sm preset-outlined-success-500 rounded-lg font-semibold whitespace-nowrap transition-all flex items-center justify-center gap-1.5 no-underline"
				href={`/api/gise/${gise.id}/download?format=xlsx`}
				target="_blank"
			>
				Baixar XLSX
			</a>
		{/if}
		{#if isAdminGeral}
			<button
				class="btn btn-sm preset-{modoEdicaoGeral
					? 'filled'
					: 'outlined'}-primary-500 rounded-lg font-semibold whitespace-nowrap transition-all flex items-center justify-center gap-1.5 {modoEdicaoGeral
					? 'border-2 border-primary-600 shadow-xl'
					: 'border-2 border-primary-500/30 hover:border-primary-500'}"
				onclick={onToggleEdit}
				disabled={editaBloqueado || loading.active || pendingCrud}
				type="button"
			>
				{modoEdicaoGeral ? 'Concluir Edição' : 'Editar escala'}
			</button>
			{#if gise.status === 'em_preenchimento' && todasSeccionaisPreenchidas}
				<form
					method="POST"
					action="?/solicitarAssinatura"
					use:enhance={onSolicitarAssinatura}
					class="contents"
				>
					<button
						class="btn btn-sm preset-filled-success-500 rounded-lg font-semibold whitespace-nowrap transition-all flex items-center justify-center gap-1.5 border-2 border-success-600/30 hover:border-success-600"
						disabled={loading.active || modoEdicaoGeral || pendingCrud}
						type="submit"
					>
						Solicitar Nova Assinatura
					</button>
				</form>
			{/if}
			{#if gise.status === 'aguardando_assinatura' && !documentoAssinadoExiste}
				<form
					method="POST"
					action="?/revogarPedidoAssinatura"
					use:enhance={onRevogarPedido}
					class="contents"
				>
					<button
						class="btn btn-sm preset-outlined-warning-500 rounded-lg font-semibold whitespace-nowrap transition-all flex items-center justify-center gap-1.5 border-2 border-warning-500/30 hover:border-warning-500"
						disabled={loading.active || pendingCrud}
						type="submit"
					>
						Revogar solicitação de ass.
					</button>
				</form>
			{/if}
			<button
				class="btn btn-sm preset-outlined-error-500 rounded-lg font-semibold whitespace-nowrap transition-all flex items-center justify-center gap-1.5 border-2 border-error-500/30 hover:border-error-500"
				onclick={onAbrirExcluir}
				disabled={editaBloqueado || loading.active || pendingCrud}
				type="button"
			>
				Excluir GISE
			</button>
		{/if}
		{#if podeReabrir}
			<button
				class="btn btn-sm preset-outlined-warning-500 rounded-lg font-semibold whitespace-nowrap transition-all flex items-center justify-center gap-1.5 border-2 border-warning-500/30 hover:border-warning-500"
				onclick={onAbrirReabrir}
				disabled={loading.active || pendingCrud}
				type="button"
			>
				Reabrir para Edição
			</button>
		{/if}
		{#if podeFinalizar}
			<button
				class="btn btn-sm preset-outlined-error-500 rounded-lg font-semibold whitespace-nowrap transition-all flex items-center justify-center gap-1.5 border-2 border-error-600/30 hover:border-error-600 bg-error-500/10 hover:bg-error-500/20 dark:bg-error-500/15"
				onclick={onAbrirFinalizar}
				disabled={loading.active || pendingCrud}
				type="button"
			>
				Marcar como Finalizada
			</button>
		{/if}
	</div>
</div>
