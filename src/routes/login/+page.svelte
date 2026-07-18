<script lang="ts">
	import { Calendar, Shield, Lock, Mail, Inbox, KeyRound } from 'lucide-svelte';
	import { browser } from '$app/environment';
	import { goto, replaceState } from '$app/navigation';
	import { applyAction, enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toaster } from '$lib/toast';
	import { apiFetch } from '$lib/api-fetch';
	import { loading as loadingService } from '$lib/loading.svelte';
	import CodigoTimer from '$lib/components/CodigoTimer.svelte';
	import { Steps, Tabs } from '@skeletonlabs/skeleton-svelte';
	import { conectarSerproParaLogin } from '$lib/serpro';
	import type { ActionResult } from '@sveltejs/kit';

	type ActionData = Record<string, unknown> | undefined;
	type FormResult = ActionResult<ActionData, ActionData>;

	async function navegarAposLogin(destino: string, invalidateAll = false) {
		await goto(destino, invalidateAll ? { invalidateAll: true } : undefined);
	}

	let tipo = $state<'policial' | 'admin'>('policial');
	let adminModulo = $state<'gise' | 'escalas'>('gise');
	let matricula = $state('');
	let senha = $state('');

	// Estado do passo 2FA
	let pendente2FA = $state(false);
	let desafioId = $state('');
	let codigo2FA = $state('');
	let emailMascarado = $state('');

	// Estado do primeiro acesso
	let primeiroAcesso = $state(false);
	let matriculaPrimeiroAcesso = $state('');
	let primeiroAcessoEnviado = $state(false);

	// Estado de recuperação de senha
	let recuperacao = $state(false);
	let identificadorRec = $state('');
	let recuperacaoEtapa = $state<'identificador' | 'codigo' | 'concluida'>('identificador');
	let recuperacaoResultado = $state<'codigo' | 'link'>('codigo');
	let desafioIdRec = $state('');
	let codigoRec = $state('');
	let emailMascaradoRec = $state('');

	const currentRecStep = $derived(
		recuperacaoEtapa === 'identificador' ? 0 : recuperacaoEtapa === 'codigo' ? 1 : 2
	);

	// Erro inline de login (fallback para quando JS estiver bloqueado pelo CSP)
	let loginError = $state<string | null>(null);

	let mostrarBannerResetado = $state(page.url.searchParams.get('resetado') === '1');
	let resetadoParamConsumido = false;

	// Exibe o erro do último attempt — funciona com JS (loginError) e sem JS (page.form)
	const loginErrorDisplay = $derived(
		loginError ?? (page.form as { error?: string } | null)?.error ?? null
	);

	// Remove `?resetado=1` sem `goto()`: uma navegação cliente extra aqui pode correr com o
	// `goto` pós-2FA e deixar o layout sem `usuario` (sidebar some, parece sem estilo).
	$effect(() => {
		if (!browser || resetadoParamConsumido || page.url.searchParams.get('resetado') !== '1') return;

		resetadoParamConsumido = true;

		const url = new URL(page.url);
		url.searchParams.delete('resetado');
		replaceState(url, page.state ?? {});
	});

	function handleLogin({ formData, cancel }: { formData: FormData; cancel: () => void }) {
		loginError = null;
		const mat = String(formData.get('matricula') ?? '').trim();
		const pw = String(formData.get('senha') ?? '');
		if (!mat) {
			loginError = 'Matrícula é obrigatória';
			cancel();
			return;
		}
		if (!pw) {
			loginError = 'Senha é obrigatória';
			cancel();
			return;
		}
		loadingService.show('Autenticando...');
		return async ({ result }: { result: FormResult }) => {
			try {
				if (result.type === 'redirect') {
					await navegarAposLogin(result.location, true);
					return;
				}

				if (result.type === 'success') {
					const d = result.data;
					if (d?.pendente2FA) {
						desafioId = String(d.desafioId || '');
						emailMascarado = String(d.emailMascarado || '');
						pendente2FA = true;
						loginError = null;
						toaster.create({ title: 'Código enviado para o seu e-mail!', type: 'success' });
						return;
					}

					if (d?.redirect) {
						await navegarAposLogin(String(d.redirect), true);
						return;
					}

					loginError = 'Não foi possível concluir o login. Tente novamente.';
					toaster.create({ title: loginError, type: 'error' });
					return;
				}

				if (result.type === 'failure') {
					await applyAction(result);
					const d = result.data;
					loginError = String(d?.error || 'Credenciais inválidas');
					toaster.create({ title: loginError, type: 'error' });
					return;
				}

				loginError = 'Erro inesperado ao autenticar. Tente novamente.';
				toaster.create({ title: loginError, type: 'error' });
			} catch {
				loginError = 'Não foi possível concluir o login. Tente novamente.';
				toaster.create({ title: loginError, type: 'error' });
			} finally {
				loadingService.hide();
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
		return async ({ result }: { result: FormResult }) => {
			try {
				if (result.type === 'redirect') {
					await navegarAposLogin(result.location, true);
					return;
				}

				if (result.type === 'success') {
					const d = result.data;
					if (d?.redirect) {
						await navegarAposLogin(String(d.redirect), true);
						return;
					}

					toaster.create({
						title: 'Não foi possível concluir a verificação. Tente novamente.',
						type: 'error'
					});
					return;
				}

				if (result.type === 'failure') {
					await applyAction(result);
					const d = result.data;
					toaster.create({ title: String(d?.error || 'Código inválido'), type: 'error' });
					if (d?.expirado || d?.esgotado) voltarLogin();
					return;
				}

				toaster.create({
					title: 'Erro inesperado ao verificar o código. Tente novamente.',
					type: 'error'
				});
			} catch {
				toaster.create({
					title: 'Não foi possível concluir a verificação. Tente novamente.',
					type: 'error'
				});
			} finally {
				loadingService.hide();
			}
		};
	}

	function handlePrimeiroAcesso() {
		loadingService.show('Processando primeiro acesso...');
		return async ({ result }: { result: ActionResult }) => {
			loadingService.hide();
			if (result.type === 'success') {
				primeiroAcessoEnviado = true;
			} else if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({
					title: String(d?.error || 'Erro ao processar solicitação.'),
					type: 'error'
				});
			}
		};
	}

	async function reenviarCodigo2FA() {
		try {
			const data = await apiFetch<{ desafioId?: string; emailMascarado?: string }>(
				'/api/auth/reenviar-codigo',
				{ method: 'POST', body: JSON.stringify({ desafioId }) }
			);
			desafioId = String(data.desafioId || desafioId);
			emailMascarado = String(data.emailMascarado || emailMascarado);
			toaster.create({ title: 'Código reenviado com sucesso!', type: 'success' });
		} catch (e: unknown) {
			toaster.create({
				title: e instanceof Error ? e.message : 'Erro ao reenviar código',
				type: 'error'
			});
			// Repassa o erro para o CodigoTimer não reiniciar a contagem.
			throw e;
		}
	}

	function voltarLogin() {
		pendente2FA = false;
		desafioId = '';
		codigo2FA = '';
	}

	async function fazerLoginComCertificado(comoAdmin = false) {
		let serproClient: Awaited<ReturnType<typeof conectarSerproParaLogin>> | null = null;
		try {
			// 1. Conectar ao SERPRO PRIMEIRO — sem loading overlay sobre o modal.
			//    Mostra feedback durante a sondagem silenciosa; esconde antes do modal aparecer.
			loadingService.show('Conectando ao Assinador SERPRO...');
			serproClient = await conectarSerproParaLogin(() => loadingService.hide());

			// 2. Gerar desafio no servidor
			const { desafioId: did, nonce } = await apiFetch<{ desafioId: string; nonce: string }>(
				'/api/auth/certificado/iniciar',
				{ method: 'POST', body: JSON.stringify({}) }
			);

			// 3. Computar SHA-256 do nonce e assinar via type:'hash' (igual à assinatura de documentos)
			const nonceBytes = new Uint8Array(nonce.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
			const hashBuffer = await crypto.subtle.digest('SHA-256', nonceBytes);
			const hashBase64 = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));

			loadingService.show('Aguardando confirmação no Assinador SERPRO...');
			const resultado = await serproClient.sign(hashBase64);
			serproClient.disconnect();
			serproClient = null;

			// 4. Verificar no servidor. Na aba Administrador, sinaliza `comoAdmin`
			//    (+ módulo escolhido) — o servidor cria sessão admin se o CPF tiver
			//    conta vinculada e devolve a rota de destino no `redirect`.
			loadingService.show('Verificando certificado...');
			const data = await apiFetch<{
				success?: boolean;
				primeiro_acesso?: boolean;
				nome?: string;
				redirect?: string;
			}>('/api/auth/certificado/verificar', {
				method: 'POST',
				body: JSON.stringify({
					desafioId: did,
					cmsBase64: resultado.rawSignature,
					comoAdmin,
					adminModulo: comoAdmin ? adminModulo : undefined
				})
			});

			// 5. Redirecionar
			const dest = data.redirect ?? (data.primeiro_acesso ? '/alterar-senha' : '/escalas');
			await navegarAposLogin(dest, true);
		} catch (err: unknown) {
			const msg =
				err instanceof Error ? err.message : 'Erro ao autenticar com certificado digital.';
			loginError = msg;
			toaster.create({ title: msg, type: 'error' });
		} finally {
			serproClient?.disconnect();
			loadingService.hide();
		}
	}

	function voltarParaLogin() {
		primeiroAcesso = false;
		primeiroAcessoEnviado = false;
		matriculaPrimeiroAcesso = '';
	}

	function resetarRecuperacao() {
		recuperacaoEtapa = 'identificador';
		identificadorRec = '';
		recuperacaoResultado = 'codigo';
		desafioIdRec = '';
		codigoRec = '';
		emailMascaradoRec = '';
	}

	function abrirRecuperacao() {
		resetarRecuperacao();
		mostrarBannerResetado = false;
		recuperacao = true;
	}

	function voltarParaRecuperacao() {
		recuperacao = false;
		resetarRecuperacao();
		mostrarBannerResetado = false;
	}

	function voltarParaIdentificadorRec() {
		recuperacaoEtapa = 'identificador';
		desafioIdRec = '';
		codigoRec = '';
		emailMascaradoRec = '';
	}

	async function solicitarRecuperacao() {
		if (!identificadorRec.trim()) return;
		loadingService.show('Enviando código de validação...');
		try {
			const data = await apiFetch<{
				requerCodigo?: boolean;
				desafioId?: string;
				emailMascarado?: string;
			}>('/api/auth/solicitar-redefinicao', {
				method: 'POST',
				body: JSON.stringify({ identificador: identificadorRec.trim(), tipo })
			});
			if (data?.requerCodigo && data?.desafioId) {
				desafioIdRec = String(data.desafioId);
				emailMascaradoRec = String(data.emailMascarado || '');
				codigoRec = '';
				recuperacaoEtapa = 'codigo';
			} else {
				recuperacaoResultado = 'codigo';
				recuperacaoEtapa = 'concluida';
			}
		} catch {
			recuperacaoResultado = 'codigo';
			recuperacaoEtapa = 'concluida'; // não revelar erros internos
		} finally {
			loadingService.hide();
		}
	}

	async function confirmarRecuperacao() {
		if (codigoRec.length !== 6) {
			toaster.create({ title: 'Informe o código de 6 dígitos', type: 'error' });
			return;
		}
		loadingService.show('Validando código...');
		try {
			await apiFetch('/api/auth/confirmar-redefinicao', {
				method: 'POST',
				body: JSON.stringify({ desafioId: desafioIdRec, codigo: codigoRec })
			});
			recuperacaoResultado = 'link';
			recuperacaoEtapa = 'concluida';
			desafioIdRec = '';
			codigoRec = '';
		} catch (e: unknown) {
			toaster.create({
				title: e instanceof Error ? e.message : 'Código inválido ou expirado.',
				type: 'error'
			});
		} finally {
			loadingService.hide();
		}
	}
