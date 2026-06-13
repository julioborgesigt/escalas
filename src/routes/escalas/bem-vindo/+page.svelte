<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	let activeTab = $state('geral');
	let searchFilter = $state('');

	const features = [
		{
			id: 'criar',
			category: 'Gestão',
			title: 'Criação de Escalas',
			desc: 'Criação rápida de escalas de plantão, expediente ou finais de semana (FDS).',
			icon: `<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`,
			detail: 'Supervisores e administradores podem criar escalas mensais ou semanais completas. É possível definir o título da escala, cidade sede, unidade de lotação, datas de início/fim e horário de entrada/saída.'
		},
		{
			id: 'base',
			category: 'Produtividade',
			title: 'Criar com Base',
			desc: 'Aproveite escalas do mês anterior com rotação de dias calculada automaticamente.',
			icon: `<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>`,
			detail: 'Utilize a funcionalidade de "Criar com base" para clonar a estrutura e o contingente policial da escala do mês anterior. O sistema calcula a próxima data de plantão de cada policial com base na escala de origem, detectando e ajustando a rotação de forma automatizada.'
		},
		{
			id: 'policiais',
			category: 'Alocação',
			title: 'Gestão de Efetivos',
			desc: 'Adicione ou remova policiais e organize equipes com observações detalhadas.',
			icon: `<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>`,
			detail: 'Permite gerenciar quais policiais farão parte da escala de serviço. Você pode inserir policiais individualmente ou em lote para o regime de expediente, definir a equipe específica de atuação e adicionar notas ou observações operacionais particulares para cada plantonista.'
		},
		{
			id: 'assinatura',
			category: 'Segurança',
			title: 'Assinatura Digital Integrada',
			desc: 'Segurança jurídica por meio de assinatura digital na tela ou token ICP-Brasil.',
			icon: `<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>`,
			detail: 'Para dar validade oficial, a escala deve ser assinada. Delegados e administradores DPC assinam a escala através de desenho de rubrica em tela (com foto selfie/prova de vida e localização GPS), ou de forma padrão utilizando certificados digitais da ICP-Brasil via WebPKI ou SERPRO.'
		},
		{
			id: 'validar',
			category: 'Validação',
			title: 'Validação Pública via Hash',
			desc: 'Confirme a integridade e a autenticidade de qualquer escala impressa ou digital.',
			icon: `<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>`,
			detail: 'Toda escala assinada gera um código hash de validação criptográfica pública que fica visível no rodapé. Qualquer pessoa pode acessar a rota `/validar` e digitar esse hash para verificar as informações completas da assinatura, data de criação, geolocalização e baixar a via PDF oficial arquivada.'
		},
		{
			id: 'revogacao',
			category: 'Ajustes',
			title: 'Revogação de Assinatura',
			desc: 'Corrija erros desfazendo a assinatura de forma controlada e auditada.',
			icon: `<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 7.89M9 11l3 3L22 4" /></svg>`,
			detail: 'Se for necessário alterar uma escala que já foi oficialmente assinada, o sistema permite que o administrador revogue (remova) a assinatura. Esta ação apaga o documento assinado anterior, registra o evento na auditoria do sistema e libera a escala novamente para alterações.'
		}
	];

	const steps = [
		{
			num: '01',
			title: 'Criação',
			desc: 'O criador cria a escala de Plantão/Expediente de uma unidade para o próximo mês.'
		},
		{
			num: '02',
			title: 'Montagem',
			desc: 'São alocados os policiais plantonistas nos dias respectivos, ajustando-se as equipes.'
		},
		{
			num: '03',
			title: 'Solicitação',
			desc: 'O supervisor solicita a assinatura de um Administrador ou Delegado de Polícia DPC.'
		},
		{
			num: '04',
			title: 'Assinatura',
			desc: 'O DPC revisa o PDF e assina a escala via Rubrica em Tela ou Token de Assinatura.'
		},
		{
			num: '05',
			title: 'Validação',
			desc: 'A escala está concluída, travada para edições e apta para consulta e verificação pública.'
		}
	];

	const filteredFeatures = $derived(
		features.filter(
			(f) =>
				f.title.toLowerCase().includes(searchFilter.toLowerCase()) ||
				f.desc.toLowerCase().includes(searchFilter.toLowerCase()) ||
				f.category.toLowerCase().includes(searchFilter.toLowerCase())
		)
	);
