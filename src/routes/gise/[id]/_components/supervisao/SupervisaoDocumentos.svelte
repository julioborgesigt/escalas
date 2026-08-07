<script lang="ts">
	/**
	 * DOCUMENTOS do quadro de supervisão — orquestra escala GISE, relatório de
	 * extra e o snippet opcional `loteSection`.
	 *
	 * O que a permissão controla é o BOTÃO de download/assinatura, não a
	 * visibilidade do bloco (`quadroSupervisaoExtraExigeRelatorio`).
	 */
	import type { Snippet } from 'svelte';
	import { quadroSupervisaoExtraExigeRelatorio } from '$lib/gise/supervisao-extra';
	import type { GiseAssinaturaRelatorio } from '$lib/server/schema';
	import SupervisaoDocEscala from './SupervisaoDocEscala.svelte';
	import SupervisaoDocExtra from './SupervisaoDocExtra.svelte';
	import type {
		DocumentoAssinadoInfo,
		GiseSupervisaoGise,
		PolicialOpcao,
		PresencaGiseLinha
	} from './types';

	interface Props {
		gise: GiseSupervisaoGise;
		policiais: PolicialOpcao[];
		isAdminGeral: boolean;
		isSeccional: boolean;
		documentoAssinadoInfo: DocumentoAssinadoInfo | null;
		presencasGise?: PresencaGiseLinha[] | null;
		supervisaoExtraUnidadeId?: number | null;
		assinaturasRelatorios?: GiseAssinaturaRelatorio[] | null;
		podeDownload?: boolean;
		isSupervisor?: boolean;
		isMobile?: boolean;
		onAssinarExtraSupervisaoManual?: () => void;
		onAssinarExtraSupervisaoDigital?: () => void;
		mostrarPainelAssinaturaEscala?: boolean;
		assinaturaEscalaSignerEmail?: string;
		rubricaCapturada?: string | null | undefined;
		painelTokenGise?: { assinarComSerpro: () => Promise<void> } | null | undefined;
		serproSignerName?: string | undefined;
		serproSignerCpf?: string | undefined;
		onAbrirAssinaturaEscalaManual: () => void;
		onAssinaturaEscalaDigitalSuccess: () => Promise<void>;
		loteSection?: Snippet;
	}

	let {
		gise,
		policiais,
		isAdminGeral,
		isSeccional,
		documentoAssinadoInfo,
		presencasGise = null,
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
		loteSection
	}: Props = $props();

	/** Sempre que existir quadro de supervisão com extra — não depende de `podeDownload` (evita sumir para o DPC). */
	const mostrarBlocoExtraSupervisao = $derived(quadroSupervisaoExtraExigeRelatorio(gise));
	const mostrarPainelAssinaturaEscalaReadonly = $derived(
		isAdminGeral && !documentoAssinadoInfo?.existe
	);

	const mostrarSecaoDocumentos = $derived(
		!!documentoAssinadoInfo?.existe ||
			mostrarPainelAssinaturaEscala ||
			mostrarPainelAssinaturaEscalaReadonly ||
			mostrarBlocoExtraSupervisao ||
			!!loteSection ||
			isSupervisor
	);
</script>

{#if mostrarSecaoDocumentos}
	{@const mostrarColEscala =
		!!documentoAssinadoInfo?.existe ||
		mostrarPainelAssinaturaEscala ||
		mostrarPainelAssinaturaEscalaReadonly ||
		isSupervisor}
	<div class="border-t border-surface-200/60 dark:border-surface-700/60 pt-3 mt-4 sm:mt-5">
		<div class="flex flex-col gap-4">
			{#if mostrarColEscala}
				<SupervisaoDocEscala
					{gise}
					{documentoAssinadoInfo}
					{isAdminGeral}
					{isSupervisor}
					{isMobile}
					{podeDownload}
					{mostrarPainelAssinaturaEscala}
					{assinaturaEscalaSignerEmail}
					bind:rubricaCapturada
					bind:painelTokenGise
					bind:serproSignerName
					bind:serproSignerCpf
					{onAbrirAssinaturaEscalaManual}
					{onAssinaturaEscalaDigitalSuccess}
				/>
			{/if}

			{#if mostrarBlocoExtraSupervisao}
				<SupervisaoDocExtra
					{gise}
					{policiais}
					{presencasGise}
					{supervisaoExtraUnidadeId}
					{assinaturasRelatorios}
					{isAdminGeral}
					{isSeccional}
					{isSupervisor}
					{isMobile}
					{podeDownload}
					{onAssinarExtraSupervisaoManual}
					{onAssinarExtraSupervisaoDigital}
				/>
			{/if}

			{@render loteSection?.()}
		</div>
	</div>
{/if}
