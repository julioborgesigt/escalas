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
