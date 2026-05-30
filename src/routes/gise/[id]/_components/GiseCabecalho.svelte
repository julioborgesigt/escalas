<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { loading } from '$lib/loading.svelte';
	import IconTooltip from '$lib/components/IconTooltip.svelte';

	interface Gise {
		id: number;
		status: string;
		data_inicio: string;
		hora_entrada: string;
		hora_saida: string;
		/** ISO 8601 quando a planilha Base_Equipe já recebeu dados desta GISE com sucesso. */
		planilha_base_equipe_alimentada_em?: string | null;
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
		isMobile?: boolean;
		onToggleEdit: () => void;
		onAbrirDataHoras: () => void;
		onAbrirExcluir: () => void;
		onAbrirReabrir: () => void;
		onAbrirFinalizar: () => void;
		onSolicitarAssinatura: SubmitFunction;
		onRevogarPedido: SubmitFunction;
		/** Reenvio manual para Base_Equipe (GISE finalizada). */
		onEnviarPlanilha?: SubmitFunction;
		/** Há registro de envio com sucesso à planilha (campo persistido na GISE). */
		planilhaBaseEquipeAlimentadaOk?: boolean;
		/** Edição dos textos do "Breve relatório" (PDFs de extra) — ex.: ao lado de Baixar XLSX. */
		onAbrirBreveRelatorio?: () => void;
	}

	const {
		gise,
		statusLabel,
		statusColor,
		diaSemana,
		fmtDate,
		isAdminGeral,
		isSeccional: _isSeccional,
		podeDownload,
		podeEditar,
		podeReabrir,
		podeFinalizar,
		editaBloqueado,
		modoEdicaoGeral,
		todasSeccionaisPreenchidas,
		documentoAssinadoExiste,
		pendingCrud,
		isMobile = false,
		onToggleEdit,
		onAbrirDataHoras,
		onAbrirExcluir,
		onAbrirReabrir,
		onAbrirFinalizar,
		onSolicitarAssinatura,
		onRevogarPedido,
		onEnviarPlanilha,
		planilhaBaseEquipeAlimentadaOk = false,
		onAbrirBreveRelatorio
	}: Props = $props();
</script>

<!--
  Sidebar aparece em min-[900px] (240px). Para titular + ações lado a lado sem espreme,
  só ativamos flex-row em xl (1280px) → ~1040px de conteúdo disponível.
  Abaixo de xl: coluna única — título em largura total, ações em faixa com wrap abaixo.
-->
<div
	class="flex flex-col gap-4 border-b border-surface-200/70 pb-5 dark:border-surface-700/60 xl:flex-row xl:items-start xl:justify-between xl:gap-6"
