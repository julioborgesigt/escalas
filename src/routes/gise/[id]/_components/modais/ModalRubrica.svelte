<script lang="ts">
	import ModalShell from '$lib/components/ModalShell.svelte';
	import SignaturePad from '$lib/components/SignaturePad.svelte';
	import type { SignaturePadConfirmPayload } from '$lib/components/SignaturePadTypes';

	interface Props {
		open: boolean;
		exigirFoto: boolean;
		exigirGps: boolean;
		exigirCodigoEmail: boolean;
		/** Rubrica cadastrada do supervisor — reutilizada em vez de exigir novo desenho. */
		rubricaSalva?: string | null;
		onConfirm: (payload: SignaturePadConfirmPayload) => void | Promise<void>;
		onCancel: () => void;
	}

	const {
		open,
		exigirFoto,
		exigirGps,
		exigirCodigoEmail,
		rubricaSalva = null,
		onConfirm,
		onCancel
	}: Props = $props();

	let signatureStep = $state<'signature' | 'camera' | 'email_code'>('signature');

	$effect(() => {
		if (open) {
			signatureStep = 'signature';
		}
	});

	const signatureTitulo = $derived(
		signatureStep === 'camera'
			? 'Prova de Vida do Supervisor'
			: signatureStep === 'email_code'
				? 'Confirmação de Identidade'
				: 'Rubrica do Supervisor'
	);
	const signatureDescricao = $derived(
		signatureStep === 'camera'
			? 'Cumpra o desafio de presença na tela para provar que você está ativo.'
			: signatureStep === 'email_code'
				? 'Por razões de segurança, insira o código enviado para o seu e-mail funcional.'
				: rubricaSalva
					? 'Confira sua rubrica cadastrada abaixo para assinar a escala ou desenhe uma nova.'
					: 'Desenhe sua rubrica no quadro abaixo para assinar a escala.'
	);
</script>

<ModalShell
	{open}
	title={signatureTitulo}
	description={signatureDescricao}
	largura="2xl"
	camada="empilhado"
	padding="compacto"
	familia="assinatura"
	onOpenChange={(novoOpen) => {
		if (!novoOpen) onCancel();
	}}
>
	{#if open}
		<SignaturePad
			{onConfirm}
			{onCancel}
			{exigirFoto}
			{exigirGps}
			{exigirCodigoEmail}
			{rubricaSalva}
			bind:step={signatureStep}
		/>
	{/if}

	<p class="text-sm text-surface-600 dark:text-surface-400 text-center italic">
		Esta rubrica será anexada permanentemente ao documento PDF desta escala.
	</p>
</ModalShell>
