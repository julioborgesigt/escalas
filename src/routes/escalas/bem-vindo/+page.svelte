<script lang="ts">
	import { goto } from '$app/navigation';

	const { data } = $props();
	const usuario = $derived(data.usuario);
</script>

<svelte:head>
	<title>Bem-vindo às Escalas - Portal de Escalas</title>
</svelte:head>

<div
	class="welcome-wrapper flex flex-col items-center justify-center min-h-[70vh] px-4 animate-fade-in"
>
	<div
		class="welcome-card relative overflow-hidden rounded-3xl p-8 sm:p-12 border border-primary-500/20 shadow-2xl bg-white/40 dark:bg-surface-900/40 backdrop-blur-xl max-w-xl w-full text-center space-y-6"
	>
		<div
			class="absolute inset-0 bg-gradient-to-br from-primary-500/10 via-transparent to-warning-500/5 z-0"
		></div>

		<div class="relative z-10 space-y-6">
			<!-- Logo / Icon -->
			<div
				class="mx-auto w-16 h-16 rounded-2xl bg-primary-500/10 text-primary-500 flex items-center justify-center text-3xl shadow-inner animate-pulse"
			>
				📅
			</div>

			<!-- Title / Greeting -->
			<div class="space-y-2">
				<span
					class="inline-block text-[0.65rem] font-black uppercase tracking-widest text-primary-700 dark:text-primary-400 bg-primary-500/10 px-3 py-1 rounded-full"
				>
					Módulo de Escalas
				</span>
				<h2
					class="text-2xl sm:text-3xl font-black text-surface-900 dark:text-surface-50 tracking-tight leading-tight"
				>
					Seja bem-vindo, <span
						class="bg-clip-text text-transparent bg-gradient-to-r from-primary-600 to-warning-500 dark:from-primary-400 dark:to-warning-400"
						>{usuario?.nome?.split(' ')[0]}</span
					>!
				</h2>
			</div>

			<!-- Descrição -->
			<p class="text-sm text-surface-600 dark:text-surface-300 leading-relaxed max-w-md mx-auto">
				Você está no ambiente de gestão ordinária do Portal de Escalas. Planeje plantões,
				expedientes e controle as assinaturas digitais de sua unidade administrativa com facilidade.
			</p>

			<!-- Action -->
			<div class="pt-4">
				<button
					type="button"
					class="btn w-full sm:w-auto preset-filled-primary-500 hover:brightness-110 px-8 py-3.5 text-sm font-bold rounded-xl transition-all shadow-lg shadow-primary-500/25 flex items-center justify-center gap-2 text-white mx-auto active:scale-95"
					onclick={() => goto('/escalas')}
				>
					Entrar no Painel de Escalas
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2.5"
							d="M13 5l7 7-7 7M5 5l7 7-7 7"
						/></svg
					>
				</button>
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