>
	<div class="min-w-0 flex-1 space-y-3">
		<button
			type="button"
			class="btn btn-sm preset-outlined-surface-500 hover:bg-surface-50 dark:hover:bg-surface-900 px-3 py-1.5 rounded-xl transition-all flex w-fit max-w-full items-center gap-2 group"
			onclick={() => goto('/gise')}
		>
			<svg
				class="w-4 h-4 shrink-0 transition-transform group-hover:-translate-x-1"
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

		<h1
			class="break-words font-bold leading-tight text-surface-900 dark:text-surface-50 text-xl sm:text-2xl xl:text-3xl"
		>
			<span class="block">Escala GISE #{gise.id}</span>
			<span
				class="mt-1 block font-semibold text-surface-700 dark:text-surface-200 text-base sm:text-lg xl:text-xl"
			>
				{diaSemana(gise.data_inicio)}, {fmtDate(gise.data_inicio)}
			</span>
		</h1>

		<div class="flex flex-wrap items-center gap-x-2 gap-y-1.5">
			<span class="max-w-full text-sm px-2.5 py-0.5 rounded-full font-semibold {statusColor(gise.status)}">
				{statusLabel(gise.status)}
			</span>
			{#if gise.status === 'finalizada' && gise.planilha_base_equipe_alimentada_em}
				<IconTooltip label="Dados desta GISE já foram enviados com sucesso para a planilha Base_Equipe.">
					<span
						class="max-w-full text-sm px-2.5 py-0.5 rounded-full font-semibold bg-success-500/15 text-success-800 border border-success-500/35 dark:text-success-200 dark:border-success-500/40"
					>
						Planilha alimentada
					</span>
				</IconTooltip>
			{/if}
			<span class="inline-flex flex-wrap items-center gap-2 text-sm text-surface-500 dark:text-surface-400">
				<span class="whitespace-nowrap">{gise.hora_entrada}h–{gise.hora_saida}h</span>
				{#if isAdminGeral && podeEditar && modoEdicaoGeral}
					<IconTooltip label="Editar Data/Horários">
						<button
							type="button"
							aria-label="Editar Data/Horários"
							class="btn btn-xs preset-filled-surface-500 rounded p-1"
							onclick={onAbrirDataHoras}
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
					</IconTooltip>
				{/if}
			</span>
		</div>
	</div>

	<div class="flex flex-wrap items-center justify-start gap-2 sm:min-w-0 sm:gap-2 xl:max-w-[min(100%,40rem)] xl:justify-end xl:shrink-0">
		{#if isAdminGeral && podeDownload && gise.status === 'finalizada'}
			<a
				class="btn btn-sm preset-outlined-success-500 rounded-lg font-semibold whitespace-nowrap transition-all flex items-center justify-center gap-1.5 flex-1 sm:flex-initial"
				href={`/api/gise/${gise.id}/download?format=xlsx`}
				target="_blank"
			>
				Baixar XLSX
			</a>
		{/if}
		{#if isAdminGeral && modoEdicaoGeral && onAbrirBreveRelatorio}
			<button
				type="button"
				class="btn btn-sm preset-outlined-primary-500 rounded-lg font-semibold whitespace-nowrap transition-all flex items-center justify-center gap-1.5 border-2 flex-1 sm:flex-initial"
				onclick={onAbrirBreveRelatorio}
				disabled={loading.active || pendingCrud}
			>
				{isMobile ? 'Alterar Justificativa' : 'Alterar texto'}
			</button>
		{/if}
		{#if isAdminGeral}
			<button
				class="btn btn-sm preset-{modoEdicaoGeral
					? 'filled'
					: 'outlined'}-primary-500 rounded-lg font-semibold whitespace-nowrap transition-all flex items-center justify-center gap-1.5 flex-1 sm:flex-initial {modoEdicaoGeral
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
						class="btn btn-sm preset-filled-success-500 rounded-lg font-semibold transition-all flex items-center justify-center gap-1.5 border-2 border-success-600/30 hover:border-success-600 text-center leading-tight whitespace-nowrap flex-1 sm:flex-initial"
						disabled={loading.active || modoEdicaoGeral || pendingCrud}
						type="submit"
					>
						{pendingCrud ? 'Enviando...' : 'Solicitar Nova Assinatura'}
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
						class="btn btn-sm preset-outlined-warning-500 rounded-lg font-semibold transition-all flex items-center justify-center gap-1.5 border-2 border-warning-500/30 hover:border-warning-500 text-center leading-tight whitespace-nowrap flex-1 sm:flex-initial"
						disabled={loading.active || pendingCrud}
						type="submit"
					>
						{pendingCrud ? 'Revogando...' : 'Revogar solicitação de ass.'}
					</button>
				</form>
			{/if}
			<button
				class="btn btn-sm preset-outlined-error-500 rounded-lg font-semibold whitespace-nowrap transition-all flex items-center justify-center gap-1.5 border-2 border-error-500/30 hover:border-error-500 flex-1 sm:flex-initial"
				onclick={onAbrirExcluir}
				disabled={editaBloqueado || loading.active || pendingCrud}
				type="button"
			>
				Excluir GISE
			</button>
		{/if}
		{#if podeReabrir}
			<button
				class="btn btn-sm preset-outlined-warning-500 rounded-lg font-semibold whitespace-nowrap transition-all flex items-center justify-center gap-1.5 border-2 border-warning-500/30 hover:border-warning-500 flex-1 sm:flex-initial"
				onclick={onAbrirReabrir}
				disabled={loading.active || pendingCrud}
				type="button"
			>
				Reabrir edição
			</button>
		{/if}
		{#if podeFinalizar}
			<button
				class="btn btn-sm preset-outlined-error-500 rounded-lg font-semibold whitespace-nowrap transition-all flex items-center justify-center gap-1.5 border-2 border-error-600/30 hover:border-error-600 bg-error-500/10 hover:bg-error-500/20 dark:bg-error-500/15 flex-1 sm:flex-initial"
				onclick={onAbrirFinalizar}
				disabled={loading.active || pendingCrud}
				type="button"
			>
				Finalizar GISE
			</button>
		{/if}
		{#if isAdminGeral && gise.status === 'finalizada' && onEnviarPlanilha}
			<form
				method="POST"
				action="?/reenviarBaseEquipePlanilha"
				use:enhance={onEnviarPlanilha}
				class="contents"
			>
				<button
					type="submit"
					class="btn btn-sm preset-outlined-primary-500 rounded-lg font-semibold whitespace-nowrap transition-all flex items-center justify-center gap-1.5 border-2 flex-1 sm:flex-initial"
					disabled={loading.active || pendingCrud}
					title={planilhaBaseEquipeAlimentadaOk
						? 'Planilha Base_Equipe já recebeu estes dados; clique para reenviar.'
						: 'Envia os dados desta GISE para a aba Base_Equipe da planilha'}
				>
					{pendingCrud
						? 'Enviando...'
						: planilhaBaseEquipeAlimentadaOk
							? 'Reenviar para planilha'
							: 'Enviar para a planilha'}
				</button>
			</form>
		{/if}
	</div>
</div>
