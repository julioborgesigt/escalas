<script lang="ts">
	/**
	 * Casca de toda página autenticada: sidebar, tema, overlay de carregamento e
	 * as duas alternâncias de identidade. Nada aqui é gate de segurança — a
	 * sidebar apenas ESCONDE o que o usuário não usa; quem barra é o `load` de
	 * cada rota. Somar um item ao menu não dá acesso a nada, e removê-lo não
	 * protege nada.
	 *
	 * A visibilidade dos itens cruza dois eixos que não se implicam:
	 *   - QUEM é (`tipo`/`papel` + os flags de participação na GISE, que vêm do
	 *     `+layout.server.ts` porque dependem do banco);
	 *   - QUAL MÓDULO o admin escolheu (`adminModulo`: ambas/gise/escalas), que
	 *     é preferência de tela, não permissão.
	 * Daí `showGrupo1`/`showGrupo2` responderem `true` para não-admin: o filtro
	 * de módulo só existe para admin.
	 *
	 * `ROTAS_SEM_SIDEBAR` são os PORTÕES — login, troca de senha obrigatória e
	 * aceite do termo. `/aceitar-termo` é autenticado e por isso precisa estar
	 * listado à mão, senão a sidebar aparece atrás do card de aceite.
	 *
	 * Duas armadilhas de navegação já resolvidas aqui, ambas invisíveis em teste
	 * unitário: o `tick()` antes de `startViewTransition` (sem ele a barra de
	 * progresso é fotografada ainda em `opacity:0` e nunca aparece) e o
	 * `afterNavigate(() => loading.hide())`, que solta o overlay quando um
	 * `loading.show()` anterior a um `goto` ficaria preso pedindo refresh.
	 */
	import type { LayoutProps } from './$types';
	import '../app.css';
	// Preload das duas fontes críticas acima da dobra (corpo + títulos): sem
	// isto o browser só descobre os woff2 após baixar e parsear o CSS, e o
	// texto pisca no swap. O ?url resolve para o MESMO asset hasheado que o
	// @font-face do app.css referencia — um download só. Demais pesos seguem
	// sob demanda via @fontsource.
	import inter400Url from '@fontsource/inter/files/inter-latin-400-normal.woff2?url';
	import outfit700Url from '@fontsource/outfit/files/outfit-latin-700-normal.woff2?url';
	import { tick } from 'svelte';
	import { page, navigating, updated } from '$app/state';
	import { goto, onNavigate, afterNavigate, beforeNavigate } from '$app/navigation';
	import { Toast, Dialog } from '@skeletonlabs/skeleton-svelte';
	import { toaster } from '$lib/toast';
	import { apiFetch } from '$lib/api-fetch';
	import { loading } from '$lib/loading.svelte';
	import LoadingOverlay from '$lib/components/LoadingOverlay.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import AvisoCadastroRubrica from '$lib/components/AvisoCadastroRubrica.svelte';
	import { useScrollLock, useInvalidateOnFocus } from '$lib/composables';
	import { fetchSyncEstado } from '$lib/sync-estado';
	import { ICONE } from '$lib/constants/icones';
	import { AlertCircle, CheckCircle2 } from '@lucide/svelte';

	const { children }: LayoutProps = $props();

	const usuario = $derived(page.data.usuario);
	const isSupervisorGise = $derived(page.data.isSupervisorGise ?? false);
	const adminModulo = $derived((page.data.adminModulo as 'ambas' | 'gise' | 'escalas') ?? 'ambas');
	const recebidosNaoVistos = $derived(Number(page.data.recebidosNaoVistos ?? 0));

	// Badge da Cx. de Entrada: poll frio em qualquer rota (admin). A inbox tem
	// poll próprio quente/frio; as duas chaves ficam alinhadas via `also`.
	useInvalidateOnFocus('app:recebidos-badge', {
		isHot: () => false,
		probe: async () => {
			if (usuario?.tipo !== 'admin') return null;
			try {
				const e = await fetchSyncEstado();
				return e.recebidos?.stamp ?? null;
			} catch {
				return null;
			}
		}
	});

	// Alternância de acesso ADM Geral ↔ Usuário (mesma pessoa vinculada).
	const podeAlternarParaUsuario = $derived(page.data.podeAlternarParaUsuario ?? false);
	const podeAlternarParaAdmin = $derived(page.data.podeAlternarParaAdmin ?? false);

	// Admin Geral = sessão de admin (tipo 'admin'): bootstrap por env OU policial
	// promovido (linha vinculada em `administradores`, logado como Administrador).
	const isAdmGeral = $derived(usuario?.tipo === 'admin');

	// Mostra aba Escalas para: admin_seccional, admin_unidade (admin geral não tem mais acesso à aba Arquivo)
	const showEscalasPoliciais = $derived(
		usuario?.papel === 'admin_seccional' || usuario?.papel === 'admin_unidade'
	);

	// Mostra aba GISE para: admin, admin_seccional ou supervisor ativo
	// (admin_unidade só vê se também for supervisor, coberto por isSupervisorGise)
	const showGise = $derived(
		usuario?.tipo === 'admin' || usuario?.papel === 'admin_seccional' || isSupervisorGise
	);

	// Presença GISE: só com escala GISE ativa E confirmação de entrada/saída
	// ainda pendente. Só "estar escalado" não basta — quem já bateu a saída
	// cai no Histórico. O Admin Geral não presta serviço: para ele o item
	// /res-gise é o editor "Conf. Form.", tratado à parte no bloco do menu.
	const temPresencaGiseAtiva = $derived(page.data.temPresencaGisePendente ?? false);
	// Histórico GISE: ao menos uma participação já encerrada para o policial (vem
	// do servidor junto do papel). Independe de haver serviço ativo, e é o que
	// mantém a aba acessível depois que todas as GISEs do policial finalizaram.
	const temGiseHistorico = $derived(page.data.temGiseHistorico ?? false);

	// For admins: control menu group visibility based on chosen module
	const showGrupo1 = $derived(
		usuario?.tipo !== 'admin' || adminModulo === 'ambas' || adminModulo === 'escalas'
	);
	const showGrupo2 = $derived(
		usuario?.tipo !== 'admin' || adminModulo === 'ambas' || adminModulo === 'gise'
	);
	const showGrupo2Separator = $derived(usuario?.tipo === 'admin' && showGrupo1 && showGrupo2);

	// Telas de "portão" (pré-entrada no sistema) são exibidas isoladas, sem a
	// navegação lateral: login, troca de senha obrigatória e aceite do termo.
	// O /aceitar-termo é autenticado (tem `usuario`), então precisa ser listado
	// aqui explicitamente — senão a sidebar apareceria atrás do card de aceite.
	const ROTAS_SEM_SIDEBAR = ['/login', '/alterar-senha', '/aceitar-termo'];
	const showSidebar = $derived(!ROTAS_SEM_SIDEBAR.includes(page.url.pathname));

	// A navegação lateral é uma GAVETA (overlay) OCULTA POR PADRÃO em todas as
	// larguras — inclusive no desktop. Abre pelo botão de menu do topo e fecha ao
	// navegar, clicar fora ou apertar Esc. `sidebarOpen` é a fonte única do estado;
	// não há mais o modo "sempre aberta" que o desktop tinha.
	let sidebarOpen = $state(false);
	let isDark = $state(
		typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : true
	);
	let showLogoutConfirm = $state(false);
	let isLoggingOut = $state(false);
	let restoreMenuFocusAfterNavigation = false;

	// Enquanto aberta, a gaveta é modal: trava o scroll do fundo e torna o
	// conteúdo inerte. Fechada, a própria gaveta fica inerte (fora da tela).
	const sidebarIsModal = $derived(sidebarOpen);
	const sidebarIsInert = $derived(!sidebarOpen);

	useScrollLock(() => sidebarIsModal);

	function closeOnEscape(event: KeyboardEvent) {
		if (event.key === 'Escape' && sidebarIsModal) {
			event.preventDefault();
			void closeSidebar();
		}
	}

	async function openSidebar() {
		// Evita aria-hidden na topbar/main com o botão de menu ainda focado.
		const focused = document.activeElement;
		if (focused instanceof HTMLElement) focused.blur();

		sidebarOpen = true;
		await tick();
		document.getElementById('navegacao-principal')?.focus();
	}

	async function closeSidebar({
		restoreFocus = true,
		afterNavigation = false
	}: { restoreFocus?: boolean; afterNavigation?: boolean } = {}) {
		if (!sidebarOpen) return;

		// Chrome: "Blocked aria-hidden on an element because its descendant
		// retained focus." O clique no item deixa o <a> focado; fechar a gaveta
		// aplica aria-hidden/inert com esse foco ainda dentro. Blur antes.
		const focused = document.activeElement;
		const drawer = document.getElementById('navegacao-principal')?.closest('aside');
		if (focused instanceof HTMLElement && drawer?.contains(focused)) {
			focused.blur();
		}

		sidebarOpen = false;

		if (!restoreFocus) return;
		if (afterNavigation) {
			restoreMenuFocusAfterNavigation = true;
			return;
		}

		await tick();
		document.getElementById('botao-menu-mobile')?.focus();
	}

	function toggleSidebar() {
		return sidebarOpen ? closeSidebar() : openSidebar();
	}

	function handleSidebarNavigation() {
		return closeSidebar({ afterNavigation: true });
	}

	function toggleTheme() {
		isDark = !isDark;
		if (isDark) {
			document.documentElement.classList.add('dark');
			localStorage.setItem('color-theme', 'dark');
		} else {
			document.documentElement.classList.remove('dark');
			localStorage.setItem('color-theme', 'light');
		}
	}

	async function logout() {
		isLoggingOut = true;
		try {
			await apiFetch('/api/auth/logout', { method: 'POST' });
		} catch {
			/* ignora erros de rede — o redirecionamento ocorre de qualquer forma */
		}

		// Limpa filtros salvos no localStorage ao deslogar
		if (typeof localStorage !== 'undefined') {
			const keysToRemove = [];
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i);
				if (key?.startsWith('filtros_')) {
					keysToRemove.push(key);
				}
			}
			keysToRemove.forEach((k) => localStorage.removeItem(k));
		}

		try {
			// invalidateAll separado causava duas navegações conflitantes (AbortError na view transition).
			// goto com invalidateAll:true faz tudo numa única navegação.
			await goto('/login', { invalidateAll: true });
		} finally {
			// O layout raiz persiste entre navegações — resetar aqui garante que o
			// modal de logout não reapareça ao fazer login novamente.
			showLogoutConfirm = false;
			isLoggingOut = false;
		}
	}

	let switchingModule = $state(false);

	async function alternarModulo() {
		if (switchingModule) return;
		switchingModule = true;
		loading.show('Alternando módulo...');
		try {
			const result = await apiFetch<{ redirect?: string }>('/api/auth/alternar-modulo', {
				method: 'POST'
			});
			if (result.redirect) {
				await goto(result.redirect, { invalidateAll: true });
			}
		} catch (e: unknown) {
			toaster.create({
				title: e instanceof Error ? e.message : 'Erro ao alternar módulo',
				type: 'error'
			});
		} finally {
			switchingModule = false;
			loading.hide();
		}
	}

	let switchingAcesso = $state(false);

	async function alternarAcesso() {
		if (switchingAcesso) return;
		switchingAcesso = true;
		loading.show('Alternando acesso...');
		try {
			const result = await apiFetch<{ redirect?: string }>('/api/auth/alternar-acesso', {
				method: 'POST'
			});
			await goto(result.redirect || '/', { invalidateAll: true });
		} catch (e: unknown) {
			toaster.create({
				title: e instanceof Error ? e.message : 'Erro ao alternar acesso',
				type: 'error'
			});
		} finally {
			switchingAcesso = false;
			loading.hide();
		}
	}

	function isActive(path: string): boolean {
		return page.url.pathname === path || page.url.pathname.startsWith(path + '/');
	}

	const rotaPath = $derived(page.url.pathname);
	/** Rota GISE: lista/escala, excl. `/gise/config` (entrada separada "Config. GISE"). */
	const giseListaOuEscalaPath = $derived(
		rotaPath === '/gise' ||
			(rotaPath.startsWith('/gise/') &&
				!rotaPath.startsWith('/gise/config') &&
				!rotaPath.startsWith('/gise/bem-vindo'))
	);
	const giseConfigPathAtivo = $derived(rotaPath.startsWith('/gise/config'));

	// As duas abas de /res-gise dividem a MESMA rota por query string: sem
	// `?status=finalizadas` é a "Presença GISE" (ativas), com ele é o "Histórico
	// GISE". O realce do menu segue essa distinção — por isso o `ativo` vai
	// explícito aos dois itens (o `isActive` padrão, só por pathname, acenderia
	// os dois ao mesmo tempo). Inclui `/res-gise/relatorio/[giseId]`, cujo link
	// carrega o mesmo `status` de ida e volta.
	const naRotaResGise = $derived(rotaPath === '/res-gise' || rotaPath.startsWith('/res-gise/'));
	const resGiseHistoricoSelecionado = $derived(
		page.url.searchParams.get('status') === 'finalizadas'
	);
	const resGisePresencaAtivo = $derived(naRotaResGise && !resGiseHistoricoSelecionado);
	const resGiseHistoricoAtivo = $derived(naRotaResGise && resGiseHistoricoSelecionado);

	onNavigate((navigation) => {
		if (sidebarOpen) {
			void closeSidebar({ afterNavigation: true });
		}
		if (!document.startViewTransition) return;
		// await tick() flushes Svelte's pending DOM updates (e.g. nav-progress-visible)
		// BEFORE startViewTransition captures the old-state screenshot. Without this,
		// the progress bar is still opacity:0 in the snapshot and never appears.
		// Aguarda tick() ANTES de iniciar a transição; evita o async-executor
		// (new Promise(async …)), que engoliria eventuais rejeições.
		return tick().then(
			() =>
				new Promise<void>((resolve) => {
					document.startViewTransition(async () => {
						resolve();
						await navigation.complete;
					});
				})
		);
	});

	// Fecha o overlay global de carregamento quando QUALQUER navegação termina.
	// Sem isto, `loading.show()` chamado antes de um goto() (ex.: /validar) ficava
	// preso, exigindo refresh para ver o resultado já renderizado por baixo.
	afterNavigate(() => {
		loading.hide();
		if (restoreMenuFocusAfterNavigation) {
			restoreMenuFocusAfterNavigation = false;
			void tick().then(() => document.getElementById('botao-menu-mobile')?.focus());
		}
	});

	// Deploy novo detectado: força reload na próxima navegação (bundle fresco).
	beforeNavigate(({ willUnload, to }) => {
		if (updated.current && !willUnload && to?.url) {
			location.href = to.url.href;
		}
	});
