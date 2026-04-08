<script lang="ts">
	import '../app.css';
	import { page, navigating } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import { Toast } from '@skeletonlabs/skeleton-svelte';
	import { toaster } from '$lib/toast';
	import { csrfHeaders } from '$lib/csrf';

	let { children } = $props();

	const usuario = $derived(page.data.usuario);
	const isSupervisorGise = $derived(page.data.isSupervisorGise ?? false);
	const isMembroGise = $derived(page.data.isMembroGise ?? false);

	// Mostra abas Escalas e Policiais para: admin, admin_seccional, admin_unidade
	const showEscalasPoliciais = $derived(
		usuario?.tipo === 'admin' ||
		usuario?.papel === 'admin_seccional' ||
		usuario?.papel === 'admin_unidade'
	);

	// Mostra aba GISE para: admin, admin_seccional ou supervisor ativo
	// (admin_unidade só vê se também for supervisor, coberto por isSupervisorGise)
	const showGise = $derived(
		usuario?.tipo === 'admin' ||
		usuario?.papel === 'admin_seccional' ||
		isSupervisorGise
	);

	const showResGise = $derived(
		usuario?.tipo === 'admin' ||
		isMembroGise
	);

	const showSidebar = $derived(
		page.url.pathname !== '/login' && page.url.pathname !== '/alterar-senha'
	);

	let sidebarOpen = $state(false);
	let isDark = $state(true);

	$effect(() => {
		isDark = document.documentElement.classList.contains('dark');
	});

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
		try {
			await fetch('/api/auth/logout', { method: 'POST', headers: csrfHeaders() });
		} catch { /* ignora erros de rede — o redirecionamento ocorre de qualquer forma */ }

		// Limpa filtros salvos no localStorage ao deslogar
		if (typeof localStorage !== 'undefined') {
			const keysToRemove = [];
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i);
				if (key?.startsWith('filtros_')) {
					keysToRemove.push(key);
				}
			}
			keysToRemove.forEach(k => localStorage.removeItem(k));
		}

		await invalidateAll();
		goto('/login');
	}


	function navTo(href: string) {
		sidebarOpen = false;
		goto(href);
	}

	function isActive(path: string): boolean {
		return page.url.pathname === path || page.url.pathname.startsWith(path + '/');
	}

	const loadingText = $derived.by(() => {
		if (!navigating?.to) return 'Carregando...';
		const path = navigating.to.url.pathname;
		if (path.startsWith('/res-gise')) return 'Carregando Relatórios GISE...';
		if (path.startsWith('/gise')) return 'Carregando GISE...';
		if (path.startsWith('/escalas')) return 'Carregando Escalas...';
		if (path.startsWith('/policiais')) return 'Carregando Policiais...';
		if (path.startsWith('/unidades')) return 'Carregando Unidades...';
		if (path.startsWith('/painel')) return 'Carregando Painel...';
		if (path.startsWith('/recebidos')) return 'Carregando Caixa de Entrada...';
		if (path.startsWith('/produtividade')) return 'Carregando Produtividade...';
		if (path.startsWith('/conf-ass')) return 'Carregando Configurações...';
		return 'Carregando...';
	});
</script>

<svelte:head>
	<title>Escalas de Plantão Policial</title>
	<meta name="description" content="Portal de Gestão de Escalas e Relatórios GISE - Polícia Civil." />
	<meta property="og:title" content="Escalas PC-CE" />
	<meta property="og:description" content="Acompanhe escalas de plantão e documente relatórios de inteligência na plataforma unificada da Polícia Civil." />
	<meta property="og:type" content="website" />
</svelte:head>

