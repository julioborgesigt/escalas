<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	const { data } = $props();
	const usuario = $derived(data.usuario);

	const isSupervisorGise = $derived(page.data.isSupervisorGise ?? false);
	const isMembroGise = $derived(page.data.isMembroGise ?? false);
	const isSupervisaoGise = $derived(page.data.isSupervisaoGise ?? false);
</script>

<svelte:head>
	<title>Bem-vindo ao Portal de Escalas</title>
</svelte:head>

<div class="welcome-wrapper flex flex-col items-center justify-center min-h-[70vh] px-4 animate-fade-in">
	<div class="welcome-card relative overflow-hidden rounded-3xl p-8 sm:p-12 border border-surface-200 dark:border-white/10 shadow-2xl bg-white/40 dark:bg-surface-900/40 backdrop-blur-xl max-w-xl w-full text-center space-y-6">
		<div class="absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-transparent to-teal-500/5 z-0"></div>
		
		<div class="relative z-10 space-y-6">
			<!-- Logo / Icon -->
			<div class="mx-auto w-16 h-16 rounded-2xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center text-3xl shadow-inner animate-pulse">
				👮
			</div>

			<!-- Title / Greeting -->
			<div class="space-y-2">
				<span class="inline-block text-[0.65rem] font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 px-3 py-1 rounded-full">
					Portal de Escalas
				</span>
				<h2 class="text-2xl sm:text-3xl font-black text-surface-900 dark:text-surface-50 tracking-tight leading-tight">
					Seja bem-vindo, <span class="bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-teal-500 dark:from-indigo-400 dark:to-teal-400">{usuario?.nome?.split(' ')[0]}</span>!
				</h2>
			</div>

			<!-- Descrição -->
			<p class="text-sm text-surface-600 dark:text-surface-300 leading-relaxed max-w-md mx-auto">
				Acompanhe seus plantões de serviço ativo, registre suas presenças e preencha seus relatórios de produtividade operacional.
			</p>

			<!-- Action Buttons based on GISE roles -->
			<div class="pt-4 flex flex-col sm:flex-row gap-3 justify-center">
				{#if isSupervisorGise}
					<button
						type="button"
						class="btn preset-filled-secondary-500 hover:brightness-110 px-6 py-3 text-sm font-bold rounded-xl transition-all shadow-lg active:scale-95 text-white"
						onclick={() => goto('/gise')}
					>
						Supervisionar GISE
					</button>
				{/if}

				{#if isMembroGise || isSupervisaoGise}
					<button
						type="button"
						class="btn preset-filled-primary-500 hover:brightness-110 px-6 py-3 text-sm font-bold rounded-xl transition-all shadow-lg active:scale-95"
						onclick={() => goto('/res-gise')}
					>
						Registrar Presença GISE
					</button>
				{:else if !isSupervisorGise}
					<div class="p-4 rounded-2xl bg-surface-100/50 dark:bg-surface-950/40 text-xs text-surface-500 max-w-sm mx-auto">
						No momento você não possui nenhuma convocação para escala GISE ativa. Verifique com a chefia de sua unidade se necessário.
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
