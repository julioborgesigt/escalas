<script lang="ts">
	/**
	 * Card do relatório de extra do quadro de supervisão (unidade sintética) —
	 * downloads, conferência e botões Tela/Token do supervisor.
	 */
	import { page } from '$app/state';
	import SupervisaoDocumentoCard from '../SupervisaoDocumentoCard.svelte';
	import { FileDown, PenLine } from '@lucide/svelte';
	import {
		supervisaoExtraRubricasCompletas,
		faltantesSupervisaoExtra,
		FALTANTE_RUBRICA_SUPER_PREFIX
	} from '$lib/gise/supervisao-extra';
	import type { GiseAssinaturaRelatorio } from '$lib/server/schema';
	import { podeBaixarComManifesto } from '$lib/manifesto';
	import { montarNomesSupervisao } from './rodagem';
	import type { GiseSupervisaoGise, PolicialOpcao, PresencaGiseLinha } from './types';

	interface Props {
		gise: GiseSupervisaoGise;
		policiais: PolicialOpcao[];
		presencasGise: PresencaGiseLinha[] | null;
		supervisaoExtraUnidadeId: number | null;
		assinaturasRelatorios: GiseAssinaturaRelatorio[] | null;
		isAdminGeral: boolean;
		isSeccional: boolean;
		isSupervisor: boolean;
		isMobile: boolean;
		podeDownload: boolean;
		onAssinarExtraSupervisaoManual?: () => void;
		onAssinarExtraSupervisaoDigital?: () => void;
	}

	const {
		gise,
		policiais,
		presencasGise,
		supervisaoExtraUnidadeId,
		assinaturasRelatorios,
		isAdminGeral,
		isSeccional,
		isSupervisor,
		isMobile,
		podeDownload,
		onAssinarExtraSupervisaoManual,
		onAssinarExtraSupervisaoDigital
	}: Props = $props();

	const nomesSupervisaoPorId = $derived(montarNomesSupervisao(gise, policiais));
	const extraSupervisaoConfigurado = $derived(supervisaoExtraUnidadeId != null);

	const assRelSup = $derived(
		supervisaoExtraUnidadeId == null
			? undefined
			: assinaturasRelatorios?.find(
					(a) => a.seccional_id === supervisaoExtraUnidadeId && a.tipo === 'extraordinario'
				)
	);
	const rubSupOk = $derived(supervisaoExtraRubricasCompletas(gise, presencasGise ?? []));
	const faltSup = $derived(
		faltantesSupervisaoExtra(gise, presencasGise ?? [], nomesSupervisaoPorId)
	);

	const downloadExtraSupHabilitado = $derived(
		extraSupervisaoConfigurado &&
			!!podeDownload &&
			rubSupOk &&
			(assRelSup || isAdminGeral || isSeccional || isSupervisor)
	);
	const downloadExtraSupConferenciaHabilitado = $derived(
		extraSupervisaoConfigurado && (isAdminGeral || isSupervisor)
	);
	const assinaturaExtraHabilitada = $derived(!!rubSupOk && !!extraSupervisaoConfigurado);

	const urlDownloadExtra = $derived(
		`/api/gise/${gise.id}/download?format=extraordinario&seccionalId=${supervisaoExtraUnidadeId}`
	);
	const urlDownloadExtraManifesto = $derived(
		`/api/gise/${gise.id}/download?format=extraordinario&seccionalId=${supervisaoExtraUnidadeId}&manifesto=true`
	);

	let expandirExtra = $state(false);
</script>

