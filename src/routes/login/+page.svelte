<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toaster } from '$lib/toast';
	import { loginSchema } from '$lib/schemas';
	import { csrfHeaders } from '$lib/csrf';
	import { loading as loadingService } from '$lib/loading.svelte';

	let tipo = $state<'policial' | 'admin'>('policial');
	let adminModulo = $state<'gise' | 'escalas'>('gise');
	let matricula = $state('');
	let senha = $state('');

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

	// Estado de recuperação de senha
	let recuperacao = $state(false);
	let identificadorRec = $state('');
	let recuperacaoEnviada = $state(false);

	// Erro inline de login (fallback para quando JS estiver bloqueado pelo CSP)
	let loginError = $state<string | null>(null);

	const mostrarBannerResetado = $derived(page.url.searchParams.get('resetado') === '1');

	// Exibe o erro do último attempt — funciona com JS (loginError) e sem JS (page.form)
	const loginErrorDisplay = $derived(loginError ?? (page.form as { error?: string } | null)?.error ?? null);

	function handleLogin({ formData, cancel }: { formData: FormData; cancel: () => void }) {
		loginError = null;
		const parsed = loginSchema.safeParse({
			matricula: formData.get('matricula'),
			senha: formData.get('senha'),
			tipo: formData.get('tipo')
		});
		if (!parsed.success) {
			loginError = parsed.error.issues[0].message;
			cancel();
			return;
		}
		loadingService.show('Autenticando...');
		return async ({ result }: { result: any }) => {
			loadingService.hide();
			if (result.type === 'success') {
				const d = result.data as Record<string, unknown>;
				if (d?.pendente2FA) {
					desafioId = String(d.desafioId || '');
					tipoUsuario2FA = (d.tipoUsuario2FA as 'policial' | 'admin') || tipo;
					emailMascarado = String(d.emailMascarado || '');
					pendente2FA = true;
					loginError = null;
					toaster.create({ title: 'Código enviado para o seu e-mail!', type: 'success' });
				} else if (d?.redirect) {
					goto(String(d.redirect), { invalidateAll: true });
				}
			} else if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				loginError = String(d?.error || 'Credenciais inválidas');
				toaster.create({ title: loginError, type: 'error' });
			}
		};
	}

	function handleVerificar2FA({ cancel }: { cancel: () => void }) {
		if (codigo2FA.length !== 6) {
			toaster.create({ title: 'Informe o código de 6 dígitos', type: 'error' });
			cancel();
			return;
		}
		loadingService.show('Verificando código...');
		return async ({ result }: { result: any }) => {
			loadingService.hide();
			if (result.type === 'success') {
				const d = result.data as Record<string, unknown>;
				if (d?.redirect) goto(String(d.redirect), { invalidateAll: true });
			} else if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error || 'Código inválido'), type: 'error' });
				if (d?.expirado || d?.esgotado) voltarLogin();
			}
		};
	}

	function handlePrimeiroAcesso() {
		loadingService.show('Processando primeiro acesso...');
		return async ({ result }: { result: any }) => {
			loadingService.hide();
			if (result.type === 'success') {
				primeiroAcessoEnviado = true;
			} else if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error || 'Erro ao processar solicitação.'), type: 'error' });
			}
		};
	}

	function voltarLogin() {
		pendente2FA = false;
		desafioId = '';
		codigo2FA = '';
	}

	function voltarParaLogin() {
		primeiroAcesso = false;
		primeiroAcessoEnviado = false;
		matriculaPrimeiroAcesso = '';
	}

	function voltarParaRecuperacao() {
		recuperacao = false;
		recuperacaoEnviada = false;
		identificadorRec = '';
	}

	async function solicitarRecuperacao() {
		if (!identificadorRec.trim()) return;
		loadingService.show('Solicitando recuperação...');
		try {
			const res = await fetch('/api/auth/solicitar-redefinicao', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
				body: JSON.stringify({ identificador: identificadorRec.trim(), tipo })
			});
			if (res.ok || res.status === 200) {
				recuperacaoEnviada = true;
			} else {
				recuperacaoEnviada = true; // resposta genérica sempre
			}
		} catch {
			recuperacaoEnviada = true; // não revelar erros internos
		} finally {
			loadingService.hide();
		}
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

		{#if mostrarBannerResetado}
			<div class="flex items-start gap-2.5 p-3 mb-5 rounded-xl bg-success-500/10 border border-success-500/25 text-success-700 dark:text-success-300 text-sm">
				<svg class="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
				</svg>
				<span>Senha redefinida com sucesso! Faça login com sua nova senha.</span>
			</div>
		{/if}

		{#if !pendente2FA && !primeiroAcesso && !recuperacao}
			<!-- ===== Formulário de credenciais ===== -->
			<div
				class="flex mb-8 bg-surface-100 dark:bg-surface-900/50 p-1 rounded-xl border border-surface-200 dark:border-white/5"
			>
				<button type="button"
					class="flex-1 py-2 text-sm font-medium transition-colors {tipo === 'policial'
						? 'preset-filled-primary-500'
						: 'text-surface-500'}"
					onclick={() => {
						tipo = 'policial';
					}}
				>
					Policial
				</button>
				<button type="button"
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

			<form method="POST" action="?/login" use:enhance={handleLogin} class="flex flex-col gap-6">
				<input type="hidden" name="tipo" value={tipo} />
				{#if tipo === 'admin'}
					<input type="hidden" name="adminModulo" value={adminModulo} />
					<label class="label">
						<span class="label-text text-xs font-semibold uppercase tracking-wider text-surface-500">Módulo de Acesso</span>
						<div class="flex gap-2 mt-1">
							{#each [{ value: 'escalas', label: 'Escalas', icon: '📅' }, { value: 'gise', label: 'GISE', icon: '🛡️' }] as opt (opt.value)}
								<button
									type="button"
									class="flex-1 flex flex-col items-center gap-1 py-2 px-1 rounded-xl border text-xs font-medium transition-all
										{adminModulo === opt.value
											? 'bg-primary-500/15 border-primary-500/50 text-primary-700 dark:text-primary-400'
											: 'border-surface-200 dark:border-surface-700 text-surface-500 hover:border-surface-400 dark:hover:border-surface-500'}"
									onclick={() => (adminModulo = opt.value as typeof adminModulo)}
								>
									<span class="text-base">{opt.icon}</span>
									<span>{opt.label}</span>
								</button>
							{/each}
						</div>
					</label>
				{/if}
				<label class="label">
					<span class="label-text">{tipo === 'admin' ? 'Login' : 'Matrícula'}</span>
					<input
						class="input"
						type="text"
						name="matricula"
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
						name="senha"
						bind:value={senha}
						placeholder="Digite sua senha"
						required
					/>
				</label>

				{#if loginErrorDisplay}
					<div class="flex items-center gap-2 p-3 rounded-xl bg-error-500/10 border border-error-500/25 text-error-700 dark:text-error-300 text-sm">
						<svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
						{loginErrorDisplay}
					</div>
				{/if}

				<button
					type="submit"
					class="btn preset-filled-primary-500 w-full py-3 flex items-center justify-center gap-2"
					disabled={loadingService.active}
				>
					{loadingService.active ? 'Entrando...' : 'Entrar'}
				</button>
			</form>

			<div
				class="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 text-xs text-surface-500 text-center"
				role="navigation"
				aria-label="Ajuda de acesso"
			>
				{#if tipo === 'policial'}
					<span class="inline-flex flex-nowrap items-baseline gap-1">
						<span class="shrink-0">Primeiro acesso?</span>
						<button
							type="button"
							class="shrink-0 text-primary-600 dark:text-primary-400 underline underline-offset-2 hover:opacity-80 transition-opacity"
							onclick={() => { primeiroAcesso = true; }}
						>
							Clique aqui
						</button>
					</span>
					<span class="hidden sm:inline text-surface-300 dark:text-surface-600 select-none" aria-hidden="true">·</span>
				{/if}
				<span class="inline-flex flex-nowrap items-baseline gap-1">
					<span class="shrink-0">Esqueceu a senha?</span>
					<button
						type="button"
						class="shrink-0 text-primary-600 dark:text-primary-400 underline underline-offset-2 hover:opacity-80 transition-opacity"
						onclick={() => { recuperacao = true; }}
					>
						Recuperar
					</button>
				</span>
			</div>
		{:else if recuperacao}
			<!-- ===== Recuperação de senha ===== -->
			{#if !recuperacaoEnviada}
				<div class="text-center mb-6">
					<div class="text-5xl mb-3">🔒</div>
					<p class="font-semibold mb-1">Recuperar senha</p>
					<p class="text-sm text-surface-600 dark:text-surface-400">
						Informe {tipo === 'policial' ? 'sua matrícula' : 'seu login'} para receber um link de redefinição por e-mail.
					</p>
				</div>

				<div class="flex flex-col gap-5">
					<div class="flex mb-4 bg-surface-100 dark:bg-surface-900/50 p-1 rounded-xl border border-surface-200 dark:border-white/5">
						<button
							type="button"
							class="flex-1 py-2 text-sm font-medium transition-colors {tipo === 'policial' ? 'preset-filled-primary-500' : 'text-surface-500'}"
							onclick={() => { tipo = 'policial'; identificadorRec = ''; }}
						>
							Policial
						</button>
						<button
							type="button"
							class="flex-1 py-2 text-sm font-medium transition-colors {tipo === 'admin' ? 'preset-filled-primary-500' : 'text-surface-500'}"
							onclick={() => { tipo = 'admin'; identificadorRec = ''; }}
						>
							Administrador
						</button>
					</div>

					<label class="label">
						<span class="label-text">{tipo === 'policial' ? 'Matrícula' : 'Login'}</span>
						<input
							class="input"
							type="text"
							bind:value={identificadorRec}
							placeholder={tipo === 'policial' ? 'Digite sua matrícula' : 'Digite seu login'}
							maxlength={tipo === 'policial' ? 8 : undefined}
						/>
					</label>

					<button
						type="button"
						class="btn preset-filled-primary-500 w-full py-3 flex items-center justify-center gap-2"
						disabled={loadingService.active || !identificadorRec.trim()}
						onclick={solicitarRecuperacao}
					>
						{loadingService.active ? 'Enviando...' : 'Enviar link de redefinição'}
					</button>

					<button type="button" class="btn preset-outlined w-full" onclick={voltarParaRecuperacao}>
						← Voltar
					</button>
				</div>
			{:else}
				<div class="text-center">
					<div class="text-5xl mb-4">📬</div>
					<p class="font-semibold mb-2">Link enviado!</p>
					<p class="text-sm text-surface-600 dark:text-surface-400 mb-6">
						Se o identificador estiver cadastrado com e-mail, você receberá um link de redefinição em instantes. Verifique também sua caixa de spam.
					</p>
					<button
						type="button"
						class="btn preset-filled-primary-500 w-full"
						onclick={voltarParaRecuperacao}
					>
						Ir para o login
					</button>
				</div>
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
				<form method="POST" action="?/solicitarPrimeiroAcesso" use:enhance={handlePrimeiroAcesso} class="flex flex-col gap-5">
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

			<form method="POST" action="?/verificar2FA" use:enhance={handleVerificar2FA} class="flex flex-col gap-5">
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

				<button
					type="submit"
					class="btn preset-filled-primary-500 w-full py-3 flex items-center justify-center gap-2"
					disabled={loadingService.active || codigo2FA.length !== 6}
				>
					{loadingService.active ? 'Verificando...' : 'Confirmar'}
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
