<script lang="ts">
	import { page } from '$app/state';
	import { toaster } from '$lib/toast';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import type { Unidade } from '$lib/types';

	const isAdmin = $derived(page.data.usuario?.tipo === 'admin');

	let unidades = $state<Unidade[]>([]);
	let loading = $state(true);
	let novoNome = $state('');
	let salvando = $state(false);

	let dialogOpen = $state(false);
	let unidadeParaExcluir = $state<{ id: number; nome: string } | null>(null);

	async function carregarUnidades() {
		loading = true;
		const res = await fetch('/api/unidades');
		unidades = await res.json();
		loading = false;
	}

	async function salvarUnidade(e: Event) {
		e.preventDefault();
		if (!novoNome.trim()) return;
		salvando = true;

		const res = await fetch('/api/unidades', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ nome: novoNome.trim() })
		});

		if (res.ok) {
			toaster.create({ title: 'Unidade cadastrada com sucesso!', type: 'success' });
			novoNome = '';
			await carregarUnidades();
		} else {
			const data = await res.json();
			toaster.create({ title: data.error || 'Erro ao cadastrar unidade', type: 'error' });
		}
		salvando = false;
	}

	function solicitarExclusao(id: number, nome: string) {
		unidadeParaExcluir = { id, nome };
		dialogOpen = true;
	}

	async function confirmarExclusao() {
		if (!unidadeParaExcluir) return;
		const { id, nome } = unidadeParaExcluir;
		dialogOpen = false;

		const res = await fetch(`/api/unidades/${id}`, { method: 'DELETE' });
		if (res.ok) {
			toaster.create({ title: `Unidade "${nome}" removida com sucesso`, type: 'success' });
			unidades = unidades.filter(u => u.id !== id);
		} else {
			const data = await res.json();
			toaster.create({ title: data.error || 'Erro ao remover unidade', type: 'error' });
		}
		unidadeParaExcluir = null;
	}

	$effect(() => {
		carregarUnidades();
	});
</script>

<div class="flex items-center justify-between mb-6">
	<h1 class="h1 text-xl font-bold">Unidades Policiais</h1>
</div>

<Dialog open={dialogOpen} onOpenChange={(e) => dialogOpen = e.open}>
	<Dialog.Content class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm">
		<div class="card p-6 max-w-sm w-full bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10">
			<Dialog.Title class="h3 font-bold mb-2">Excluir Unidade?</Dialog.Title>
			<Dialog.Description class="text-surface-600 dark:text-surface-400 mb-6">
				Tem certeza que deseja excluir a unidade "{unidadeParaExcluir?.nome}"? Esta ação não afeta os policiais já lotados nela.
			</Dialog.Description>
			<div class="flex justify-end gap-3">
				<Dialog.CloseTrigger class="btn preset-outlined-surface">Cancelar</Dialog.CloseTrigger>
				<button class="btn preset-filled-error-500" onclick={confirmarExclusao}>Excluir</button>
			</div>
		</div>
	</Dialog.Content>
</Dialog>

{#if isAdmin}
	<div class="p-6 rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20 mb-6">
		<h2 class="font-semibold text-base mb-4">Cadastrar Nova Unidade</h2>
		<form onsubmit={salvarUnidade} class="flex flex-col sm:flex-row gap-3">
			<input
				class="input flex-1"
				type="text"
				bind:value={novoNome}
				placeholder="Ex: Delegacia de Polícia Civil de Icó"
				required
			/>
			<button type="submit" class="btn preset-filled-primary-500 shrink-0" disabled={salvando || !novoNome.trim()}>
				{salvando ? 'Salvando...' : 'Cadastrar'}
			</button>
		</form>
	</div>
{/if}

<div class="p-6 rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20 overflow-hidden">
	{#if loading}
		<p class="text-center py-12 text-surface-500">Carregando...</p>
	{:else if unidades.length === 0}
		<div class="text-center py-20">
			<div class="bg-surface-200/50 dark:bg-surface-800/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 grayscale opacity-50">
				<svg class="w-8 h-8 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
			</div>
			<p class="text-surface-600 dark:text-surface-400 text-lg">Nenhuma unidade cadastrada.</p>
			{#if isAdmin}
				<p class="text-surface-500 text-sm mt-2">Cadastre unidades acima para habilitar a importação de policiais.</p>
			{/if}
		</div>
	{:else}
		<!-- Desktop table -->
		<div class="hidden md:block table-wrap">
			<table class="table">
				<thead>
					<tr>
						<th>Nome da Unidade</th>
						<th>Cadastrada em</th>
						{#if isAdmin}<th>Ações</th>{/if}
					</tr>
				</thead>
				<tbody>
					{#each unidades as u (u.id)}
						<tr>
							<td class="font-medium">{u.nome}</td>
							<td class="text-surface-500 text-sm">{new Date(u.created_at).toLocaleDateString('pt-BR')}</td>
							{#if isAdmin}
								<td>
									<button class="btn btn-sm preset-filled-error-500" onclick={() => solicitarExclusao(u.id, u.nome)}>Excluir</button>
								</td>
							{/if}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Mobile cards -->
		<div class="md:hidden space-y-3">
			{#each unidades as u (u.id)}
				<div class="p-4 rounded-2xl bg-surface-100/50 dark:bg-surface-800/50 border border-surface-200 dark:border-white/10">
					<div class="flex items-center justify-between gap-3">
						<div class="min-w-0">
							<p class="font-semibold text-sm truncate">{u.nome}</p>
							<p class="text-xs text-surface-500 mt-0.5">Cadastrada em {new Date(u.created_at).toLocaleDateString('pt-BR')}</p>
						</div>
						{#if isAdmin}
							<button class="btn btn-sm preset-filled-error-500 shrink-0" onclick={() => solicitarExclusao(u.id, u.nome)}>Excluir</button>
						{/if}
					</div>
				</div>
			{/each}
		</div>

		<p class="mt-3 text-surface-500 text-sm">{unidades.length} unidade{unidades.length !== 1 ? 's' : ''} cadastrada{unidades.length !== 1 ? 's' : ''}</p>
	{/if}
</div>