<!-- Navigation progress bar -->
{#if navigating?.to && !['/login', '/alterar-senha'].includes(navigating.to.url.pathname)}
	<div class="nav-progress-wrap" aria-hidden="true">
		<div class="nav-progress-bar"></div>
	</div>

	<div class="fixed inset-0 z-[10000] bg-surface-50/80 dark:bg-surface-950/80 backdrop-blur-sm flex flex-col items-center justify-center pointer-events-none">
		<div class="w-12 h-12 border-4 border-surface-200 dark:border-surface-700 border-t-primary-500 rounded-full animate-spin"></div>
		<p class="mt-4 text-surface-600 dark:text-surface-300 font-medium animate-pulse uppercase tracking-widest text-xs">{loadingText}</p>
	</div>
{/if}

<!-- Global Toast Provider -->
<Toast.Group {toaster} class="fixed z-[9999] inset-0 pointer-events-none p-4 flex flex-col items-end justify-end gap-3">
	{#snippet children(toast)}
		<Toast {toast} class="bg-surface-900 dark:bg-surface-100 text-surface-50 dark:text-surface-900 px-6 py-4 rounded-xl shadow-2xl pointer-events-auto border border-surface-700 dark:border-surface-300 min-w-[300px]">
			<div class="flex items-center gap-3">
				{#if toast.type === 'success'}
					<svg class="w-6 h-6 text-success-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
				{:else if toast.type === 'error'}
					<svg class="w-6 h-6 text-error-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
				{/if}
				<div class="flex-1">
					<Toast.Title class="font-bold text-sm">{toast.title}</Toast.Title>
					{#if toast.description}
						<Toast.Description class="text-xs opacity-75">{toast.description}</Toast.Description>
					{/if}
				</div>
				<Toast.CloseTrigger class="btn-icon btn-sm opacity-50 hover:opacity-100 transition-opacity">
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
				</Toast.CloseTrigger>
			</div>
		</Toast>
	{/snippet}
</Toast.Group>

{#if showSidebar && usuario}
	<!-- Mobile: hamburger top bar -->
	<div class="md:hidden fixed top-0 left-0 right-0 z-40 h-14 bg-surface-50/90 dark:bg-surface-950/90 backdrop-blur-lg border-b border-surface-200 dark:border-white/10 flex items-center px-4">
		<button
			class="p-2 -ml-2 text-surface-600 dark:text-surface-300 hover:text-primary-500 transition-colors"
			onclick={() => sidebarOpen = !sidebarOpen}
			aria-label="Menu"
		>
			<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
			</svg>
		</button>
		<a href="/" class="ml-3 flex items-center gap-2 no-underline">
			<span class="text-primary-600 dark:text-primary-500 text-lg">⚡</span>
			<span class="font-extrabold text-lg bg-clip-text text-transparent bg-gradient-to-r from-surface-900 to-surface-500 dark:from-surface-50 dark:to-surface-300">Escalas</span>
		</a>
	</div>

	<!-- Mobile: overlay backdrop -->
	{#if sidebarOpen}
		<button
			class="md:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
			onclick={() => sidebarOpen = false}
			aria-label="Fechar menu"
		></button>
	{/if}

	<!-- Sidebar -->
	<aside class="
		fixed top-0 left-0 z-50 h-full w-60
		bg-surface-50/95 dark:bg-surface-950/95 backdrop-blur-xl
		border-r border-surface-200 dark:border-white/10
		shadow-xl shadow-black/5 dark:shadow-black/30
		flex flex-col
		transition-transform duration-300 ease-in-out
		md:translate-x-0
		{sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
	">
		<!-- Logo -->
		<div class="h-16 flex items-center px-5 border-b border-surface-200 dark:border-white/5 shrink-0">
			<a href="/" class="flex items-center gap-2 no-underline group" onclick={() => sidebarOpen = false}>
				<span class="text-primary-600 dark:text-primary-500 text-xl group-hover:text-primary-500 dark:group-hover:text-primary-400 transition-colors">⚡</span>
				<span class="font-extrabold text-xl bg-clip-text text-transparent bg-gradient-to-r from-surface-900 to-surface-500 dark:from-surface-50 dark:to-surface-300">Escalas</span>
			</a>
			<!-- Mobile close button -->
			<button
				class="md:hidden ml-auto p-1 text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 transition-colors"
				onclick={() => sidebarOpen = false}
				aria-label="Fechar menu"
			>
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
			</button>
		</div>

		<!-- Navigation -->
		<nav class="flex-1 px-3 py-4 space-y-1 overflow-y-auto">

			<!-- Grupo 1: Painel · Cx. de Entrada · Arquivo/Escalas -->
			{#if usuario?.tipo === 'admin'}
				<button
					class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all no-underline
						{isActive('/painel') ? 'bg-primary-500/15 text-primary-700 dark:text-primary-400 border border-primary-500/20' : 'text-surface-600 dark:text-surface-300 hover:bg-surface-200/50 dark:hover:bg-surface-800/50 border border-transparent'}"
					onclick={() => navTo('/painel')}
				>
					<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
					Painel
				</button>
				<button
					class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all no-underline
						{isActive('/recebidos') ? 'bg-primary-500/15 text-primary-700 dark:text-primary-400 border border-primary-500/20' : 'text-surface-600 dark:text-surface-300 hover:bg-surface-200/50 dark:hover:bg-surface-800/50 border border-transparent'}"
					onclick={() => navTo('/recebidos')}
				>
					<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4a2 2 0 012-2m16 0h-2M4 13H6m0 0v4a2 2 0 002 2h8a2 2 0 002-2v-4m-2 0h2m-2 0H6" /></svg>
					Cx. de Entrada
				</button>
			{/if}
			{#if showEscalasPoliciais}
				<button
					class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all no-underline
						{isActive('/escalas') ? 'bg-primary-500/15 text-primary-700 dark:text-primary-400 border border-primary-500/20' : 'text-surface-600 dark:text-surface-300 hover:bg-surface-200/50 dark:hover:bg-surface-800/50 border border-transparent'}"
					onclick={() => navTo('/escalas')}
				>
					<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
					{usuario?.tipo === 'admin' ? 'Arquivo' : 'Escalas'}
				</button>
			{/if}

			<!-- Separador 1 (só admin geral) -->
			{#if usuario?.tipo === 'admin'}
				<hr class="!my-3 border-surface-200 dark:border-white/10" />
			{/if}

			<!-- Grupo 2: GISE · Rel. GISE -->
			{#if showGise}
				<button
					class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all no-underline
						{isActive('/gise') ? 'bg-primary-500/15 text-primary-700 dark:text-primary-400 border border-primary-500/20' : 'text-surface-600 dark:text-surface-300 hover:bg-surface-200/50 dark:hover:bg-surface-800/50 border border-transparent'}"
					onclick={() => navTo('/gise')}
				>
					<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
					GISE
				</button>
			{/if}
			{#if showResGise}
				<button
					class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all no-underline
						{isActive('/res-gise') ? 'bg-primary-500/15 text-primary-700 dark:text-primary-400 border border-primary-500/20' : 'text-surface-600 dark:text-surface-300 hover:bg-surface-200/50 dark:hover:bg-surface-800/50 border border-transparent'}"
					onclick={() => navTo('/res-gise')}
				>
					<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
					Rel. Gise
				</button>
			{/if}

			{#if usuario?.tipo === 'admin'}
				<button
					class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all no-underline
						{isActive('/produtividade') ? 'bg-primary-500/15 text-primary-700 dark:text-primary-400 border border-primary-500/20' : 'text-surface-600 dark:text-surface-300 hover:bg-surface-200/50 dark:hover:bg-surface-800/50 border border-transparent'}"
					onclick={() => navTo('/produtividade')}
				>
					<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
					Produtividade
				</button>
			{/if}

			<!-- Separador 2 (só admin geral) -->
			{#if usuario?.tipo === 'admin'}
				<hr class="!my-3 border-surface-200 dark:border-white/10" />
			{/if}

			<!-- Grupo 3: Policiais · Unidades -->
			{#if showEscalasPoliciais}
				<button
					class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all no-underline
						{isActive('/policiais') ? 'bg-primary-500/15 text-primary-700 dark:text-primary-400 border border-primary-500/20' : 'text-surface-600 dark:text-surface-300 hover:bg-surface-200/50 dark:hover:bg-surface-800/50 border border-transparent'}"
					onclick={() => navTo('/policiais')}
				>
					<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
					Policiais
				</button>
			{/if}
			{#if usuario?.tipo === 'admin'}
				<button
					class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all no-underline
						{isActive('/unidades') ? 'bg-primary-500/15 text-primary-700 dark:text-primary-400 border border-primary-500/20' : 'text-surface-600 dark:text-surface-300 hover:bg-surface-200/50 dark:hover:bg-surface-800/50 border border-transparent'}"
					onclick={() => navTo('/unidades')}
				>
					<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
					Unidades
				</button>
				<button
					class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all no-underline
						{isActive('/conf-ass') ? 'bg-primary-500/15 text-primary-700 dark:text-primary-400 border border-primary-500/20' : 'text-surface-600 dark:text-surface-300 hover:bg-surface-200/50 dark:hover:bg-surface-800/50 border border-transparent'}"
					onclick={() => navTo('/conf-ass')}
				>
					<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
					Conf. ass.
				</button>
			{/if}

		</nav>

		<!-- Bottom section: theme, user, logout -->
		<div class="px-3 pb-4 space-y-3 border-t border-surface-200 dark:border-white/5 pt-4 shrink-0">
			<!-- Theme toggle -->
			<button
				class="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-surface-500 dark:text-surface-400 hover:bg-surface-200/50 dark:hover:bg-surface-800/50 transition-colors"
				onclick={toggleTheme}
			>
				{#if isDark}
					<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
					<span>Tema claro</span>
				{:else}
					<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
					<span>Tema escuro</span>
				{/if}
			</button>

			<!-- User info -->
			<div class="px-3 py-2">
				<p class="text-xs font-semibold text-surface-900 dark:text-surface-100 truncate">{usuario.nome}</p>
				{#if usuario.tipo === 'admin'}
					<span class="badge preset-filled-primary-500 text-[0.6rem] font-semibold tracking-wider mt-1">ADMIN GERAL</span>
				{:else if usuario.papel === 'admin_seccional'}
					<span class="badge preset-filled-warning-500 text-[0.6rem] font-semibold tracking-wider mt-1">ADM SECCIONAL</span>
				{:else if usuario.papel === 'admin_unidade'}
					<span class="badge preset-filled-tertiary-500 text-[0.6rem] font-semibold tracking-wider mt-1">ADM UNIDADE</span>
				{:else if isSupervisorGise}
					<span class="badge preset-filled-success-500 text-[0.6rem] font-semibold tracking-wider mt-1">SUPERVISOR</span>
				{:else if usuario.lotacao}
					<p class="text-[0.65rem] text-surface-500 dark:text-surface-400 mt-0.5 truncate">{usuario.lotacao}</p>
				{/if}
			</div>

			<!-- Logout -->
			<button
				class="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-surface-500 dark:text-surface-400 hover:bg-error-500/10 hover:text-error-600 dark:hover:text-error-400 transition-colors"
				onclick={logout}
			>
				<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
				Sair
			</button>
		</div>
	</aside>

	<!-- Main content with sidebar offset -->
	<main class="md:ml-60 min-h-screen">
		<div class="max-w-6xl mx-auto px-4 pt-20 md:pt-8 pb-12">
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
	.nav-progress-wrap {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 2px;
		z-index: 10000;
		pointer-events: none;
		background: rgb(var(--color-primary-500) / 0.2);
		overflow: hidden;
	}
	.nav-progress-bar {
		height: 100%;
		width: 45%;
		background: rgb(var(--color-primary-500));
		border-radius: 999px;
		animation: nav-progress 1.2s ease-in-out infinite;
	}
	@keyframes nav-progress {
		0%   { transform: translateX(-110%); }
		100% { transform: translateX(320%); }
	}
</style>
