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
	<title>Bem-vindo ao GISE - Portal de Escalas</title>
</svelte:head>

<div
	class="welcome-wrapper flex flex-col items-center justify-center min-h-[70vh] px-4 animate-fade-in"
>
	<div
		class="welcome-card relative overflow-hidden rounded-3xl p-8 sm:p-12 border border-secondary-500/20 shadow-2xl bg-white/40 dark:bg-surface-900/40 backdrop-blur-xl {cardWidthClass} w-full text-center space-y-6"
	>
		<div
			class="absolute inset-0 bg-gradient-to-br from-secondary-500/10 via-transparent to-primary-500/5 z-0"
		></div>

		<div class="relative z-10 space-y-6">
			<!-- Logo / Icon -->
			<div
				class="mx-auto w-16 h-16 rounded-2xl bg-secondary-500/10 text-secondary-500 flex items-center justify-center text-3xl shadow-inner animate-pulse"
			>
				🛡️
			</div>

			<!-- Title / Greeting -->
			<div class="space-y-2">
				<span
					class="inline-block text-[0.65rem] font-black uppercase tracking-widest text-secondary-600 dark:text-secondary-400 bg-secondary-500/10 px-3 py-1 rounded-full"
				>
					Módulo GISE
				</span>
				<h2
					class="text-2xl sm:text-3xl font-black text-surface-900 dark:text-surface-50 tracking-tight leading-tight"
				>
					Seja bem-vindo, <span
						class="bg-clip-text text-transparent bg-gradient-to-r from-secondary-600 to-primary-500 dark:from-secondary-400 dark:to-primary-400"
						>{usuario?.nome?.split(' ')[0]}</span
					>!
				</h2>
			</div>

			{#if usuario?.tipo === 'admin'}
				<!-- Descrição Geral Admin -->
				<p class="text-sm text-surface-600 dark:text-surface-300 leading-relaxed max-w-lg mx-auto">
					Você está no ambiente de gestão do módulo GISE. Como administrador, utilize as abas abaixo para gerenciar a alocação das equipes, analisar a produtividade ou ajustar configurações.
				</p>

				<!-- Grid de Ações para Admin (4 cards) -->
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 text-left">
					<!-- Card Escalas GISE -->
					<div class="p-5 rounded-2xl border border-surface-200 dark:border-white/10 bg-surface-50/50 dark:bg-surface-800/50 flex flex-col justify-between space-y-4 hover:border-secondary-500/30 transition-colors">
						<div class="space-y-2">
							<div class="flex items-center gap-2">
								<span class="text-xl">📅</span>
								<h3 class="font-bold text-surface-900 dark:text-surface-50 text-base">Escalas GISE</h3>
							</div>
							<p class="text-xs text-surface-600 dark:text-surface-300 leading-relaxed">
								Planeje, gerencie e valide a alocação de equipes operacionais e equipes de inteligência em serviço extraordinário.
							</p>
						</div>
						<button
							type="button"
							class="btn w-full preset-filled-secondary-500 hover:brightness-110 py-2.5 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 text-white active:scale-95 shadow-md shadow-secondary-500/25"
							onclick={() => goto('/gise')}
						>
							Acessar Escalas GISE
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" />
							</svg>
						</button>
					</div>

					<!-- Card Produtividade -->
					<div class="p-5 rounded-2xl border border-surface-200 dark:border-white/10 bg-surface-50/50 dark:bg-surface-800/50 flex flex-col justify-between space-y-4 hover:border-secondary-500/30 transition-colors">
						<div class="space-y-2">
							<div class="flex items-center gap-2">
								<span class="text-xl">📊</span>
								<h3 class="font-bold text-surface-900 dark:text-surface-50 text-base">Produtividade</h3>
							</div>
							<p class="text-xs text-surface-600 dark:text-surface-300 leading-relaxed">
								Acompanhe relatórios de apreensões de armas e drogas, analise os índices de prisões e exporte gráficos consolidados.
							</p>
						</div>
						<button
							type="button"
							class="btn w-full preset-filled-secondary-500 hover:brightness-110 py-2.5 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 text-white active:scale-95 shadow-md shadow-secondary-500/25"
							onclick={() => goto('/produtividade')}
						>
							Acessar Produtividade
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" />
							</svg>
						</button>
					</div>

					<!-- Card Conf. Gise -->
					<div class="p-5 rounded-2xl border border-surface-200 dark:border-white/10 bg-surface-50/50 dark:bg-surface-800/50 flex flex-col justify-between space-y-4 hover:border-secondary-500/30 transition-colors">
						<div class="space-y-2">
							<div class="flex items-center gap-2">
								<span class="text-xl">⚙️</span>
								<h3 class="font-bold text-surface-900 dark:text-surface-50 text-base">Conf. Gise</h3>
							</div>
							<p class="text-xs text-surface-600 dark:text-surface-300 leading-relaxed">
								Configure parâmetros globais do módulo GISE, como valores limite de cotas financeiras e horas extras permitidas.
							</p>
						</div>
						<button
							type="button"
							class="btn w-full preset-filled-secondary-500 hover:brightness-110 py-2.5 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 text-white active:scale-95 shadow-md shadow-secondary-500/25"
							onclick={() => goto('/gise/config')}
						>
							Acessar Conf. Gise
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" />
							</svg>
						</button>
					</div>

					<!-- Card Conf. Form. -->
					<div class="p-5 rounded-2xl border border-surface-200 dark:border-white/10 bg-surface-50/50 dark:bg-surface-800/50 flex flex-col justify-between space-y-4 hover:border-secondary-500/30 transition-colors">
						<div class="space-y-2">
							<div class="flex items-center gap-2">
								<span class="text-xl">📄</span>
								<h3 class="font-bold text-surface-900 dark:text-surface-50 text-base">Conf. Form.</h3>
							</div>
							<p class="text-xs text-surface-600 dark:text-surface-300 leading-relaxed">
								Gerencie modelos de formulários de relatório de inteligência e valide os arquivos de presença das equipes GISE.
							</p>
						</div>
						<button
							type="button"
							class="btn w-full preset-filled-secondary-500 hover:brightness-110 py-2.5 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 text-white active:scale-95 shadow-md shadow-secondary-500/25"
							onclick={() => goto('/res-gise')}
						>
							Acessar Conf. Form.
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" />
							</svg>
						</button>
					</div>
				</div>
			{:else}
				{#if isSubAdmin}
					{#if showResGise}
						<!-- Descrição Geral SubAdmin com GISE -->
						<p class="text-sm text-surface-600 dark:text-surface-300 leading-relaxed max-w-lg mx-auto">
							{#if usuario?.papel === 'admin_unidade'}
								Você está no ambiente administrativo do GISE. Por aqui, você poderá gerenciar a alocação de equipes operacionais e de inteligência, bem como confirmar sua presença na escala GISE, quando escalado.
							{:else}
								Você está no ambiente administrativo do GISE. Por aqui, você poderá planejar e gerenciar a alocação de equipes operacionais e de inteligência da seccional, bem como confirmar sua presença na escala GISE, quando escalado.
							{/if}
						</p>

						<!-- Grid de Ações para SubAdmin (2 cards) -->
						<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 text-left">
							<!-- Card Escalas GISE -->
							<div class="p-5 rounded-2xl border border-surface-200 dark:border-white/10 bg-surface-50/50 dark:bg-surface-800/50 flex flex-col justify-between space-y-4 hover:border-secondary-500/30 transition-colors">
								<div class="space-y-2">
									<div class="flex items-center gap-2">
										<span class="text-xl">📅</span>
										<h3 class="font-bold text-surface-900 dark:text-surface-50 text-base">Escalas GISE</h3>
									</div>
									<p class="text-xs text-surface-600 dark:text-surface-300 leading-relaxed">
										{#if usuario?.papel === 'admin_unidade'}
											Gerencie a alocação de equipes operacionais e de inteligência da sua unidade na escala GISE.
										{:else}
											Planeje, gerencie e valide a alocação de equipes operacionais e de inteligência na escala GISE da seccional.
										{/if}
									</p>
								</div>
								<button
									type="button"
									class="btn w-full preset-filled-secondary-500 hover:brightness-110 py-2.5 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 text-white active:scale-95 shadow-md shadow-secondary-500/25"
									onclick={() => goto('/gise')}
								>
									Acessar Escalas GISE
									<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" />
									</svg>
								</button>
							</div>

							<!-- Card Presença GISE -->
							<div class="p-5 rounded-2xl border border-surface-200 dark:border-white/10 bg-surface-50/50 dark:bg-surface-800/50 flex flex-col justify-between space-y-4 hover:border-secondary-500/30 transition-colors">
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
									class="btn w-full preset-filled-secondary-500 hover:brightness-110 py-2.5 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 text-white active:scale-95 shadow-md shadow-secondary-500/25"
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
								Você está no ambiente de planejamento especial do GISE. Como administrador da unidade, você poderá gerenciar a alocação de equipes operacionais e de inteligência, bem como confirmar sua presença na escala GISE, quando estiver escalado.
							{:else}
								Você está no ambiente de planejamento especial do GISE. Como administrador da seccional, você poderá gerenciar a alocação de equipes operacionais e de inteligência, bem como confirmar sua presença na escala GISE, quando estiver escalado.
							{/if}
						</p>

						<!-- Action para SubAdmin sem GISE -->
						<div class="pt-4">
							<button
								type="button"
								class="btn w-full sm:w-auto preset-filled-secondary-500 hover:brightness-110 px-8 py-3.5 text-sm font-bold rounded-xl transition-all shadow-lg shadow-secondary-500/25 flex items-center justify-center gap-2 text-white mx-auto active:scale-95"
								onclick={() => goto('/gise')}
							>
								Entrar no Painel GISE
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
					<!-- Descrição Original para Supervisor/Membro -->
					<p class="text-sm text-surface-600 dark:text-surface-300 leading-relaxed max-w-md mx-auto">
						Você está no ambiente de planejamento especial do GISE. Aqui você pode gerenciar a alocação
						de equipes operacionais e validar os relatórios consolidados de serviço extraordinário.
					</p>

					<!-- Action Original para Supervisor/Membro -->
					<div class="pt-4">
						<button
							type="button"
							class="btn w-full sm:w-auto preset-filled-secondary-500 hover:brightness-110 px-8 py-3.5 text-sm font-bold rounded-xl transition-all shadow-lg shadow-secondary-500/25 flex items-center justify-center gap-2 text-white mx-auto active:scale-95"
							onclick={() => goto('/gise')}
						>
							Entrar no Painel GISE
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
			{/if}
		</div>
	</div>
</div>

<style>
	.welcome-wrapper {
		background: radial-gradient(circle at top, rgba(168, 85, 247, 0.05) 0%, transparent 60%);
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
