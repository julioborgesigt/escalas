<script lang="ts">
	import ModalShell from '$lib/components/ModalShell.svelte';
	import SignaturePad from '$lib/components/SignaturePad.svelte';
	import RodapeOpcaoTokenAssinatura from '$lib/components/RodapeOpcaoTokenAssinatura.svelte';
	import type {
		SignaturePadConfirmPayload,
		SignaturePadStep
	} from '$lib/components/SignaturePadTypes';

	interface Props {
		open: boolean;
		exigirFoto: boolean;
		exigirGps: boolean;
		exigirCodigoEmail: boolean;
		/** Rubrica cadastrada do supervisor — reutilizada em vez de exigir novo desenho. */
		rubricaSalva?: string | null;
		credenciaisCombinadas?: boolean;
		cpfUsuario?: string | null;
		onAssinarToken?: (() => void) | null;
		onConfirm: (payload: SignaturePadConfirmPayload) => void | Promise<void>;
		onCancel: () => void;
	}

	const {
		open,
		exigirFoto,
		exigirGps,
		exigirCodigoEmail,
		rubricaSalva = null,
		credenciaisCombinadas = true,
		cpfUsuario = null,
		onAssinarToken = null,
		onConfirm,
		onCancel
	}: Props = $props();

	let signatureStep = $state<SignaturePadStep>('signature');

	$effect(() => {
		if (open) {
			signatureStep = 'signature';
		}
	});

	const signatureTitulo = $derived(
		signatureStep === 'camera'
			? 'Prova de Vida do Supervisor'
			: signatureStep === 'password'
				? 'Confirme sua senha'
				: signatureStep === 'email_code'
					? 'Confirmação de Identidade'
					: signatureStep === 'credenciais'
						? 'Fator de autenticação'
						: 'Rubrica do Supervisor'
	);
	const signatureDescricao = $derived(
		signatureStep === 'camera'
			? 'Cumpra o desafio de presença na tela para provar que você está ativo.'
			: signatureStep === 'password'
				? 'A sessão sozinha não basta. Digite a senha de acesso para assinar.'
				: signatureStep === 'email_code'
					? 'Por razões de segurança, insira o código enviado para o seu e-mail funcional.'
					: signatureStep === 'credenciais'
						? 'Confirme sua senha e o código enviado por e-mail para concluir a assinatura.'
						: rubricaSalva
							? 'Confira sua rubrica cadastrada abaixo para assinar a escala ou desenhe uma nova.'
							: 'Desenhe sua rubrica no quadro abaixo para assinar a escala.'
	);
	const mostrarOpcaoToken = $derived(
		Boolean(onAssinarToken) && (signatureStep === 'signature' || signatureStep === 'credenciais')
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
			{credenciaisCombinadas}
			{cpfUsuario}
			bind:step={signatureStep}
		/>
		{#if mostrarOpcaoToken && onAssinarToken}
			<RodapeOpcaoTokenAssinatura {onAssinarToken} />
		{/if}
	{/if}

	<p class="text-sm text-surface-600 dark:text-surface-400 text-center italic">
		Esta rubrica será anexada permanentemente ao documento PDF desta escala.
	</p>
</ModalShell>
