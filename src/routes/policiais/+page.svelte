<script lang="ts">
	import type { Policial, Unidade } from '$lib/types';
	import { page } from '$app/state';
	import { toaster } from '$lib/toast';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';

	const isAdmin = $derived(page.data.usuario?.tipo === 'admin');

	let policiais = $state<Policial[]>([]);
	let loading = $state(true);
	let filtroLotacao = $state('');
	let filtroCargo = $state('');
	let filtroSeccional = $state<number | 'todas'>('todas');
	let filtroBusca = $state('');
	let unidades = $state<Unidade[]>([]);

	$effect(() => {
		// Reset lotacao when seccional changes
		if (filtroSeccional) {
			filtroLotacao = '';
			// We might want to call carregarPoliciais() here? Yes, because clearing it removes the filter.
			// Actually the select handles onchange={carregarPoliciais}. We don't need to do it here manually 
			// if it triggers an onchange, but wait, $effect running will just update state. 
			// Just clearing the 'filtroLotacao' won't fetch. We can trigger `carregarPoliciais()` manually.
		}
	});

	const seccionais = $derived(unidades.filter(u => u.tipo === 'seccional'));
	const delegaciasDropdown = $derived(
		filtroSeccional === 'todas'
			? unidades.filter(u => u.tipo === 'delegacia')
			: unidades.filter(u => u.tipo === 'delegacia' && u.seccional_id === filtroSeccional)
	);

	let dialogOpen = $state(false);
	let policialParaExcluir = $state<{id: number, nome: string} | null>(null);

	// Special sentinel value for "sem lotação" filter
	const SEM_LOTACAO = '__sem_lotacao__';

	const policiaisExibidos = $derived(
		policiais.filter(p => {
			if (filtroCargo && p.cargo !== filtroCargo) return false;
			if (filtroBusca && !p.nome.toLowerCase().includes(filtroBusca.toLowerCase())) return false;
			return true;
		})
	);

	async function carregarPoliciais() {
		if (isAdmin && !filtroLotacao) {
			policiais = [];
			loading = false;
			return;
		}

		loading = true;
		let params = '';
		if (filtroLotacao === SEM_LOTACAO) {
			params = '?sem_lotacao=1';
		} else if (filtroLotacao) {
			params = `?lotacao=${encodeURIComponent(filtroLotacao)}`;
		}
		const res = await fetch(`/api/policiais${params}`);
		policiais = await res.json();
		loading = false;
	}

	async function carregarUnidades() {
		const res = await fetch('/api/unidades');
		unidades = await res.json();
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
			policiais = policiais.filter(p => p.id !== id);
		} else {
			const data = await res.json();
			toaster.create({ title: data.error || 'Erro ao remover', type: 'error' });
		}
		policialParaExcluir = null;
	}

	$effect(() => {
		carregarPoliciais();
		carregarUnidades();
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

<div class="p-6 rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20 overflow-hidden mt-6">
	<div class="flex flex-col sm:flex-row sm:items-end gap-4 mb-8 p-6 rounded-2xl bg-surface-100/30 dark:bg-surface-800/20 border border-surface-200 dark:border-white/10">
		{#if isAdmin}
			<label class="label flex-1 max-w-sm">
				<span class="label-text font-semibold mb-1">Seccional</span>
				<select class="select" bind:value={filtroSeccional} onchange={() => { filtroLotacao = ''; carregarPoliciais(); }}>
					<option value="todas">Todas as Seccionais</option>
					{#each seccionais as sec (sec.id)}
						<option value={sec.id}>{sec.nome}</option>
					{/each}
				</select>
			</label>
			<label class="label flex-1 max-w-sm">
				<span class="label-text font-semibold mb-1">Unidade de Lotação</span>
				<select class="select" bind:value={filtroLotacao} onchange={carregarPoliciais}>
					<option value="">Selecione uma unidade...</option>
					{#each delegaciasDropdown as del (del.id)}
						<option value={del.nome}>{del.nome}</option>
					{/each}
					<option value={SEM_LOTACAO}>— Sem lotação —</option>
				</select>
			</label>
		{/if}
		<label class="label w-full sm:w-48 shrink-0">
			<span class="label-text font-semibold mb-1">Cargo</span>
			<select class="select" bind:value={filtroCargo}>
				<option value="">Todos</option>
				<option value="DPC">DPC — Delegado</option>
				<option value="OIP">OIP — Oficial Investigador</option>
			</select>
		</label>

		<label class="label flex-1 min-w-[200px]">
			<span class="label-text font-semibold mb-1">Buscar por Nome</span>
			<div class="relative">
				<input type="text" class="input pl-10" bind:value={filtroBusca} placeholder="Digite um nome..." />
				<div class="absolute inset-y-0 left-3 flex items-center pointer-events-none opacity-50">
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
				</div>
			</div>
		</label>
		{#if isAdmin}
			<p class="text-xs text-surface-500 mb-2 italic self-end">Selecione uma unidade para visualizar os policiais cadastrados nela.</p>
		{/if}
	</div>

	{#if loading}
		<p class="text-center py-12 text-surface-500">Carregando...</p>
	{:else if isAdmin && !filtroLotacao}
		<div class="text-center py-20">
			<div class="bg-surface-200/50 dark:bg-surface-800/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 grayscale opacity-50">
				<svg class="w-8 h-8 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
			</div>
			<p class="text-surface-600 dark:text-surface-400 text-lg">Escolha uma unidade para exibir os dados.</p>
		</div>
	{:else if policiaisExibidos.length === 0}
		<div class="text-center py-12 text-surface-500">
			<p class="mb-4">{filtroCargo ? `Nenhum policial com cargo ${filtroCargo} encontrado.` : 'Nenhum policial cadastrado.'}</p>
			{#if !filtroCargo}
				<a href="/policiais/novo" class="btn preset-filled-primary-500">Cadastrar Policial</a>
			{/if}
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
					{#each policiaisExibidos as p (p.id)}
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
			{#each policiaisExibidos as p (p.id)}
				<div class="p-4 rounded-2xl bg-surface-100/50 dark:bg-surface-800/50 border border-surface-200 dark:border-white/10 hover:border-primary-500/30 transition-colors">
					<div class="flex items-center justify-between mb-2">
						<span class="font-semibold text-sm">{p.nome}</span>
						<span class="badge text-xs {p.cargo === 'DPC' ? 'preset-filled-primary-500' : 'preset-filled-warning-500'}">{p.cargo}</span>
					</div>
					<div class="space-y-1 text-sm mb-3">
						<div class="flex justify-between">
							<span class="text-surface-500">Matrícula</span>
							<span class="text-surface-900 dark:text-surface-100">{p.matricula}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-surface-500">Telefone</span>
							<span class="text-surface-900 dark:text-surface-100">{p.telefone}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-surface-500">Lotação</span>
							<span class="text-right text-surface-900 dark:text-surface-100">{p.lotacao}</span>
						</div>
					</div>
					<div class="flex gap-2 pt-3 border-t border-surface-200 dark:border-white/5">
						<a href="/policiais/{p.id}" class="btn btn-sm preset-outlined-primary-500 hover:bg-primary-500/10 hover:-translate-y-0.5 transition-all">Editar</a>
						<button class="btn btn-sm preset-filled-error-500 hover:-translate-y-0.5 transition-all" onclick={() => solicitarExclusao(p.id, p.nome)}>Excluir</button>
					</div>
				</div>
			{/each}
		</div>

		<p class="mt-3 text-surface-500 text-sm">{policiaisExibidos.length} policial(is) encontrado(s)</p>
	{/if}
</div>