</script>

<svelte:window onkeydown={closeOnEscape} />

<svelte:head>
	<!-- crossorigin é obrigatório em preload de fonte (fetch em modo CORS
	     mesmo same-origin); sem ele o browser baixa o arquivo duas vezes. -->
	<link rel="preload" href={inter400Url} as="font" type="font/woff2" crossorigin="anonymous" />
	<link rel="preload" href={outfit700Url} as="font" type="font/woff2" crossorigin="anonymous" />
	<title>Escalas de Plantão Policial</title>
	<meta
		name="description"
		content="Portal de Gestão de Escalas e Relatórios GISE - Polícia Civil."
	/>
	<meta property="og:title" content="Escalas PC-CE" />
	<meta
		property="og:description"
		content="Acompanhe escalas de plantão e documente relatórios de inteligência na plataforma unificada da Polícia Civil."
	/>
	<meta property="og:type" content="website" />
</svelte:head>

<!-- Navigation progress bar — always in DOM so view-transition captures it at full opacity -->
<div
	class="nav-progress-wrap"
	class:nav-progress-visible={navigating?.to &&
		!ROTAS_SEM_SIDEBAR.includes(navigating.to.url.pathname)}
	aria-hidden="true"
>
	<div class="nav-progress-bar"></div>
</div>

