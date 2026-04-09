<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { toaster } from '$lib/toast';
	import { loginSchema, primeiroAcessoSchema, verificar2FASchema } from '$lib/schemas/auth';
	import Spinner from '$lib/components/Spinner.svelte';
	import { superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';

	let { data } = $props();

	// Estado da interface
	let pendente2FA = $state(false);
	let emailMascarado = $state('');
	let primeiroAcesso = $state(false);
	let primeiroAcessoEnviado = $state(false);

	// svelte-ignore state_referenced_locally
	const loginSuper = superForm(data.loginForm, {
		validators: zod4Client(loginSchema),
		invalidateAll: false,
		onUpdated: async ({ form }) => {
			if (form.valid && form.message) {
				try {
					const msg = JSON.parse(form.message);
					if (msg.type === 'success') {
						if (msg.pendente2FA) {
							$verificar2FAForm.desafioId = String(msg.desafioId || '');
							emailMascarado = String(msg.emailMascarado || '');
							pendente2FA = true;
							toaster.success({ title: 'Código enviado para o seu e-mail!' });
						} else if (msg.redirect) {
							goto(String(msg.redirect), { invalidateAll: true });
						}
					} else {
						toaster.error({ title: msg.error || 'Credenciais inválidas' });
					}
				} catch (e) {}
			} else if (!form.valid && form.message) {
				try {
					const msg = JSON.parse(form.message);
					if (msg.error) toaster.error({ title: msg.error });
				} catch (e) {}
			}
		}
	});

	const loginForm = loginSuper.form;
	const loginErrors = loginSuper.errors;
	const loginConstraints = loginSuper.constraints;
	const loginEnhance = loginSuper.enhance;
	const loginSubmitting = loginSuper.submitting;
	const loginDelayed = loginSuper.delayed;

	// svelte-ignore state_referenced_locally
	const primeAcessoSuper = superForm(data.primeiroAcessoForm, {
		validators: zod4Client(primeiroAcessoSchema),
		invalidateAll: false,
		onUpdated: async ({ form }) => {
			if (form.valid && form.message) {
				try {
					const msg = JSON.parse(form.message);
					if (msg.type === 'success') {
						primeiroAcessoEnviado = true;
					} else {
						toaster.error({ title: msg.error || 'Erro ao processar solicitação.' });
					}
				} catch (e) {}
			} else if (!form.valid && form.message) {
				try {
					const msg = JSON.parse(form.message);
					if (msg.error) toaster.error({ title: msg.error });
				} catch (e) {}
			}
		}
	});

	const primeiroAcessoForm = primeAcessoSuper.form;
	const primeiroAcessoErrors = primeAcessoSuper.errors;
	const primeiroAcessoConstraints = primeAcessoSuper.constraints;
	const primeiroAcessoEnhance = primeAcessoSuper.enhance;
	const primeiroAcessoSubmitting = primeAcessoSuper.submitting;
	const primeiroAcessoDelayed = primeAcessoSuper.delayed;

	// svelte-ignore state_referenced_locally
	const verificar2FASuper = superForm(data.verificar2FAForm, {
		validators: zod4Client(verificar2FASchema),
		invalidateAll: false,
		onUpdated: async ({ form }) => {
			if (form.valid && form.message) {
				try {
					const msg = JSON.parse(form.message);
					if (msg.type === 'success') {
						if (msg.redirect) goto(String(msg.redirect), { invalidateAll: true });
					} else {
						toaster.error({ title: msg.error || 'Código inválido' });
						if (msg.expirado || msg.esgotado) voltarLogin();
					}
				} catch (e) {}
			} else if (!form.valid && form.message) {
				try {
					const msg = JSON.parse(form.message);
					if (msg.error) toaster.error({ title: msg.error });
					if (msg.expirado || msg.esgotado) voltarLogin();
				} catch (e) {}
			}
		}
	});

	const verificar2FAForm = verificar2FASuper.form;
	const verificar2FAErrors = verificar2FASuper.errors;
	const verificar2FAConstraints = verificar2FASuper.constraints;
	const verificar2FAEnhance = verificar2FASuper.enhance;
	const verificar2FASubmitting = verificar2FASuper.submitting;
	const verificar2FADelayed = verificar2FASuper.delayed;



	function voltarLogin() {
		pendente2FA = false;
		$verificar2FAForm.desafioId = '';
		$verificar2FAForm.codigo = '';
	}

	function voltarParaLogin() {
		primeiroAcesso = false;
		primeiroAcessoEnviado = false;
		$primeiroAcessoForm.matricula = '';
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
					type="button"
					class="flex-1 py-2 text-sm font-medium transition-colors {$loginForm.tipo === 'policial'
						? 'preset-filled-primary-500'
						: 'text-surface-500'}"
					onclick={() => {
						$loginForm.tipo = 'policial';
					}}
				>
					Policial
				</button>
				<button
					type="button"
					class="flex-1 py-2 text-sm font-medium transition-colors {$loginForm.tipo === 'admin'
						? 'preset-filled-primary-500'
						: 'text-surface-500'}"
					onclick={() => {
						$loginForm.tipo = 'admin';
					}}
				>
					Administrador
				</button>
			</div>

			<form method="POST" action="?/login" use:loginEnhance class="flex flex-col gap-6">
				<input type="hidden" name="tipo" value={$loginForm.tipo} />
				<label class="label relative">
					<span class="label-text">{$loginForm.tipo === 'admin' ? 'Login' : 'Matrícula'}</span>
					<input
						class="input {$loginErrors.matricula ? 'input-error' : ''}"
						type="text"
						name="matricula"
						bind:value={$loginForm.matricula}
						{...$loginConstraints.matricula}
						aria-invalid={$loginErrors.matricula ? 'true' : undefined}
						placeholder={$loginForm.tipo === 'admin'
							? 'Digite seu login'
							: 'Digite sua matrícula (8 caracteres)'}
						maxlength={$loginForm.tipo === 'admin' ? undefined : 8}
					/>
					{#if $loginErrors.matricula}<div class="text-error-500 text-xs mt-1 absolute -bottom-5">{$loginErrors.matricula[0]}</div>{/if}
				</label>

				<label class="label relative">
					<span class="label-text">Senha</span>
					<input
						class="input {$loginErrors.senha ? 'input-error' : ''}"
						type="password"
						name="senha"
						bind:value={$loginForm.senha}
						{...$loginConstraints.senha}
						aria-invalid={$loginErrors.senha ? 'true' : undefined}
						placeholder="Digite sua senha"
					/>
					{#if $loginErrors.senha}<div class="text-error-500 text-xs mt-1 absolute -bottom-5">{$loginErrors.senha[0]}</div>{/if}
				</label>

				<button
					type="submit"
					class="btn preset-filled-primary-500 w-full py-3 flex items-center justify-center gap-2"
					disabled={$loginSubmitting}
				>
					{#if $loginDelayed}<Spinner size="md" />{/if}
					{$loginSubmitting ? 'Entrando...' : 'Entrar'}
				</button>
			</form>

			{#if $loginForm.tipo === 'policial'}
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
				<form method="POST" action="?/solicitarPrimeiroAcesso" use:primeiroAcessoEnhance class="flex flex-col gap-5">
					<label class="label relative">
						<span class="label-text">Matrícula</span>
						<input
							class="input {$primeiroAcessoErrors.matricula ? 'input-error' : ''}"
							type="text"
							name="matricula"
							bind:value={$primeiroAcessoForm.matricula}
							{...$primeiroAcessoConstraints.matricula}
							aria-invalid={$primeiroAcessoErrors.matricula ? 'true' : undefined}
							placeholder="Digite sua matrícula"
							maxlength="8"
						/>
						{#if $primeiroAcessoErrors.matricula}<div class="text-error-500 text-xs mt-1 absolute -bottom-5">{$primeiroAcessoErrors.matricula[0]}</div>{/if}
					</label>
					<button
						type="submit"
						class="btn preset-filled-primary-500 w-full py-3 flex items-center justify-center gap-2"
						disabled={$primeiroAcessoSubmitting}
					>
						{#if $primeiroAcessoDelayed}<Spinner size="md" />{/if}
						{$primeiroAcessoSubmitting ? 'Enviando...' : 'Enviar senha provisória'}
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

			<form method="POST" action="?/verificar2FA" use:verificar2FAEnhance class="flex flex-col gap-5">
				<input type="hidden" name="desafioId" bind:value={$verificar2FAForm.desafioId} />
				<label class="label relative">
					<span class="label-text text-center block">Código de verificação</span>
					<input
						class="input text-center text-3xl font-bold tracking-[0.4em] py-3 {$verificar2FAErrors.codigo ? 'input-error' : ''}"
						type="text"
						name="codigo"
						value={$verificar2FAForm.codigo}
						oninput={(e) => ($verificar2FAForm.codigo = e.currentTarget.value.replace(/\D/g, '').slice(0, 6))}
						placeholder="000000"
						maxlength="6"
						inputmode="numeric"
						autocomplete="one-time-code"
						aria-invalid={$verificar2FAErrors.codigo ? 'true' : undefined}
					/>
					{#if $verificar2FAErrors.codigo}<div class="text-error-500 text-xs mt-1 absolute -bottom-5 text-center w-full">{$verificar2FAErrors.codigo[0]}</div>{/if}
				</label>

				<button
					type="submit"
					class="btn preset-filled-primary-500 w-full py-3 flex items-center justify-center gap-2"
					disabled={$verificar2FASubmitting || $verificar2FAForm.codigo.length !== 6}
				>
					{#if $verificar2FADelayed}<Spinner size="md" />{/if}
					{$verificar2FASubmitting ? 'Verificando...' : 'Confirmar'}
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
