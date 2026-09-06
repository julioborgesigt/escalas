<script lang="ts">
	/**
	 * Fluxo 1+2 da tela de login: formulário de senha (→ 2FA no orquestrador)
	 * e entrada por certificado digital SERPRO (dispensa 2FA).
	 */
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import { enhance } from '$app/forms';
	import { loading as loadingService } from '$lib/loading.svelte';
	import SeletorPolicialAdmin from './SeletorPolicialAdmin.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';

	let {
		tipo = $bindable(),
		matricula = $bindable(),
		senha = $bindable(),
		loginErrorDisplay,
		handleLogin,
		fazerLoginComCertificado,
		onPrimeiroAcesso,
		onRecuperacao
	}: {
		tipo: 'policial' | 'admin';
		matricula: string;
		senha: string;
		loginErrorDisplay: string | null;
		handleLogin: SubmitFunction;
		fazerLoginComCertificado: (comoAdmin?: boolean) => Promise<void>;
		onPrimeiroAcesso: () => void;
		onRecuperacao: () => void;
	} = $props();
</script>

<div class="mb-8">
	<SeletorPolicialAdmin bind:tipo />
</div>

<form method="POST" action="?/login" use:enhance={handleLogin} class="flex flex-col gap-4 sm:gap-6">
	<input type="hidden" name="tipo" value={tipo} />
	<label class="label">
		<span class="label-text">{tipo === 'admin' ? 'Login' : 'Matrícula'}</span>
		<!-- svelte-ignore a11y_autofocus -->
		<!-- Página dedicada de login: foco inicial no campo é padrão aceito por a11y. -->
		<input
			class="input"
			type="text"
			name="matricula"
			bind:value={matricula}
			placeholder={tipo === 'admin' ? 'Digite seu login' : 'Digite sua matrícula (8 caracteres)'}
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
			<AlertCircle class="w-4 h-4 shrink-0" aria-hidden="true" />
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
	<span class="text-xs text-surface-600 dark:text-surface-400 shrink-0">ou</span>
	<div class="flex-1 h-px bg-surface-200 dark:bg-surface-700"></div>
</div>
<button
	type="button"
	class="btn preset-outlined-surface-500 w-full py-3 flex items-center justify-center gap-2 text-sm"
	disabled={loadingService.active}
	onclick={() => fazerLoginComCertificado(tipo === 'admin')}
>
	<!-- Token A3 / pendrive USB — Lucide não tem flash-drive; silhueta lateral. -->
	<svg
		class="w-4 h-4 shrink-0"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<!-- Conector USB-A -->
		<path d="M2 9h5v6H2z" />
		<path d="M4 11v2M6 11v2" />
		<!-- Corpo do token -->
		<rect x="7" y="7" width="15" height="10" rx="2" />
	</svg>
	Certificado Digital (SERPRO)
</button>

<div
	class="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 text-xs text-surface-600 dark:text-surface-400 text-center"
	role="navigation"
	aria-label="Ajuda de acesso"
>
	{#if tipo === 'policial'}
		<span class="inline-flex flex-nowrap items-baseline gap-1">
			<span class="shrink-0">Primeiro acesso?</span>
			<button
				type="button"
				class="shrink-0 text-primary-600 dark:text-primary-400 underline underline-offset-2 hover:opacity-80 transition-opacity"
				onclick={onPrimeiroAcesso}
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
			onclick={onRecuperacao}
		>
			Recuperar
		</button>
	</span>
</div>
