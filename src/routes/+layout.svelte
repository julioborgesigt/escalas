<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';
	import { AppBar } from '@skeletonlabs/skeleton-svelte';

	let { children } = $props();

	const usuario = $derived($page.data.usuario);
	let menuOpen = $state(false);

	async function logout() {
		await fetch('/api/auth/logout', { method: 'POST' });
		window.location.href = '/login';
	}
</script>

<svelte:head>
	<title>Escalas de Plantão Policial</title>
</svelte:head>

<!-- Navbar Glassmorphism -->
<header class="sticky top-0 z-50 bg-surface-950/70 backdrop-blur-lg border-b border-white/10 shadow-lg shadow-black/20">
	<div class="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
		<a href="/" class="flex items-center gap-2 text-surface-50 font-extrabold text-xl tracking-tight no-underline group">
			<span class="text-primary-500 group-hover:text-primary-400 transition-colors">⚡</span>
			<span class="bg-clip-text text-transparent bg-gradient-to-r from-surface-50 to-surface-300">Escalas</span>
		</a>

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
			<a href="/policiais" class="text-surface-300 hover:text-primary-400 transition-colors text-sm font-medium no-underline">Policiais</a>
			<a href="/escalas" class="text-surface-300 hover:text-primary-400 transition-colors text-sm font-medium no-underline">Escalas</a>
			{#if usuario}
				<div class="w-px h-5 bg-white/10 mx-2"></div> <!-- Divider -->
				<span class="text-surface-300 text-xs flex items-center gap-2">
					{usuario.nome}
					{#if usuario.tipo === 'admin'}
						<span class="badge preset-filled-primary-500 text-[0.65rem] font-semibold tracking-wider">ADMIN</span>
					{:else}
						<span class="badge bg-surface-800 text-surface-100 border border-white/5 text-[0.65rem]">
							{usuario.lotacao}
						</span>
					{/if}
				</span>
				<button
					class="btn btn-sm bg-surface-800 hover:bg-surface-700 text-surface-50 text-xs border border-white/10 transition-all font-medium"
					onclick={logout}
				>
					Sair
				</button>
			{/if}
		</nav>
	</div>

	<!-- Mobile nav -->
	{#if menuOpen}
		<nav class="md:hidden px-4 pb-4 flex flex-col gap-3 border-t border-white/5 pt-3 bg-surface-950/95 backdrop-blur-xl">
			<a href="/policiais" class="text-surface-300 hover:text-primary-400 text-sm font-medium py-1 no-underline" onclick={() => menuOpen = false}>Policiais</a>
			<a href="/escalas" class="text-surface-300 hover:text-primary-400 text-sm font-medium py-1 no-underline" onclick={() => menuOpen = false}>Escalas</a>
			{#if usuario}
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
			{/if}
		</nav>
	{/if}
</header>

<main class="max-w-6xl mx-auto px-4 pt-8 pb-12 min-h-[calc(100vh-80px)]">
	<div class="animate-in fade-in duration-500">
		{@render children()}
	</div>
</main>