</script>

<svelte:head>
	<title>Bem-vindo ao Módulo de Escalas - Portal de Escalas</title>
</svelte:head>

<div class="welcome-container space-y-8 animate-fade-in">
	<!-- Top Bar / Navigation Back -->
	<div class="flex items-center justify-between border-b border-surface-200/60 dark:border-white/5 pb-4">
		<div class="flex items-center gap-3">
			<button
				type="button"
				class="btn btn-sm preset-outlined-surface-500 hover:bg-surface-200/30 dark:hover:bg-surface-800/40 rounded-xl transition-all"
				onclick={() => goto('/escalas')}
			>
				← Voltar
			</button>
			<h1 class="text-xl sm:text-2xl font-bold tracking-tight text-surface-900 dark:text-surface-50">
				Módulo Escalas
			</h1>
		</div>
		<span class="badge preset-filled-primary-500/10 text-primary-700 dark:text-primary-400 font-bold uppercase tracking-wider text-xs px-2.5 py-1">
			Guia do Usuário
		</span>
	</div>

	<!-- Hero Banner -->
	<div class="hero-card relative overflow-hidden rounded-3xl p-6 sm:p-10 border border-primary-500/20 shadow-xl dark:shadow-black/30">
		<div class="absolute inset-0 bg-gradient-to-br from-primary-500/10 via-transparent to-warning-500/5 z-0"></div>
		<div class="relative z-10 max-w-2xl space-y-3">
			<h2 class="text-3xl sm:text-4xl font-black text-surface-900 dark:text-surface-50 tracking-tight leading-tight">
				Simplifique a Gestão de <span class="bg-clip-text text-transparent bg-gradient-to-r from-primary-600 via-primary-500 to-warning-500 dark:from-primary-400 dark:to-warning-400">Escalas Policiais</span>
			</h2>
			<p class="text-sm sm:text-base text-surface-600 dark:text-surface-300 leading-relaxed">
				Bem-vindo ao ambiente de gestão operacional do Portal de Escalas. Aqui você pode planejar, organizar e validar de forma transparente e segura o fluxo de plantão e expediente das delegacias de Polícia Civil.
			</p>
			<div class="pt-2 flex flex-wrap gap-3">
				<button
					type="button"
					class="btn preset-filled-primary-500 hover:brightness-110 px-4 py-2 text-sm font-bold rounded-xl transition-all shadow-lg shadow-primary-500/20 flex items-center gap-2"
					onclick={() => goto('/escalas')}
				>
					Acessar Minhas Escalas
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
			📖 Visão Geral
		</button>
		<button
			type="button"
			class="tab-btn {activeTab === 'features' ? 'active' : ''}"
			onclick={() => (activeTab = 'features')}
		>
			⚙️ Funcionalidades
		</button>
		<button
			type="button"
			class="tab-btn {activeTab === 'assinaturas' ? 'active' : ''}"
			onclick={() => (activeTab = 'assinaturas')}
		>
			✍️ Assinatura Digital
		</button>
		<button
			type="button"
			class="tab-btn {activeTab === 'validar' ? 'active' : ''}"
			onclick={() => (activeTab = 'validar')}
		>
			🛡️ Validação Pública
		</button>
	</div>

	<!-- Content Area -->
	<div class="tab-content-wrapper">
		{#if activeTab === 'geral'}
			<div class="space-y-8 animate-slide-up">
				<!-- Grid Overview Info -->
				<div class="grid grid-cols-1 md:grid-cols-3 gap-6">
					<div class="card p-6 rounded-2xl bg-white/40 dark:bg-surface-900/40 border border-surface-200/60 dark:border-white/5 space-y-3 shadow-sm hover:shadow-md transition-shadow">
						<div class="w-10 h-10 rounded-xl bg-primary-500/10 text-primary-600 dark:text-primary-400 flex items-center justify-center font-bold text-lg">
							📅
						</div>
						<h3 class="text-lg font-bold text-surface-900 dark:text-surface-50">Fluxo Mensal Planejado</h3>
						<p class="text-xs text-surface-500 dark:text-surface-400 leading-relaxed">
							Planeje com facilidade o contingente de plantão ordinário e de expediente para todo o mês, evitando conflitos de horários e furos nas delegacias operacionais.
						</p>
					</div>

					<div class="card p-6 rounded-2xl bg-white/40 dark:bg-surface-900/40 border border-surface-200/60 dark:border-white/5 space-y-3 shadow-sm hover:shadow-md transition-shadow">
						<div class="w-10 h-10 rounded-xl bg-warning-500/10 text-warning-600 dark:text-warning-400 flex items-center justify-center font-bold text-lg">
							⚡
						</div>
						<h3 class="text-lg font-bold text-surface-900 dark:text-surface-50">Criação Automatizada</h3>
						<p class="text-xs text-surface-500 dark:text-surface-400 leading-relaxed">
							Use dados de escalas pretéritas para recalcular o próximo mês e aplicar as regras de rotação de plantão sem necessidade de redigitar manualmente todo o efetivo.
						</p>
					</div>

					<div class="card p-6 rounded-2xl bg-white/40 dark:bg-surface-900/40 border border-surface-200/60 dark:border-white/5 space-y-3 shadow-sm hover:shadow-md transition-shadow">
						<div class="w-10 h-10 rounded-xl bg-secondary-500/10 text-secondary-600 dark:text-secondary-400 flex items-center justify-center font-bold text-lg">
							🔒
						</div>
						<h3 class="text-lg font-bold text-surface-900 dark:text-surface-50">Validade Criptográfica</h3>
						<p class="text-xs text-surface-500 dark:text-surface-400 leading-relaxed">
							Toda escala assinada gera metadados e assinaturas criptográficas de acordo com as normas da ICP-Brasil, oferecendo auditoria total e transparência jurídica.
						</p>
					</div>
				</div>

				<!-- Step-by-Step Flow Chart -->
				<div class="card p-6 sm:p-8 rounded-3xl bg-white/40 dark:bg-surface-900/40 border border-surface-200/60 dark:border-white/5 space-y-6 shadow-sm">
					<h3 class="text-xl font-bold text-surface-900 dark:text-surface-50 text-center">
						Linha de Vida de uma Escala
					</h3>
					<div class="grid grid-cols-1 sm:grid-cols-5 gap-4 relative">
						{#each steps as step}
							<div class="flex flex-col items-center text-center space-y-2 group relative z-10">
								<div class="w-12 h-12 rounded-2xl bg-surface-100 dark:bg-surface-800 border border-surface-300 dark:border-surface-700 flex items-center justify-center font-black text-sm text-surface-600 dark:text-surface-300 group-hover:border-primary-500 group-hover:text-primary-500 transition-all duration-300">
									{step.num}
								</div>
								<h4 class="font-bold text-sm text-surface-900 dark:text-surface-100">{step.title}</h4>
								<p class="text-[0.7rem] text-surface-500 dark:text-surface-400 max-w-[150px] leading-normal">{step.desc}</p>
							</div>
						{/each}
						<!-- Horizontal line behind steps (desktop only) -->
						<div class="hidden sm:block absolute top-6 left-8 right-8 h-px bg-surface-300 dark:bg-surface-700 z-0"></div>
					</div>
				</div>
			</div>
		{:else}
			{#if activeTab === 'features'}
				<div class="space-y-6 animate-slide-up">
					<!-- Search Bar -->
					<div class="max-w-md">
						<input
							type="text"
							placeholder="Filtrar por funcionalidade ou termo..."
							class="input px-4 py-2.5 rounded-xl border border-surface-300 dark:border-surface-700 w-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
							bind:value={searchFilter}
						/>
					</div>

					<!-- Grid Features -->
					<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
						{#each filteredFeatures as feature}
							<div class="card p-6 rounded-2xl bg-white/50 dark:bg-surface-900/50 border border-surface-200/60 dark:border-white/5 space-y-4 hover:-translate-y-1 hover:border-primary-500/40 transition-all duration-300 shadow-sm hover:shadow-md flex flex-col justify-between group">
								<div class="space-y-3">
									<div class="flex items-center justify-between">
										<span class="text-[0.62rem] font-bold uppercase tracking-wider text-primary-600 dark:text-primary-400 bg-primary-500/10 px-2 py-0.5 rounded-full">
											{feature.category}
										</span>
										<div class="text-surface-400 group-hover:text-primary-500 transition-colors">
											{@html feature.icon}
										</div>
									</div>
									<h3 class="text-lg font-bold text-surface-900 dark:text-surface-50 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
										{feature.title}
									</h3>
									<p class="text-xs text-surface-600 dark:text-surface-300 font-semibold">
										{feature.desc}
									</p>
									<p class="text-[0.75rem] text-surface-500 dark:text-surface-400 leading-relaxed">
										{feature.detail}
									</p>
								</div>
							</div>
						{/each}
						{#if filteredFeatures.length === 0}
							<div class="col-span-full text-center py-12 text-surface-500">
								<p>Nenhuma funcionalidade encontrada para "{searchFilter}".</p>
							</div>
						{/if}
					</div>
				</div>
			{:else if activeTab === 'assinaturas'}
				<div class="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-slide-up">
					<!-- Explanation Text -->
					<div class="lg:col-span-7 space-y-6 leading-relaxed">
						<h3 class="text-xl font-bold text-surface-900 dark:text-surface-50">
							Segurança e Legalidade nos Fluxos Administrativos
						</h3>
						<p class="text-sm text-surface-600 dark:text-surface-300">
							O Portal de Escalas incorpora as diretrizes de segurança da ICP-Brasil. Isso significa que as escalas oficiais geradas possuem validade e eficácia idênticas às publicações impressas tradicionais.
						</p>

						<div class="space-y-4">
							<div class="flex items-start gap-4">
								<div class="w-8 h-8 rounded-lg bg-primary-500/10 text-primary-500 flex items-center justify-center font-bold text-sm shrink-0">
									✍️
								</div>
								<div>
									<h4 class="text-sm font-bold text-surface-900 dark:text-surface-100">Assinatura em Tela (Dispositivos Móveis)</h4>
									<p class="text-xs text-surface-500 dark:text-surface-400">
										Projetada para fácil utilização em smartphones ou tablets. O delegado desenha sua rubrica na tela do celular. Para segurança jurídica, o sistema realiza prova de presença ativa (Liveness Challenge / captura de selfie) e armazena os dados exatos de localização GPS e IP.
									</p>
								</div>
							</div>

							<div class="flex items-start gap-4">
								<div class="w-8 h-8 rounded-lg bg-warning-500/10 text-warning-500 flex items-center justify-center font-bold text-sm shrink-0">
									🔑
								</div>
								<div>
									<h4 class="text-sm font-bold text-surface-900 dark:text-surface-100">Assinatura por Token (ICP-Brasil)</h4>
									<p class="text-xs text-surface-500 dark:text-surface-400">
										Permite a utilização de certificados digitais do tipo A3 (tokens USB ou smartcards) ou A1. A autenticação é feita de forma nativa por meio da integração com o Assinador SERPRO ou a extensão WebPKI instalada no navegador.
									</p>
								</div>
							</div>

							<div class="flex items-start gap-4">
								<div class="w-8 h-8 rounded-lg bg-secondary-500/10 text-secondary-500 flex items-center justify-center font-bold text-sm shrink-0">
									✉️
								</div>
								<div>
									<h4 class="text-sm font-bold text-surface-900 dark:text-surface-100">Confirmação via E-mail Funcional</h4>
									<p class="text-xs text-surface-500 dark:text-surface-400">
										Em certas configurações de segurança, a assinatura em tela é blindada por um código de verificação enviado diretamente ao e-mail institucional cadastrado do policial, constituindo um fator duplo de autenticação (2FA).
									</p>
								</div>
							</div>
						</div>
					</div>

					<!-- Visual Mockup (Assinatura Box) -->
					<div class="lg:col-span-5 flex items-center justify-center">
						<div class="signature-mockup w-full max-w-sm rounded-3xl border border-surface-200 dark:border-white/10 bg-white/40 dark:bg-surface-900/40 p-6 space-y-4 shadow-lg backdrop-blur-md">
							<div class="flex items-center justify-between border-b border-surface-100 dark:border-white/5 pb-2">
								<span class="text-xs font-black text-surface-400 dark:text-surface-500 uppercase tracking-widest">Painel de Assinatura</span>
								<span class="w-2.5 h-2.5 rounded-full bg-warning-500 animate-pulse"></span>
							</div>
							<div class="border border-dashed border-surface-300 dark:border-surface-700 rounded-xl h-40 bg-surface-50 dark:bg-surface-950 flex items-center justify-center text-center relative overflow-hidden group">
								<span class="text-xs text-surface-400 dark:text-surface-600 select-none group-hover:hidden">Desenhe sua rubrica neste espaço</span>
								<!-- Mock signature path SVG -->
								<svg class="absolute inset-0 w-full h-full text-primary-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 100 100">
									<path d="M 10 50 Q 35 20 50 50 T 90 50" stroke-linecap="round" />
									<path d="M 25 35 L 75 65" stroke-linecap="round" />
								</svg>
							</div>
							<div class="flex gap-2">
								<button type="button" class="btn btn-sm preset-outlined-surface-500 flex-1 py-2 rounded-xl text-xs">Limpar</button>
								<button type="button" class="btn btn-sm preset-filled-primary-500 flex-1 py-2 rounded-xl text-xs font-bold text-white">Assinar Escala</button>
							</div>
						</div>
					</div>
				</div>
			{:else if activeTab === 'validar'}
				<div class="space-y-6 animate-slide-up max-w-3xl">
					<h3 class="text-xl font-bold text-surface-900 dark:text-surface-50">
						Como Funciona a Validação Pública de Documentos?
					</h3>
					<p class="text-sm text-surface-600 dark:text-surface-300 leading-relaxed">
						Uma das maiores preocupações de órgãos fiscalizadores e integrantes do Judiciário é a autenticidade das escalas oficiais geradas no ambiente virtual. Para garantir isso, o sistema atribui um ID de hash criptográfico e gera uma página pública de consulta.
					</p>

					<div class="card-glass p-6 rounded-2xl space-y-4 border border-surface-200/60 dark:border-white/5 bg-surface-100/10 dark:bg-surface-800/10">
						<h4 class="text-sm font-bold text-surface-900 dark:text-surface-50 flex items-center gap-2">
							<span class="text-base">📍</span> Passo a Passo de Validação
						</h4>
						<ol class="list-decimal list-inside space-y-2 text-xs text-surface-600 dark:text-surface-400">
							<li>No rodapé de qualquer PDF exportado do Portal de Escalas, localize o código hash alfanumérico.</li>
							<li>Copie esse hash ou use o QR Code impresso no documento.</li>
							<li>Acesse a página pública em <code class="bg-surface-200 dark:bg-surface-800 px-1 py-0.5 rounded text-[0.7rem] font-mono">/validar</code>.</li>
							<li>Cole o hash na caixa de busca pública do portal.</li>
							<li>O sistema exibe na tela o nome do delegante assinante, o CPF parcial, data/hora da assinatura e permite o download do PDF original idêntico ao armazenado, inviabilizando qualquer tipo de falsificação ou fraude física.</li>
						</ol>
					</div>

					<div class="flex justify-start">
						<button
							type="button"
							class="btn btn-sm preset-outlined-primary-500 hover:preset-filled-primary-500 hover:text-white px-4 py-2 rounded-xl text-xs font-bold transition-all"
							onclick={() => goto('/validar')}
						>
							Ir para a Tela de Validação Pública →
						</button>
					</div>
				</div>
			{/if}
		{/if}
	</div>
</div>

<style>
	.hero-card {
		background: radial-gradient(circle at top left, var(--color-primary-500) 0%, transparent 80%),
			linear-gradient(to bottom right, var(--color-surface-100) 0%, var(--color-surface-200) 100%);
	}
	:global(.dark) .hero-card {
		background: radial-gradient(circle at top left, rgba(16, 185, 129, 0.15) 0%, transparent 60%),
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
		color: var(--color-primary-500);
	}

	.tab-btn.active {
		color: var(--color-primary-500);
		border-bottom-color: var(--color-primary-500);
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
