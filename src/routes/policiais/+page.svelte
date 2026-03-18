<script lang="ts">
	import type { Policial } from '$lib/types';

	let policiais = $state<Policial[]>([]);
	let loading = $state(true);
	let message = $state('');
	let messageType = $state<'success' | 'error'>('success');
	let filtroLotacao = $state('');
	let lotacoes = $state<string[]>([]);

	async function carregarPoliciais() {
		loading = true;
		const params = filtroLotacao ? `?lotacao=${encodeURIComponent(filtroLotacao)}` : '';
		const res = await fetch(`/api/policiais${params}`);
		policiais = await res.json();
		loading = false;
	}

	async function carregarLotacoes() {
		const res = await fetch('/api/policiais');
		const todos: Policial[] = await res.json();
		lotacoes = [...new Set(todos.map(p => p.lotacao))].sort();
	}

	async function excluir(id: number, nome: string) {
		if (!confirm(`Excluir ${nome}?`)) return;
		const res = await fetch(`/api/policiais/${id}`, { method: 'DELETE' });
		if (res.ok) {
			message = `${nome} excluído com sucesso`;
			messageType = 'success';
			carregarPoliciais();
		} else {
			message = 'Erro ao excluir';
			messageType = 'error';
		}
	}

	$effect(() => {
		carregarPoliciais();
		carregarLotacoes();
	});

	$effect(() => {
		filtroLotacao;
		carregarPoliciais();
	});
</script>

<div class="page-header">
	<h1>Policiais Cadastrados</h1>
	<div class="actions">
		<a href="/policiais/upload" class="btn btn-outline">Importar Planilha</a>
		<a href="/policiais/novo" class="btn btn-primary">Novo Policial</a>
	</div>
</div>

{#if message}
	<div class="alert alert-{messageType}">{message}</div>
{/if}

<div class="card">
	<div class="form-group" style="max-width: 300px; margin-bottom: 1rem;">
		<label for="filtro">Filtrar por lotação</label>
		<select id="filtro" bind:value={filtroLotacao}>
			<option value="">Todas</option>
			{#each lotacoes as lot}
				<option value={lot}>{lot}</option>
			{/each}
		</select>
	</div>

	{#if loading}
		<p style="text-align: center; padding: 2rem; color: var(--text-light);">Carregando...</p>
	{:else if policiais.length === 0}
		<div class="empty-state">
			<p>Nenhum policial cadastrado.</p>
			<a href="/policiais/novo" class="btn btn-primary">Cadastrar Policial</a>
		</div>
	{:else}
		<div style="overflow-x: auto;">
			<table>
				<thead>
					<tr>
						<th>Nome</th>
						<th>Matrícula</th>
						<th>Cargo</th>
						<th>Telefone</th>
						<th>Lotação</th>
						<th>Ações</th>
					</tr>
				</thead>
				<tbody>
					{#each policiais as p}
						<tr>
							<td>{p.nome}</td>
							<td>{p.matricula}</td>
							<td><span class="badge badge-{p.cargo.toLowerCase()}">{p.cargo}</span></td>
							<td>{p.telefone}</td>
							<td>{p.lotacao}</td>
							<td class="actions">
								<a href="/policiais/{p.id}" class="btn btn-outline btn-sm">Editar</a>
								<button class="btn btn-danger btn-sm" onclick={() => excluir(p.id, p.nome)}>Excluir</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p style="margin-top: 0.75rem; color: var(--text-light); font-size: 0.85rem;">{policiais.length} policial(is) encontrado(s)</p>
	{/if}
</div>
