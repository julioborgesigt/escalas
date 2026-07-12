<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { csrfHeaders } from '$lib/csrf';
	import { loading } from '$lib/loading.svelte';
	import type { ActionResult } from '@sveltejs/kit';

	let senhaAtual = $state('');
	let novaSenha = $state('');
	let confirmarSenha = $state('');
	let error = $state('');

	const primeiroAcesso = $derived(page.data.primeiro_acesso);

	// --- E-mail pessoal (apenas no primeiro acesso) ---
	let emailPessoal = $state('');
	let etapaEmailPessoal = $state<'idle' | 'enviando' | 'aguardando_codigo' | 'verificado'>('idle');
	let codigoEmailPessoal = $state('');
	let desafioIdEmailPessoal = $state('');
	let emailMascaradoPessoal = $state('');
	let erroEmailPessoal = $state('');

	async function enviarCodigoEmailPessoal() {
		erroEmailPessoal = '';
		loading.show('Enviando código de verificação...');
		etapaEmailPessoal = 'enviando';
		try {
			const res = await fetch('/api/auth/solicitar-verificacao-email-pessoal', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
				body: JSON.stringify({ email: emailPessoal })
			});
			const data = await res.json();
			if (res.ok) {
				desafioIdEmailPessoal = data.desafioId;
				emailMascaradoPessoal = data.emailMascarado;
				etapaEmailPessoal = 'aguardando_codigo';
			} else {
				erroEmailPessoal = data.error ?? 'Falha ao enviar código.';
				etapaEmailPessoal = 'idle';
			}
		} catch {
			erroEmailPessoal = 'Erro de conexão. Tente novamente.';
			etapaEmailPessoal = 'idle';
		} finally {
			loading.hide();
		}
	}

	async function confirmarCodigoEmailPessoal() {
		erroEmailPessoal = '';
		loading.show('Verificando código...');
		try {
			const res = await fetch('/api/auth/confirmar-verificacao-email-pessoal', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
				body: JSON.stringify({
					desafioId: desafioIdEmailPessoal,
					codigo: codigoEmailPessoal,
					email: emailPessoal
				})
			});
			const data = await res.json();
			if (res.ok && data.ok) {
				etapaEmailPessoal = 'verificado';
			} else {
				erroEmailPessoal = data.error ?? 'Código inválido.';
			}
		} catch {
			erroEmailPessoal = 'Erro de conexão. Tente novamente.';
		} finally {
			loading.hide();
		}
	}

	const forca = $derived(validarForcaSenha(novaSenha, confirmarSenha));
	const senhaOk = $derived(forca.senhaOk);
	const emailPessoalOk = $derived(!primeiroAcesso || etapaEmailPessoal === 'verificado');
	const podeAlterarSenha = $derived(senhaOk && forca.confirmaOk && emailPessoalOk);

	import { enhance } from '$app/forms';
	import CamposNovaSenha, { validarForcaSenha } from '$lib/components/CamposNovaSenha.svelte';

	function handleAlterarSenha({ cancel }: { cancel: () => void }) {
		error = '';

		if (primeiroAcesso && etapaEmailPessoal !== 'verificado') {
			error = 'Confirme seu e-mail pessoal para continuar o primeiro acesso.';
			cancel();
			return;
		}

		if (novaSenha !== confirmarSenha) {
			error = 'As senhas não conferem.';
			cancel();
			return;
		}

		if (!senhaOk) {
			error = 'A senha não atende aos requisitos mínimos.';
			cancel();
			return;
		}

		loading.show('Alterando sua senha...');

		return async ({ result }: { result: ActionResult }) => {
			loading.hide();
			if (result.type === 'success') {
				goto('/');
			} else if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				error = String(d?.error || 'Erro ao alterar a senha.');
			}
		};
	}
</script>

<svelte:head>
	<title>{primeiroAcesso ? 'Defina sua senha' : 'Alterar Senha'} | Escalas</title>
</svelte:head>

