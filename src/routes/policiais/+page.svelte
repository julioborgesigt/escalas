<script lang="ts">
	import type { Policial } from '$lib/types';
	import { page } from '$app/stores';

	const usuario = $derived($page.data.usuario);
	const isAdmin = $derived(usuario?.tipo === 'admin');

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

<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
	<h1 class="h1 text-xl font-bold">Policiais Cadastrados</h1>
	<div class="flex gap-2">
		<a href="/policiais/upload" class="btn preset-outlined-primary-500">Importar Planilha</a>
		<a href="/policiais/novo" class="btn preset-filled-primary-500">Novo Policial</a>
	</div>
</div>

{#if message}
	<aside class="p-3 rounded-lg text-sm mb-4 {messageType === 'success' ? 'preset-tonal-success' : 'preset-filled-error-500'}">{message}</aside>
{/if}

<div class="card p-4 sm:p-6">
	{#if isAdmin}
		<label class="label max-w-xs mb-4">
			<span class="label-text">Filtrar por lotação</span>
			<select class="select" bind:value={filtroLotacao}>
				<option value="">Todas</option>
				{#each lotacoes as lot}
					<option value={lot}>{lot}</option>
				{/each}
			</select>
		</label>
	{/if}

	{#if loading}
		<p class="text-center py-8 text-surface-500">Carregando...</p>
	{:else if policiais.length === 0}
		<div class="text-center py-12 text-surface-500">
			<p class="mb-4">Nenhum policial cadastrado.</p>
			<a href="/policiais/novo" class="btn preset-filled-primary-500">Cadastrar Policial</a>
		</div>
	{:else}
		<!-- Desktop table -->
		<div class="hidden md:block table-wrap">
			<table class="table">
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
							<td>
								<span class="badge text-xs {p.cargo === 'DPC' ? 'preset-filled-primary-500' : 'preset-filled-warning-500'}">{p.cargo}</span>
							</td>
							<td>{p.telefone}</td>
							<td>{p.lotacao}</td>
							<td>
								<div class="flex gap-2">
									<a href="/policiais/{p.id}" class="btn btn-sm preset-outlined-primary-500">Editar</a>
									<button class="btn btn-sm preset-filled-error-500" onclick={() => excluir(p.id, p.nome)}>Excluir</button>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Mobile cards -->
		<div class="md:hidden space-y-3">
			{#each policiais as p}
				<div class="card border border-surface-200 p-4">
					<div class="flex items-center justify-between mb-2">
						<span class="font-semibold text-sm">{p.nome}</span>
						<span class="badge text-xs {p.cargo === 'DPC' ? 'preset-filled-primary-500' : 'preset-filled-warning-500'}">{p.cargo}</span>
					</div>
					<div class="space-y-1 text-sm mb-3">
						<div class="flex justify-between">
							<span class="text-surface-500">Matrícula</span>
							<span>{p.matricula}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-surface-500">Telefone</span>
							<span>{p.telefone}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-surface-500">Lotação</span>
							<span class="text-right">{p.lotacao}</span>
						</div>
					</div>
					<div class="flex gap-2 pt-3 border-t border-surface-200">
						<a href="/policiais/{p.id}" class="btn btn-sm preset-outlined-primary-500">Editar</a>
						<button class="btn btn-sm preset-filled-error-500" onclick={() => excluir(p.id, p.nome)}>Excluir</button>
					</div>
				</div>
			{/each}
		</div>

		<p class="mt-3 text-surface-500 text-sm">{policiais.length} policial(is) encontrado(s)</p>
	{/if}
</div>