{#if updated.current && showSidebar}
	<div
		class="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-3 bg-warning-500 px-4 py-2 text-sm font-semibold text-surface-950 shadow-md"
		role="status"
	>
		<span>Nova versão do sistema disponível.</span>
		<button
			type="button"
			class="rounded-lg bg-surface-950/15 px-3 py-1 text-xs font-bold uppercase tracking-wide hover:bg-surface-950/25"
			onclick={() => location.reload()}
		>
			Atualizar agora
		</button>
	</div>
{/if}

<!-- Global Loading Overlay — only for API operations (signing, saving). Page navigation uses the top progress bar + inline skeletons. -->
<!-- offsetSidebar=false: a gaveta é overlay (não reserva espaço), então o overlay
     de carregamento centraliza na viewport inteira. -->
<LoadingOverlay active={loading.active} message={loading.message} offsetSidebar={false} />

<!-- Aviso pós-login: policial com assinatura pendente e sem rubrica cadastrada -->
{#if page.data.precisaCadastrarRubrica}
	<AvisoCadastroRubrica />
{/if}

<!-- Global Toast Provider -->
<!-- Posição/empilhamento vêm dos estilos inline do Zag (placement 'bottom-end' no
     toast.ts); classes de posição aqui entrariam em conflito e desalinhariam. -->
<Toast.Group {toaster}>
	{#snippet children(toast)}
		<Toast
			{toast}
			class="bg-surface-900 dark:bg-surface-100 text-surface-50 dark:text-surface-900 px-6 py-4 rounded-xl shadow-2xl pointer-events-auto border border-surface-700 dark:border-surface-300 w-[calc(100vw-2rem)] sm:w-auto sm:min-w-[320px] sm:max-w-md"
		>
			<div class="flex items-center gap-3">
				{#if toast.type === 'success'}
					<CheckCircle2 class="w-6 h-6 text-success-500" aria-hidden="true" />
				{:else if toast.type === 'error'}
					<AlertCircle class="w-6 h-6 text-error-500" aria-hidden="true" />
				{/if}
				<div class="flex-1">
					<Toast.Title class="font-bold text-base">{toast.title}</Toast.Title>
					{#if toast.description}
						<Toast.Description class="text-sm opacity-75">{toast.description}</Toast.Description>
					{/if}
				</div>
				<Toast.CloseTrigger
					class="btn-icon btn-sm opacity-50 hover:opacity-100 transition-opacity"
					aria-label="Fechar notificação"
				>
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						/></svg
					>
				</Toast.CloseTrigger>
			</div>
		</Toast>
	{/snippet}
</Toast.Group>

<a
	href="#conteudo-principal"
	class="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[10001] focus:rounded-lg focus:bg-primary-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:shadow-lg"
	inert={sidebarIsModal}
>
	Pular para o conteúdo
</a>

{#if showSidebar && usuario}
	<!-- Barra do topo (todas as larguras): menu + marca + alternar modo (direita).
	     É o que abre a gaveta de navegação, que agora fica oculta por padrão também no desktop. -->
	<div
		class="fixed top-0 left-0 right-0 z-40 h-14 bg-white/90 dark:bg-surface-950/90 backdrop-blur-lg border-b border-surface-200 dark:border-white/10 flex items-center px-4"
		inert={sidebarIsModal}
	>
		<button
			type="button"
			class="p-2 -ml-2 text-surface-600 dark:text-surface-300 hover:text-primary-500 transition-colors"
			onclick={toggleSidebar}
			aria-label="Menu"
			aria-expanded={sidebarOpen}
			aria-controls="navegacao-principal"
			id="botao-menu-mobile"
		>
			<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M4 6h16M4 12h16M4 18h16"
				/>
			</svg>
		</button>
		<div class="ml-3 flex items-center gap-2">
			<span
				class="font-heading font-bold text-lg text-surface-900 dark:text-surface-50 tracking-tight"
				>DPI SUL</span
			>
		</div>
		{#if podeAlternarParaUsuario || podeAlternarParaAdmin}
			<button
				type="button"
				class="ml-auto shrink-0 truncate max-w-[11rem] sm:max-w-none rounded-lg border border-primary-500/40 bg-primary-500/5 px-2.5 sm:px-3 py-1.5 text-2xs sm:text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-500/15 disabled:opacity-50 dark:text-primary-300"
				onclick={alternarAcesso}
				title={podeAlternarParaUsuario
					? 'Entrar como usuário (mesma conta)'
					: 'Assumir acesso de Administrador Geral (mesma conta)'}
				disabled={switchingAcesso}
			>
				{podeAlternarParaUsuario ? 'Ir p/ modo usuário' : 'Ir p/ modo admin'}
			</button>
		{/if}
	</div>

	<!-- Backdrop da gaveta (todas as larguras): clicar fora fecha. -->
	{#if sidebarOpen}
		<button
			type="button"
			class="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
			onclick={() => void closeSidebar()}
			aria-label="Fechar menu"
		></button>
	{/if}

	<!-- Sidebar -->
	<aside
		class="
			fixed top-0 left-0 z-50 h-full
			bg-surface-50/95 dark:bg-surface-950/95 backdrop-blur-xl
			border-r border-surface-200 dark:border-white/10
			shadow-xl shadow-black/5 dark:shadow-black/30
			flex flex-col
			transition-transform duration-300 ease-in-out
			{sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
		"
		style="width: var(--sidebar-width, 240px);"
		inert={sidebarIsInert}
		aria-hidden={sidebarIsInert}
	>
		<!-- Logo -->
		<div
			class="h-16 flex items-center px-5 border-b border-surface-200 dark:border-white/5 shrink-0"
		>
			<div class="flex items-center gap-2 group">
				<span
					class="font-heading font-bold text-xl text-surface-900 dark:text-surface-50 tracking-tight"
					>DPI SUL</span
				>
			</div>
			<!-- Botão de fechar a gaveta -->
			<button
				type="button"
				class="ml-auto p-1 text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 transition-colors"
				onclick={() => void closeSidebar()}
				aria-label="Fechar menu"
			>
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M6 18L18 6M6 6l12 12"
					/></svg
				>
			</button>
		</div>

		<!-- Navigation -->
		<nav id="navegacao-principal" class="flex-1 px-3 py-4 space-y-1 overflow-y-auto" tabindex="-1">
			{#snippet itemMenu(
				href: string,
				rotulo: string,
				paths: string[],
				ativo?: boolean,
				badge?: number
			)}
				<a
					{href}
					data-sveltekit-preload-data="hover"
					class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all no-underline
						{(ativo ?? isActive(href))
						? 'bg-primary-500/15 text-primary-700 dark:text-primary-400 border border-primary-500/20'
						: 'text-surface-600 dark:text-surface-300 hover:bg-surface-200/50 dark:hover:bg-surface-800/50 border border-transparent'}"
					onclick={handleSidebarNavigation}
				>
					<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						{#each paths as d (d)}
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" {d} />
						{/each}
					</svg>
					<span class="truncate flex-1 text-left">{rotulo}</span>
					{#if badge && badge > 0}
						<span
							class="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-primary-500 text-white text-3xs font-bold tabular-nums flex items-center justify-center"
							aria-label={`${badge} não lidos`}
						>
							{badge > 99 ? '99+' : badge}
						</span>
					{/if}
				</a>
			{/snippet}

			{#if usuario?.isSuperAdmin}
				<!-- Super Admin: menu exclusivo — apenas estas 6 abas, nesta ordem. -->
				{@render itemMenu('/super-admin', 'Boas-vindas', ICONE.casa)}
				{@render itemMenu('/unidades', 'Unidades', ICONE.predio)}
				{@render itemMenu('/policiais', 'Policiais', ICONE.pessoas)}
				{@render itemMenu('/conf-ass', 'Config. Ass.', ICONE.engrenagem)}
				{@render itemMenu('/config-geral', 'Config. Geral', ICONE.sliders)}
				{@render itemMenu('/auditoria', 'Auditoria', ICONE.documento)}
			{:else}
				{#if usuario?.tipo === 'policial' && !usuario.papel}
					{@render itemMenu('/bem-vindo', 'Boas-vindas', ICONE.casa)}
				{/if}

				<!-- Grupo 1: Painel · Cx. de Entrada · Arquivo/Escalas -->
				{#if showGrupo1}
					{#if usuario?.tipo === 'admin'}
						{@render itemMenu('/escalas/bem-vindo', 'Boas-vindas', ICONE.casa)}
						{@render itemMenu('/painel', 'Painel', ICONE.painel)}
						{@render itemMenu(
							'/recebidos',
							'Cx. de Entrada',
							ICONE.caixaEntrada,
							undefined,
							recebidosNaoVistos
						)}
					{/if}
					{#if showEscalasPoliciais}
						{@render itemMenu('/escalas/bem-vindo', 'Boas-vindas', ICONE.casa)}
						{@render itemMenu(
							'/escalas',
							usuario?.tipo === 'admin' ? 'Arquivo' : 'Escalas ordinárias',
							ICONE.calendario,
							isActive('/escalas') && !page.url.pathname.startsWith('/escalas/bem-vindo')
						)}
					{/if}
				{/if}
				<!-- end showGrupo1 -->

				<!-- Separador 1 (só admin geral, entre grupos que ambos existem) -->
				{#if showGrupo2Separator}
					<hr class="!my-3 border-surface-200 dark:border-white/10" />
				{/if}

				<!-- Grupo 2: GISE · Produtividade (admin) · Config. GISE · Rel. GISE -->
				{#if showGrupo2}
					{#if showGise}
						<!-- Só o Admin Geral em módulo GISE tem /gise/bem-vindo como home
						     (obterRotaBemVindo); para os demais (admin_seccional,
						     admin_unidade e supervisor GISE) a página redireciona e o item
						     duplicaria o "Boas-vindas" do próprio grupo do usuário. -->
						{#if usuario?.tipo === 'admin' && adminModulo === 'gise'}
							{@render itemMenu('/gise/bem-vindo', 'Boas-vindas', ICONE.casa)}
						{/if}
						{@render itemMenu('/gise', 'Escalas GISE', ICONE.pranchetaLista, giseListaOuEscalaPath)}
						{#if usuario?.tipo === 'admin'}
							{@render itemMenu('/produtividade', 'Produtividade', ICONE.barras)}
						{/if}
						{#if usuario?.tipo === 'admin'}
							{@render itemMenu(
								'/gise/config',
								'Conf. GISE',
								ICONE.engrenagem,
								giseConfigPathAtivo
							)}
						{/if}
					{/if}
					{#if usuario?.tipo === 'admin'}
						{@render itemMenu('/res-gise', 'Conf. Form.', ICONE.documento)}
					{:else}
						{#if temPresencaGiseAtiva}
							{@render itemMenu(
								'/res-gise',
								'Presença GISE',
								ICONE.documento,
								resGisePresencaAtivo
							)}
						{/if}
						{#if temGiseHistorico}
							{@render itemMenu(
								'/res-gise?status=finalizadas',
								'Histórico GISE',
								ICONE.historico,
								resGiseHistoricoAtivo
							)}
						{/if}
					{/if}
				{/if}
				<!-- end showGrupo2 -->

				<!-- Separador 2 (Admin Geral: acesso à gestão de policiais) -->
				{#if isAdmGeral}
					<hr class="!my-3 border-surface-200 dark:border-white/10" />
				{/if}

				<!-- Grupo 3: Policiais + Solicitações (Admin Geral) · Unidades (exclusivo Super Admin) -->
				{#if isAdmGeral}
					{@render itemMenu('/policiais', 'Policiais', ICONE.pessoas)}
					{@render itemMenu('/solicitacoes', 'Solicitações', ICONE.checkLista)}
				{/if}

				<!-- Grupo 4: Meu perfil (todo policial) -->
				{#if usuario?.tipo === 'policial'}
					<hr class="!my-3 border-surface-200 dark:border-white/10" />
					{@render itemMenu('/perfil', 'Meu perfil', ICONE.perfil)}
				{/if}
			{/if}
		</nav>

		<!-- Bottom section: theme, user, logout -->
		<div class="px-3 pb-4 space-y-3 border-t border-surface-200 dark:border-white/5 pt-4 shrink-0">
			<!-- Theme toggle -->
			<button
				type="button"
				class="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-surface-600 dark:text-surface-400 hover:bg-surface-200/50 dark:hover:bg-surface-800/50 transition-colors"
				onclick={toggleTheme}
			>
				{#if isDark}
					<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
						/></svg
					>
					<span>Tema claro</span>
				{:else}
					<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
						/></svg
					>
					<span>Tema escuro</span>
				{/if}
			</button>

			<!-- User info -->
			{#if usuario?.nome}
				<div
					class="mx-1 mb-1 rounded-xl border border-surface-200/70 bg-surface-100/60 px-3 py-2.5 dark:border-white/5 dark:bg-surface-800/40"
				>
					<p
						class="truncate text-xs font-semibold leading-tight text-surface-900 dark:text-surface-100"
					>
						{usuario.nome}
					</p>
					{#if !usuario?.papel && !isSupervisorGise && usuario?.lotacao}
						<p class="mt-0.5 truncate text-3xs text-surface-600 dark:text-surface-400">
							{usuario.lotacao}
						</p>
					{/if}

					<!-- Papéis / status -->
					{#if usuario?.tipo === 'admin' || usuario?.papel === 'admin_seccional' || usuario?.papel === 'admin_unidade' || isSupervisorGise}
						<div class="mt-2 flex flex-wrap items-center gap-1.5">
							{#if usuario?.tipo === 'admin'}
								<span
									class="badge preset-filled-primary-500 text-3xs font-semibold uppercase tracking-wider"
								>
									{usuario?.isSuperAdmin
										? 'SUPER ADMIN'
										: adminModulo === 'gise'
											? 'ADMIN GISE'
											: adminModulo === 'escalas'
												? 'ADMIN ESCALAS'
												: 'ADMIN GERAL'}
								</span>
								{#if !usuario?.isSuperAdmin}
									<button
										type="button"
										class="btn-icon btn-sm preset-outlined-primary-500 flex cursor-pointer items-center justify-center rounded-md p-1 text-primary-600 transition-all hover:bg-primary-500/10 dark:text-primary-400"
										onclick={alternarModulo}
										title="Alternar módulo (GISE ↔ Escalas)"
										aria-label="Alternar módulo"
										disabled={switchingModule}
									>
										<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2.5"
												d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
											/>
										</svg>
									</button>
								{/if}
							{/if}
							{#if usuario?.papel === 'admin_seccional'}
								<span
									class="badge preset-filled-warning-500 text-3xs font-semibold uppercase tracking-wider"
									>ADM SECCIONAL</span
								>
							{/if}
							{#if usuario?.papel === 'admin_unidade'}
								<span
									class="badge preset-filled-tertiary-500 text-3xs font-semibold uppercase tracking-wider"
									>ADM UNIDADE</span
								>
							{/if}
							{#if isSupervisorGise}
								<span
									class="badge preset-filled-success-500 text-3xs font-semibold uppercase tracking-wider"
									>SUPERVISOR GISE</span
								>
							{/if}
						</div>
					{/if}
				</div>
			{/if}

			<!-- Logout -->
			<button
				type="button"
				class="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-surface-600 dark:text-surface-400 hover:bg-error-500/10 hover:text-error-600 dark:hover:text-error-400 transition-colors"
				onclick={() => (showLogoutConfirm = true)}
			>
				<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
					/></svg
				>
				Sair
			</button>
		</div>
	</aside>

	<!--
		Exceção deliberada ao ModalShell: o logout é um diálogo global z-[100],
		com estado de redirecionamento e ações verticais próprias do shell da
		aplicação. Mantê-lo aqui evita transformar o primitive em um segundo layout.
	-->
	<Dialog
		open={showLogoutConfirm}
		onOpenChange={(e) => {
			if (!e.open && !isLoggingOut) showLogoutConfirm = false;
		}}
	>
		<Dialog.Content
			class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm"
		>
			<div class="w-full max-w-sm rounded-2xl card-elevated shadow-2xl p-6 space-y-6">
				<div class="flex flex-col items-center text-center space-y-2">
					<Dialog.Title class="text-xl font-bold text-surface-900 dark:text-surface-50">
						{isLoggingOut ? 'Encerrando sessão...' : 'Sair do Sistema'}
					</Dialog.Title>
					<Dialog.Description class="text-sm text-surface-600 dark:text-surface-400">
						{isLoggingOut
							? 'Aguarde, você será redirecionado em instantes.'
							: 'Deseja realmente encerrar sua sessão?'}
					</Dialog.Description>
				</div>
				<div class="flex flex-col gap-2">
					<button
						type="button"
						class="btn preset-filled-error-500 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2"
						onclick={logout}
						disabled={isLoggingOut}
					>
						{#if isLoggingOut}
							<Spinner size="sm" />
							Saindo...
						{:else}
							Sim, Sair
						{/if}
					</button>
					<button
						type="button"
						class="btn preset-outlined-surface-500 py-3 rounded-xl font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
						onclick={() => (showLogoutConfirm = false)}
						disabled={isLoggingOut}
					>
						Cancelar
					</button>
				</div>
			</div>
		</Dialog.Content>
	</Dialog>

	<!-- Conteúdo principal: gaveta é overlay (não empurra). `pt-20` reserva a
	     topbar fixa. Em xl+ o wrapper vira "folha" (borda + bg-white +
	     rounded-2xl — teste visual 07/ago/2026). -->
	<main
		id="conteudo-principal"
		class="min-h-screen relative"
		inert={sidebarIsModal}
		aria-hidden={sidebarIsModal}
	>
		<div
			class="max-w-6xl mx-auto min-w-0 px-4 sm:px-6 lg:px-8 pt-20 pb-12 transition-opacity duration-200 {navigating?.to &&
			navigating.to.url.pathname !== page.url.pathname
				? 'opacity-40 pointer-events-none'
				: ''}"
		>
			<div
				class="min-w-0 xl:border xl:border-surface-200/80 dark:xl:border-white/10 xl:bg-white dark:xl:bg-surface-900 xl:rounded-2xl xl:px-6 xl:py-6"
			>
				{@render children()}
			</div>
		</div>
	</main>
{:else}
	<!-- No sidebar: login / alterar-senha -->
	<main id="conteudo-principal">
		{@render children()}
	</main>
{/if}

<style>
	:root {
		/* Gaveta de navegação (overlay em qualquer viewport): largura fixa e legível. */
		--sidebar-width: 240px;
	}

	@media (prefers-reduced-motion: no-preference) {
		::view-transition-old(root) {
			animation: 180ms linear both vt-fade-out;
		}
		::view-transition-new(root) {
			animation: 180ms linear both vt-fade-in;
		}
		@keyframes vt-fade-out {
			to {
				opacity: 0;
			}
		}
		@keyframes vt-fade-in {
			from {
				opacity: 0;
			}
		}
	}

	.nav-progress-wrap {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 3px;
		z-index: 10000;
		pointer-events: none;
		overflow: hidden;
		opacity: 0;
		/* Give it its own view-transition name so it is excluded from the
		   root cross-fade (which starts at opacity:0 and would hide the bar) */
		view-transition-name: nav-progress;
	}
	.nav-progress-visible {
		opacity: 1;
		background: color-mix(in oklch, var(--color-primary-500) 25%, transparent);
	}
	.nav-progress-bar {
		height: 100%;
		width: 40%;
		background: linear-gradient(90deg, var(--color-primary-500), var(--color-secondary-500));
		border-radius: 999px;
		animation: nav-progress 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
	}
	@keyframes nav-progress {
		0% {
			transform: translateX(-120%);
		}
		100% {
			transform: translateX(350%);
		}
	}
	/* Opt the progress bar out of the root cross-fade entirely */
	::view-transition-old(nav-progress),
	::view-transition-new(nav-progress) {
		animation: none;
	}
</style>