</script>

<svelte:head>
	<title>Login | Sistema de Escalas</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center p-4">
	<div class="w-full max-w-sm p-6 sm:p-8 rounded-3xl card-glass-auth">
		<div class="text-center mb-6">
			<h1 class="h1 text-xl font-bold mb-1">Sistema de Escalas</h1>
		</div>

		{#if mostrarBannerResetado && !recuperacao}
			<div
				class="flex items-start gap-2.5 p-3 mb-5 rounded-xl bg-success-500/10 border border-success-500/25 text-success-700 dark:text-success-300 text-sm"
			>
				<svg
					class="w-4 h-4 mt-0.5 shrink-0"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
				</svg>
				<span>Senha redefinida com sucesso! Faça login com sua nova senha.</span>
			</div>
		{/if}

		{#if !pendente2FA && !primeiroAcesso && !recuperacao}
			<!-- ===== Formulário de credenciais ===== -->
			<div class="mb-8">
				<Tabs
					value={tipo}
					onValueChange={(e) => (tipo = e.value as 'policial' | 'admin')}
					class="w-full"
				>
					<Tabs.List
						class="flex items-center rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-800 p-1 gap-1 w-full"
					>
						<Tabs.Trigger
							value="policial"
							class="px-3 py-2 text-sm font-semibold rounded-lg flex-1 text-center cursor-pointer select-none transition-all duration-200 text-surface-500 dark:text-surface-400 data-[selected]:bg-primary-500 data-[selected]:text-white data-[selected]:shadow-md data-[selected]:shadow-primary-500/25 hover:text-surface-700 dark:hover:text-surface-200"
							>Policial</Tabs.Trigger
						>
						<Tabs.Trigger
							value="admin"
							class="px-3 py-2 text-sm font-semibold rounded-lg flex-1 text-center cursor-pointer select-none transition-all duration-200 text-surface-500 dark:text-surface-400 data-[selected]:bg-primary-500 data-[selected]:text-white data-[selected]:shadow-md data-[selected]:shadow-primary-500/25 hover:text-surface-700 dark:hover:text-surface-200"
							>Administrador</Tabs.Trigger
						>
					</Tabs.List>
				</Tabs>
			</div>

			<form
				method="POST"
				action="?/login"
				use:enhance={handleLogin}
				class="flex flex-col gap-4 sm:gap-6"
			>
				<input type="hidden" name="tipo" value={tipo} />
				{#if tipo === 'admin'}
					<input type="hidden" name="adminModulo" value={adminModulo} />
					<label class="label">
						<span class="label-text text-xs font-semibold uppercase tracking-wider text-surface-500"
							>Módulo de Acesso</span
						>
						<div class="flex gap-2 mt-1">
							{#each [{ value: 'escalas', label: 'Escalas' }, { value: 'gise', label: 'GISE' }] as opt (opt.value)}
								<button
									type="button"
									class="flex-1 flex flex-col items-center gap-1 py-2 px-1 rounded-xl border text-xs font-medium transition-all
										{adminModulo === opt.value
										? 'bg-primary-500/15 border-primary-500/50 text-primary-700 dark:text-primary-400'
										: 'border-surface-200 dark:border-surface-700 text-surface-500 hover:border-surface-400 dark:hover:border-surface-500'}"
									onclick={() => (adminModulo = opt.value as typeof adminModulo)}
								>
									{#if opt.value === 'escalas'}<Calendar
											class="w-5 h-5"
											aria-hidden="true"
										/>{:else}<Shield class="w-5 h-5" aria-hidden="true" />{/if}
									<span>{opt.label}</span>
								</button>
							{/each}
						</div>
					</label>
				{/if}
				<label class="label">
					<span class="label-text">{tipo === 'admin' ? 'Login' : 'Matrícula'}</span>
					<!-- svelte-ignore a11y_autofocus -->
					<!-- Página dedicada de login: foco inicial no campo é padrão aceito por a11y. -->
					<input
						class="input"
						type="text"
						name="matricula"
						bind:value={matricula}
						placeholder={tipo === 'admin'
							? 'Digite seu login'
							: 'Digite sua matrícula (8 caracteres)'}
						maxlength={tipo === 'admin' ? undefined : 8}
						autocomplete="username"
						inputmode={tipo === 'policial' ? 'numeric' : 'text'}
						enterkeyhint="next"
						aria-describedby={loginErrorDisplay ? 'login-error' : undefined}
						autofocus
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
						autocomplete="current-password"
						enterkeyhint="go"
						aria-describedby={loginErrorDisplay ? 'login-error' : undefined}
						required
					/>
				</label>

				{#if loginErrorDisplay}
					<div
						id="login-error"
						role="alert"
						aria-live="assertive"
						class="flex items-center gap-2 p-3 rounded-xl bg-error-500/10 border border-error-500/25 text-error-700 dark:text-error-300 text-sm"
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

			<div class="flex items-center gap-3 my-4">
				<div class="flex-1 h-px bg-surface-200 dark:bg-surface-700"></div>
				<span class="text-xs text-surface-500 dark:text-surface-400 shrink-0">ou</span>
				<div class="flex-1 h-px bg-surface-200 dark:bg-surface-700"></div>
			</div>
			<button
				type="button"
				class="btn preset-outlined-surface-500 w-full py-3 flex items-center justify-center gap-2 text-sm"
				disabled={loadingService.active}
				onclick={() => fazerLoginComCertificado(tipo === 'admin')}
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
						d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
					/>
				</svg>
				Entrar com Certificado Digital (SERPRO)
			</button>
			{#if tipo === 'admin'}
				<p class="mt-2 text-2xs text-surface-500 dark:text-surface-400 text-center">
					Requer certificado A3 de um policial com acesso de Administrador Geral.
				</p>
			{/if}

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
							onclick={() => {
								primeiroAcesso = true;
							}}
						>
							Clique aqui
						</button>
					</span>
					<span
						class="hidden sm:inline text-surface-300 dark:text-surface-600 select-none"
						aria-hidden="true">·</span
					>
				{/if}
				<span class="inline-flex flex-nowrap items-baseline gap-1">
					<span class="shrink-0">Esqueceu a senha?</span>
					<button
						type="button"
						class="shrink-0 text-primary-600 dark:text-primary-400 underline underline-offset-2 hover:opacity-80 transition-opacity"
						onclick={abrirRecuperacao}
					>
						Recuperar
					</button>
				</span>
			</div>
		{:else if recuperacao}
			<!-- ===== Recuperação de senha ===== -->
			<Steps step={currentRecStep} count={3} class="mb-6">
				<Steps.List class="flex items-center justify-center gap-2">
					{#each ['Identificação', 'Código', 'Concluído'] as label, i (i)}
						<Steps.Item index={i}>
							<Steps.Trigger
								tabindex={-1}
								class="flex items-center gap-2 text-xs font-semibold data-[current]:text-primary-500 data-[complete]:text-success-500 text-surface-400 pointer-events-none"
							>
								<Steps.Indicator
									class="w-6 h-6 rounded-full border-2 flex items-center justify-center text-3xs"
									>{i + 1}</Steps.Indicator
								>
								<span class="hidden sm:inline">{label}</span>
							</Steps.Trigger>
							{#if i < 2}
								<Steps.Separator class="w-6 sm:w-12 h-px bg-surface-300 dark:bg-surface-700" />
							{/if}
						</Steps.Item>
					{/each}
				</Steps.List>
			</Steps>
			{#if recuperacaoEtapa === 'identificador'}
				<div class="text-center mb-6">
					<Lock
						class="w-12 h-12 mx-auto mb-3 text-surface-500 dark:text-surface-400"
						aria-hidden="true"
					/>
					<p class="font-semibold mb-1">Recuperar senha</p>
					<p class="text-sm text-surface-600 dark:text-surface-400">
						Informe {tipo === 'policial' ? 'sua matrícula' : 'seu login'} para receber um código de validação
						por e-mail.
					</p>
				</div>

				<div class="flex flex-col gap-5">
					<Tabs
						value={tipo}
						onValueChange={(e) => {
							tipo = e.value as 'policial' | 'admin';
							identificadorRec = '';
						}}
						class="w-full mb-4"
					>
						<Tabs.List
							class="flex items-center rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-800 p-1 gap-1 w-full"
						>
							<Tabs.Trigger
								value="policial"
								class="px-3 py-2 text-sm font-semibold rounded-lg flex-1 text-center cursor-pointer select-none transition-all duration-200 text-surface-500 dark:text-surface-400 data-[selected]:bg-primary-500 data-[selected]:text-white data-[selected]:shadow-md data-[selected]:shadow-primary-500/25 hover:text-surface-700 dark:hover:text-surface-200"
								>Policial</Tabs.Trigger
							>
							<Tabs.Trigger
								value="admin"
								class="px-3 py-2 text-sm font-semibold rounded-lg flex-1 text-center cursor-pointer select-none transition-all duration-200 text-surface-500 dark:text-surface-400 data-[selected]:bg-primary-500 data-[selected]:text-white data-[selected]:shadow-md data-[selected]:shadow-primary-500/25 hover:text-surface-700 dark:hover:text-surface-200"
								>Administrador</Tabs.Trigger
							>
						</Tabs.List>
					</Tabs>

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
						{loadingService.active ? 'Enviando...' : 'Enviar código de validação'}
					</button>

					<button type="button" class="btn preset-outlined w-full" onclick={voltarParaRecuperacao}>
						← Voltar
					</button>
				</div>
			{:else if recuperacaoEtapa === 'codigo'}
				<div class="text-center mb-6">
					<Mail
						class="w-12 h-12 mx-auto mb-3 text-surface-500 dark:text-surface-400"
						aria-hidden="true"
					/>
					<p class="font-semibold mb-1">Código de validação</p>
				</div>

				<div class="flex flex-col gap-5">
					<label class="label">
						<span class="label-text text-center block">Código de validação</span>
						<input
							class="input text-center text-3xl font-bold tracking-[0.4em] py-3"
							type="text"
							value={codigoRec}
							oninput={(e) => (codigoRec = e.currentTarget.value.replace(/\D/g, '').slice(0, 6))}
							placeholder="000000"
							maxlength="6"
							inputmode="numeric"
							autocomplete="one-time-code"
						/>
					</label>

					<CodigoTimer emailMascarado={emailMascaradoRec} onReenviar={solicitarRecuperacao} />

					<button
						type="button"
						class="btn preset-filled-primary-500 w-full py-3 flex items-center justify-center gap-2"
						disabled={loadingService.active || codigoRec.length !== 6}
						onclick={confirmarRecuperacao}
					>
						{loadingService.active ? 'Validando...' : 'Confirmar código'}
					</button>

					<button
						type="button"
						class="btn preset-outlined w-full"
						onclick={voltarParaIdentificadorRec}
					>
						← Voltar
					</button>
				</div>
			{:else}
				<div class="text-center">
					<Inbox
						class="w-12 h-12 mx-auto mb-4 text-surface-500 dark:text-surface-400"
						aria-hidden="true"
					/>
					<p class="font-semibold mb-2">
						{recuperacaoResultado === 'link' ? 'Link enviado!' : 'Código enviado!'}
					</p>
					<p class="text-sm text-surface-600 dark:text-surface-400 mb-6">
						{#if recuperacaoResultado === 'link'}
							Dentro de instantes você receberá em seu e-mail funcional um link de redefinição de
							senha. Verifique também sua caixa de spam.
						{:else}
							Você receberá um código de validação em instantes.
						{/if}
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
					<KeyRound
						class="w-12 h-12 mx-auto mb-3 text-surface-500 dark:text-surface-400"
						aria-hidden="true"
					/>
					<p class="font-semibold mb-1">Primeiro acesso</p>
					<p class="text-sm text-surface-600 dark:text-surface-400">
						Informe sua matrícula para receber uma senha provisória no e-mail cadastrado.
					</p>
				</div>
				<form
					method="POST"
					action="?/solicitarPrimeiroAcesso"
					use:enhance={handlePrimeiroAcesso}
					class="flex flex-col gap-5"
				>
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
					<Inbox
						class="w-12 h-12 mx-auto mb-4 text-surface-500 dark:text-surface-400"
						aria-hidden="true"
					/>
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
				<Mail
					class="w-12 h-12 mx-auto mb-3 text-surface-500 dark:text-surface-400"
					aria-hidden="true"
				/>
				<p class="font-semibold mb-1">Verificação em dois fatores</p>
			</div>

			<form
				method="POST"
				action="?/verificar2FA"
				use:enhance={handleVerificar2FA}
				class="flex flex-col gap-5"
			>
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

				<CodigoTimer {emailMascarado} onReenviar={reenviarCodigo2FA} />

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
		{/if}
	</div>
</div>
