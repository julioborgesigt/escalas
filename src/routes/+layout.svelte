<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import { AppBar, Toast } from '@skeletonlabs/skeleton-svelte';
	import { toaster } from '$lib/toast';

	let { children } = $props();

	const usuario = $derived(page.data.usuario);
	let menuOpen = $state(false);
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
		await fetch('/api/auth/logout', { method: 'POST' });
		await invalidateAll();
		goto('/login');
	}
</script>

<svelte:head>
	<title>Escalas de Plantão Policial</title>
</svelte:head>

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

<!-- Navbar Glassmorphism -->
{#if page.url.pathname !== '/login' && page.url.pathname !== '/alterar-senha'}
<header class="sticky top-0 z-50 bg-surface-50/70 dark:bg-surface-950/70 backdrop-blur-lg border-b border-surface-200 dark:border-white/10 shadow-lg shadow-black/5 dark:shadow-black/20">
	<div class="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
		<a href="/" class="flex items-center gap-2 text-surface-900 dark:text-surface-50 font-extrabold text-xl tracking-tight no-underline group">
			<span class="text-primary-600 dark:text-primary-500 group-hover:text-primary-500 dark:group-hover:text-primary-400 transition-colors">⚡</span>
			<span class="bg-clip-text text-transparent bg-gradient-to-r from-surface-900 to-surface-500 dark:from-surface-50 dark:to-surface-300">Escalas</span>
		</a>

		{#if usuario}
			<!-- Mobile toggle -->
			<button
				class="md:hidden text-surface-200 hover:text-primary-400 transition-colors p-1"
				onclick={() => menuOpen = !menuOpen}
				aria-label="Menu"
			>
				<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					{#if menuOpen}
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					{:else}
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
					{/if}
				</svg>
			</button>

			<!-- Desktop nav -->
			<nav class="hidden md:flex items-center gap-6">
				<a href="/policiais" class="text-surface-600 dark:text-surface-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors text-sm font-medium no-underline">Policiais</a>
				<a href="/escalas" class="text-surface-600 dark:text-surface-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors text-sm font-medium no-underline">Escalas</a>
				
				<button class="btn-icon p-1 hover:bg-surface-500/10 rounded-full text-surface-600 dark:text-surface-300 transition-colors" onclick={toggleTheme} aria-label="Alternar Tema">
					{#if isDark}
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
					{:else}
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
					{/if}
				</button>

				<div class="w-px h-5 bg-surface-200 dark:bg-white/10 mx-2"></div> <!-- Divider -->
				<span class="text-surface-600 dark:text-surface-300 text-xs flex items-center gap-2">
					{usuario.nome}
					{#if usuario.tipo === 'admin'}
						<span class="badge preset-filled-primary-500 text-[0.65rem] font-semibold tracking-wider">ADMIN</span>
					{:else}
						<span class="badge bg-surface-200 dark:bg-surface-800 text-surface-900 dark:text-surface-100 border border-surface-300 dark:border-white/5 text-[0.65rem]">
							{usuario.lotacao}
						</span>
					{/if}
				</span>
				<button
					class="btn btn-sm bg-surface-200 dark:bg-surface-800 hover:bg-surface-300 dark:hover:bg-surface-700 text-surface-900 dark:text-surface-50 text-xs border border-surface-300 dark:border-white/10 transition-all font-medium"
					onclick={logout}
				>
					Sair
				</button>
			</nav>
		{/if}
	</div>

	<!-- Mobile nav -->
	{#if menuOpen && usuario}
		<nav class="md:hidden px-4 pb-4 flex flex-col gap-3 border-t border-surface-200 dark:border-white/5 pt-3 bg-surface-50/95 dark:bg-surface-950/95 backdrop-blur-xl">
			<div class="flex items-center justify-between pb-2 border-b border-surface-200 dark:border-white/5">
				<span class="text-xs font-semibold text-surface-500">Alternar Tema</span>
				<button class="btn-icon p-1 hover:bg-surface-500/10 rounded-full text-surface-600 dark:text-surface-300 transition-colors" onclick={toggleTheme} aria-label="Alternar Tema">
					{#if isDark}
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
					{:else}
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
					{/if}
				</button>
			</div>
			<a href="/policiais" class="text-surface-600 dark:text-surface-300 hover:text-primary-600 dark:hover:text-primary-400 text-sm font-medium py-1 no-underline" onclick={() => menuOpen = false}>Policiais</a>
			<a href="/escalas" class="text-surface-600 dark:text-surface-300 hover:text-primary-600 dark:hover:text-primary-400 text-sm font-medium py-1 no-underline" onclick={() => menuOpen = false}>Escalas</a>
			<div class="flex items-center gap-2 pt-3 mt-1 border-t border-white/5">
				<span class="text-surface-300 text-xs font-medium">
					{usuario.nome}
					{#if usuario.tipo === 'admin'}
						<span class="badge preset-filled-primary-500 text-[0.65rem] ml-1">ADMIN</span>
					{/if}
				</span>
				<button
					class="btn btn-sm bg-surface-800 hover:bg-surface-700 text-surface-50 text-xs border border-white/10 ml-auto"
					onclick={logout}
				>
					Sair
				</button>
			</div>
		</nav>
	{/if}
</header>
{/if}

<main class="max-w-6xl mx-auto px-4 pt-8 pb-12 min-h-[calc(100vh-80px)]">
	<div class="animate-in fade-in duration-500">
		{@render children()}
	</div>
</main>