<div class="min-h-[80vh] flex items-center justify-center p-4">
	<div class="w-full max-w-sm">
		<!-- Card -->
		<div class="p-6 sm:p-8 rounded-3xl card-glass-auth">
			<!-- Icon + Title -->
			<div class="text-center mb-6">
				<div
					class="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary-500/10 border border-primary-500/20 mb-4"
				>
					<svg
						class="w-7 h-7 text-primary-500"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="1.8"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
						/>
					</svg>
				</div>
				<h1 class="text-xl font-bold">
					{primeiroAcesso ? 'Defina sua nova senha' : 'Alterar Senha'}
				</h1>
				<p class="text-sm text-surface-500 mt-1">
					{primeiroAcesso
						? 'Confirme seu e-mail pessoal e escolha uma senha segura para continuar.'
						: 'Preencha os campos abaixo para alterar sua senha.'}
				</p>
			</div>

			<!-- First-access warning banner -->
			{#if primeiroAcesso}
				<div
					class="flex items-start gap-2.5 p-3 mb-5 rounded-xl bg-warning-500/10 border border-warning-500/25 text-warning-700 dark:text-warning-300 text-sm"
				>
					<svg
						class="w-4 h-4 mt-0.5 shrink-0"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
						/>
					</svg>
					<span
						>Este é seu <strong>primeiro acesso</strong>. Confirme seu e-mail pessoal e defina uma
						senha para continuar.</span
					>
				</div>
			{/if}

			<!-- Seção de e-mail pessoal (apenas no primeiro acesso) -->
			{#if primeiroAcesso}
				<div
					class="mb-5 p-4 rounded-2xl bg-surface-100/80 dark:bg-surface-800/50 border border-surface-200 dark:border-white/5 space-y-3"
				>
					<div>
						<p
							class="text-xs font-semibold text-surface-600 dark:text-surface-300 uppercase tracking-wider mb-0.5"
						>
							E-mail pessoal obrigatório
						</p>
						<p class="text-xs text-surface-500 leading-relaxed">
							Você deve confirmar seu e-mail pessoal para recuperar sua senha no futuro e continuar
							o primeiro acesso.
						</p>
					</div>

					{#if etapaEmailPessoal === 'verificado'}
						<div
							class="flex items-center gap-2 text-success-600 dark:text-success-400 text-sm font-medium"
						>
							<svg
								class="w-4 h-4 shrink-0"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								stroke-width="2.5"
							>
								<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
							</svg>
							E-mail pessoal verificado com sucesso!
						</div>
					{:else if etapaEmailPessoal === 'idle' || etapaEmailPessoal === 'enviando'}
						<div class="flex gap-2">
							<input
								class="input flex-1 text-sm"
								type="email"
								placeholder="seu@email.com"
								bind:value={emailPessoal}
								disabled={loading.active}
							/>
							<button
								type="button"
								onclick={enviarCodigoEmailPessoal}
								disabled={loading.active || !emailPessoal.trim()}
							>
								{loading.active ? 'Enviando...' : 'Enviar código'}
							</button>
						</div>
					{:else if etapaEmailPessoal === 'aguardando_codigo'}
						<p class="text-xs text-surface-500">
							Código enviado para <strong>{emailMascaradoPessoal}</strong>. Válido por 10 minutos.
						</p>
						<div class="flex gap-2">
							<input
								class="input flex-1 text-center text-xl font-bold tracking-[0.3em]"
								type="text"
								placeholder="000000"
								maxlength="6"
								inputmode="numeric"
								bind:value={codigoEmailPessoal}
								oninput={(e) =>
									(codigoEmailPessoal = e.currentTarget.value.replace(/\D/g, '').slice(0, 6))}
								disabled={loading.active}
							/>
							<button type="button" onclick={confirmarCodigoEmailPessoal}>
								{loading.active ? 'Verificando...' : 'Confirmar'}
							</button>
						</div>
						<button
							type="button"
							class="text-xs text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 underline underline-offset-2"
							onclick={() => {
								etapaEmailPessoal = 'idle';
								codigoEmailPessoal = '';
							}}
						>
							Usar outro e-mail
						</button>
					{/if}

					{#if erroEmailPessoal}
						<p class="text-xs text-error-600 dark:text-error-400">{erroEmailPessoal}</p>
					{/if}

					{#if etapaEmailPessoal !== 'verificado'}
						<p class="text-3xs text-surface-500 dark:text-surface-400 italic">
							A alteração da senha ficará disponível após a confirmação do e-mail pessoal.
						</p>
					{/if}
				</div>
			{/if}

			<!-- Error message -->
			{#if error}
				<div
					class="flex items-center gap-2 p-3 mb-4 rounded-xl bg-error-500/10 border border-error-500/25 text-error-700 dark:text-error-300 text-sm"
				>
					<svg
						class="w-4 h-4 shrink-0"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
					{error}
				</div>
			{/if}

			<!-- Form -->
			<form
				method="POST"
				action="?/alterar"
				use:enhance={handleAlterarSenha}
				class="flex flex-col gap-4"
			>
				{#if !primeiroAcesso}
					<label class="label">
						<span class="label-text font-medium">Senha atual</span>
						<input
							class="input"
							type="password"
							name="senha_atual"
							bind:value={senhaAtual}
							placeholder="Digite a senha atual"
							required
						/>
					</label>
				{/if}

				<CamposNovaSenha
					bind:novaSenha
					bind:confirmarSenha
					placeholderNova="Digite a nova senha"
					placeholderConfirmar="Confirme a nova senha"
				/>

				<button
					type="submit"
					class="btn preset-filled-primary-500 w-full py-3 mt-1 font-semibold tracking-wide flex items-center justify-center gap-2"
					disabled={loading.active || !podeAlterarSenha}
				>
					{loading.active
						? 'Salvando...'
						: primeiroAcesso
							? 'Definir senha e continuar'
							: 'Salvar nova senha'}
				</button>
			</form>
		</div>
	</div>
</div>
