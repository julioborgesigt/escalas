<script lang="ts">
	/**
	 * Card de documento da escala GISE (assinada / pendente) + painel token
	 * sr-only para assinatura digital do supervisor.
	 */
	import { page } from '$app/state';
	import PainelAssinaturaToken from '$lib/components/PainelAssinaturaToken.svelte';
	import SupervisaoDocumentoCard from '../SupervisaoDocumentoCard.svelte';
	import { FileDown, PenLine } from '@lucide/svelte';
	import { podeBaixarComManifesto } from '$lib/manifesto';
	import type { DocumentoAssinadoInfo, GiseSupervisaoGise } from './types';

	interface Props {
		gise: GiseSupervisaoGise;
		documentoAssinadoInfo: DocumentoAssinadoInfo | null;
		isAdminGeral: boolean;
		isSupervisor: boolean;
		isMobile: boolean;
		podeDownload: boolean;
		mostrarPainelAssinaturaEscala: boolean;
		assinaturaEscalaSignerEmail?: string;
		rubricaCapturada?: string | null | undefined;
		painelTokenGise?: { assinarComSerpro: () => Promise<void> } | null | undefined;
		serproSignerName?: string | undefined;
		serproSignerCpf?: string | undefined;
		onAbrirAssinaturaEscalaManual: () => void;
		onAssinaturaEscalaDigitalSuccess: () => Promise<void>;
	}

	let {
		gise,
		documentoAssinadoInfo,
		isAdminGeral,
		isSupervisor,
		isMobile,
		podeDownload,
		mostrarPainelAssinaturaEscala,
		assinaturaEscalaSignerEmail = undefined,
		rubricaCapturada = $bindable(null),
		painelTokenGise = $bindable(null),
		serproSignerName = $bindable(''),
		serproSignerCpf = $bindable(''),
		onAbrirAssinaturaEscalaManual,
		onAssinaturaEscalaDigitalSuccess
	}: Props = $props();

	const assinaturaEscalaHabilitada = $derived(!!podeDownload);
	const seccionaisPendentes = $derived(
		gise.seccionais?.filter(
			(s) => s.status !== 'preenchida' && s.status !== 'preenchida_retificada'
		) || []
	);

	const urlDocumentoAssinado = $derived(`/api/gise/${gise.id}/documento-assinado`);
	const urlDocumentoAssinadoManifesto = $derived(
		`/api/gise/${gise.id}/documento-assinado?manifesto=true`
	);
	const urlDownloadPdf = $derived(`/api/gise/${gise.id}/download?format=pdf`);

	let expandirEscala = $state(false);
</script>

