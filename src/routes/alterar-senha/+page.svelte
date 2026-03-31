<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { alterarSenhaSchema } from '$lib/schemas';
	import Spinner from '$lib/components/Spinner.svelte';

	let senhaAtual = $state('');
	let novaSenha = $state('');
	let confirmarSenha = $state('');
	let error = $state('');
	let loading = $state(false);

	const primeiroAcesso = $derived(page.data.primeiro_acesso);

	const senhaOk     = $derived(novaSenha.length === 8);
	const confirmaOk  = $derived(confirmarSenha.length > 0 && novaSenha === confirmarSenha);

	async function alterar(e: Event) {
		e.preventDefault();
		error = '';

		if (novaSenha !== confirmarSenha) {
			error = 'As senhas não conferem.';
			return;
		}

		const parsed = alterarSenhaSchema.safeParse({ nova_senha: novaSenha, senha_atual: senhaAtual || undefined });
		if (!parsed.success) {
			error = parsed.error.issues[0].message;
			return;
		}

		loading = true;

		const body: Record<string, string> = { nova_senha: novaSenha };
		if (!primeiroAcesso) {
			body.senha_atual = senhaAtual;
		}

		const res = await fetch('/api/auth/alterar-senha', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});

		const data = await res.json();

		if (!res.ok) {
			error = data.error;
			loading = false;
			return;
		}

		goto('/');
	}
</script>

<svelte:head>
	<title>{primeiroAcesso ? 'Defina sua senha' : 'Alterar Senha'} | Escalas</title>
</svelte:head>

<div class="min-h-[80vh] flex items-center justify-center p-4">
	<div class="w-full max-w-sm">

		<!-- Card -->
		<div class="p-8 rounded-3xl bg-white/90 dark:bg-surface-900/60 backdrop-blur-xl border border-surface-200 dark:border-white/10 shadow-2xl shadow-black/10 dark:shadow-black/50">

			<!-- Icon + Title -->
			<div class="text-center mb-6">
				<div class="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary-500/10 border border-primary-500/20 mb-4">
					<svg class="w-7 h-7 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
						<path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
					</svg>
				</div>
				<h1 class="text-xl font-bold">
					{primeiroAcesso ? 'Defina sua nova senha' : 'Alterar Senha'}
				</h1>
				<p class="text-sm text-surface-500 mt-1">
					{primeiroAcesso
						? 'Escolha uma senha de 8 caracteres para continuar.'
						: 'Preencha os campos abaixo para alterar sua senha.'}
				</p>
			</div>

			<!-- First-access warning banner -->
			{#if primeiroAcesso}
				<div class="flex items-start gap-2.5 p-3 mb-5 rounded-xl bg-warning-500/10 border border-warning-500/25 text-warning-700 dark:text-warning-300 text-sm">
					<svg class="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
					</svg>
					<span>Este é seu <strong>primeiro acesso</strong>. Defina uma senha pessoal para continuar.</span>
				</div>
			{/if}

			<!-- Error message -->
			{#if error}
				<div class="flex items-center gap-2 p-3 mb-4 rounded-xl bg-error-500/10 border border-error-500/25 text-error-700 dark:text-error-300 text-sm">
					<svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
					{error}
				</div>
			{/if}

			<!-- Form -->
			<form onsubmit={alterar} class="flex flex-col gap-4">

				{#if !primeiroAcesso}
					<label class="label">
						<span class="label-text font-medium">Senha atual</span>
						<input
							class="input"
							type="password"
							bind:value={senhaAtual}
							maxlength="8"
							placeholder="••••••••"
							required
						/>
					</label>
				{/if}

				<label class="label">
					<span class="label-text font-medium">Nova senha <span class="text-surface-400 font-normal">(8 caracteres)</span></span>
					<input
						class="input"
						type="password"
						bind:value={novaSenha}
						maxlength="8"
						minlength="8"
						placeholder="••••••••"
						required
					/>
					<!-- Length indicator dots -->
					<div class="flex gap-1 mt-1.5">
						{#each Array(8) as _, i}
							<div class="h-1 flex-1 rounded-full transition-colors duration-150 {i < novaSenha.length ? 'bg-primary-500' : 'bg-surface-200 dark:bg-surface-700'}"></div>
						{/each}
					</div>
				</label>

				<label class="label">
					<span class="label-text font-medium">Confirmar nova senha</span>
					<div class="relative">
						<input
							class="input {confirmarSenha.length > 0 ? (confirmaOk ? 'border-success-500 focus:ring-success-500' : 'border-error-500 focus:ring-error-500') : ''}"
							type="password"
							bind:value={confirmarSenha}
							maxlength="8"
							minlength="8"
							placeholder="••••••••"
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
					disabled={loading || !senhaOk || !confirmaOk}
				>
					{#if loading}<Spinner size="md" />{/if}
					{loading ? 'Salvando...' : (primeiroAcesso ? 'Definir senha e continuar' : 'Salvar nova senha')}
				</button>

			</form>
		</div>

	</div>
</div>
