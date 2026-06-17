<script lang="ts">
	import { goto } from '$app/navigation';

	const { data } = $props();
	const usuario = $derived(data.usuario);
	const isSubAdmin = $derived(
		usuario?.papel === 'admin_unidade' || usuario?.papel === 'admin_seccional'
	);
	const showResGise = $derived(
		!!(data.isMembroGise || data.isSupervisorGise || data.isSupervisaoGise)
	);
	const cardWidthClass = $derived(
		usuario?.tipo === 'admin' || (isSubAdmin && showResGise) ? 'max-w-2xl' : 'max-w-xl'
	);
</script>

<svelte:head>
	<title>Bem-vindo às Escalas - Portal de Escalas</title>
</svelte:head>

<div
	class="welcome-wrapper flex flex-col items-center justify-center min-h-[70vh] px-4 animate-fade-in"
>
	<div
		class="welcome-card relative overflow-hidden rounded-3xl p-8 sm:p-12 border border-primary-500/20 shadow-2xl bg-white/40 dark:bg-surface-900/40 backdrop-blur-xl {cardWidthClass} w-full text-center space-y-6"
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

			{#if usuario?.tipo === 'admin'}
				<!-- Descrição Geral Admin -->
				<p class="text-sm text-surface-600 dark:text-surface-300 leading-relaxed max-w-lg mx-auto">
					Você está no ambiente de gestão do Portal de Escalas. Como administrador, utilize as abas abaixo para monitorar a conformidade das escalas ou gerenciar os novos recebimentos.
				</p>

				<!-- Grid de Ações para Admin -->
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 text-left">
					<!-- Card Painel -->
					<div class="p-5 rounded-2xl border border-surface-200 dark:border-white/10 bg-surface-50/50 dark:bg-surface-800/50 flex flex-col justify-between space-y-4 hover:border-primary-500/30 transition-colors">
						<div class="space-y-2">
							<div class="flex items-center gap-2">
								<span class="text-xl">📊</span>
								<h3 class="font-bold text-surface-900 dark:text-surface-50 text-base">Painel de Compliance</h3>
							</div>
							<p class="text-xs text-surface-600 dark:text-surface-300 leading-relaxed">
								Acompanhe o envio e assinatura das escalas por delegacia, monitorando o cumprimento dos prazos e identificando pendências.
							</p>
						</div>
						<button
							type="button"
							class="btn w-full preset-filled-primary-500 hover:brightness-110 py-2.5 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 text-white active:scale-95 shadow-md shadow-primary-500/25"
							onclick={() => goto('/painel')}
						>
							Acessar Painel
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" />
							</svg>
						</button>
					</div>

					<!-- Card Caixa de Entrada -->
					<div class="p-5 rounded-2xl border border-surface-200 dark:border-white/10 bg-surface-50/50 dark:bg-surface-800/50 flex flex-col justify-between space-y-4 hover:border-primary-500/30 transition-colors">
						<div class="space-y-2">
							<div class="flex items-center gap-2">
								<span class="text-xl">📥</span>
								<h3 class="font-bold text-surface-900 dark:text-surface-50 text-base">Caixa de Entrada</h3>
							</div>
							<p class="text-xs text-surface-600 dark:text-surface-300 leading-relaxed">
								Visualize e gerencie os envios e assinaturas de escalas em tempo real, além de realizar exportações (Word, Excel, PDF).
							</p>
						</div>
						<button
							type="button"
							class="btn w-full preset-filled-primary-500 hover:brightness-110 py-2.5 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 text-white active:scale-95 shadow-md shadow-primary-500/25"
							onclick={() => goto('/recebidos')}
						>
							Acessar Cx. de Entrada
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" />
							</svg>
						</button>
					</div>
				</div>
			{:else if isSubAdmin}
				{#if showResGise}
					<!-- Descrição Geral SubAdmin com GISE -->
					<p class="text-sm text-surface-600 dark:text-surface-300 leading-relaxed max-w-lg mx-auto">
						{#if usuario?.papel === 'admin_unidade'}
							Você está no ambiente administrativo do Portal de Escalas. Por aqui, você poderá criar e gerenciar as escalas ordinárias (mensal) de plantão e expediente e a escala de final de semana, bem como poderá confirmar sua presença na escala GISE, quando escalado.
						{:else}
							Você está no ambiente administrativo do Portal de Escalas. Por aqui, você poderá gerenciar e supervisionar as escalas ordinárias (mensal) de plantão e expediente e a escala de final de semana da seccional, bem como poderá confirmar sua presença na escala GISE, quando escalado.
						{/if}
					</p>

					<!-- Grid de Ações para SubAdmin (2 cards) -->
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 text-left">
						<!-- Card Escalas -->
						<div class="p-5 rounded-2xl border border-surface-200 dark:border-white/10 bg-surface-50/50 dark:bg-surface-800/50 flex flex-col justify-between space-y-4 hover:border-primary-500/30 transition-colors">
							<div class="space-y-2">
								<div class="flex items-center gap-2">
									<span class="text-xl">📅</span>
									<h3 class="font-bold text-surface-900 dark:text-surface-50 text-base">Gestão de Escalas</h3>
								</div>
								<p class="text-xs text-surface-600 dark:text-surface-300 leading-relaxed">
									{#if usuario?.papel === 'admin_unidade'}
										Crie e gerencie as escalas ordinárias (mensal) de plantão e expediente e a escala de final de semana de sua unidade administrativa.
									{:else}
										Acompanhe, gerencie e supervisione as escalas ordinárias e de final de semana das unidades subordinadas da sua seccional.
									{/if}
								</p>
							</div>
							<button
								type="button"
								class="btn w-full preset-filled-primary-500 hover:brightness-110 py-2.5 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 text-white active:scale-95 shadow-md shadow-primary-500/25"
								onclick={() => goto('/escalas')}
							>
								Acessar Escalas
								<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" />
								</svg>
							</button>
						</div>

						<!-- Card Presença GISE -->
						<div class="p-5 rounded-2xl border border-surface-200 dark:border-white/10 bg-surface-50/50 dark:bg-surface-800/50 flex flex-col justify-between space-y-4 hover:border-primary-500/30 transition-colors">
							<div class="space-y-2">
								<div class="flex items-center gap-2">
									<span class="text-xl">🛡️</span>
									<h3 class="font-bold text-surface-900 dark:text-surface-50 text-base">Presença GISE</h3>
								</div>
								<p class="text-xs text-surface-600 dark:text-surface-300 leading-relaxed">
									Confirme sua presença nas escalas GISE ativas onde você foi alocado e assine a folha de presença correspondente.
								</p>
							</div>
							<button
								type="button"
								class="btn w-full preset-filled-primary-500 hover:brightness-110 py-2.5 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 text-white active:scale-95 shadow-md shadow-primary-500/25"
								onclick={() => goto('/res-gise')}
							>
								Acessar Presença GISE
								<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" />
								</svg>
							</button>
						</div>
					</div>
				{:else}
					<!-- Descrição para SubAdmin sem GISE -->
					<p class="text-sm text-surface-600 dark:text-surface-300 leading-relaxed max-w-md mx-auto">
						{#if usuario?.papel === 'admin_unidade'}
							Você está no ambiente de gestão do Portal de Escalas. Por aqui, você poderá criar e gerenciar as escalas ordinárias (mensal) de plantão e expediente e a escala de final de semana de sua unidade, bem como confirmar sua presença na escala GISE, quando estiver escalado.
						{:else}
							Você está no ambiente de gestão do Portal de Escalas. Como administrador da seccional, você poderá gerenciar e supervisionar as escalas ordinárias (mensal) de plantão e expediente e a escala de final de semana de todas as unidades da sua seccional, bem como confirmar sua presença na escala GISE, quando estiver escalado.
						{/if}
					</p>

					<!-- Action para SubAdmin sem GISE -->
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
				{/if}
			{:else}
				<!-- Descrição Original para Policial -->
				<p class="text-sm text-surface-600 dark:text-surface-300 leading-relaxed max-w-md mx-auto">
					Você está no ambiente de gestão ordinária do Portal de Escalas. Planeje plantões,
					expedientes e controle as assinaturas digitais de sua unidade administrativa com facilidade.
				</p>

				<!-- Action Original para Policial -->
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
			{/if}
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
