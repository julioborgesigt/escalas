<script lang="ts">
	import type { Escala } from '$lib/types';

	let escalas = $state<Escala[]>([]);
	let loading = $state(true);
	let message = $state('');

	function formatarData(dateStr: string): string {
		const [year, month, day] = dateStr.split('-');
		return `${day}/${month}/${year}`;
	}

	async function carregar() {
		loading = true;
		const res = await fetch('/api/escalas');
		escalas = await res.json();
		loading = false;
	}

	async function excluir(id: number, titulo: string) {
		if (!confirm(`Excluir escala "${titulo}"?`)) return;
		const res = await fetch(`/api/escalas?id=${id}`, { method: 'DELETE' });
		if (res.ok) {
			message = 'Escala excluída';
			carregar();
		}
	}

	$effect(() => { carregar(); });
</script>

<div class="page-header">
	<h1>Escalas de Plantão</h1>
	<a href="/escalas/nova" class="btn btn-primary">Nova Escala</a>
</div>

{#if message}
	<div class="alert alert-success">{message}</div>
{/if}

<div class="card">
	{#if loading}
		<p style="text-align: center; padding: 2rem; color: var(--text-light);">Carregando...</p>
	{:else if escalas.length === 0}
		<div class="empty-state">
			<p>Nenhuma escala criada.</p>
			<a href="/escalas/nova" class="btn btn-primary">Criar Escala</a>
		</div>
	{:else}
		<div style="overflow-x: auto;">
			<table>
				<thead>
					<tr>
						<th>Título</th>
						<th>Cidade</th>
						<th>Período</th>
						<th>Horário</th>
						<th>Ações</th>
					</tr>
				</thead>
				<tbody>
					{#each escalas as esc}
						<tr>
							<td><a href="/escalas/{esc.id}">{esc.titulo}</a></td>
							<td>{esc.cidade}</td>
							<td>{formatarData(esc.data_inicio)} a {formatarData(esc.data_fim)}</td>
							<td>{esc.horario}</td>
							<td class="actions">
								<a href="/escalas/{esc.id}" class="btn btn-outline btn-sm">Gerenciar</a>
								<button class="btn btn-danger btn-sm" onclick={() => excluir(esc.id, esc.titulo)}>Excluir</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
