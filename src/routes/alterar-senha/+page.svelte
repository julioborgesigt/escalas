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

<div class="page-header">
	<h1>{primeiroAcesso ? 'Defina sua nova senha' : 'Alterar Senha'}</h1>
</div>

{#if primeiroAcesso}
	<div class="alert alert-warning">
		Este é seu primeiro acesso. Você precisa definir uma nova senha para continuar.
	</div>
{/if}

{#if error}
	<div class="alert alert-error">{error}</div>
{/if}

<div class="card" style="max-width: 500px;">
	<form onsubmit={alterar}>
		{#if !primeiroAcesso}
			<div class="form-group">
				<label for="senha_atual">Senha atual</label>
				<input id="senha_atual" type="password" bind:value={senhaAtual} maxlength="8" required />
			</div>
		{/if}

		<div class="form-group">
			<label for="nova_senha">Nova senha (8 caracteres)</label>
			<input id="nova_senha" type="password" bind:value={novaSenha} maxlength="8" minlength="8" required />
		</div>

		<div class="form-group">
			<label for="confirmar">Confirmar nova senha</label>
			<input id="confirmar" type="password" bind:value={confirmarSenha} maxlength="8" minlength="8" required />
		</div>

		<button type="submit" class="btn btn-primary" disabled={loading}>
			{loading ? 'Salvando...' : 'Salvar nova senha'}
		</button>
	</form>
</div>

<style>
	.alert-warning {
		background: #fef3c7;
		color: #92400e;
		border: 1px solid #fde68a;
		padding: 0.75rem 1rem;
		border-radius: 6px;
		margin-bottom: 1rem;
		font-size: 0.875rem;
	}
</style>
