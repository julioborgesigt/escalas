<script lang="ts">
	import { goto } from '$app/navigation';
	import { 
		Calendar, 
		LayoutDashboard, 
		Inbox, 
		Shield, 
		FileCheck, 
		ArrowRight 
	} from 'lucide-svelte';

	const { data } = $props();
	const usuario = $derived(data.usuario);
	const isSubAdmin = $derived(
		usuario?.papel === 'admin_unidade' || usuario?.papel === 'admin_seccional'
	);
	const showResGise = $derived(
		!!(data.isMembroGise || data.isSupervisorGise || data.isSupervisaoGise)
	);
	const cardWidthClass = $derived(
		usuario?.tipo === 'admin'
			? 'max-w-2xl'
			: usuario?.papel === 'admin_seccional'
				? showResGise
					? 'max-w-4xl'
					: 'max-w-2xl'
				: usuario?.papel === 'admin_unidade'
					? showResGise
						? 'max-w-2xl'
						: 'max-w-xl'
					: 'max-w-xl'
	);
</script>

<svelte:head>
	<title>Bem-vindo às Escalas - Portal de Escalas</title>
</svelte:head>

<div
	class="welcome-wrapper flex flex-col items-center justify-center min-h-[70vh] px-4 animate-fade-in"
>
	<div
		class="welcome-card relative overflow-hidden rounded-2xl sm:rounded-3xl p-5 sm:p-10 border border-primary-500/20 shadow-2xl bg-white/40 dark:bg-surface-900/40 backdrop-blur-xl {cardWidthClass} w-full text-center space-y-6"
	>
		<div
			class="absolute inset-0 bg-gradient-to-br from-primary-500/10 via-transparent to-warning-500/5 z-0"
		></div>

		<div class="relative z-10 space-y-6">
			<!-- Logo / Icon -->
			<div
				class="mx-auto w-14 h-14 rounded-2xl bg-primary-500/10 text-primary-500 flex items-center justify-center border border-primary-500/20 shadow-sm"
			>
				<Calendar class="w-7 h-7" />
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
					Você está no ambiente de gestão do Portal de Escalas. Como administrador, utilize as abas
					abaixo para monitorar a conformidade das escalas ou gerenciar os novos recebimentos.
				</p>

				<!-- Grid de Ações para Admin -->
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 text-left">
					<!-- Card Painel -->
					<div
						class="p-4 sm:p-5 rounded-2xl border border-surface-200 dark:border-white/10 bg-surface-50/50 dark:bg-surface-800/50 flex flex-col justify-between space-y-4 hover:border-primary-500/30 transition-colors"
					>
						<div class="space-y-2">
							<div class="flex items-center gap-2 text-primary-500">
								<LayoutDashboard class="w-5 h-5" />
								<h3 class="font-bold text-surface-900 dark:text-surface-50 text-base">
									Painel de Compliance
								</h3>
							</div>
							<p class="text-xs text-surface-600 dark:text-surface-300 leading-relaxed">
								Acompanhe o envio e assinatura das escalas por delegacia, monitorando o cumprimento
								dos prazos e identificando pendências.
							</p>
						</div>
						<button
							type="button"
							class="btn w-full preset-filled-primary-500 hover:brightness-110 py-2.5 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 text-white active:scale-95 shadow-md shadow-primary-500/25"
							onclick={() => goto('/painel')}
						>
							Acessar Painel
							<ArrowRight class="w-3.5 h-3.5" />
						</button>
					</div>

					<!-- Card Caixa de Entrada -->
					<div
						class="p-4 sm:p-5 rounded-2xl border border-surface-200 dark:border-white/10 bg-surface-50/50 dark:bg-surface-800/50 flex flex-col justify-between space-y-4 hover:border-primary-500/30 transition-colors"
					>
						<div class="space-y-2">
							<div class="flex items-center gap-2 text-primary-500">
								<Inbox class="w-5 h-5" />
								<h3 class="font-bold text-surface-900 dark:text-surface-50 text-base">
									Caixa de Entrada
								</h3>
							</div>
							<p class="text-xs text-surface-600 dark:text-surface-300 leading-relaxed">
								Visualize e gerencie os envios e assinaturas de escalas em tempo real, além de
								realizar exportações (Word, Excel, PDF).
							</p>
						</div>
						<button
							type="button"
							class="btn w-full preset-filled-primary-500 hover:brightness-110 py-2.5 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 text-white active:scale-95 shadow-md shadow-primary-500/25"
							onclick={() => goto('/recebidos')}
						>
							Acessar Cx. de Entrada
							<ArrowRight class="w-3.5 h-3.5" />
						</button>
					</div>
				</div>
			{:else if isSubAdmin}
				{#if usuario?.papel === 'admin_seccional'}
					<!-- Descrição Geral Admin Seccional -->
					<p
						class="text-sm text-surface-600 dark:text-surface-300 leading-relaxed max-w-lg mx-auto"
					>
						Você está no ambiente administrativo da seccional. Gerencie e supervisione as escalas
						ordinárias ou acesse o planejamento e acompanhamento do módulo GISE.
					</p>

					<!-- Grid de Ações para Admin Seccional (2 ou 3 cards) -->
					<div
						class="grid grid-cols-1 {showResGise
							? 'md:grid-cols-3'
							: 'sm:grid-cols-2'} gap-4 pt-4 text-left"
					>
						<!-- Card Escalas -->
						<div
							class="p-4 sm:p-5 rounded-2xl border border-surface-200 dark:border-white/10 bg-surface-50/50 dark:bg-surface-800/50 flex flex-col justify-between space-y-4 hover:border-primary-500/30 transition-colors"
						>
							<div class="space-y-2">
								<div class="flex items-center gap-2 text-primary-500">
									<Calendar class="w-5 h-5" />
									<h3 class="font-bold text-surface-900 dark:text-surface-50 text-base">
										Escalas Ordinárias
									</h3>
								</div>
								<p class="text-xs text-surface-600 dark:text-surface-300 leading-relaxed">
									Envie e gerencie as escalas ordinárias de sua seccional, incluindo plantão
									(mensal), expediente e a escala de final de semana.
								</p>
							</div>
							<button
								type="button"
								class="btn w-full preset-filled-primary-500 hover:brightness-110 py-2.5 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 text-white active:scale-95 shadow-md shadow-primary-500/25"
								onclick={() => goto('/escalas')}
							>
								Acessar Escalas
								<ArrowRight class="w-3.5 h-3.5" />
							</button>
						</div>

						<!-- Card Escalas GISE -->
						<div
							class="p-4 sm:p-5 rounded-2xl border border-surface-200 dark:border-white/10 bg-surface-50/50 dark:bg-surface-800/50 flex flex-col justify-between space-y-4 hover:border-primary-500/30 transition-colors"
						>
							<div class="space-y-2">
								<div class="flex items-center gap-2 text-primary-500">
									<Shield class="w-5 h-5" />
									<h3 class="font-bold text-surface-900 dark:text-surface-50 text-base">
										Escalas GISE
									</h3>
								</div>
								<p class="text-xs text-surface-600 dark:text-surface-300 leading-relaxed">
									Preencha e gerencie a escalação dos policiais convocados para atuar nas operações
									extraordinárias do GISE.
								</p>
							</div>
							<button
								type="button"
								class="btn w-full preset-filled-primary-500 hover:brightness-110 py-2.5 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 text-white active:scale-95 shadow-md shadow-primary-500/25"
								onclick={() => goto('/gise')}
							>
								Acessar Escalas GISE
								<ArrowRight class="w-3.5 h-3.5" />
							</button>
						</div>

						<!-- Card Presença GISE (Condicional) -->
						{#if showResGise}
							<div
								class="p-4 sm:p-5 rounded-2xl border border-surface-200 dark:border-white/10 bg-surface-50/50 dark:bg-surface-800/50 flex flex-col justify-between space-y-4 hover:border-primary-500/30 transition-colors"
							>
								<div class="space-y-2">
									<div class="flex items-center gap-2 text-primary-500">
										<FileCheck class="w-5 h-5" />
										<h3 class="font-bold text-surface-900 dark:text-surface-50 text-base">
											Presença GISE
										</h3>
									</div>
									<p class="text-xs text-surface-600 dark:text-surface-300 leading-relaxed">
										Confirme sua presença nas escalas extraordinárias GISE onde foi alocado e assine
										a folha correspondente.
									</p>
								</div>
								<button
									type="button"
									class="btn w-full preset-filled-primary-500 hover:brightness-110 py-2.5 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 text-white active:scale-95 shadow-md shadow-primary-500/25"
									onclick={() => goto('/res-gise')}
								>
									Confirmar Presença
									<ArrowRight class="w-3.5 h-3.5" />
								</button>
							</div>
						{/if}
					</div>
				{:else if usuario?.papel === 'admin_unidade'}
					{#if showResGise}
						<!-- Descrição Geral SubAdmin com GISE -->
						<p
							class="text-sm text-surface-600 dark:text-surface-300 leading-relaxed max-w-lg mx-auto"
						>
							Você está no ambiente administrativo do Portal de Escalas. Por aqui, você poderá criar
							e gerenciar as escalas ordinárias (mensal) de plantão e expediente e a escala de final
							de semana, bem como poderá confirmar sua presença na escala GISE, quando escalado.
						</p>

						<!-- Grid de Ações para SubAdmin (2 cards) -->
						<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 text-left">
							<!-- Card Escalas -->
							<div
								class="p-4 sm:p-5 rounded-2xl border border-surface-200 dark:border-white/10 bg-surface-50/50 dark:bg-surface-800/50 flex flex-col justify-between space-y-4 hover:border-primary-500/30 transition-colors"
							>
								<div class="space-y-2">
									<div class="flex items-center gap-2 text-primary-500">
										<Calendar class="w-5 h-5" />
										<h3 class="font-bold text-surface-900 dark:text-surface-50 text-base">
											Gestão de Escalas
										</h3>
									</div>
									<p class="text-xs text-surface-600 dark:text-surface-300 leading-relaxed">
										Crie e gerencie as escalas ordinárias (mensal) de plantão e expediente e a
										escala de final de semana de sua unidade administrativa.
									</p>
								</div>
								<button
									type="button"
									class="btn w-full preset-filled-primary-500 hover:brightness-110 py-2.5 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 text-white active:scale-95 shadow-md shadow-primary-500/25"
									onclick={() => goto('/escalas')}
								>
									Acessar Escalas
									<ArrowRight class="w-3.5 h-3.5" />
								</button>
							</div>

							<!-- Card Presença GISE -->
							<div
								class="p-4 sm:p-5 rounded-2xl border border-surface-200 dark:border-white/10 bg-surface-50/50 dark:bg-surface-800/50 flex flex-col justify-between space-y-4 hover:border-primary-500/30 transition-colors"
							>
								<div class="space-y-2">
									<div class="flex items-center gap-2 text-primary-500">
										<FileCheck class="w-5 h-5" />
										<h3 class="font-bold text-surface-900 dark:text-surface-50 text-base">
											Presença GISE
										</h3>
									</div>
									<p class="text-xs text-surface-600 dark:text-surface-300 leading-relaxed">
										Confirme sua presença nas escalas GISE ativas onde você foi alocado e assine a
										folha de presença correspondente.
									</p>
								</div>
								<button
									type="button"
									class="btn w-full preset-filled-primary-500 hover:brightness-110 py-2.5 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 text-white active:scale-95 shadow-md shadow-primary-500/25"
									onclick={() => goto('/res-gise')}
								>
									Acessar Presença GISE
									<ArrowRight class="w-3.5 h-3.5" />
								</button>
							</div>
						</div>
					{:else}
						<!-- Descrição para SubAdmin sem GISE -->
						<p
							class="text-sm text-surface-600 dark:text-surface-300 leading-relaxed max-w-md mx-auto"
						>
							Você está no ambiente de gestão do Portal de Escalas. Por aqui, você poderá criar e
							gerenciar as escalas ordinárias (mensal) de plantão e expediente e a escala de final
							de semana de sua unidade, bem como confirmar sua presença na escala GISE, quando
							estiver escalado.
						</p>

						<!-- Action para SubAdmin sem GISE -->
						<div class="pt-4">
							<button
								type="button"
								class="btn w-full sm:w-auto preset-filled-primary-500 hover:brightness-110 px-8 py-3.5 text-sm font-bold rounded-xl transition-all shadow-lg shadow-primary-500/25 flex items-center justify-center gap-2 text-white mx-auto active:scale-95"
								onclick={() => goto('/escalas')}
							>
								Entrar no Painel de Escalas
								<ArrowRight class="w-4 h-4" />
							</button>
						</div>
					{/if}
				{/if}
			{:else}
				<!-- Descrição Original para Policial -->
				<p class="text-sm text-surface-600 dark:text-surface-300 leading-relaxed max-w-md mx-auto">
					Você está no ambiente de gestão ordinária do Portal de Escalas. Planeje plantões,
					expedientes e controle as assinaturas digitais de sua unidade administrativa com
					facilidade.
				</p>

				<!-- Action Original para Policial -->
				<div class="pt-4">
					<button
						type="button"
						class="btn w-full sm:w-auto preset-filled-primary-500 hover:brightness-110 px-8 py-3.5 text-sm font-bold rounded-xl transition-all shadow-lg shadow-primary-500/25 flex items-center justify-center gap-2 text-white mx-auto active:scale-95"
						onclick={() => goto('/escalas')}
					>
						Entrar no Painel de Escalas
						<ArrowRight class="w-4 h-4" />
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
