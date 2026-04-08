<script lang="ts">
	import { goto } from '$app/navigation';
	import { toaster } from '$lib/toast';
	import { loginSchema } from '$lib/schemas';
	import Spinner from '$lib/components/Spinner.svelte';

	/** Parse resposta de Form Action SvelteKit (array compactado ou objeto) */
	function parseFormResponse(
		raw: Record<string, unknown> | undefined
	): Record<string, unknown> | undefined {
		if (raw?.type === 'success') {
			// O SvelteKit envia data como string JSON
			let arr: unknown[] | null = null;
			if (typeof raw.data === 'string') {
				try {
					arr = JSON.parse(raw.data);
				} catch {
					/* ignore */
				}
			} else if (Array.isArray(raw.data)) {
				arr = raw.data;
			}
			if (arr && arr.length > 0 && typeof arr[0] === 'object' && !Array.isArray(arr[0])) {
				const keyMap = arr[0] as Record<string, number>;
				const obj: Record<string, unknown> = {};
				for (const [key, idx] of Object.entries(keyMap)) {
					obj[key] = arr[idx];
				}
				return obj;
			}
		}
		return raw as Record<string, unknown> | undefined;
	}

	let tipo = $state<'policial' | 'admin'>('policial');
	let matricula = $state('');
	let senha = $state('');
	let loading = $state(false);

	// Estado do passo 2FA
	let pendente2FA = $state(false);
	let desafioId = $state('');
	let codigo2FA = $state('');
	let tipoUsuario2FA = $state<'policial' | 'admin'>('policial');
	let emailMascarado = $state('');

	// Estado do primeiro acesso
	let primeiroAcesso = $state(false);
	let matriculaPrimeiroAcesso = $state('');
	let primeiroAcessoEnviado = $state(false);

	async function login(e: Event) {
		e.preventDefault();

		const parsed = loginSchema.safeParse({ matricula, senha, tipo });
		if (!parsed.success) {
			toaster.create({ title: parsed.error.issues[0].message, type: 'error' });
			return;
		}

		loading = true;
		try {
			const fd = new FormData();
			fd.set('matricula', matricula);
			fd.set('senha', senha);
			fd.set('tipo', tipo);

			console.log('[login] Enviando request...');
			const resp = await fetch('?/login', { method: 'POST', body: fd });
			console.log('[login] Response status:', resp.status);
			const raw = (await resp.json()) as Record<string, unknown> | undefined;
			console.log('[login] Raw response:', raw);

			// SvelteKit serializa sucesso como array compacto:
			// [{keyMap}, val1, val2, ...] → converter para objeto
			const data = parseFormResponse(raw);
			console.log('[login] Parsed data:', data);

			if (!resp.ok) {
				toaster.create({
					title: (data?.error as string) || 'Credenciais inválidas',
					type: 'error'
				});
				return;
			}

			if (data?.pendente2FA) {
				desafioId = (data.desafioId as string) || '';
				tipoUsuario2FA = (data.tipoUsuario2FA as 'policial' | 'admin') || tipo;
				emailMascarado = (data.emailMascarado as string) || '';
				pendente2FA = true;
				toaster.create({ title: 'Código enviado para o seu e-mail!', type: 'success' });
			} else if (data?.redirect) {
				goto(data.redirect as string, { invalidateAll: true });
			} else {
				toaster.create({ title: 'Resposta inesperada do servidor', type: 'error' });
			}
		} catch (err) {
			console.error('[login] Erro:', err);
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
			const fd = new FormData();
			fd.set('desafioId', desafioId);
			fd.set('codigo', codigo2FA);

			const resp = await fetch('?/verificar2FA', { method: 'POST', body: fd });
			const raw = (await resp.json()) as Record<string, unknown> | undefined;
			const data = parseFormResponse(raw);

			if (!resp.ok) {
				toaster.create({ title: (data?.error as string) || 'Código inválido', type: 'error' });
				if (data?.expirado || data?.esgotado) {
					voltarLogin();
				}
				return;
			}

			if (data?.redirect) {
				goto(data.redirect as string, { invalidateAll: true });
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

	async function solicitarPrimeiroAcesso(e: Event) {
		e.preventDefault();
		if (!matriculaPrimeiroAcesso.trim()) return;
		loading = true;
		try {
			const fd = new FormData();
			fd.set('matricula', matriculaPrimeiroAcesso.trim());

			const resp = await fetch('?/solicitarPrimeiroAcesso', { method: 'POST', body: fd });
			const raw = (await resp.json()) as Record<string, unknown> | undefined;
			const data = parseFormResponse(raw);

			if (!resp.ok) {
				toaster.create({
					title: (data?.error as string) || 'Erro ao processar solicitação.',
					type: 'error'
				});
			} else {
				primeiroAcessoEnviado = true;
			}
		} catch {
			toaster.create({ title: 'Erro de conexão. Verifique sua rede.', type: 'error' });
		} finally {
			loading = false;
		}
	}

	function voltarParaLogin() {
		primeiroAcesso = false;
		primeiroAcessoEnviado = false;
		matriculaPrimeiroAcesso = '';
	}
</script>

<svelte:head>
	<title>Login - Escalas de Plantão</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center p-4">
	<div
		class="w-full max-w-sm p-8 rounded-3xl bg-white/90 dark:bg-surface-900/60 backdrop-blur-xl border border-surface-200 dark:border-white/10 shadow-2xl shadow-black/10 dark:shadow-black/50"
	>
		<div class="text-center mb-6">
			<h1 class="h1 text-xl font-bold mb-1">Escalas de Plantão</h1>
			<p class="text-surface-600 dark:text-surface-500 text-sm">
				Faça login para acessar o sistema
			</p>
		</div>

		{#if !pendente2FA && !primeiroAcesso}
			<!-- ===== Formulário de credenciais ===== -->
			<div
				class="flex mb-8 bg-surface-100 dark:bg-surface-900/50 p-1 rounded-xl border border-surface-200 dark:border-white/5"
			>
				<button
					class="flex-1 py-2 text-sm font-medium transition-colors {tipo === 'policial'
						? 'preset-filled-primary-500'
						: 'text-surface-500'}"
					onclick={() => {
						tipo = 'policial';
					}}
				>
					Policial
				</button>
				<button
					class="flex-1 py-2 text-sm font-medium transition-colors {tipo === 'admin'
						? 'preset-filled-primary-500'
						: 'text-surface-500'}"
					onclick={() => {
						tipo = 'admin';
					}}
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
						placeholder={tipo === 'admin'
							? 'Digite seu login'
							: 'Digite sua matrícula (8 caracteres)'}
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
					Primeiro acesso?
					<button
						type="button"
						class="text-primary-600 dark:text-primary-400 underline underline-offset-2 hover:opacity-80 transition-opacity"
						onclick={() => {
							primeiroAcesso = true;
						}}
					>
						Clique aqui
					</button>
				</p>
			{/if}
		{:else if primeiroAcesso}
			<!-- ===== Primeiro acesso ===== -->
			{#if !primeiroAcessoEnviado}
				<div class="text-center mb-6">
					<div class="text-5xl mb-3">🔑</div>
					<p class="font-semibold mb-1">Primeiro acesso</p>
					<p class="text-sm text-surface-600 dark:text-surface-400">
						Informe sua matrícula para receber uma senha provisória no e-mail cadastrado.
					</p>
				</div>
				<form onsubmit={solicitarPrimeiroAcesso} class="flex flex-col gap-5">
					<label class="label">
						<span class="label-text">Matrícula</span>
						<input
							class="input"
							type="text"
							bind:value={matriculaPrimeiroAcesso}
							placeholder="Digite sua matrícula"
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
						{loading ? 'Enviando...' : 'Enviar senha provisória'}
					</button>
					<button type="button" class="btn preset-outlined w-full" onclick={voltarParaLogin}>
						← Voltar
					</button>
				</form>
			{:else}
				<div class="text-center">
					<div class="text-5xl mb-4">📬</div>
					<p class="font-semibold mb-2">E-mail enviado!</p>
					<p class="text-sm text-surface-600 dark:text-surface-400 mb-6">
						Se a matrícula estiver cadastrada com e-mail, você receberá a senha provisória em
						instantes. Verifique também sua caixa de spam.
					</p>
					<button
						type="button"
						class="btn preset-filled-primary-500 w-full"
						onclick={voltarParaLogin}
					>
						Ir para o login
					</button>
				</div>
			{/if}
		{:else}
			<!-- ===== Formulário de verificação 2FA ===== -->
			<div class="text-center mb-6">
				<div class="text-5xl mb-3">📧</div>
				<p class="font-semibold mb-1">Verificação em dois fatores</p>
				<p class="text-sm text-surface-600 dark:text-surface-400">
					Enviamos um código de 6 dígitos para<br />
					<span class="font-medium text-surface-800 dark:text-surface-200">{emailMascarado}</span>
				</p>
			</div>

			<form onsubmit={verificar2FA} class="flex flex-col gap-5">
				<label class="label">
					<span class="label-text text-center block">Código de verificação</span>
					<input
						class="input text-center text-3xl font-bold tracking-[0.4em] py-3"
						type="text"
						value={codigo2FA}
						oninput={(e) => (codigo2FA = e.currentTarget.value.replace(/\D/g, '').slice(0, 6))}
						placeholder="000000"
						maxlength="6"
						inputmode="numeric"
						autocomplete="one-time-code"
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
