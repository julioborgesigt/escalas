<script lang="ts">
	/**
	 * Fluxo 3: primeiro acesso — pede o link/senha provisória por matrícula.
	 * Respostas genéricas: a tela só repete o que o servidor devolve.
	 */
	import { Inbox, KeyRound } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import { loading as loadingService } from '$lib/loading.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';

	let {
		matriculaPrimeiroAcesso = $bindable(),
		primeiroAcessoEnviado,
		handlePrimeiroAcesso,
		onVoltar
	}: {
		matriculaPrimeiroAcesso: string;
		primeiroAcessoEnviado: boolean;
		handlePrimeiroAcesso: SubmitFunction;
		onVoltar: () => void;
	} = $props();
</script>

{#if !primeiroAcessoEnviado}
	<div class="text-center mb-6">
		<KeyRound
			class="w-12 h-12 mx-auto mb-3 text-surface-600 dark:text-surface-400"
			aria-hidden="true"
		/>
		<p class="font-semibold mb-1">Primeiro acesso</p>
		<p class="text-sm text-surface-600 dark:text-surface-400">
			Informe sua matrícula para receber uma senha provisória no e-mail cadastrado.
		</p>
	</div>
	<form
		method="POST"
		action="?/solicitarPrimeiroAcesso"
		use:enhance={handlePrimeiroAcesso}
		class="flex flex-col gap-5"
	>
		<label class="label">
			<span class="label-text">Matrícula</span>
			<input
				class="input"
				type="text"
				name="matricula"
				bind:value={matriculaPrimeiroAcesso}
				placeholder="Digite sua matrícula"
				maxlength="8"
				required
			/>
		</label>
		<button
			type="submit"
			class="btn preset-filled-primary-500 w-full py-3 flex items-center justify-center gap-2"
			disabled={loadingService.active}
		>
			{loadingService.active ? 'Enviando...' : 'Enviar senha provisória'}
		</button>
		<button type="button" class="btn preset-outlined w-full" onclick={onVoltar}>
			← Voltar
		</button>
	</form>
{:else}
	<div class="text-center">
		<Inbox
			class="w-12 h-12 mx-auto mb-4 text-surface-600 dark:text-surface-400"
			aria-hidden="true"
		/>
		<p class="font-semibold mb-2">E-mail enviado!</p>
		<p class="text-sm text-surface-600 dark:text-surface-400 mb-6">
			Se a matrícula estiver cadastrada com e-mail, você receberá a senha provisória em
			instantes. Verifique também sua caixa de spam.
		</p>
		<button type="button" class="btn preset-filled-primary-500 w-full" onclick={onVoltar}>
			Ir para o login
		</button>
	</div>
{/if}
