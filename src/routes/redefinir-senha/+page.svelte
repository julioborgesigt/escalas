<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { loading } from '$lib/loading.svelte';
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();

	let novaSenha = $state('');
	let confirmarSenha = $state('');
	let erroForm = $state('');

	const temMinimo    = $derived(novaSenha.length >= 8);
	const temMaiuscula = $derived(/[A-Z]/.test(novaSenha));
	const temMinuscula = $derived(/[a-z]/.test(novaSenha));
	const temNumero    = $derived(/[0-9]/.test(novaSenha));
	const senhaOk      = $derived(temMinimo && temMaiuscula && temMinuscula && temNumero);
	const confirmaOk   = $derived(confirmarSenha.length > 0 && novaSenha === confirmarSenha);

	function handleRedefinir({ cancel }: { cancel: () => void }) {
		erroForm = '';
		if (novaSenha !== confirmarSenha) {
			erroForm = 'As senhas não conferem.';
			cancel();
			return;
		}
		loading.show('Salvando nova senha...');
		return async ({ result }: { result: any }) => {
			loading.hide();
			if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				erroForm = String(d?.error || 'Erro ao redefinir a senha.');
			} else if (result.type === 'redirect') {
				await goto(result.location, { invalidateAll: true });
			}
		};
	}
</script>

<svelte:head>
	<title>Redefinir Senha | Escalas</title>
</svelte:head>

<div class="min-h-[80vh] flex items-center justify-center p-4">
	<div class="w-full max-w-sm">
		<div class="p-6 sm:p-8 rounded-3xl bg-white/90 dark:bg-surface-900/60 backdrop-blur-xl border border-surface-200 dark:border-white/10 shadow-2xl shadow-black/10 dark:shadow-black/50">

			{#if !data.valido}
				<!-- Token inválido / expirado -->
				<div class="text-center">
					<div class="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-error-500/10 border border-error-500/20 mb-4">
						<svg class="w-7 h-7 text-error-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
							<path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
						</svg>
					</div>
					<h1 class="text-xl font-bold mb-2">Link inválido</h1>
					<p class="text-sm text-surface-500 mb-6">{data.erro}</p>
					<a href="/login" class="btn preset-filled-primary-500 w-full no-underline justify-center">
						Ir para o login
					</a>
				</div>
			{:else}
				<!-- Formulário de nova senha -->
				<div class="text-center mb-6">
					<div class="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary-500/10 border border-primary-500/20 mb-4">
						<svg class="w-7 h-7 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
							<path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
						</svg>
					</div>
					<h1 class="text-xl font-bold">Definir nova senha</h1>
					<p class="text-sm text-surface-500 mt-1">Escolha uma senha segura para sua conta.</p>
				</div>

				{#if erroForm}
					<div class="flex items-center gap-2 p-3 mb-4 rounded-xl bg-error-500/10 border border-error-500/25 text-error-700 dark:text-error-300 text-sm">
						<svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
						{erroForm}
					</div>
				{/if}

				<form method="POST" action="?/redefinir" use:enhance={handleRedefinir} class="flex flex-col gap-4">
					<input type="hidden" name="token" value={data.token} />

					<label class="label">
						<span class="label-text font-medium">Nova senha</span>
						<input
							class="input"
							type="password"
							name="nova_senha"
							bind:value={novaSenha}
							required
						/>
					</label>

					<!-- Requisitos de senha -->
					<div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs px-0.5">
						{#snippet req(ok: boolean, label: string)}
							<div class="flex items-center gap-1.5 {ok ? 'text-success-600 dark:text-success-400' : 'text-surface-400'}">
								{#if ok}
									<svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
								{:else}
									<svg class="w-3.5 h-3.5 shrink-0 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>
								{/if}
								{label}
							</div>
						{/snippet}
						{@render req(temMinimo,    'Mínimo 8 caracteres')}
						{@render req(temMaiuscula, 'Letra maiúscula (A-Z)')}
						{@render req(temMinuscula, 'Letra minúscula (a-z)')}
						{@render req(temNumero,    'Pelo menos um número')}
					</div>

					<label class="label">
						<span class="label-text font-medium">Confirmar nova senha</span>
						<div class="relative">
							<input
								class="input {confirmarSenha.length > 0 ? (confirmaOk ? 'border-success-500 focus:ring-success-500' : 'border-error-500 focus:ring-error-500') : ''}"
								type="password"
								name="confirmar_senha"
								bind:value={confirmarSenha}
								required
							/>
							{#if confirmarSenha.length > 0}
								<div class="absolute inset-y-0 right-3 flex items-center pointer-events-none">
									{#if confirmaOk}
										<svg class="w-4 h-4 text-success-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
									{:else}
										<svg class="w-4 h-4 text-error-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
									{/if}
								</div>
							{/if}
						</div>
					</label>

					<button
						type="submit"
						class="btn preset-filled-primary-500 w-full py-3 mt-1 font-semibold tracking-wide flex items-center justify-center gap-2"
						disabled={loading.active || !senhaOk || !confirmaOk}
					>
						{loading.active ? 'Salvando...' : 'Definir nova senha'}
					</button>
				</form>
			{/if}

		</div>
	</div>
</div>
