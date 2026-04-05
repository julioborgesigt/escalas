<script lang="ts">
	import { goto } from '$app/navigation';
	import { toaster } from '$lib/toast';
	import { loginSchema } from '$lib/schemas';
	import Spinner from '$lib/components/Spinner.svelte';
	import { csrfHeaders } from '$lib/csrf';

	let tipo = $state<'policial' | 'admin'>('policial');
	let matricula = $state('');
	let senha = $state('');
	let loading = $state(false);

	// Estado do passo 2FA
	let pendente2FA = $state(false);
	let desafioId = $state('');
	let codigo2FA = $state('');
	let tipoUsuario2FA = $state<'policial' | 'admin'>('policial');

	async function login(e: Event) {
		e.preventDefault();

		const parsed = loginSchema.safeParse({ matricula, senha, tipo });
		if (!parsed.success) {
			toaster.create({ title: parsed.error.issues[0].message, type: 'error' });
			return;
		}

		loading = true;
		try {
			const res = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
				body: JSON.stringify(parsed.data)
			});

			if (res.ok) {
				const data = await res.json();
				if (data.pendente2FA) {
					// Código enviado por e-mail — mostrar formulário 2FA
					desafioId = data.desafioId;
					tipoUsuario2FA = tipo;
					pendente2FA = true;
					toaster.create({ title: 'Código enviado para o seu e-mail!', type: 'success' });
				} else if (data.primeiro_acesso) {
					goto('/alterar-senha', { invalidateAll: true });
				} else {
					goto(tipo === 'admin' ? '/painel' : '/escalas', { invalidateAll: true });
				}
			} else {
				const data = await res.json();
				toaster.create({ title: data.error || 'Credenciais inválidas', type: 'error' });
			}
		} catch {
			toaster.create({ title: 'Erro de conexão. Verifique sua rede.', type: 'error' });
		} finally {
			loading = false;
		}
	}

	async function verificar2FA(e: Event) {
		e.preventDefault();
		if (codigo2FA.length !== 6) {
			toaster.create({ title: 'Informe o código de 6 dígitos', type: 'error' });
			return;
		}

		loading = true;
		try {
			const res = await fetch('/api/auth/verificar-2fa', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
				body: JSON.stringify({ desafioId, codigo: codigo2FA })
			});

			if (res.ok) {
				const data = await res.json();
				if (data.primeiro_acesso) {
					goto('/alterar-senha', { invalidateAll: true });
				} else {
					goto(tipoUsuario2FA === 'admin' ? '/painel' : '/escalas', { invalidateAll: true });
				}
			} else {
				const data = await res.json();
				toaster.create({ title: data.error || 'Código inválido', type: 'error' });
				if (data.expirado || data.esgotado) {
					voltarLogin();
				}
			}
		} catch {
			toaster.create({ title: 'Erro de conexão. Verifique sua rede.', type: 'error' });
		} finally {
			loading = false;
		}
	}

	function voltarLogin() {
		pendente2FA = false;
		desafioId = '';
		codigo2FA = '';
	}
</script>

<svelte:head>
	<title>Login - Escalas de Plantão</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center p-4">
	<div class="w-full max-w-sm p-8 rounded-3xl bg-white/90 dark:bg-surface-900/60 backdrop-blur-xl border border-surface-200 dark:border-white/10 shadow-2xl shadow-black/10 dark:shadow-black/50">
		<div class="text-center mb-6">
			<h1 class="h1 text-xl font-bold mb-1">Escalas de Plantão</h1>
			<p class="text-surface-600 dark:text-surface-500 text-sm">Faça login para acessar o sistema</p>
		</div>

		{#if !pendente2FA}
			<!-- ===== Formulário de credenciais ===== -->
			<div class="flex mb-8 bg-surface-100 dark:bg-surface-900/50 p-1 rounded-xl border border-surface-200 dark:border-white/5">
				<button
					class="flex-1 py-2 text-sm font-medium transition-colors {tipo === 'policial' ? 'preset-filled-primary-500' : 'text-surface-500'}"
					onclick={() => { tipo = 'policial'; }}
				>
					Policial
				</button>
				<button
					class="flex-1 py-2 text-sm font-medium transition-colors {tipo === 'admin' ? 'preset-filled-primary-500' : 'text-surface-500'}"
					onclick={() => { tipo = 'admin'; }}
				>
					Administrador
				</button>
			</div>

			<form onsubmit={login} class="flex flex-col gap-6">
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

				<button
					type="submit"
					class="btn preset-filled-primary-500 w-full py-3 flex items-center justify-center gap-2"
					disabled={loading}
				>
					{#if loading}<Spinner size="md" />{/if}
					{loading ? 'Entrando...' : 'Entrar'}
				</button>
			</form>

			{#if tipo === 'policial'}
				<p class="text-center mt-4 text-xs text-surface-500">
					Senha inicial: <strong>12345678</strong> (será solicitada a troca no primeiro acesso)
				</p>
			{/if}
		{:else}
			<!-- ===== Formulário de verificação 2FA ===== -->
			<div class="text-center mb-6">
				<div class="text-5xl mb-3">📧</div>
				<p class="font-semibold mb-1">Verificação em dois fatores</p>
				<p class="text-sm text-surface-600 dark:text-surface-400">
					Enviamos um código de 6 dígitos para o e-mail cadastrado.
				</p>
			</div>

			<form onsubmit={verificar2FA} class="flex flex-col gap-5">
				<label class="label">
					<span class="label-text text-center block">Código de verificação</span>
					<input
						class="input text-center text-3xl font-bold tracking-[0.4em] py-3"
						type="text"
						bind:value={codigo2FA}
						placeholder="000000"
						maxlength="6"
						pattern="[0-9]{6}"
						inputmode="numeric"
						autocomplete="one-time-code"
						autofocus
						required
					/>
				</label>

				<button
					type="submit"
					class="btn preset-filled-primary-500 w-full py-3 flex items-center justify-center gap-2"
					disabled={loading || codigo2FA.length !== 6}
				>
					{#if loading}<Spinner size="md" />{/if}
					{loading ? 'Verificando...' : 'Confirmar'}
				</button>

				<button type="button" class="btn preset-outlined w-full" onclick={voltarLogin}>
					← Voltar
				</button>
			</form>

			<p class="text-center mt-4 text-xs text-surface-500">
				O código expira em <strong>10 minutos</strong>.
			</p>
		{/if}
	</div>
</div>
