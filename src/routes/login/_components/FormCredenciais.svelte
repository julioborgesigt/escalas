<script lang="ts">
	/**
	 * Fluxo 1+2 da tela de login: formulário de senha (→ 2FA no orquestrador)
	 * e entrada por certificado digital SERPRO (dispensa 2FA).
	 */
	import { AlertCircle, Calendar, Shield } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import { loading as loadingService } from '$lib/loading.svelte';
	import { Tabs } from '@skeletonlabs/skeleton-svelte';
	import type { SubmitFunction } from '@sveltejs/kit';

	let {
		tipo = $bindable(),
		adminModulo = $bindable(),
		matricula = $bindable(),
		senha = $bindable(),
		loginErrorDisplay,
		handleLogin,
		fazerLoginComCertificado,
		onPrimeiroAcesso,
		onRecuperacao
	}: {
		tipo: 'policial' | 'admin';
		adminModulo: 'gise' | 'escalas';
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
				class="px-3 py-2 text-sm font-semibold rounded-lg flex-1 text-center cursor-pointer select-none transition-all duration-200 text-surface-600 dark:text-surface-400 data-[selected]:bg-primary-500 data-[selected]:text-white data-[selected]:shadow-md data-[selected]:shadow-primary-500/25 hover:text-surface-700 dark:hover:text-surface-200"
				>Policial</Tabs.Trigger
			>
			<Tabs.Trigger
				value="admin"
				class="px-3 py-2 text-sm font-semibold rounded-lg flex-1 text-center cursor-pointer select-none transition-all duration-200 text-surface-600 dark:text-surface-400 data-[selected]:bg-primary-500 data-[selected]:text-white data-[selected]:shadow-md data-[selected]:shadow-primary-500/25 hover:text-surface-700 dark:hover:text-surface-200"
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
			<span
				class="label-text text-xs font-semibold uppercase tracking-wider text-surface-600 dark:text-surface-400"
				>Módulo de Acesso</span
			>
			<div class="flex gap-2 mt-1">
				{#each [{ value: 'escalas', label: 'Escalas' }, { value: 'gise', label: 'GISE' }] as opt (opt.value)}
					<button
						type="button"
						class="flex-1 flex flex-col items-center gap-1 py-2 px-1 rounded-xl border text-xs font-medium transition-all
							{adminModulo === opt.value
							? 'bg-primary-500/15 border-primary-500/50 text-primary-700 dark:text-primary-400'
							: 'border-surface-200 dark:border-surface-700 text-surface-600 dark:text-surface-400 hover:border-surface-400 dark:hover:border-surface-500'}"
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
	<p class="mt-2 text-2xs text-surface-600 dark:text-surface-400 text-center">
		Requer certificado A3 de um policial com acesso de Administrador Geral.
	</p>
{/if}

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
