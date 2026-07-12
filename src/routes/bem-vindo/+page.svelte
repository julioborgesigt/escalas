<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { User } from 'lucide-svelte';

	const { data } = $props();
	const usuario = $derived(data.usuario);

	const isSupervisorGise = $derived(page.data.isSupervisorGise ?? false);
	const isMembroGise = $derived(page.data.isMembroGise ?? false);
	const isSupervisaoGise = $derived(page.data.isSupervisaoGise ?? false);
</script>

<svelte:head>
	<title>Bem-vindo ao Portal de Escalas</title>
</svelte:head>

<div
	class="welcome-wrapper flex flex-col items-center justify-center min-h-[70vh] px-4 animate-fade-in"
>
	<div
		class="welcome-card relative overflow-hidden rounded-2xl sm:rounded-3xl p-5 sm:p-10 border border-surface-200 dark:border-white/10 shadow-2xl bg-white/40 dark:bg-surface-900/40 backdrop-blur-xl max-w-lg w-full text-center space-y-6"
	>
		<div
			class="absolute inset-0 bg-gradient-to-br from-secondary-500/10 via-transparent to-primary-500/5 z-0"
		></div>

		<div class="relative z-10 space-y-6">
			<!-- Logo / Icon -->
			<div
				class="mx-auto w-14 h-14 rounded-2xl bg-secondary-500/10 text-secondary-500 flex items-center justify-center border border-secondary-500/20 shadow-sm"
			>
				<User class="w-7 h-7" />
			</div>

			<!-- Title / Greeting -->
			<div class="space-y-2">
				<span
					class="inline-block text-3xs font-black uppercase tracking-widest text-secondary-600 dark:text-secondary-400 bg-secondary-500/10 px-3 py-1 rounded-full"
				>
					Portal de Escalas
				</span>
				<h1
					class="text-2xl sm:text-3xl font-black text-surface-900 dark:text-surface-50 tracking-tight leading-tight"
				>
					Seja bem-vindo, <span
						class="bg-clip-text text-transparent bg-gradient-to-r from-secondary-600 to-primary-500 dark:from-secondary-400 dark:to-primary-400"
						>{usuario?.nome?.split(' ')[0]}</span
					>!
				</h1>
			</div>

			<!-- Descrição -->
			<p class="text-sm text-surface-600 dark:text-surface-300 leading-relaxed max-w-md mx-auto">
				Acompanhe seus plantões de serviço ativo, registre suas presenças e preencha seus relatórios
				de produtividade operacional.
			</p>

			<!-- Action Buttons based on GISE roles -->
			<div class="pt-4 flex flex-col sm:flex-row gap-3 justify-center">
				{#if isSupervisorGise}
					<button
						type="button"
						class="btn preset-filled-secondary-500 hover:brightness-110 px-6 py-3 text-sm font-bold rounded-xl transition-all shadow-lg text-white"
						onclick={() => goto('/gise')}
					>
						Supervisionar GISE
					</button>
				{/if}

				{#if isMembroGise || isSupervisaoGise}
					<button
						type="button"
						class="btn preset-filled-primary-500 hover:brightness-110 px-6 py-3 text-sm font-bold rounded-xl transition-all shadow-lg"
						onclick={() => goto('/res-gise')}
					>
						Registrar Presença GISE
					</button>
				{:else if !isSupervisorGise}
					<div
						class="p-4 rounded-2xl bg-surface-100/50 dark:bg-surface-950/40 text-xs text-surface-500 max-w-sm mx-auto"
					>
						No momento você não possui nenhuma convocação para escala GISE ativa. Verifique com a
						chefia de sua unidade se necessário.
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.welcome-wrapper {
		background: radial-gradient(circle at top, rgba(99, 102, 241, 0.05) 0%, transparent 60%);
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
