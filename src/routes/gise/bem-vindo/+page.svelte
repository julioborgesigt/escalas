<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	let activeTab = $state('geral');
	let selectedStatusIndex = $state(0);

	const statusFlow = [
		{
			status: 'em_definicao_supervisor',
			label: 'Definição do Supervisor',
			responsible: 'Administrador Geral',
			desc: 'A escala GISE é criada pelo Administrador. Neste momento, o supervisor da escala deve ser definido para que ele possa assumir as edições.',
			icon: '👤',
			badgeColor: 'bg-surface-200 text-surface-800 dark:bg-surface-800 dark:text-surface-200'
		},
		{
			status: 'em_preenchimento',
			label: 'Preenchimento',
			responsible: 'Supervisores de Seccional',
			desc: 'Os administradores de seccional/unidade preenchem as equipes, alocam os policiais nos respectivos slots (DPC/OIP) e enviam as informações.',
			icon: '✍️',
			badgeColor: 'bg-primary-500/10 text-primary-700 dark:text-primary-400'
		},
		{
			status: 'aguardando_assinatura',
			label: 'Aguardando Assinatura',
			responsible: 'Supervisor da GISE',
			desc: 'Com todas as seccionais preenchidas, a escala principal é gerada em PDF e fica aguardando a assinatura digital do supervisor designado.',
			icon: '✍️',
			badgeColor: 'bg-warning-500/10 text-warning-700 dark:text-warning-400'
		},
		{
			status: 'em_andamento',
			label: 'Em Andamento',
			responsible: 'Policiais Escalados',
			desc: 'A escala está ativa. Durante o serviço, os policiais escalados realizam o check-in (entrada) e o check-out (saída) com confirmação de rubrica e selfie.',
			icon: '⚡',
			badgeColor: 'bg-success-500/10 text-success-700 dark:text-success-400'
		},
		{
			status: 'aguardando_relatorios',
			label: 'Aguardando Relatórios',
			responsible: 'Supervisores de Seccional',
			desc: 'O período operacional da escala terminou. Os responsáveis de cada seccional inserem as respostas dos relatórios de produtividade/atividades operacionais.',
			icon: '📋',
			badgeColor: 'bg-secondary-500/10 text-secondary-700 dark:text-secondary-400'
		},
		{
			status: 'aguardando_assinatura_relat',
			label: 'Assinatura dos Relatórios',
			responsible: 'Supervisor da GISE',
			desc: 'Os relatórios de produtividade e de serviço extraordinário (extras) foram gerados e aguardam a validação e assinatura digital do supervisor.',
			icon: '🔑',
			badgeColor: 'bg-tertiary-500/10 text-tertiary-700 dark:text-tertiary-400'
		},
		{
			status: 'pronta_para_finalizar',
			label: 'Pronta para Finalizar',
			responsible: 'Supervisor / Admin',
			desc: 'Escala e todos os seus relatórios periféricos estão completamente assinados e revisados, prontos para o arquivamento definitivo.',
			icon: '🏁',
			badgeColor: 'bg-info-500/10 text-info-700 dark:text-info-400'
		},
		{
			status: 'finalizada',
			label: 'Finalizada',
			responsible: 'Sistema',
			desc: 'A escala GISE é finalizada. Os dados estatísticos de produtividade são consolidados nos dashboards gerais e os arquivos PDF oficiais estão guardados.',
			icon: '✅',
			badgeColor: 'bg-success-500 text-white'
		}
	];

	const selectedStatus = $derived(statusFlow[selectedStatusIndex]);
</script>

<svelte:head>
	<title>Bem-vindo ao Módulo GISE - Portal de Escalas</title>
</svelte:head>

