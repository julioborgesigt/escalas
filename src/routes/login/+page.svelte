<script lang="ts">
	let tipo = $state<'policial' | 'admin'>('policial');
	let matricula = $state('');
	let senha = $state('');
	let error = $state('');
	let loading = $state(false);

	async function login(e: Event) {
		e.preventDefault();
		loading = true;
		error = '';

		const res = await fetch('/api/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ matricula, senha, tipo })
		});

		const data = await res.json();

		if (!res.ok) {
			error = data.error;
			loading = false;
			return;
		}

		if (data.primeiro_acesso) {
			window.location.href = '/alterar-senha';
		} else {
			window.location.href = '/';
		}
	}
</script>

<svelte:head>
	<title>Login - Escalas de Plantão</title>
</svelte:head>

<div class="login-container">
	<div class="login-card">
		<div class="login-header">
			<h1>Escalas de Plantão</h1>
			<p>Faça login para acessar o sistema</p>
		</div>

		<div class="tipo-toggle">
			<button
				class="tipo-btn"
				class:active={tipo === 'policial'}
				onclick={() => { tipo = 'policial'; error = ''; }}
			>
				Policial
			</button>
			<button
				class="tipo-btn"
				class:active={tipo === 'admin'}
				onclick={() => { tipo = 'admin'; error = ''; }}
			>
				Administrador
			</button>
		</div>

		{#if error}
			<div class="alert alert-error">{error}</div>
		{/if}

		<form onsubmit={login}>
			<div class="form-group">
				<label for="matricula">
					{tipo === 'admin' ? 'Login' : 'Matrícula'}
				</label>
				<input
					id="matricula"
					type="text"
					bind:value={matricula}
					placeholder={tipo === 'admin' ? 'Digite seu login' : 'Digite sua matrícula (8 caracteres)'}
					maxlength={tipo === 'admin' ? undefined : 8}
					required
				/>
			</div>

			<div class="form-group">
				<label for="senha">Senha</label>
				<input
					id="senha"
					type="password"
					bind:value={senha}
					placeholder="Digite sua senha"
					maxlength="8"
					required
				/>
			</div>

			<button type="submit" class="btn btn-primary btn-block" disabled={loading}>
				{loading ? 'Entrando...' : 'Entrar'}
			</button>
		</form>

		{#if tipo === 'policial'}
			<p class="login-hint">
				Senha inicial: <strong>12345678</strong> (será solicitada a troca no primeiro acesso)
			</p>
		{/if}
	</div>
</div>

<style>
	.login-container {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg);
		padding: 1rem;
	}

	.login-card {
		background: var(--card-bg);
		border-radius: 12px;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
		padding: 2rem;
		width: 100%;
		max-width: 400px;
	}

	.login-header {
		text-align: center;
		margin-bottom: 1.5rem;
	}

	.login-header h1 {
		color: var(--primary-dark);
		font-size: 1.5rem;
		margin-bottom: 0.25rem;
	}

	.login-header p {
		color: var(--text-light);
		font-size: 0.9rem;
	}

	.tipo-toggle {
		display: flex;
		gap: 0;
		margin-bottom: 1.5rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		overflow: hidden;
	}

	.tipo-btn {
		flex: 1;
		padding: 0.5rem;
		border: none;
		background: transparent;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		color: var(--text-light);
		transition: all 0.2s;
	}

	.tipo-btn.active {
		background: var(--primary);
		color: white;
	}

	.btn-block {
		width: 100%;
		justify-content: center;
		padding: 0.75rem;
		font-size: 1rem;
		margin-top: 0.5rem;
	}

	.login-hint {
		text-align: center;
		margin-top: 1rem;
		font-size: 0.8rem;
		color: var(--text-light);
	}
</style>
