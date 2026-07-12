<script lang="ts">
	import type { PageProps } from './$types';
	import { AlertTriangle } from 'lucide-svelte';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';

	const { data, form }: PageProps = $props();

	// Captura intencional do valor inicial — `provedor` é editável pelos radios e
	// é re-sincronizado pelo $effect abaixo quando o servidor confirma o salvar.
	// svelte-ignore state_referenced_locally
	let provedor = $state<'cloudflare' | 'resend'>(data.provedorEmail);
	let salvando = $state(false);

	// Mantém a seleção sincronizada com o que o servidor confirmou após salvar.
	$effect(() => {
		if (form?.provedorEmail) provedor = form.provedorEmail as 'cloudflare' | 'resend';
	});

	const OPCOES = [
		{
			valor: 'cloudflare' as const,
			titulo: 'Cloudflare Email',
			descricao: 'Binding nativo do Worker (cota ~200/dia). Padrão histórico do sistema.'
		},
		{
			valor: 'resend' as const,
			titulo: 'Resend',
			descricao: 'API HTTP (RESEND_API_KEY). Útil para isolar problemas de entrega.'
		}
	];
</script>

<svelte:head><title>Configurações Gerais — Escalas PC</title></svelte:head>

<div class="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
	<header>
		<h1 class="text-2xl font-bold text-surface-900 dark:text-white">Configurações Gerais</h1>
		<p class="text-sm text-surface-500 dark:text-surface-400">
			Ajustes globais do sistema. Alterações ficam registradas na auditoria.
		</p>
	</header>

	<section
		class="rounded-xl border border-surface-200 dark:border-white/10 bg-surface-50 dark:bg-surface-900 p-5 space-y-4"
	>
		<div>
			<h2 class="text-lg font-semibold text-surface-900 dark:text-white">
				Provedor de e-mail padrão
			</h2>
			<p class="text-sm text-surface-500 dark:text-surface-400">
				Define qual serviço envia os e-mails primeiro (códigos 2FA, recuperação de senha, link de
				primeiro acesso). Se o provedor padrão falhar ou estourar a cota, o outro assume
				automaticamente.
			</p>
		</div>

		<form
			method="POST"
			action="?/salvarEmail"
			use:enhance={() => {
				salvando = true;
				return async ({ result, update }) => {
					salvando = false;
					if (result.type === 'success') {
						toaster.success({ title: 'Configuração salva' });
					} else if (result.type === 'failure') {
						toaster.error({
							title: 'Não foi possível salvar',
							description: String(result.data?.error ?? '')
						});
					}
					await update({ reset: false });
				};
			}}
			class="space-y-4"
		>
			<div class="grid gap-3 sm:grid-cols-2">
				{#each OPCOES as op (op.valor)}
					<label
						class="flex cursor-pointer gap-3 rounded-xl border p-4 transition-all {provedor ===
						op.valor
							? 'border-primary-500/60 bg-primary-500/10'
							: 'border-surface-200 dark:border-white/10 hover:bg-surface-100/50 dark:hover:bg-surface-800/40'}"
					>
						<input
							type="radio"
							name="provedor"
							value={op.valor}
							bind:group={provedor}
							class="radio mt-1 shrink-0"
						/>
						<span class="space-y-1">
							<span class="block font-medium text-surface-900 dark:text-white">{op.titulo}</span>
							<span class="block text-xs text-surface-500 dark:text-surface-400"
								>{op.descricao}</span
							>
						</span>
					</label>
				{/each}
			</div>

			{#if provedor === 'resend' && !data.resendConfigurado}
				<p
					class="rounded-lg border border-warning-500/30 bg-warning-500/10 p-3 text-xs text-warning-700 dark:text-warning-300"
				>
					<AlertTriangle class="inline w-3.5 h-3.5 -mt-0.5" aria-hidden="true" /> O Resend não parece
					configurado (RESEND_API_KEY ausente). O envio cairá no fallback (Cloudflare) até configurar
					a chave.
				</p>
			{/if}

			<div class="flex items-center gap-3">
				<button
					type="submit"
					class="btn preset-filled-primary-500 text-sm"
					disabled={salvando || provedor === data.provedorEmail}
				>
					{salvando ? 'Salvando…' : 'Salvar'}
				</button>
				<span class="text-xs text-surface-500 dark:text-surface-400">
					Padrão atual: <strong>{data.provedorEmail === 'resend' ? 'Resend' : 'Cloudflare'}</strong>
				</span>
			</div>
		</form>
	</section>
</div>