{#snippet iconeCaneta()}
	<PenLine class="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
{/snippet}

{#snippet detalhesExtra(mobile: boolean)}
	{#if assRelSup}
		<p class="text-xs font-bold text-surface-800 dark:text-surface-100 break-words">
			{assRelSup.assinante_nome}
		</p>
	{:else}
		<p class="text-2xs leading-snug text-surface-600 dark:text-surface-400">
			O supervisor poderá assinar o relatório de extra do quadro de supervisão quando todos os
			integrantes confirmarem sua saída.
		</p>
		{#if !rubSupOk}
			<p
				class="text-2xs leading-snug text-surface-600 dark:text-surface-400 {mobile
					? ''
					: 'mt-0.5'}"
			>
				{#if faltSup?.startsWith(FALTANTE_RUBRICA_SUPER_PREFIX)}
					<span class="text-error-600 dark:text-error-400 font-medium">Faltando rúbrica de:</span
					>{faltSup.slice(FALTANTE_RUBRICA_SUPER_PREFIX.length)}
				{:else}
					{faltSup ?? 'Aguardando rúbricas do quadro de supervisão.'}
				{/if}
			</p>
		{:else}
			<p
				class="text-2xs leading-snug text-surface-600 dark:text-surface-400 {mobile
					? ''
					: 'mt-0.5'}"
			>
				Disponível para conferência. Aguardando assinatura.
			</p>
		{/if}
	{/if}
{/snippet}

{#snippet acoesExtra(mobile: boolean)}
	{#if assRelSup}
		{@const podeManifesto = podeBaixarComManifesto(page.data.usuario, assRelSup.assinante_id)}
		<a
			href={urlDownloadExtra}
			target="_blank"
			class="btn btn-xs preset-filled-primary-500 px-2.5 py-1.5 text-3xs font-bold rounded-lg no-underline flex items-center gap-1 {mobile
				? ''
				: 'hover:scale-[1.02] transition-all'} {!downloadExtraSupHabilitado
				? 'pointer-events-none opacity-60'
				: ''}"
			title={podeManifesto ? 'Baixar sem manifesto (para impressão)' : 'Baixar PDF assinado'}
		>
			<FileDown size={13} class="shrink-0" />
			{podeManifesto ? 'S/ manifesto' : 'Baixar PDF'}
		</a>
		{#if podeManifesto}
			<a
				href={urlDownloadExtraManifesto}
				target="_blank"
				class="btn btn-xs preset-outlined-primary-500 px-2.5 py-1.5 text-3xs font-bold rounded-lg no-underline flex items-center gap-1 {mobile
					? ''
					: 'hover:scale-[1.02] transition-all'} {!downloadExtraSupHabilitado
					? 'pointer-events-none opacity-60'
					: ''}"
				title="Baixar com manifesto (folha de auditoria)"
			>
				<FileDown size={13} class="shrink-0" />
				C/ manifesto
			</a>
		{/if}
	{:else}
		<a
			class="btn btn-xs text-3xs px-2.5 py-1.5 rounded-lg font-semibold no-underline flex items-center gap-1 {mobile
				? ''
				: 'hover:scale-[1.02] transition-all'} {downloadExtraSupConferenciaHabilitado
				? 'preset-tonal-primary border border-primary-500/30 hover:border-primary-500'
				: 'preset-tonal-surface opacity-50 pointer-events-none'}"
			href={urlDownloadExtra}
			target="_blank"
		>
			{@render iconeCaneta()}
			Conferência
		</a>
		{#if isSupervisor && extraSupervisaoConfigurado}
			{#if mobile}
				<button
					type="button"
					class="btn btn-xs preset-filled-warning-500 border border-warning-600/30 px-2.5 py-1.5 text-3xs font-bold rounded-lg hover:border-warning-600 disabled:opacity-40 flex items-center gap-1"
					disabled={!assinaturaExtraHabilitada}
					onclick={() => onAssinarExtraSupervisaoManual?.()}
				>
					{@render iconeCaneta()}
					Tela
				</button>
			{:else}
				<button
					type="button"
					class="btn btn-xs preset-filled-tertiary-500 border border-tertiary-600/30 px-2.5 py-1.5 text-3xs font-bold rounded-lg hover:border-tertiary-600 disabled:opacity-40 flex items-center gap-1 hover:scale-[1.02] transition-all"
					disabled={!assinaturaExtraHabilitada}
					onclick={() => onAssinarExtraSupervisaoDigital?.()}
				>
					{@render iconeCaneta()}
					Token
				</button>
			{/if}
		{/if}
	{/if}
{/snippet}

<div class="flex flex-col gap-1.5 w-full animate-fade">
	{#if !extraSupervisaoConfigurado}
		{#if isMobile}
			<p
				class="text-3xs font-bold uppercase tracking-wider text-surface-400 dark:text-surface-500"
			>
				Relatório de extra (Supervisão e apoio)
			</p>
		{/if}
		<div
			class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-300 p-3.5"
		>
			<p
				class="text-xs text-warning-700 dark:text-warning-400 bg-warning-500/10 border border-warning-500/20 rounded-lg px-3 py-2"
			>
				O relatório de extra do quadro ainda não está disponível. Peça ao administrador para
				executar as migrações.
			</p>
		</div>
	{:else}
		<SupervisaoDocumentoCard
			{isMobile}
			tituloExternoMobile="Relatório de extra (Supervisão e apoio)"
			tituloMobile="Relatório de extra — supervisão e apoio"
			tituloDesktop={assRelSup ? 'Relatório de extra' : 'Relatório de extra (supervisão)'}
			badgeEstado={assRelSup ? 'sucesso' : rubSupOk ? 'alerta' : 'neutro'}
			badgeLabel={assRelSup
				? 'Assinado'
				: rubSupOk
					? 'pronto para assinar'
					: 'Aguardando rubricas'}
			bind:expandido={expandirExtra}
			detalhes={detalhesExtra}
			acoes={acoesExtra}
		/>
	{/if}
</div>
