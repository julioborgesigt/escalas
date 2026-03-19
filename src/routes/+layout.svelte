<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';

	let { children } = $props();

	const usuario = $derived($page.data.usuario);

	async function logout() {
		await fetch('/api/auth/logout', { method: 'POST' });
		window.location.href = '/login';
	}
</script>

<svelte:head>
	<title>Escalas de Plantão Policial</title>
</svelte:head>

<nav class="navbar">
	<div class="container nav-content">
		<a href="/" class="nav-brand">Escalas de Plantão</a>
		<div class="nav-links">
			<a href="/policiais">Policiais</a>
			<a href="/escalas">Escalas</a>
			{#if usuario}
				<span class="nav-user">
					{usuario.nome}
					{#if usuario.tipo === 'admin'}
						<span class="badge-admin">Admin</span>
					{:else}
						<span class="badge-lotacao">{usuario.lotacao}</span>
					{/if}
				</span>
				<button class="nav-logout" onclick={logout}>Sair</button>
			{/if}
		</div>
	</div>
</nav>

<main class="container" style="padding-top: 1.5rem; padding-bottom: 2rem;">
	{@render children()}
</main>

<style>
	.navbar {
		background: var(--primary);
		color: white;
		padding: 0.75rem 0;
		box-shadow: 0 2px 4px rgba(0,0,0,0.1);
	}
	.nav-content {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.nav-brand {
		color: white;
		font-weight: 700;
		font-size: 1.1rem;
	}
	.nav-brand:hover {
		text-decoration: none;
	}
	.nav-links {
		display: flex;
		gap: 1.5rem;
		align-items: center;
	}
	.nav-links a {
		color: rgba(255,255,255,0.85);
		font-size: 0.9rem;
		font-weight: 500;
	}
	.nav-links a:hover {
		color: white;
		text-decoration: none;
	}
	.nav-user {
		color: rgba(255,255,255,0.7);
		font-size: 0.8rem;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.badge-admin {
		background: #f59e0b;
		color: #1a1a2e;
		font-size: 0.65rem;
		font-weight: 700;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
	}
	.badge-lotacao {
		background: rgba(255,255,255,0.15);
		font-size: 0.65rem;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
		color: rgba(255,255,255,0.8);
	}
	.nav-logout {
		background: rgba(255,255,255,0.15);
		border: none;
		color: white;
		padding: 0.3rem 0.75rem;
		border-radius: 4px;
		font-size: 0.8rem;
		cursor: pointer;
		transition: background 0.2s;
	}
	.nav-logout:hover {
		background: rgba(255,255,255,0.25);
	}

	@media (max-width: 768px) {
		.nav-content {
			flex-direction: column;
			gap: 0.5rem;
		}
		.nav-links {
			gap: 0.75rem;
			flex-wrap: wrap;
			justify-content: center;
		}
	}
</style>
