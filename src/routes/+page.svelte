<div class="home">
	<h1>Sistema de Escalas de Plantão</h1>
	<p>Gerencie policiais e escalas de plantão de forma simples e rápida.</p>

	<div class="cards">
		<a href="/policiais" class="home-card">
			<h2>Policiais</h2>
			<p>Cadastre e gerencie delegados e oficiais investigadores de polícia.</p>
		</a>
		<a href="/escalas" class="home-card">
			<h2>Escalas</h2>
			<p>Crie escalas de plantão e exporte em diversos formatos.</p>
		</a>
	</div>
</div>

<style>
	.home {
		text-align: center;
		padding: 3rem 0;
	}
	.home h1 {
		font-size: 2rem;
		margin-bottom: 0.5rem;
		color: var(--primary-dark);
	}
	.home > p {
		color: var(--text-light);
		margin-bottom: 2rem;
	}
	.cards {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.5rem;
		max-width: 700px;
		margin: 0 auto;
	}
	.home-card {
		background: var(--card-bg);
		border-radius: 8px;
		padding: 2rem 1.5rem;
		box-shadow: 0 1px 3px rgba(0,0,0,0.1);
		transition: transform 0.2s, box-shadow 0.2s;
		text-decoration: none;
	}
	.home-card:hover {
		transform: translateY(-2px);
		box-shadow: 0 4px 12px rgba(0,0,0,0.15);
		text-decoration: none;
	}
	.home-card h2 {
		color: var(--primary);
		margin-bottom: 0.5rem;
	}
	.home-card p {
		color: var(--text-light);
		font-size: 0.9rem;
	}
	@media (max-width: 600px) {
		.cards { grid-template-columns: 1fr; }
	}
</style>
