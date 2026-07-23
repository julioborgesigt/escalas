<script lang="ts">
	import PainelAssinaturaFDS from './PainelAssinaturaFDS.svelte';
	import PainelAssinaturaDigital from './PainelAssinaturaDigital.svelte';
	import type { UsuarioLogado } from '$lib/auth';

	interface DocumentoAssinadoInfo {
		existe: boolean;
		assinante_nome?: string;
		assinante_cpf?: string;
		data?: string;
	}

	let {
		escalaId,
		isFDS,
		policiaisCount,
		usuario,
		podeEditarEscala = true,
		documentoAssinadoInfo = $bindable(),
		finalizadaEm = $bindable(null),
		emailEnvioInicial = null,
		podeOIPSolicitar = false,
		solicitacaoAtual = null,
		onSolicitacaoEnviada
	}: {
		escalaId: string;
		isFDS: boolean;
		policiaisCount: number;
		usuario: UsuarioLogado | null;
		/**
		 * Se o usuário pode EDITAR/FINALIZAR a escala. Um admin_seccional que apenas
		 * visualiza a escala de uma unidade recebe `false` e não vê os controles de
		 * finalizar/reabrir/reenviar do FDS (mas continua vendo downloads). A assinatura
		 * digital (plantão/expediente) segue com regra própria, cross-unidade.
		 */
		podeEditarEscala?: boolean;
		documentoAssinadoInfo: DocumentoAssinadoInfo | null;
		finalizadaEm?: string | null;
		emailEnvioInicial?: string | null;
		podeOIPSolicitar?: boolean;
		solicitacaoAtual?: { tipo: string; destinatario_id?: number } | null;
		onSolicitacaoEnviada?: () => void;
	} = $props();
</script>

{#if isFDS}
	<PainelAssinaturaFDS
		{escalaId}
		{policiaisCount}
		podeEditar={podeEditarEscala}
		bind:finalizadaEm
		{emailEnvioInicial}
	/>
{:else}
	<PainelAssinaturaDigital
		{escalaId}
		{isFDS}
		{policiaisCount}
		{usuario}
		bind:documentoAssinadoInfo
		{podeOIPSolicitar}
		{solicitacaoAtual}
		{onSolicitacaoEnviada}
	/>
{/if}
