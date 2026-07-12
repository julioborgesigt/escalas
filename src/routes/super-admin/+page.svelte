<script lang="ts">
	import { goto } from '$app/navigation';
	import { ShieldCheck, Building, Users, Key, Settings, History, ArrowRight } from 'lucide-svelte';

	const { data } = $props();
	const usuario = $derived(data.usuario);

	const acoes = [
		{
			icone: Building,
			titulo: 'Unidades',
			descricao:
				'Cadastre e gerencie a estrutura organizacional: departamentos, seccionais e delegacias.',
			rota: '/unidades',
			cta: 'Gerenciar Unidades'
		},
		{
			icone: Users,
			titulo: 'Policiais',
			descricao:
				'Gerencie o cadastro de policiais, papéis administrativos (RBAC) e a concessão de Admin Geral.',
			rota: '/policiais',
			cta: 'Gerenciar Policiais'
		},
		{
			icone: Key,
			titulo: 'Config. de Assinatura',
			descricao:
				'Defina os requisitos das assinaturas eletrônicas (foto, GPS e código por e-mail / 2FA).',
			rota: '/conf-ass',
			cta: 'Abrir Config. Ass.'
		},
		{
			icone: Settings,
			titulo: 'Configurações Gerais',
			descricao:
				'Ajustes globais do sistema, como o provedor de e-mail padrão (Cloudflare / Resend) com fallback.',
			rota: '/config-geral',
			cta: 'Abrir Config. Geral'
		},
		{
			icone: History,
			titulo: 'Auditoria',
			descricao:
				'Trilha forense de ações do sistema: filtros, verificação de integridade e exportação (CSV/PDF).',
			rota: '/auditoria',
			cta: 'Abrir Auditoria'
		}
	];
</script>

<svelte:head>
	<title>Administração do Sistema — Portal de Escalas</title>
</svelte:head>

<div
	class="welcome-wrapper flex flex-col items-center justify-center min-h-[70vh] px-4 animate-fade-in"
>
	<div
		class="welcome-card relative overflow-hidden rounded-2xl sm:rounded-3xl p-5 sm:p-10 border border-primary-500/20 shadow-2xl bg-white/40 dark:bg-surface-900/40 backdrop-blur-xl max-w-5xl w-full text-center space-y-6"
	>
		<div
			class="absolute inset-0 bg-gradient-to-br from-primary-500/10 via-transparent to-warning-500/5 z-0"
		></div>

		<div class="relative z-10 space-y-6">
			<div
				class="mx-auto w-14 h-14 rounded-2xl bg-primary-500/10 text-primary-500 flex items-center justify-center border border-primary-500/20 shadow-sm"
			>
				<ShieldCheck class="w-7 h-7" />
			</div>

			<div class="space-y-2">
				<span
					class="inline-block text-3xs font-black uppercase tracking-widest text-primary-700 dark:text-primary-400 bg-primary-500/10 px-3 py-1 rounded-full"
				>
					Administração do Sistema
				</span>
				<h1
					class="text-2xl sm:text-3xl font-black text-surface-900 dark:text-surface-50 tracking-tight leading-tight"
				>
					Seja bem-vindo, <span
						class="bg-clip-text text-transparent bg-gradient-to-r from-primary-600 to-warning-500 dark:from-primary-400 dark:to-warning-400"
						>{usuario?.nome?.split(' ')[0]}</span
					>!
				</h1>
			</div>

			<p class="text-sm text-surface-600 dark:text-surface-300 leading-relaxed max-w-2xl mx-auto">
				Você está no console do <strong>Super Administrador</strong>. Aqui você gerencia a estrutura
				do sistema (unidades e policiais), as configurações globais e a auditoria/conformidade — sem
				as abas operacionais do dia a dia.
			</p>

			<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-2 text-left">
				{#each acoes as acao (acao.rota)}
					{@const Icon = acao.icone}
					<div
						class="p-4 sm:p-5 rounded-2xl border border-surface-200 dark:border-white/10 bg-surface-50/50 dark:bg-surface-800/50 flex flex-col justify-between space-y-4 hover:border-primary-500/30 transition-colors"
					>
						<div class="space-y-2">
							<div class="flex items-center gap-2 text-primary-500">
								<Icon class="w-5 h-5" />
								<h3 class="font-bold text-surface-900 dark:text-surface-50 text-base">
									{acao.titulo}
								</h3>
							</div>
							<p class="text-xs text-surface-600 dark:text-surface-300 leading-relaxed">
								{acao.descricao}
							</p>
						</div>
						<button
							type="button"
							class="btn w-full preset-filled-primary-500 hover:brightness-110 py-2.5 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 text-white shadow-md shadow-primary-500/25"
							onclick={() => goto(acao.rota)}
						>
							{acao.cta}
							<ArrowRight class="w-3.5 h-3.5" />
						</button>
					</div>
				{/each}
			</div>
		</div>
	</div>
</div>

<style>
	.welcome-wrapper {
		background: radial-gradient(circle at top, rgba(16, 185, 129, 0.05) 0%, transparent 60%);
	}

	.welcome-card {
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
	}

	.animate-fade-in {
		animation: fadeIn 0.4s ease-out both;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
