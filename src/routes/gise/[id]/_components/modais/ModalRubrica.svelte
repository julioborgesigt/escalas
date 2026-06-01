<script lang="ts">
	import SignaturePad, {
		type SignaturePadConfirmPayload
	} from '$lib/components/SignaturePad.svelte';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';

	interface Props {
		open: boolean;
		exigirFoto: boolean;
		exigirGps: boolean;
		exigirCodigoEmail: boolean;
		onConfirm: (payload: SignaturePadConfirmPayload) => void | Promise<void>;
		onCancel: () => void;
	}

	const { open, exigirFoto, exigirGps, exigirCodigoEmail, onConfirm, onCancel }: Props = $props();

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
				: 'Desenhe sua rubrica no quadro abaixo para assinar a escala.'
	);
</script>

<Dialog
	{open}
	onOpenChange={(e) => {
		if (!e.open) onCancel();
	}}
>
	<Dialog.Content
		class="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-surface-950/80 backdrop-blur-md overflow-y-auto"
	>
		<div
			class="bg-surface-50 dark:bg-surface-900 rounded-2xl shadow-2xl w-full max-w-2xl p-4 sm:p-8 space-y-5 sm:space-y-6 border border-white/10 max-h-[calc(100dvh-1.5rem)] overflow-y-auto"
		>
			<div class="text-center space-y-2">
				<Dialog.Title class="text-xl sm:text-2xl font-bold text-surface-900 dark:text-surface-50">
					{signatureTitulo}
				</Dialog.Title>
				<Dialog.Description class="text-sm text-surface-500">
					{signatureDescricao}
				</Dialog.Description>
			</div>

			{#if open}
				<SignaturePad
					{onConfirm}
					{onCancel}
					{exigirFoto}
					{exigirGps}
					{exigirCodigoEmail}
					bind:step={signatureStep}
				/>
			{/if}

			<p class="text-sm text-surface-400 text-center italic">
				Esta rubrica será anexada permanentemente ao documento PDF desta escala.
			</p>
		</div>
	</Dialog.Content>
</Dialog>
