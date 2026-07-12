<script lang="ts">
	import PainelAssinaturaToken from '$lib/components/PainelAssinaturaToken.svelte';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';

	interface Props {
		open: boolean;
		giseId: number;
		seccionalId: number;
		seccionalNome: string;
		signerEmail?: string;
		disabled: boolean;
		control: { assinarComSerpro: () => Promise<void> } | null;
		signerName: string;
		signerCpf: string;
		onSuccess: () => Promise<void>;
		onClose: () => void;
	}

	let {
		open,
		giseId,
		seccionalId,
		seccionalNome,
		signerEmail,
		disabled,
		control = $bindable(),
		signerName = $bindable(),
		signerCpf = $bindable(),
		onSuccess,
		onClose
	}: Props = $props();
</script>

<Dialog
	{open}
	onOpenChange={(e) => {
		if (!disabled && !e.open) onClose();
	}}
>
	<Dialog.Content
		class="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-surface-950/80 backdrop-blur-md overflow-y-auto"
	>
		<div
			class="card-elevated rounded-2xl shadow-2xl w-full max-w-lg p-5 sm:p-8 space-y-5 sm:space-y-6 border border-white/10 max-h-[calc(100dvh-1.5rem)] overflow-y-auto"
		>
			<div class="text-center space-y-2">
				<Dialog.Title class="text-xl sm:text-2xl font-bold text-surface-900 dark:text-surface-50">
					Assinatura Digital Individual
				</Dialog.Title>
				<Dialog.Description class="text-sm text-surface-500">
					Você está assinando o Relatório Extraordinário da seccional: <br />
					<strong class="text-surface-900 dark:text-surface-50">{seccionalNome}</strong>
				</Dialog.Description>
			</div>

			<PainelAssinaturaToken
				bind:control
				bind:signerName
				bind:signerCpf
				{signerEmail}
				prepararUrl="/api/gise/{giseId}/relatorios/{seccionalId}/preparar-assinatura"
				finalizarUrl="/api/gise/{giseId}/relatorios/{seccionalId}/finalizar-assinatura"
				nomeArquivo="relatorio_extraordinario_{seccionalNome}.pdf"
				{disabled}
				{onSuccess}
			/>

			<button
				type="button"
				class="w-full btn preset-outlined-surface-500 py-3 rounded-2xl text-sm"
				onclick={onClose}
				{disabled}
			>
				Cancelar e fechar
			</button>
		</div>
	</Dialog.Content>
</Dialog>
