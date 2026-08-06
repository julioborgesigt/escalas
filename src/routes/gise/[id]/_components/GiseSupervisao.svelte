<script lang="ts">
	/**
	 * Orquestrador fino do QUADRO DE SUPERVISÃO da GISE.
	 *
	 * Mantém a API pública estável para `+page.svelte` e compõe:
	 *   1. `SupervisaoDesignacao` — designar papéis (Admin Geral);
	 *   2. marcadores via `rodagem.ts` (dentro da designação);
	 *   3. `SupervisaoDocumentos` — assinaturas de escala e extra do quadro.
	 *
	 * Sem "card" externo: o quadro é uma SEÇÃO da página (título + blocos), não um
	 * cartão dentro de cartão.
	 */
	import { Clock } from '@lucide/svelte';
	import { quadroSupervisaoExtraExigeRelatorio } from '$lib/gise/supervisao-extra';
	import SupervisaoDesignacao from './supervisao/SupervisaoDesignacao.svelte';
	import SupervisaoDocumentos from './supervisao/SupervisaoDocumentos.svelte';
	import type { GiseSupervisaoProps } from './supervisao/types';

	let {
		gise,
		policiais,
		isAdminGeral,
		isSeccional,
		podeEditar,
		modoEdicaoGeral,
		editando = $bindable(false),
		documentoAssinadoInfo,
		pendingCrud,
		buscarDpcs,
		buscarOips,
		selectedFromPoliciais,
		supervisorId = $bindable(),
		assessorId = $bindable(),
		assessorEmailNotificacao = $bindable(''),
		seint1Id = $bindable(),
		seint2Id = $bindable(),
		presencasGise = null,
		seintSupervisaoComRelatorio = [],
		supervisaoExtraUnidadeId = null,
		assinaturasRelatorios = null,
		podeDownload = false,
		isSupervisor = false,
		isMobile = false,
		onAssinarExtraSupervisaoManual,
		onAssinarExtraSupervisaoDigital,
		mostrarPainelAssinaturaEscala = false,
		assinaturaEscalaSignerEmail = undefined,
		rubricaCapturada = $bindable(null),
		painelTokenGise = $bindable(null),
		serproSignerName = $bindable(''),
		serproSignerCpf = $bindable(''),
		onAbrirAssinaturaEscalaManual,
		onAssinaturaEscalaDigitalSuccess,
		loteSection,
		onEditar,
		onCancelar,
		onSubmit
	}: GiseSupervisaoProps = $props();

	const mostrarBlocoExtraSupervisao = $derived(quadroSupervisaoExtraExigeRelatorio(gise));
	const mostrarPainelAssinaturaEscalaReadonly = $derived(
		isAdminGeral && !documentoAssinadoInfo?.existe
	);
</script>

<section class="space-y-3 sm:space-y-5">
	<div class="flex flex-wrap items-baseline justify-between gap-2 sm:gap-4">
		<h2 class="text-xl font-bold text-surface-900 dark:text-surface-50 tracking-tight">
			Supervisão e apoio
		</h2>

		<div class="flex w-full sm:w-auto flex-wrap items-center justify-end gap-2 sm:gap-3">
			{#if !editando && !documentoAssinadoInfo?.existe && mostrarBlocoExtraSupervisao && !(mostrarPainelAssinaturaEscala || mostrarPainelAssinaturaEscalaReadonly)}
				<span
					class="inline-flex items-center gap-1.5 rounded-full bg-warning-500 px-3 py-1 text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-warning-500/20"
				>
					<Clock size={12} class="shrink-0" />
					Ass. Escala Pend.
				</span>
			{/if}
		</div>
	</div>

	<SupervisaoDesignacao
		{gise}
		{policiais}
		{isAdminGeral}
		{podeEditar}
		{modoEdicaoGeral}
		bind:editando
		{pendingCrud}
		{buscarDpcs}
		{buscarOips}
		{selectedFromPoliciais}
		bind:supervisorId
		bind:assessorId
		bind:assessorEmailNotificacao
		bind:seint1Id
		bind:seint2Id
		{presencasGise}
		{seintSupervisaoComRelatorio}
		{onEditar}
		{onCancelar}
		{onSubmit}
	/>

	<SupervisaoDocumentos
		{gise}
		{policiais}
		{isAdminGeral}
		{isSeccional}
		{documentoAssinadoInfo}
		{presencasGise}
		{supervisaoExtraUnidadeId}
		{assinaturasRelatorios}
		{podeDownload}
		{isSupervisor}
		{isMobile}
		{onAssinarExtraSupervisaoManual}
		{onAssinarExtraSupervisaoDigital}
		{mostrarPainelAssinaturaEscala}
		{assinaturaEscalaSignerEmail}
		bind:rubricaCapturada
		bind:painelTokenGise
		bind:serproSignerName
		bind:serproSignerCpf
		{onAbrirAssinaturaEscalaManual}
		{onAssinaturaEscalaDigitalSuccess}
		{loteSection}
	/>
</section>
