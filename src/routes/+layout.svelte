<script lang="ts">
	import '../app.css';
	// Preload das duas fontes críticas acima da dobra (corpo + títulos): sem
	// isto o browser só descobre os woff2 após baixar e parsear o CSS, e o
	// texto pisca no swap. O ?url resolve para o MESMO asset hasheado que o
	// @font-face do app.css referencia — um download só. Demais pesos seguem
	// sob demanda via @fontsource.
	import inter400Url from '@fontsource/inter/files/inter-latin-400-normal.woff2?url';
	import outfit700Url from '@fontsource/outfit/files/outfit-latin-700-normal.woff2?url';
	import { tick } from 'svelte';
	import { page, navigating } from '$app/state';
	import { goto, onNavigate, afterNavigate } from '$app/navigation';
	import { Toast, Dialog, Avatar } from '@skeletonlabs/skeleton-svelte';
	import { toaster } from '$lib/toast';
	import { csrfHeaders } from '$lib/csrf';
	import { loading } from '$lib/loading.svelte';
	import LoadingOverlay from '$lib/components/LoadingOverlay.svelte';
	import { useScrollLock } from '$lib/composables';

	const { children } = $props();

	const usuario = $derived(page.data.usuario);
	const iniciaisUsuario = $derived(
		usuario?.nome
			? usuario.nome
					.trim()
					.split(/\s+/)
					.map((n: string) => n[0])
					.filter(Boolean)
					.slice(0, 2)
					.join('')
					.toUpperCase()
			: ''
	);
	const isSupervisorGise = $derived(page.data.isSupervisorGise ?? false);
	const isMembroGise = $derived(page.data.isMembroGise ?? false);
	const isSupervisaoGise = $derived(page.data.isSupervisaoGise ?? false);
	const adminModulo = $derived((page.data.adminModulo as 'ambas' | 'gise' | 'escalas') ?? 'ambas');

	// Mostra aba Escalas para: admin_seccional, admin_unidade (admin geral não tem mais acesso à aba Arquivo)
	const showEscalasPoliciais = $derived(
		usuario?.papel === 'admin_seccional' || usuario?.papel === 'admin_unidade'
	);

	// Mostra aba GISE para: admin, admin_seccional ou supervisor ativo
	// (admin_unidade só vê se também for supervisor, coberto por isSupervisorGise)
	const showGise = $derived(
		usuario?.tipo === 'admin' || usuario?.papel === 'admin_seccional' || isSupervisorGise
	);

	// Rel. Gise: escalados (membro), quadro de supervisão (assessor/SEINT) e supervisor DPC ativo
	const showResGise = $derived(
		usuario?.tipo === 'admin' || isMembroGise || isSupervisaoGise || isSupervisorGise
	);

	// For admins: control menu group visibility based on chosen module
	const showGrupo1 = $derived(
		usuario?.tipo !== 'admin' || adminModulo === 'ambas' || adminModulo === 'escalas'
	);
	const showGrupo2 = $derived(
		usuario?.tipo !== 'admin' || adminModulo === 'ambas' || adminModulo === 'gise'
	);
	const showGrupo2Separator = $derived(usuario?.tipo === 'admin' && showGrupo1 && showGrupo2);

	const showSidebar = $derived(
		page.url.pathname !== '/login' && page.url.pathname !== '/alterar-senha'
	);

	let sidebarOpen = $state(false);
	let isDark = $state(
		typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : true
	);
	let showLogoutConfirm = $state(false);
	let isLoggingOut = $state(false);

	useScrollLock(() => sidebarOpen);

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
			await fetch('/api/auth/logout', { method: 'POST', headers: csrfHeaders() });
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
			const res = await fetch('/api/auth/alternar-modulo', {
				method: 'POST',
				headers: csrfHeaders()
			});
			if (res.ok) {
				const result = await res.json();
				if (result.redirect) {
					await goto(result.redirect, { invalidateAll: true });
				}
			} else {
				toaster.create({ title: 'Erro ao alternar módulo', type: 'error' });
			}
		} catch {
			toaster.create({ title: 'Erro de conexão ao alternar módulo', type: 'error' });
		} finally {
			switchingModule = false;
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

	onNavigate((navigation) => {
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
	afterNavigate(() => loading.hide());
</script>

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
		!['/login', '/alterar-senha'].includes(navigating.to.url.pathname)}
	aria-hidden="true"
>
	<div class="nav-progress-bar"></div>
</div>

<!-- Global Loading Overlay — only for API operations (signing, saving). Page navigation uses the top progress bar + inline skeletons. -->
<LoadingOverlay
	active={loading.active}
	message={loading.message}
	offsetSidebar={showSidebar && !!usuario}
/>

<!-- Global Toast Provider -->
<Toast.Group
	{toaster}
	class="fixed z-[9999] inset-0 pointer-events-none p-4 flex flex-col items-end justify-end gap-3"
>
	{#snippet children(toast)}
		<Toast
			{toast}
			class="bg-surface-900 dark:bg-surface-100 text-surface-50 dark:text-surface-900 px-6 py-4 rounded-xl shadow-2xl pointer-events-auto border border-surface-700 dark:border-surface-300 w-full sm:w-auto sm:min-w-[300px] max-w-[calc(100vw-2rem)]"
		>
			<div class="flex items-center gap-3">
				{#if toast.type === 'success'}
					<svg
						class="w-6 h-6 text-success-500"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
						/></svg
					>
				{:else if toast.type === 'error'}
					<svg class="w-6 h-6 text-error-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
						/></svg
					>
				{/if}
				<div class="flex-1">
					<Toast.Title class="font-bold text-sm">{toast.title}</Toast.Title>
					{#if toast.description}
						<Toast.Description class="text-xs opacity-75">{toast.description}</Toast.Description>
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

{#if showSidebar && usuario}
	<!-- Mobile: hamburger top bar -->
	<div
		class="min-[900px]:hidden fixed top-0 left-0 right-0 z-40 h-14 bg-surface-50/90 dark:bg-surface-950/90 backdrop-blur-lg border-b border-surface-200 dark:border-white/10 flex items-center px-4"
	>
		<button
			type="button"
			class="p-2 -ml-2 text-surface-600 dark:text-surface-300 hover:text-primary-500 transition-colors"
			onclick={() => (sidebarOpen = !sidebarOpen)}
			aria-label="Menu"
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
				class="font-extrabold text-lg bg-clip-text text-transparent bg-gradient-to-r from-surface-900 to-surface-500 dark:from-surface-50 dark:to-surface-300"
				>DPI SUL</span
			>
		</div>
	</div>

	<!-- Mobile: overlay backdrop -->
	{#if sidebarOpen}
		<button
			type="button"
			class="min-[900px]:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
			onclick={() => (sidebarOpen = false)}
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
			min-[900px]:translate-x-0
			{sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
		"
		style="width: var(--sidebar-width, 240px);"
	>
		<!-- Logo -->
		<div
			class="h-16 flex items-center px-5 border-b border-surface-200 dark:border-white/5 shrink-0"
		>
			<div class="flex items-center gap-2 group">
				<span
					class="font-extrabold text-xl bg-clip-text text-transparent bg-gradient-to-r from-surface-900 to-surface-500 dark:from-surface-50 dark:to-surface-300"
					>DPI SUL</span
				>
			</div>
			<!-- Mobile close button -->
			<button
				type="button"
				class="min-[900px]:hidden ml-auto p-1 text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 transition-colors"
				onclick={() => (sidebarOpen = false)}
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
		<nav class="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
			{#if usuario?.tipo === 'policial' && !usuario.papel}
				<a
					href="/bem-vindo"
					data-sveltekit-preload-data="hover"
					class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all no-underline
					{isActive('/bem-vindo')
						? 'bg-primary-500/15 text-primary-700 dark:text-primary-400 border border-primary-500/20'
						: 'text-surface-600 dark:text-surface-300 hover:bg-surface-200/50 dark:hover:bg-surface-800/50 border border-transparent'}"
					onclick={() => (sidebarOpen = false)}
				>
					<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
						/></svg
					>
					Boas-vindas
				</a>
			{/if}

			<!-- Grupo 1: Painel · Cx. de Entrada · Arquivo/Escalas -->
			{#if showGrupo1}
				{#if usuario?.tipo === 'admin'}
					<a
						href="/escalas/bem-vindo"
						data-sveltekit-preload-data="hover"
						class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all no-underline
						{isActive('/escalas/bem-vindo')
							? 'bg-primary-500/15 text-primary-700 dark:text-primary-400 border border-primary-500/20'
							: 'text-surface-600 dark:text-surface-300 hover:bg-surface-200/50 dark:hover:bg-surface-800/50 border border-transparent'}"
						onclick={() => (sidebarOpen = false)}
					>
						<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.5"
								d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
							/></svg
						>
						Boas-vindas
					</a>
					<a
						href="/painel"
						data-sveltekit-preload-data="hover"
						class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all no-underline
						{isActive('/painel')
							? 'bg-primary-500/15 text-primary-700 dark:text-primary-400 border border-primary-500/20'
							: 'text-surface-600 dark:text-surface-300 hover:bg-surface-200/50 dark:hover:bg-surface-800/50 border border-transparent'}"
						onclick={() => (sidebarOpen = false)}
					>
						<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.5"
								d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
							/></svg
						>
						Painel
					</a>
					<a
						href="/recebidos"
						data-sveltekit-preload-data="hover"
						class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all no-underline
						{isActive('/recebidos')
							? 'bg-primary-500/15 text-primary-700 dark:text-primary-400 border border-primary-500/20'
							: 'text-surface-600 dark:text-surface-300 hover:bg-surface-200/50 dark:hover:bg-surface-800/50 border border-transparent'}"
						onclick={() => (sidebarOpen = false)}
					>
						<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.5"
								d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4a2 2 0 012-2m16 0h-2M4 13H6m0 0v4a2 2 0 002 2h8a2 2 0 002-2v-4m-2 0h2m-2 0H6"
							/></svg
						>
						Cx. de Entrada
					</a>
				{/if}
				{#if showEscalasPoliciais}
					<a
						href="/escalas/bem-vindo"
						data-sveltekit-preload-data="hover"
						class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all no-underline
						{isActive('/escalas/bem-vindo')
							? 'bg-primary-500/15 text-primary-700 dark:text-primary-400 border border-primary-500/20'
							: 'text-surface-600 dark:text-surface-300 hover:bg-surface-200/50 dark:hover:bg-surface-800/50 border border-transparent'}"
						onclick={() => (sidebarOpen = false)}
					>
						<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.5"
								d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
							/></svg
						>
						Boas-vindas
					</a>
					<a
						href="/escalas"
						data-sveltekit-preload-data="hover"
						class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all no-underline
						{isActive('/escalas') && !page.url.pathname.startsWith('/escalas/bem-vindo')
							? 'bg-primary-500/15 text-primary-700 dark:text-primary-400 border border-primary-500/20'
							: 'text-surface-600 dark:text-surface-300 hover:bg-surface-200/50 dark:hover:bg-surface-800/50 border border-transparent'}"
						onclick={() => (sidebarOpen = false)}
					>
						<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.5"
								d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
							/></svg
						>
						{usuario?.tipo === 'admin' ? 'Arquivo' : 'Escalas'}
					</a>
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
					{#if usuario?.papel !== 'admin_seccional'}
						<a
							href="/gise/bem-vindo"
							data-sveltekit-preload-data="hover"
							class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all no-underline
							{isActive('/gise/bem-vindo')
								? 'bg-primary-500/15 text-primary-700 dark:text-primary-400 border border-primary-500/20'
								: 'text-surface-600 dark:text-surface-300 hover:bg-surface-200/50 dark:hover:bg-surface-800/50 border border-transparent'}"
							onclick={() => (sidebarOpen = false)}
						>
							<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="1.5"
									d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
								/></svg
							>
							Boas-vindas
						</a>
					{/if}
					<a
						href="/gise"
						data-sveltekit-preload-data="hover"
						class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all no-underline
						{giseListaOuEscalaPath
							? 'bg-primary-500/15 text-primary-700 dark:text-primary-400 border border-primary-500/20'
							: 'text-surface-600 dark:text-surface-300 hover:bg-surface-200/50 dark:hover:bg-surface-800/50 border border-transparent'}"
						onclick={() => (sidebarOpen = false)}
					>
						<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.5"
								d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
							/></svg
						>
						Escalas GISE
					</a>
					{#if usuario?.tipo === 'admin'}
						<a
							href="/produtividade"
							data-sveltekit-preload-data="hover"
							class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all no-underline
						{isActive('/produtividade')
								? 'bg-primary-500/15 text-primary-700 dark:text-primary-400 border border-primary-500/20'
								: 'text-surface-600 dark:text-surface-300 hover:bg-surface-200/50 dark:hover:bg-surface-800/50 border border-transparent'}"
							onclick={() => (sidebarOpen = false)}
						>
							<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="1.5"
									d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
								/></svg
							>
							Produtividade
						</a>
					{/if}
					{#if usuario?.tipo === 'admin'}
						<a
							href="/gise/config"
							data-sveltekit-preload-data="hover"
							class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all no-underline
							{giseConfigPathAtivo
								? 'bg-primary-500/15 text-primary-700 dark:text-primary-400 border border-primary-500/20'
								: 'text-surface-600 dark:text-surface-300 hover:bg-surface-200/50 dark:hover:bg-surface-800/50 border border-transparent'}"
							onclick={() => (sidebarOpen = false)}
						>
							<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="1.5"
									d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
								/><path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="1.5"
									d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
								/></svg
							>
							Conf. GISE
						</a>
					{/if}
				{/if}
				{#if showResGise}
					<a
						href="/res-gise"
						data-sveltekit-preload-data="hover"
						class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all no-underline
						{isActive('/res-gise')
							? 'bg-primary-500/15 text-primary-700 dark:text-primary-400 border border-primary-500/20'
							: 'text-surface-600 dark:text-surface-300 hover:bg-surface-200/50 dark:hover:bg-surface-800/50 border border-transparent'}"
						onclick={() => (sidebarOpen = false)}
					>
						<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.5"
								d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
							/></svg
						>
						{usuario?.tipo === 'admin' ? 'Conf. Form.' : 'Presença GISE'}
					</a>
				{/if}
			{/if}
			<!-- end showGrupo2 -->

			<!-- Separador 2 (só super admin) -->
			{#if usuario?.isSuperAdmin}
				<hr class="!my-3 border-surface-200 dark:border-white/10" />
			{/if}

			<!-- Grupo 3: Policiais · Unidades (exclusivo Super Admin) -->
			{#if usuario?.isSuperAdmin}
				<a
					href="/policiais"
					data-sveltekit-preload-data="hover"
					class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all no-underline
						{isActive('/policiais')
						? 'bg-primary-500/15 text-primary-700 dark:text-primary-400 border border-primary-500/20'
						: 'text-surface-600 dark:text-surface-300 hover:bg-surface-200/50 dark:hover:bg-surface-800/50 border border-transparent'}"
					onclick={() => (sidebarOpen = false)}
				>
					<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
						/></svg
					>
					Policiais
				</a>
			{/if}
			{#if usuario?.isSuperAdmin}
				<a
					href="/unidades"
					data-sveltekit-preload-data="hover"
					class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all no-underline
						{isActive('/unidades')
						? 'bg-primary-500/15 text-primary-700 dark:text-primary-400 border border-primary-500/20'
						: 'text-surface-600 dark:text-surface-300 hover:bg-surface-200/50 dark:hover:bg-surface-800/50 border border-transparent'}"
					onclick={() => (sidebarOpen = false)}
				>
					<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
						/></svg
					>
					Unidades
				</a>
				<a
					href="/conf-ass"
					data-sveltekit-preload-data="hover"
					class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all no-underline
						{isActive('/conf-ass')
						? 'bg-primary-500/15 text-primary-700 dark:text-primary-400 border border-primary-500/20'
						: 'text-surface-600 dark:text-surface-300 hover:bg-surface-200/50 dark:hover:bg-surface-800/50 border border-transparent'}"
					onclick={() => (sidebarOpen = false)}
				>
					<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
						/><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
						/></svg
					>
					Conf. ass.
				</a>
			{/if}
		</nav>

		<!-- Bottom section: theme, user, logout -->
		<div class="px-3 pb-4 space-y-3 border-t border-surface-200 dark:border-white/5 pt-4 shrink-0">
			<!-- Theme toggle -->
			<button
				type="button"
				class="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-surface-500 dark:text-surface-400 hover:bg-surface-200/50 dark:hover:bg-surface-800/50 transition-colors"
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
			<div class="px-3 py-2 space-y-2">
				{#if usuario?.nome}
					<div class="flex-1 min-w-0">
						<p
							class="text-xs font-semibold text-surface-900 dark:text-surface-100 truncate leading-tight"
						>
							{usuario.nome}
						</p>
						{#if !usuario?.papel && !isSupervisorGise && usuario?.lotacao}
							<p class="text-[0.65rem] text-surface-500 dark:text-surface-400 truncate mt-0.5">
								{usuario.lotacao}
							</p>
						{/if}
					</div>
				{/if}
				<div class="flex flex-wrap gap-1.5 items-center">
					{#if usuario?.tipo === 'admin'}
						<span
							class="badge preset-filled-primary-500 text-[0.6rem] font-semibold tracking-wider uppercase"
						>
							ADMIN {adminModulo === 'gise'
								? 'GISE'
								: adminModulo === 'escalas'
									? 'ESCALAS'
									: 'GERAL'}
						</span>
						<button
							type="button"
							class="btn-icon btn-sm preset-outlined-primary-500 hover:bg-primary-500/10 rounded-md active:scale-95 transition-all text-primary-600 dark:text-primary-400 flex items-center justify-center cursor-pointer p-1"
							onclick={alternarModulo}
							title="Alternar Módulo (GISE / Escalas)"
							aria-label="Alternar Módulo"
							disabled={switchingModule}
						>
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
							</svg>
						</button>
					{/if}
					{#if usuario?.papel === 'admin_seccional'}
						<span
							class="badge preset-filled-warning-500 text-[0.6rem] font-semibold tracking-wider uppercase"
							>ADM SECCIONAL</span
						>
					{/if}
					{#if usuario?.papel === 'admin_unidade'}
						<span
							class="badge preset-filled-tertiary-500 text-[0.6rem] font-semibold tracking-wider uppercase"
							>ADM UNIDADE</span
						>
					{/if}
					{#if isSupervisorGise}
						<span
							class="badge preset-filled-success-500 text-[0.6rem] font-semibold tracking-wider uppercase"
							>SUPERVISOR GISE</span
						>
					{/if}
				</div>
			</div>

			<!-- Logout -->
			<button
				type="button"
				class="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-surface-500 dark:text-surface-400 hover:bg-error-500/10 hover:text-error-600 dark:hover:text-error-400 transition-colors"
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

	<!-- Modal de Confirmação de Logout -->
	<Dialog
		open={showLogoutConfirm}
		onOpenChange={(e) => {
			if (!e.open && !isLoggingOut) showLogoutConfirm = false;
		}}
	>
		<Dialog.Content
			class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-surface-950/40 backdrop-blur-sm"
		>
			<div
				class="w-full max-w-sm rounded-2xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-white/10 shadow-2xl p-6 space-y-6"
			>
				<div class="flex flex-col items-center text-center space-y-2">
					<Dialog.Title class="text-xl font-bold text-surface-900 dark:text-surface-50">
						{isLoggingOut ? 'Encerrando sessão...' : 'Sair do Sistema'}
					</Dialog.Title>
					<Dialog.Description class="text-sm text-surface-500 dark:text-surface-400">
						{isLoggingOut
							? 'Aguarde, você será redirecionado em instantes.'
							: 'Deseja realmente encerrar sua sessão?'}
					</Dialog.Description>
				</div>
				<div class="flex flex-col gap-2">
					<button
						type="button"
						class="btn preset-filled-error-500 py-3 rounded-xl font-bold transition-all active:scale-95 flex items-center justify-center gap-2"
						onclick={logout}
						disabled={isLoggingOut}
					>
						{#if isLoggingOut}
							<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
								<circle
									class="opacity-25"
									cx="12"
									cy="12"
									r="10"
									stroke="currentColor"
									stroke-width="3"
								></circle>
								<path
									class="opacity-75"
									fill="currentColor"
									d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
								></path>
							</svg>
							Saindo...
						{:else}
							Sim, Sair
						{/if}
					</button>
					<button
						type="button"
						class="btn preset-outlined-surface-500 py-3 rounded-xl font-bold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
						onclick={() => (showLogoutConfirm = false)}
						disabled={isLoggingOut}
					>
						Cancelar
					</button>
				</div>
			</div>
		</Dialog.Content>
	</Dialog>

	<!-- Main content with sidebar offset -->
	<main
		class="min-h-screen relative transition-[margin] duration-300"
		style="margin-left: {usuario ? 'var(--desktop-sidebar-offset)' : '0'};"
	>
		<div
			class="max-w-6xl mx-auto min-w-0 px-2 sm:px-4 pt-20 min-[900px]:pt-8 pb-12 transition-opacity duration-200 {navigating?.to &&
			navigating.to.url.pathname !== page.url.pathname
				? 'opacity-40 pointer-events-none'
				: ''}"
		>
			{@render children()}
		</div>
	</main>
{:else}
	<!-- No sidebar: login / alterar-senha -->
	<main>
		{@render children()}
	</main>
{/if}

<style>
	:root {
		/* No mobile (overlay), usamos largura fixa para legibilidade */
		--sidebar-width: 240px;
		--desktop-sidebar-offset: 0px;
	}

	@media (min-width: 900px) {
		:root {
			/* No desktop, a largura é fluida: min 168px (70% de 240), ideal 18vw, max 240px */
			--sidebar-width: clamp(168px, 18vw, 240px);
			--desktop-sidebar-offset: var(--sidebar-width);
		}
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