{#snippet iconeCaneta()}
	<PenLine class="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
{/snippet}

{#snippet detalhesEscala(mobile: boolean)}
	{#if documentoAssinadoInfo?.existe}
		<p class="text-xs font-bold text-surface-800 dark:text-surface-100 break-words">
			{documentoAssinadoInfo.assinante_nome}
		</p>
	{:else}
		<p class="text-2xs leading-snug text-surface-600 dark:text-surface-400">
			O supervisor poderá assinar a escala quando todas as seccionais enviarem a escala.
		</p>
		<p
			class="text-2xs leading-snug text-surface-600 dark:text-surface-400 {mobile ? '' : 'mt-0.5'}"
		>
			<span class="text-error-600 dark:text-error-400 font-medium">Faltando envio de:</span>
			{#if !gise.seccionais || gise.seccionais.length === 0}
				a escalar
			{:else if seccionaisPendentes.length === 0}
				Nenhum
			{:else}
				{seccionaisPendentes.map((s) => s.seccional_nome).join(', ')}
			{/if}
		</p>
	{/if}
{/snippet}

{#snippet acoesEscala(mobile: boolean)}
	{#if documentoAssinadoInfo?.existe}
		{@const podeManifesto = podeBaixarComManifesto(
			page.data.usuario,
			documentoAssinadoInfo.assinante_id
		)}
		<a
			href={urlDocumentoAssinado}
			target="_blank"
			class="btn btn-xs preset-filled-primary-500 px-2.5 py-1.5 text-3xs font-bold rounded-lg no-underline flex items-center gap-1 {mobile
				? ''
				: 'hover:scale-[1.02] transition-all'}"
			title={podeManifesto ? 'Baixar sem manifesto (para impressão)' : 'Baixar PDF assinado'}
		>
			<FileDown size={13} class="shrink-0" />
			{podeManifesto ? 'S/ manifesto' : 'Baixar PDF'}
		</a>
		{#if podeManifesto}
			<a
				href={urlDocumentoAssinadoManifesto}
				target="_blank"
				class="btn btn-xs preset-outlined-primary-500 px-2.5 py-1.5 text-3xs font-bold rounded-lg no-underline flex items-center gap-1 {mobile
					? ''
					: 'hover:scale-[1.02] transition-all'}"
				title="Baixar com manifesto (folha de auditoria)"
			>
				<FileDown size={13} class="shrink-0" />
				C/ manifesto
			</a>
		{/if}
	{:else}
		{#if isSupervisor || isAdminGeral}
			<a
				class="btn btn-xs text-3xs px-2.5 py-1.5 rounded-lg font-semibold no-underline flex items-center gap-1 {mobile
					? ''
					: 'hover:scale-[1.02] transition-all'} {assinaturaEscalaHabilitada
					? 'preset-tonal-primary border border-primary-500/30 hover:border-primary-500'
					: 'preset-tonal-surface opacity-50 pointer-events-none'}"
				href={urlDownloadPdf}
				target="_blank"
				title="Conferência (sem assinatura digital)"
			>
				{@render iconeCaneta()}
				Conferência
			</a>
		{/if}
		{#if isSupervisor}
			{#if mobile}
				<button
					type="button"
					class="btn btn-xs preset-filled-warning-500 border border-warning-600/30 px-2.5 py-1.5 text-3xs font-bold rounded-lg hover:border-warning-600 disabled:opacity-40 flex items-center gap-1"
					disabled={!mostrarPainelAssinaturaEscala}
					onclick={() => onAbrirAssinaturaEscalaManual()}
				>
					{@render iconeCaneta()}
					Tela
				</button>
			{:else}
				<button
					type="button"
					class="btn btn-xs preset-filled-tertiary-500 border border-tertiary-600/30 px-2.5 py-1.5 text-3xs font-bold rounded-lg hover:border-tertiary-600 disabled:opacity-40 flex items-center gap-1 hover:scale-[1.02] transition-all"
					disabled={!mostrarPainelAssinaturaEscala}
					onclick={() => painelTokenGise?.assinarComSerpro()}
				>
					{@render iconeCaneta()}
					Token
				</button>
			{/if}
		{/if}
	{/if}
{/snippet}

<div class="flex flex-col gap-1.5 w-full animate-fade">
	<SupervisaoDocumentoCard
		{isMobile}
		tituloExternoMobile={documentoAssinadoInfo?.existe
			? 'Escala GISE'
			: 'Assinatura da escala GISE'}
		tituloMobile={documentoAssinadoInfo?.existe
			? 'Escala assinada digitalmente'
			: 'Assinatura da escala GISE'}
		tituloDesktop={documentoAssinadoInfo?.existe ? 'Escala GISE' : 'Assinatura da escala GISE'}
		badgeEstado={documentoAssinadoInfo?.existe
			? 'sucesso'
			: gise.status === 'aguardando_assinatura'
				? 'alerta'
				: 'neutro'}
		badgeLabel={documentoAssinadoInfo?.existe
			? 'Assinada'
			: gise.status === 'aguardando_assinatura'
				? 'ass. Pendente'
				: 'em preenchimento'}
		bind:expandido={expandirEscala}
		detalhes={detalhesEscala}
		acoes={acoesEscala}
	/>

	{#if mostrarPainelAssinaturaEscala}
		<div class="sr-only" aria-hidden="true">
			<PainelAssinaturaToken
				bind:control={painelTokenGise}
				bind:signerName={serproSignerName}
				bind:signerCpf={serproSignerCpf}
				signerEmail={assinaturaEscalaSignerEmail ?? ''}
				prepararUrl="/api/gise/{gise.id}/preparar-assinatura"
				finalizarUrl="/api/gise/{gise.id}/finalizar-assinatura"
				nomeArquivo="gise_{gise.data_inicio}_assinada.pdf"
				extraPayload={{ rubrica: rubricaCapturada }}
				disabled={false}
				onSuccess={onAssinaturaEscalaDigitalSuccess}
			/>
		</div>
	{/if}
</div>
