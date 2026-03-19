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

<!-- Navbar -->
<header class="preset-filled-primary-900-100">
	<div class="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
		<a href="/" class="text-white font-bold text-lg no-underline hover:no-underline">
			Escalas de Plantão
		</a>

		<!-- Mobile toggle -->
		<button
			class="md:hidden text-white p-1"
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
		<nav class="hidden md:flex items-center gap-4">
			<a href="/policiais" class="text-white/80 hover:text-white text-sm font-medium no-underline hover:no-underline">Policiais</a>
			<a href="/escalas" class="text-white/80 hover:text-white text-sm font-medium no-underline hover:no-underline">Escalas</a>
			{#if usuario}
				<span class="text-white/70 text-xs flex items-center gap-1">
					{usuario.nome}
					{#if usuario.tipo === 'admin'}
						<span class="badge preset-filled-warning-500 text-[0.65rem]">Admin</span>
					{:else}
						<span class="badge preset-tonal-surface text-[0.65rem]">
							{usuario.lotacao}
						</span>
					{/if}
				</span>
				<button
					class="btn btn-sm preset-tonal-surface text-white text-xs"
					onclick={logout}
				>
					Sair
				</button>
			{/if}
		</nav>
	</div>

	<!-- Mobile nav -->
	{#if menuOpen}
		<nav class="md:hidden px-4 pb-3 flex flex-col gap-2 border-t border-white/10 pt-2">
			<a href="/policiais" class="text-white/80 hover:text-white text-sm no-underline" onclick={() => menuOpen = false}>Policiais</a>
			<a href="/escalas" class="text-white/80 hover:text-white text-sm no-underline" onclick={() => menuOpen = false}>Escalas</a>
			{#if usuario}
				<div class="flex items-center gap-2 pt-2 border-t border-white/10">
					<span class="text-white/70 text-xs">
						{usuario.nome}
						{#if usuario.tipo === 'admin'}
							<span class="badge preset-filled-warning-500 text-[0.65rem]">Admin</span>
						{/if}
					</span>
					<button
						class="btn btn-sm preset-tonal-surface text-white text-xs ml-auto"
						onclick={logout}
					>
						Sair
					</button>
				</div>
			{/if}
		</nav>
	{/if}
</header>

<main class="max-w-6xl mx-auto px-4 pt-6 pb-8">
	{@render children()}
</main>
