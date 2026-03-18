<script lang="ts">
	import '../app.css';
	let { children } = $props();
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
</style>
