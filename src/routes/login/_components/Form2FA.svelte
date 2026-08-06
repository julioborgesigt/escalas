<script lang="ts">
	/**
	 * Fluxo 1 (passo 2): verificação 2FA por e-mail após login com senha.
	 */
	import { Mail } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import { loading as loadingService } from '$lib/loading.svelte';
	import CodigoTimer from '$lib/components/CodigoTimer.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';

	let {
		desafioId,
		codigo2FA = $bindable(),
		emailMascarado,
		handleVerificar2FA,
		reenviarCodigo2FA,
		onVoltar
	}: {
		desafioId: string;
		codigo2FA: string;
		emailMascarado: string;
		handleVerificar2FA: SubmitFunction;
		reenviarCodigo2FA: () => Promise<void>;
		onVoltar: () => void;
	} = $props();
</script>

<div class="text-center mb-6">
	<Mail class="w-12 h-12 mx-auto mb-3 text-surface-600 dark:text-surface-400" aria-hidden="true" />
	<p class="font-semibold mb-1">Verificação em dois fatores</p>
</div>

<form
	method="POST"
	action="?/verificar2FA"
	use:enhance={handleVerificar2FA}
	class="flex flex-col gap-5"
>
	<input type="hidden" name="desafioId" value={desafioId} />
	<label class="label">
		<span class="label-text text-center block">Código de verificação</span>
		<input
			class="input text-center text-3xl font-bold tracking-[0.4em] py-3"
			type="text"
			name="codigo"
			value={codigo2FA}
			oninput={(e) => (codigo2FA = e.currentTarget.value.replace(/\D/g, '').slice(0, 6))}
			placeholder="000000"
			maxlength="6"
			inputmode="numeric"
			autocomplete="one-time-code"
		/>
	</label>

	<CodigoTimer {emailMascarado} onReenviar={reenviarCodigo2FA} />

	<button
		type="submit"
		class="btn preset-filled-primary-500 w-full py-3 flex items-center justify-center gap-2"
		disabled={loadingService.active || codigo2FA.length !== 6}
	>
		{loadingService.active ? 'Verificando...' : 'Confirmar'}
	</button>

	<button type="button" class="btn preset-outlined w-full" onclick={onVoltar}> ← Voltar </button>
</form>