<div class="welcome-container space-y-8 animate-fade-in">
	<!-- Top Bar / Navigation Back -->
	<div class="flex items-center justify-between border-b border-surface-200/60 dark:border-white/5 pb-4">
		<div class="flex items-center gap-3">
			<button
				type="button"
				class="btn btn-sm preset-outlined-surface-500 hover:bg-surface-200/30 dark:hover:bg-surface-800/40 rounded-xl transition-all"
				onclick={() => goto('/gise')}
			>
				← Voltar
			</button>
			<h1 class="text-xl sm:text-2xl font-bold tracking-tight text-surface-900 dark:text-surface-50">
				Módulo GISE
			</h1>
		</div>
		<span class="badge preset-filled-secondary-500/10 text-secondary-700 dark:text-secondary-400 font-bold uppercase tracking-wider text-xs px-2.5 py-1">
			Guia do Usuário
		</span>
	</div>

	<!-- Hero Banner -->
	<div class="hero-card relative overflow-hidden rounded-3xl p-6 sm:p-10 border border-secondary-500/20 shadow-xl dark:shadow-black/30">
		<div class="absolute inset-0 bg-gradient-to-br from-secondary-500/10 via-transparent to-primary-500/5 z-0"></div>
		<div class="relative z-10 max-w-2xl space-y-3">
			<h2 class="text-3xl sm:text-4xl font-black text-surface-900 dark:text-surface-50 tracking-tight leading-tight">
				Gestão Integrada de <span class="bg-clip-text text-transparent bg-gradient-to-r from-secondary-600 via-secondary-500 to-primary-500 dark:from-secondary-400 dark:to-primary-400">Serviços Especiais</span>
			</h2>
			<p class="text-sm sm:text-base text-surface-600 dark:text-surface-300 leading-relaxed">
				Bem-vindo ao centro de operações do GISE. Gerencie o ciclo de vida completo de operações especiais, coordene equipes, valide a produtividade policial e certifique a presença do contingente com total rigor criptográfico.
			</p>
			<div class="pt-2 flex flex-wrap gap-3">
				<button
					type="button"
					class="btn preset-filled-secondary-500 hover:brightness-110 px-4 py-2 text-sm font-bold rounded-xl transition-all shadow-lg shadow-secondary-500/20 flex items-center gap-2 text-white"
					onclick={() => goto('/gise')}
				>
					Acessar Painel GISE
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
				</button>
			</div>
		</div>
	</div>

	<!-- Tabs Header -->
	<div class="flex border-b border-surface-200 dark:border-white/10 gap-2 overflow-x-auto pb-px">
		<button
			type="button"
			class="tab-btn {activeTab === 'geral' ? 'active' : ''}"
			onclick={() => (activeTab = 'geral')}
		>
			ℹ️ Visão Geral
		</button>
		<button
			type="button"
			class="tab-btn {activeTab === 'fluxo' ? 'active' : ''}"
			onclick={() => (activeTab = 'fluxo')}
		>
			🔄 Ciclo de Vida & Status
		</button>
		<button
			type="button"
			class="tab-btn {activeTab === 'presenca' ? 'active' : ''}"
			onclick={() => (activeTab = 'presenca')}
		>
			📸 Presença & Prova de Vida
		</button>
		<button
			type="button"
			class="tab-btn {activeTab === 'relatorios' ? 'active' : ''}"
			onclick={() => (activeTab = 'relatorios')}
		>
			📊 Produtividade & Extras
		</button>
	</div>

	<!-- Content Area -->
	<div class="tab-content-wrapper">
		{#if activeTab === 'geral'}
			<div class="space-y-8 animate-slide-up">
				<!-- Grid Cards -->
				<div class="grid grid-cols-1 md:grid-cols-3 gap-6">
					<div class="card p-6 rounded-2xl bg-white/40 dark:bg-surface-900/40 border border-surface-200/60 dark:border-white/5 space-y-3 shadow-sm hover:shadow-md transition-shadow">
						<div class="w-10 h-10 rounded-xl bg-secondary-500/10 text-secondary-600 dark:text-secondary-400 flex items-center justify-center font-bold text-lg">
							🎯
						</div>
						<h3 class="text-lg font-bold text-surface-900 dark:text-surface-50">Equipes e Slots</h3>
						<p class="text-xs text-surface-500 dark:text-surface-400 leading-relaxed">
							Distribua os policiais em equipes operacionais específicas de Inteligência (SEINT) ou equipes padrão com quantitativos de vagas para DPC e OIP predefinidos.
						</p>
					</div>

					<div class="card p-6 rounded-2xl bg-white/40 dark:bg-surface-900/40 border border-surface-200/60 dark:border-white/5 space-y-3 shadow-sm hover:shadow-md transition-shadow">
						<div class="w-10 h-10 rounded-xl bg-primary-500/10 text-primary-600 dark:text-primary-400 flex items-center justify-center font-bold text-lg">
							👤
						</div>
						<h3 class="text-lg font-bold text-surface-900 dark:text-surface-50">Evidência Biométrica</h3>
						<p class="text-xs text-surface-500 dark:text-surface-400 leading-relaxed">
							Check-in e check-out integrados com fotos selfies auditadas por testes de "liveness" (presença de vida), reduzindo fraudes no registro de horas.
						</p>
					</div>

					<div class="card p-6 rounded-2xl bg-white/40 dark:bg-surface-900/40 border border-surface-200/60 dark:border-white/5 space-y-3 shadow-sm hover:shadow-md transition-shadow">
						<div class="w-10 h-10 rounded-xl bg-warning-500/10 text-warning-600 dark:text-warning-400 flex items-center justify-center font-bold text-lg">
							📈
						</div>
						<h3 class="text-lg font-bold text-surface-900 dark:text-surface-50">Métricas Consolidadas</h3>
						<p class="text-xs text-surface-500 dark:text-surface-400 leading-relaxed">
							Relatórios de produtividade convertidos automaticamente em dados estatísticos e gráficos, melhorando a análise do impacto de operações policiais especiais.
						</p>
					</div>
				</div>

				<!-- Info Box -->
				<div class="card-glass p-6 sm:p-8 rounded-3xl border border-surface-200 dark:border-white/10 space-y-4 shadow-md bg-surface-100/20 dark:bg-surface-800/10">
					<h3 class="text-lg font-bold text-surface-900 dark:text-surface-50">
						Diferença entre GISE e ESCALAS ordinárias
					</h3>
					<p class="text-xs sm:text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
						Enquanto o módulo de <strong>Escalas</strong> gerencia a rotina mensal regular e expediente geral de cada delegacia de polícia, o <strong>GISE</strong> é destinado a <strong>operações especiais e regimes diferenciados</strong>. O GISE possui um fluxo complexo de preenchimento descentralizado por seccionais, assinaturas separadas da escala e dos relatórios operacionais, e coleta ativa de metadados de presença dos agentes de campo (localização + foto).
					</p>
				</div>
			</div>
		{:else}
			{#if activeTab === 'fluxo'}
				<div class="space-y-8 animate-slide-up">
					<h3 class="text-xl font-bold text-surface-900 dark:text-surface-50">
						Simulador de Status GISE
					</h3>
					<p class="text-sm text-surface-600 dark:text-surface-300">
						Clique nos status na barra para acompanhar as transições, responsabilidades e o comportamento do sistema em cada fase:
					</p>

					<!-- Interactive status bar -->
					<div class="flex gap-2 overflow-x-auto pb-4 max-w-full">
						{#each statusFlow as step, i}
							<button
								type="button"
								class="btn flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-xl border transition-all whitespace-nowrap
								{selectedStatusIndex === i
									? 'preset-filled-secondary-500 text-white shadow-md'
									: 'preset-outlined-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800'}"
								onclick={() => (selectedStatusIndex = i)}
							>
								<span>{step.icon}</span>
								<span>{step.label}</span>
							</button>
						{/each}
					</div>

					<!-- Details Card -->
					<div class="card-glass p-6 sm:p-8 rounded-3xl border border-secondary-500/20 bg-secondary-500/5 dark:bg-secondary-500/10 space-y-4 shadow-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6 transition-all duration-300">
						<div class="space-y-3 max-w-xl">
							<span class="inline-block text-[0.62rem] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full {selectedStatus.badgeColor}">
								Status: {selectedStatus.status}
							</span>
							<h4 class="text-2xl font-black text-surface-900 dark:text-surface-50 tracking-tight">
								{selectedStatus.label}
							</h4>
							<p class="text-xs sm:text-sm text-surface-600 dark:text-surface-300 leading-relaxed">
								{selectedStatus.desc}
							</p>
						</div>

						<div class="border-t sm:border-t-0 sm:border-l border-surface-200 dark:border-white/10 pt-4 sm:pt-0 sm:pl-6 shrink-0 space-y-1">
							<span class="text-[0.62rem] font-black uppercase text-surface-400 dark:text-surface-500 tracking-wider">Ação / Responsável</span>
							<p class="text-sm font-bold text-surface-900 dark:text-surface-100">{selectedStatus.responsible}</p>
						</div>
					</div>
				</div>
			{:else if activeTab === 'presenca'}
				<div class="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-slide-up">
					<!-- Description -->
					<div class="lg:col-span-7 space-y-6 leading-relaxed">
						<h3 class="text-xl font-bold text-surface-900 dark:text-surface-50">
							Rigor no Registro de Frequência de Campo
						</h3>
						<p class="text-sm text-surface-600 dark:text-surface-300">
							Para atestar a execução dos plantões especiais e validar os relatórios do GISE, os policiais designados devem realizar o registro de entrada e saída.
						</p>

						<div class="space-y-4">
							<div class="flex items-start gap-4">
								<div class="w-8 h-8 rounded-lg bg-secondary-500/10 text-secondary-500 flex items-center justify-center font-bold text-sm shrink-0">
									📸
								</div>
								<div>
									<h4 class="text-sm font-bold text-surface-900 dark:text-surface-100">Selfie & Liveness Challenge</h4>
									<p class="text-xs text-surface-500 dark:text-surface-400">
										O check-in e check-out exigem uma foto selfie. Para impedir o uso de fotografias estáticas ou falsificações, o sistema executa um desafio de vida (Liveness) solicitando reações do usuário (ex: piscar, sorrir) perante a câmera do celular.
									</p>
								</div>
							</div>

							<div class="flex items-start gap-4">
								<div class="w-8 h-8 rounded-lg bg-primary-500/10 text-primary-500 flex items-center justify-center font-bold text-sm shrink-0">
									📍
								</div>
								<div>
									<h4 class="text-sm font-bold text-surface-900 dark:text-surface-100">Coleta Georreferenciada</h4>
									<p class="text-xs text-surface-500 dark:text-surface-400">
										O sistema verifica as coordenadas geográficas (GPS) do policial no exato momento da entrada e da saída, salvando de forma criptografada as informações que comprovam a presença do agente na área de atuação delegada.
									</p>
								</div>
							</div>

							<div class="flex items-start gap-4">
								<div class="w-8 h-8 rounded-lg bg-warning-500/10 text-warning-500 flex items-center justify-center font-bold text-sm shrink-0">
									✒️
								</div>
								<div>
									<h4 class="text-sm font-bold text-surface-900 dark:text-surface-100">Assinatura Manual e IP</h4>
									<p class="text-xs text-surface-500 dark:text-surface-400">
										Além da biometria facial, o policial confirma sua presença desenhando sua assinatura ou rubrica no quadro e o IP da rede é registrado para posterior auditoria.
									</p>
								</div>
							</div>
						</div>
					</div>

					<!-- Selfie visual demo -->
					<div class="lg:col-span-5 flex items-center justify-center">
						<div class="selfie-mockup w-full max-w-sm rounded-3xl border border-surface-200 dark:border-white/10 bg-white/40 dark:bg-surface-900/40 p-6 space-y-4 shadow-lg backdrop-blur-md">
							<div class="flex items-center justify-between border-b border-surface-100 dark:border-white/5 pb-2">
								<span class="text-xs font-black text-surface-400 dark:text-surface-500 uppercase tracking-widest">Verificação Biométrica</span>
								<span class="badge preset-filled-success-500 text-white text-[0.62rem] font-bold">LIVENESS</span>
							</div>

							<div class="relative rounded-2xl h-52 bg-surface-900 border border-surface-700 overflow-hidden flex items-center justify-center">
								<!-- Mock face scanner overlay -->
								<div class="absolute inset-0 border-[3px] border-secondary-500/30 rounded-2xl m-3 flex items-center justify-center">
									<div class="w-32 h-32 rounded-full border-2 border-dashed border-secondary-500 animate-spin" style="animation-duration: 20s"></div>
								</div>
								<div class="absolute top-4 left-4 right-4 bg-black/60 backdrop-blur-md rounded-xl p-2 text-center text-[0.7rem] text-white font-bold z-10 animate-pulse">
									😊 Sorria ou pisque para a câmera
								</div>
								<!-- SVG face sketch -->
								<svg class="w-20 h-20 text-surface-600 opacity-60" fill="currentColor" viewBox="0 0 24 24">
									<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15.5h-2v-2h2v2zm0-4.5h-2V7h2v6z" />
								</svg>
							</div>

							<div class="flex items-center gap-3 bg-surface-100/50 dark:bg-surface-950/40 p-3 rounded-xl">
								<span class="text-xl">📍</span>
								<div class="min-w-0">
									<p class="text-[0.65rem] font-black uppercase text-surface-400">Coordenadas obtidas</p>
									<p class="text-xs font-mono truncate text-surface-800 dark:text-surface-200">Lat: -3.71, Lng: -38.54 (Precisão: 10m)</p>
								</div>
							</div>
						</div>
					</div>
				</div>
			{:else if activeTab === 'relatorios'}
				<div class="space-y-6 animate-slide-up max-w-3xl leading-relaxed">
					<h3 class="text-xl font-bold text-surface-900 dark:text-surface-50">
						Relatórios Consolidados de Extraordinário e Atividades
					</h3>
					<p class="text-sm text-surface-600 dark:text-surface-300">
						O desfecho de toda escala GISE se dá na produção dos relatórios finais. O sistema automatiza o cruzamento de dados de presença com a produtividade relatada pelas equipes de campo para produzir os arquivos finais de pagamento de serviço extraordinário (Extras).
					</p>

					<div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
						<div class="card p-5 rounded-2xl bg-white/40 dark:bg-surface-900/40 border border-surface-200/60 dark:border-white/5 space-y-2 shadow-sm">
							<h4 class="text-sm font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
								📝 Relatório Extraordinário
							</h4>
							<p class="text-xs text-surface-500 dark:text-surface-400">
								Consolida as horas efetivamente trabalhadas por cada policial escalado para fins de validação do serviço especial e consequente encaminhamento de pagamento de diárias ou gratificações.
							</p>
						</div>

						<div class="card p-5 rounded-2xl bg-white/40 dark:bg-surface-900/40 border border-surface-200/60 dark:border-white/5 space-y-2 shadow-sm">
							<h4 class="text-sm font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
								📊 Produtividade Operacional
							</h4>
							<p class="text-xs text-surface-500 dark:text-surface-400">
								Tabula dados numéricos de ocorrências, prisões, apreensões de armas, drogas ou outros indicadores chave computados durante a operação, facilitando o feedback gerencial para a cúpula da segurança.
							</p>
						</div>
					</div>

					<p class="text-xs text-surface-500 dark:text-surface-400 bg-surface-100/50 dark:bg-surface-950/40 p-4 rounded-xl border border-surface-200 dark:border-white/5">
						⚠️ <strong>Atenção:</strong> Os relatórios de extra ficam travados no sistema até que os policiais escalados tenham concluído o fluxo de check-out. Isso impede que planilhas de pagamento contenham inconsistências com o serviço físico prestado na rua.
					</p>
				</div>
			{/if}
		{/if}
	</div>
</div>

<style>
	.hero-card {
		background: radial-gradient(circle at top left, var(--color-secondary-500) 0%, transparent 80%),
			linear-gradient(to bottom right, var(--color-surface-100) 0%, var(--color-surface-200) 100%);
	}
	:global(.dark) .hero-card {
		background: radial-gradient(circle at top left, rgba(168, 85, 247, 0.15) 0%, transparent 60%),
			linear-gradient(to bottom right, #0b0f19 0%, #151e2e 100%);
	}

	.tab-btn {
		padding: 0.75rem 1.25rem;
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--color-surface-500);
		border-bottom: 2px solid transparent;
		transition: all 0.2s ease;
		white-space: nowrap;
		cursor: pointer;
	}

	.tab-btn:hover {
		color: var(--color-secondary-500);
	}

	.tab-btn.active {
		color: var(--color-secondary-500);
		border-bottom-color: var(--color-secondary-500);
	}

	.animate-fade-in {
		animation: fadeIn 0.4s ease-out both;
	}

	.animate-slide-up {
		animation: slideUp 0.3s ease-out both;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes slideUp {
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
