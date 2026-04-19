<script lang="ts">
	import PainelAssinaturaToken from '$lib/components/PainelAssinaturaToken.svelte';

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

{#if open}
	<div
		class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md"
	>
		<div
			class="bg-surface-50 dark:bg-surface-900 rounded-3xl shadow-2xl w-full max-w-lg p-8 space-y-6 border border-white/10"
		>
			<div class="text-center space-y-2">
				<h2 class="text-2xl font-bold text-surface-900 dark:text-surface-50">
					Assinatura Digital Individual
				</h2>
				<p class="text-sm text-surface-500">
					Você está assinando o Relatório Extraordinário da seccional: <br />
					<strong class="text-surface-900 dark:text-surface-50">{seccionalNome}</strong>
				</p>
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
				class="w-full btn preset-outlined-surface py-3 rounded-2xl text-sm"
				onclick={onClose}
				{disabled}
			>
				Cancelar e fechar
			</button>
		</div>
	</div>
{/if}
