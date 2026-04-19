<script lang="ts">
	import PainelAssinaturaToken from '$lib/components/PainelAssinaturaToken.svelte';
	import { loading } from '$lib/loading.svelte';

	interface Props {
		giseId: number;
		dataInicio: string;
		isMobile: boolean;
		restringirSmartphone: boolean;
		signerEmail?: string;
		rubricaCapturada: string | null;
		painelTokenControl: { assinarComSerpro: () => Promise<void> } | null;
		signerName: string;
		signerCpf: string;
		onAbrirManual: () => void;
		onSuccessDigital: () => Promise<void>;
	}

	let {
		giseId,
		dataInicio,
		isMobile,
		restringirSmartphone,
		signerEmail,
		rubricaCapturada,
		painelTokenControl = $bindable(),
		signerName = $bindable(),
		signerCpf = $bindable(),
		onAbrirManual,
		onSuccessDigital
	}: Props = $props();

	let expandirManual = $state(false);
	let expandirDigital = $state(false);
</script>

<div id="secao-assinatura-digital" class="space-y-6">
	<h3
		class="flex items-center gap-2 text-lg font-bold uppercase tracking-widest text-primary-500"
	>
		<svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"
			><path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
			/></svg
		>
		Assinar Escala GISE
	</h3>

	<div class="grid grid-cols-1 gap-6">
		<div
			class="card p-5 bg-surface-100/50 dark:bg-surface-800/40 border-2 {isMobile ||
			!restringirSmartphone
				? 'border-primary-500/30'
				: 'border-surface-200 dark:border-white/5 opacity-60'} rounded-3xl flex flex-col justify-start gap-5 shadow-xl transition-all"
		>
			<button
				type="button"
				class="w-full text-left flex flex-col gap-2"
				onclick={() => (expandirManual = !expandirManual)}
			>
				<div class="flex items-center justify-between">
					<h4
						class="font-bold text-sm flex items-center gap-2 text-surface-900 dark:text-surface-50"
					>
						<svg
							class="w-5 h-5 {isMobile || !restringirSmartphone
								? 'text-primary-500'
								: 'text-surface-400'}"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
							/>
						</svg>
						Assinar na Tela (Manual)
					</h4>
					<div class="flex items-center gap-3">
						{#if isMobile || !restringirSmartphone}
							<span
								class="badge preset-filled-primary-500 text-[0.6rem] uppercase font-black px-2 py-0.5"
								>Disponível</span
							>
						{:else}
							<span
								class="badge bg-surface-200 dark:bg-surface-700 text-surface-500 text-[0.6rem] uppercase font-black px-2 py-0.5"
								>Indisponível no PC</span
							>
						{/if}
						<svg
							class="w-4 h-4 text-surface-400 transition-transform duration-300 {expandirManual
								? 'rotate-180'
								: ''}"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M19 9l-7 7-7-7"
							/>
						</svg>
					</div>
				</div>
				<p class="text-xs text-surface-500 leading-relaxed">
					Gera o PDF com sua rubrica manual desenhada diretamente na tela do seu dispositivo. <strong
						>Ideal para tablets e smartphones.</strong
					>
				</p>
			</button>

			{#if expandirManual}
				<div class="pt-4 border-t border-surface-200 dark:border-white/5 flex flex-col gap-5">
					{#if isMobile || !restringirSmartphone}
						<button
							type="button"
							class="btn preset-filled-primary-500 w-full py-3 rounded-2xl font-bold uppercase text-xs shadow-lg shadow-primary-500/20 hover:scale-[1.02] active:scale-95 transition-all"
							disabled={loading.active}
							onclick={onAbrirManual}
						>
							Abrir Painel de Rubrica
						</button>
					{:else}
						<div class="flex-1 flex items-center">
							<div class="bg-error-500/10 p-3 rounded-xl border border-error-500/20 w-full">
								<p
									class="text-[0.7rem] text-error-600 dark:text-error-400 font-bold uppercase text-center leading-tight"
								>
									A assinatura em tela é restrita a dispositivos móveis. Utilize o Token A3 no
									computador.
								</p>
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<div
			class="card p-5 bg-surface-100/50 dark:bg-surface-800/40 border-2 {!isMobile &&
			restringirSmartphone
				? 'border-tertiary-500/30'
				: 'border-surface-200 dark:border-white/5'} rounded-3xl flex flex-col justify-start gap-5 shadow-xl transition-all"
		>
			<button
				type="button"
				class="w-full text-left flex flex-col gap-2"
				onclick={() => (expandirDigital = !expandirDigital)}
			>
				<div class="flex items-center justify-between">
					<h4
						class="font-bold text-sm flex items-center gap-2 text-surface-900 dark:text-surface-50"
					>
						<svg
							class="w-5 h-5 {!isMobile || restringirSmartphone
								? 'text-tertiary-500'
								: 'text-surface-400'}"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
							/>
						</svg>
						Assinatura Digital (Token A3)
					</h4>
					<div class="flex items-center gap-3">
						{#if !isMobile}
							<span
								class="badge preset-filled-tertiary-500 text-[0.6rem] uppercase font-black px-2 py-0.5"
								>Recomendado</span
							>
						{:else}
							<span
								class="badge bg-surface-200 dark:bg-surface-700 text-surface-500 text-[0.6rem] uppercase font-black px-2 py-0.5"
								>Apenas Desktop</span
							>
						{/if}
						<svg
							class="w-4 h-4 text-surface-400 transition-transform duration-300 {expandirDigital
								? 'rotate-180'
								: ''}"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M19 9l-7 7-7-7"
							/>
						</svg>
					</div>
				</div>
				<p class="text-xs text-surface-500 leading-relaxed">
					Assinatura com validade <strong>Qualificada (ICP-Brasil)</strong> usando seu certificado
					digital físico. Requer o Assinador Desktop instalado no computador.
				</p>
			</button>

			{#if expandirDigital}
				<div class="pt-4 border-t border-surface-200 dark:border-white/5 flex flex-col gap-5">
					<PainelAssinaturaToken
						bind:control={painelTokenControl}
						bind:signerName
						bind:signerCpf
						{signerEmail}
						prepararUrl="/api/gise/{giseId}/preparar-assinatura"
						finalizarUrl="/api/gise/{giseId}/finalizar-assinatura"
						nomeArquivo="gise_{dataInicio}_assinada.pdf"
						extraPayload={{ rubrica: rubricaCapturada }}
						disabled={loading.active}
						onSuccess={onSuccessDigital}
					/>

					{#if isMobile}
						<div
							class="bg-surface-200 dark:bg-surface-700/30 p-3 rounded-xl border border-surface-300 dark:border-surface-600/30"
						>
							<p
								class="text-[0.65rem] text-surface-500 font-bold uppercase text-center leading-tight"
							>
								Certificados físicos (USB/Token/Cartão) só podem ser lidos em computadores.
							</p>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>
