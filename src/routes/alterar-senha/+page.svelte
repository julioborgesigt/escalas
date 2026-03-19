<script lang="ts">
	import { page } from '$app/stores';

	let senhaAtual = $state('');
	let novaSenha = $state('');
	let confirmarSenha = $state('');
	let error = $state('');
	let loading = $state(false);

	const primeiroAcesso = $derived($page.data.primeiro_acesso);

	async function alterar(e: Event) {
		e.preventDefault();
		error = '';

		if (novaSenha.length !== 8) {
			error = 'A nova senha deve ter exatamente 8 caracteres';
			return;
		}

		if (novaSenha !== confirmarSenha) {
			error = 'As senhas não conferem';
			return;
		}

		if (novaSenha === '12345678') {
			error = 'Escolha uma senha diferente da padrão';
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

		window.location.href = '/';
	}
</script>

<div class="flex items-center justify-between mb-6">
	<h1 class="h1 text-xl font-bold">{primeiroAcesso ? 'Defina sua nova senha' : 'Alterar Senha'}</h1>
</div>

{#if primeiroAcesso}
	<aside class="preset-tonal-warning p-3 rounded-lg text-sm mb-4">
		Este é seu primeiro acesso. Você precisa definir uma nova senha para continuar.
	</aside>
{/if}

{#if error}
	<aside class="preset-filled-error-500 p-3 rounded-lg text-sm mb-4">{error}</aside>
{/if}

<div class="card p-6 max-w-md">
	<form onsubmit={alterar} class="space-y-4">
		{#if !primeiroAcesso}
			<label class="label">
				<span class="label-text">Senha atual</span>
				<input class="input" type="password" bind:value={senhaAtual} maxlength="8" required />
			</label>
		{/if}

		<label class="label">
			<span class="label-text">Nova senha (8 caracteres)</span>
			<input class="input" type="password" bind:value={novaSenha} maxlength="8" minlength="8" required />
		</label>

		<label class="label">
			<span class="label-text">Confirmar nova senha</span>
			<input class="input" type="password" bind:value={confirmarSenha} maxlength="8" minlength="8" required />
		</label>

		<button type="submit" class="btn preset-filled-primary-500" disabled={loading}>
			{loading ? 'Salvando...' : 'Salvar nova senha'}
		</button>
	</form>
</div>
