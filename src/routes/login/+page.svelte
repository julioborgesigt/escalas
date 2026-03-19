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

<div class="min-h-screen flex items-center justify-center p-4">
	<div class="w-full max-w-sm p-8 rounded-3xl bg-surface-900/60 backdrop-blur-xl border border-white/10 shadow-2xl shadow-black/50">
		<div class="text-center mb-6">
			<h1 class="h1 text-xl font-bold mb-1">Escalas de Plantão</h1>
			<p class="text-surface-500 text-sm">Faça login para acessar o sistema</p>
		</div>

		<!-- Toggle Policial/Admin -->
		<div class="flex mb-8 bg-surface-900/50 p-1 rounded-xl border border-white/5">
			<button
				class="flex-1 py-2 text-sm font-medium transition-colors {tipo === 'policial' ? 'preset-filled-primary-500' : 'text-surface-500'}"
				onclick={() => { tipo = 'policial'; error = ''; }}
			>
				Policial
			</button>
			<button
				class="flex-1 py-2 text-sm font-medium transition-colors {tipo === 'admin' ? 'preset-filled-primary-500' : 'text-surface-500'}"
				onclick={() => { tipo = 'admin'; error = ''; }}
			>
				Administrador
			</button>
		</div>

		{#if error}
			<aside class="alert preset-filled-error-500 mb-4 p-3 rounded-lg text-sm">{error}</aside>
		{/if}

		<form onsubmit={login} class="space-y-4">
			<label class="label">
				<span class="label-text">{tipo === 'admin' ? 'Login' : 'Matrícula'}</span>
				<input
					class="input"
					type="text"
					bind:value={matricula}
					placeholder={tipo === 'admin' ? 'Digite seu login' : 'Digite sua matrícula (8 caracteres)'}
					maxlength={tipo === 'admin' ? undefined : 8}
					required
				/>
			</label>

			<label class="label">
				<span class="label-text">Senha</span>
				<input
					class="input"
					type="password"
					bind:value={senha}
					placeholder="Digite sua senha"
					maxlength="8"
					required
				/>
			</label>

			<button type="submit" class="btn preset-filled-primary-500 w-full py-3" disabled={loading}>
				{loading ? 'Entrando...' : 'Entrar'}
			</button>
		</form>

		{#if tipo === 'policial'}
			<p class="text-center mt-4 text-xs text-surface-500">
				Senha inicial: <strong>12345678</strong> (será solicitada a troca no primeiro acesso)
			</p>
		{/if}
	</div>
</div>
