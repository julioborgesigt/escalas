<script lang="ts">
	import type { Policial } from '$lib/types';
	import { page } from '$app/stores';
	import { toaster } from '$lib/toast';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';

	const usuario = $derived($page.data.usuario);
	const isAdmin = $derived(usuario?.tipo === 'admin');

	let policiais = $state<Policial[]>([]);
	let loading = $state(true);
	let filtroLotacao = $state('');
	let lotacoes = $state<string[]>([]);

	let dialogOpen = $state(false);
	let policialParaExcluir = $state<{id: number, nome: string} | null>(null);

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

	function solicitarExclusao(id: number, nome: string) {
		policialParaExcluir = { id, nome };
		dialogOpen = true;
	}

	async function confirmarExclusao() {
		if (!policialParaExcluir) return;
		
		const id = policialParaExcluir.id;
		const nome = policialParaExcluir.nome;
		dialogOpen = false;

		const res = await fetch(`/api/policiais/${id}`, { method: 'DELETE' });
		if (res.ok) {
			toaster.create({ title: `${nome} removido com sucesso`, type: 'success' });
			carregarPoliciais();
		} else {
			const data = await res.json();
			toaster.create({ title: data.error || 'Erro ao remover', type: 'error' });
		}
		policialParaExcluir = null;
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

<div class="flex items-center justify-between mb-6">
	<h1 class="h1 text-xl font-bold">Gerenciar Policiais</h1>
	<div class="flex gap-2">
		{#if isAdmin}
			<a href="/policiais/upload" class="btn preset-outlined-primary-500 hidden sm:inline-flex">Importar Excel</a>
		{/if}
		<a href="/policiais/novo" class="btn preset-filled-primary-500">Novo Policial</a>
	</div>
</div>

<Dialog open={dialogOpen} onOpenChange={(e) => dialogOpen = e.open}>
	<Dialog.Content class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm">
		<div class="card p-6 max-w-sm w-full bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10">
			<Dialog.Title class="h3 font-bold mb-2">Excluir Policial?</Dialog.Title>
			<Dialog.Description class="text-surface-600 dark:text-surface-400 mb-6">
				Tem certeza que deseja excluir o policial "{policialParaExcluir?.nome}" do sistema de cadastro?
			</Dialog.Description>
			<div class="flex justify-end gap-3">
				<Dialog.CloseTrigger class="btn preset-outlined-surface">Cancelar</Dialog.CloseTrigger>
				<button class="btn preset-filled-error-500" onclick={confirmarExclusao}>Excluir</button>
			</div>
		</div>
	</Dialog.Content>
</Dialog>

<div class="p-6 rounded-3xl bg-surface-900/60 backdrop-blur-md border border-white/5 shadow-xl shadow-black/20 overflow-hidden mt-6">
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
										<a href="/policiais/{p.id}" class="btn btn-sm preset-filled-surface hover:preset-filled-primary-500 transition-colors">Editar</a>
										<button class="btn btn-sm preset-filled-error-500" onclick={() => solicitarExclusao(p.id, p.nome)}>Excluir</button>
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
				<div class="p-4 rounded-2xl bg-surface-800/50 border border-white/10 hover:border-primary-500/30 transition-colors">
					<div class="flex items-center justify-between mb-2">
						<span class="font-semibold text-sm">{p.nome}</span>
						<span class="badge text-xs {p.cargo === 'DPC' ? 'preset-filled-primary-500' : 'preset-filled-warning-500'}">{p.cargo}</span>
					</div>
					<div class="space-y-1 text-sm mb-3">
						<div class="flex justify-between">
							<span class="text-surface-500">Matrícula</span>
							<span class="text-surface-100">{p.matricula}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-surface-500">Telefone</span>
							<span class="text-surface-100">{p.telefone}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-surface-500">Lotação</span>
							<span class="text-right text-surface-100">{p.lotacao}</span>
						</div>
					</div>
					<div class="flex gap-2 pt-3 border-t border-white/5">
						<a href="/policiais/{p.id}" class="btn btn-sm preset-outlined-primary-500 hover:bg-primary-500/10 hover:-translate-y-0.5 transition-all">Editar</a>
						<button class="btn btn-sm preset-filled-error-500 hover:-translate-y-0.5 transition-all" onclick={() => solicitarExclusao(p.id, p.nome)}>Excluir</button>
					</div>
				</div>
			{/each}
		</div>

		<p class="mt-3 text-surface-500 text-sm">{policiais.length} policial(is) encontrado(s)</p>
	{/if}
</div>
