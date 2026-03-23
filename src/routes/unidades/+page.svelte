<script lang="ts">
	import { page } from '$app/state';
	import { toaster } from '$lib/toast';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import type { Unidade } from '$lib/types';

	const isAdmin = $derived(page.data.usuario?.tipo === 'admin');

	let unidades = $state<Unidade[]>([]);
	let loading = $state(true);
	let novoNome = $state('');
	let novoTemPlantao = $state(false);
	let novoTemExpediente = $state(false);
	let novoTemFds = $state(false);
	let salvando = $state(false);

	// Edição inline
	let editandoId = $state<number | null>(null);
	let editNome = $state('');
	let editTemPlantao = $state(false);
	let editTemExpediente = $state(false);
	let editTemFds = $state(false);
	let salvandoEdicao = $state(false);

	// Exclusão
	let dialogOpen = $state(false);
	let unidadeParaExcluir = $state<{ id: number; nome: string } | null>(null);

	// Cadastro
	let cadastroOpen = $state(false);

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
			body: JSON.stringify({ 
				nome: novoNome.trim(),
				tem_plantao: novoTemPlantao,
				tem_expediente: novoTemExpediente,
				tem_fds: novoTemFds
			})
		});

		if (res.ok) {
			toaster.create({ title: 'Unidade cadastrada com sucesso!', type: 'success' });
			novoNome = '';
			novoTemPlantao = false;
			novoTemExpediente = false;
			novoTemFds = false;
			cadastroOpen = false;
			await carregarUnidades();
		} else {
			const data = await res.json();
			toaster.create({ title: data.error || 'Erro ao cadastrar unidade', type: 'error' });
		}
		salvando = false;
	}

	function iniciarEdicao(u: Unidade) {
		editandoId = u.id;
		editNome = u.nome;
		editTemPlantao = u.tem_plantao ?? false;
		editTemExpediente = u.tem_expediente ?? false;
		editTemFds = u.tem_fds ?? false;
	}

	function cancelarEdicao() {
		editandoId = null;
		editNome = '';
		editTemPlantao = false;
		editTemExpediente = false;
		editTemFds = false;
	}

	async function salvarEdicao(id: number) {
		if (!editNome.trim()) return;
		salvandoEdicao = true;

		const res = await fetch(`/api/unidades/${id}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ 
				nome: editNome.trim(),
				tem_plantao: editTemPlantao,
				tem_expediente: editTemExpediente,
				tem_fds: editTemFds
			})
		});

		if (res.ok) {
			toaster.create({ title: 'Unidade atualizada com sucesso!', type: 'success' });
			editandoId = null;
			await carregarUnidades();
		} else {
			const data = await res.json();
			toaster.create({ title: data.error || 'Erro ao atualizar unidade', type: 'error' });
		}
		salvandoEdicao = false;
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

	$effect(() => { carregarUnidades(); });
</script>

<div class="flex items-center justify-between mb-6">
	<h1 class="h1 text-xl font-bold">Unidades Policiais</h1>
	{#if isAdmin}
		<button class="btn preset-filled-primary-500" onclick={() => cadastroOpen = true}>
			<svg class="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
			Cadastrar
		</button>
	{/if}
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

<!-- Modal de Cadastro -->
<Dialog open={cadastroOpen} onOpenChange={(e) => { cadastroOpen = e.open; if (!e.open) { novoNome = ''; novoTemPlantao = false; novoTemExpediente = false; novoTemFds = false; } }}>
	<Dialog.Content class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm">
		<div class="card p-6 max-w-md w-full bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10">
			<Dialog.Title class="h3 font-bold mb-5">Cadastrar Nova Unidade</Dialog.Title>
			<form onsubmit={salvarUnidade} class="flex flex-col gap-4">
				<label class="label">
					<span class="label-text font-semibold mb-1">Nome da Unidade</span>
					<input
						class="input"
						type="text"
						bind:value={novoNome}
						placeholder="Ex: Delegacia de Polícia Civil de Icó"
						required
					/>
				</label>
				<div class="flex flex-wrap gap-4 p-3 bg-surface-200/50 dark:bg-surface-800/50 rounded-xl border border-surface-300 dark:border-white/5">
					<p class="w-full text-sm font-medium mb-1 text-surface-600 dark:text-surface-400">Regimes de Escala:</p>
					<label class="flex items-center space-x-2"><input class="checkbox" type="checkbox" bind:checked={novoTemPlantao} /><span>Plantão</span></label>
					<label class="flex items-center space-x-2"><input class="checkbox" type="checkbox" bind:checked={novoTemExpediente} /><span>Expediente</span></label>
					<label class="flex items-center space-x-2"><input class="checkbox" type="checkbox" bind:checked={novoTemFds} /><span>Fim de Semana</span></label>
				</div>
				<div class="flex justify-end gap-3 pt-1">
					<Dialog.CloseTrigger class="btn preset-outlined-surface">Cancelar</Dialog.CloseTrigger>
					<button type="submit" class="btn preset-filled-primary-500" disabled={salvando || !novoNome.trim()}>
						{salvando ? 'Salvando...' : 'Cadastrar'}
					</button>
				</div>
			</form>
		</div>
	</Dialog.Content>
</Dialog>


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
							<td>
								{#if isAdmin && editandoId === u.id}
									<div class="flex flex-col gap-2">
										<input
											class="input text-sm"
											type="text"
											bind:value={editNome}
											onkeydown={(e) => { if (e.key === 'Enter') salvarEdicao(u.id); if (e.key === 'Escape') cancelarEdicao(); }}
										/>
										<div class="flex flex-wrap gap-3 text-sm mt-1">
											<label class="flex items-center space-x-1.5"><input class="checkbox" type="checkbox" bind:checked={editTemPlantao} /><span>Plantão</span></label>
											<label class="flex items-center space-x-1.5"><input class="checkbox" type="checkbox" bind:checked={editTemExpediente} /><span>Expediente</span></label>
											<label class="flex items-center space-x-1.5"><input class="checkbox" type="checkbox" bind:checked={editTemFds} /><span>FDS</span></label>
										</div>
									</div>
								{:else}
									<div>
										<span class="font-medium block">{u.nome}</span>
										<div class="flex gap-1.5 mt-1.5">
											{#if u.tem_plantao}<span class="badge preset-filled-tertiary-500/20 text-tertiary-900 dark:text-tertiary-200 border border-tertiary-500/30 text-[10px] px-1.5 py-0 font-bold">Plantão</span>{/if}
											{#if u.tem_expediente}<span class="badge preset-filled-primary-500/20 text-primary-900 dark:text-primary-200 border border-primary-500/30 text-[10px] px-1.5 py-0 font-bold">Expediente</span>{/if}
											{#if u.tem_fds}<span class="badge preset-filled-warning-500/20 text-warning-900 dark:text-warning-200 border border-warning-500/30 text-[10px] px-1.5 py-0 font-bold">FDS</span>{/if}
										</div>
									</div>
								{/if}
							</td>
							<td class="text-surface-500 text-sm">{new Date(u.created_at).toLocaleDateString('pt-BR')}</td>
							{#if isAdmin}
								<td>
									{#if editandoId === u.id}
										<div class="flex gap-2">
											<button class="btn btn-sm preset-filled-primary-500" onclick={() => salvarEdicao(u.id)} disabled={salvandoEdicao || !editNome.trim()}>
												{salvandoEdicao ? 'Salvando...' : 'Salvar'}
											</button>
											<button class="btn btn-sm preset-outlined-surface" onclick={cancelarEdicao}>Cancelar</button>
										</div>
									{:else}
										<div class="flex gap-2">
											<button class="btn btn-sm preset-outlined-primary-500" onclick={() => iniciarEdicao(u)}>Editar</button>
											<button class="btn btn-sm preset-filled-error-500" onclick={() => solicitarExclusao(u.id, u.nome)}>Excluir</button>
										</div>
									{/if}
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
					{#if isAdmin && editandoId === u.id}
						<div class="space-y-2">
							<input
								class="input text-sm w-full"
								type="text"
								bind:value={editNome}
								onkeydown={(e) => { if (e.key === 'Escape') cancelarEdicao(); }}
							/>
							<div class="flex flex-wrap gap-3 text-sm py-2">
								<label class="flex items-center space-x-1.5"><input class="checkbox" type="checkbox" bind:checked={editTemPlantao} /><span>Plantão</span></label>
								<label class="flex items-center space-x-1.5"><input class="checkbox" type="checkbox" bind:checked={editTemExpediente} /><span>Expediente</span></label>
								<label class="flex items-center space-x-1.5"><input class="checkbox" type="checkbox" bind:checked={editTemFds} /><span>FDS</span></label>
							</div>
							<div class="flex gap-2">
								<button class="btn btn-sm preset-filled-primary-500 flex-1" onclick={() => salvarEdicao(u.id)} disabled={salvandoEdicao || !editNome.trim()}>
									{salvandoEdicao ? 'Salvando...' : 'Salvar'}
								</button>
								<button class="btn btn-sm preset-outlined-surface flex-1" onclick={cancelarEdicao}>Cancelar</button>
							</div>
						</div>
					{:else}
						<div class="flex items-center justify-between gap-3">
							<div class="min-w-0">
								<p class="font-semibold text-sm">{u.nome}</p>
								<div class="flex flex-wrap gap-1.5 mt-1.5 mb-1">
									{#if u.tem_plantao}<span class="badge preset-filled-tertiary-500/20 text-tertiary-900 dark:text-tertiary-200 border border-tertiary-500/30 text-[10px] px-1.5 py-0 font-bold">Plantão</span>{/if}
									{#if u.tem_expediente}<span class="badge preset-filled-primary-500/20 text-primary-900 dark:text-primary-200 border border-primary-500/30 text-[10px] px-1.5 py-0 font-bold">Expediente</span>{/if}
									{#if u.tem_fds}<span class="badge preset-filled-warning-500/20 text-warning-900 dark:text-warning-200 border border-warning-500/30 text-[10px] px-1.5 py-0 font-bold">FDS</span>{/if}
								</div>
								<p class="text-[11px] text-surface-500 mt-1">Cadastrada em {new Date(u.created_at).toLocaleDateString('pt-BR')}</p>
							</div>
							{#if isAdmin}
								<div class="flex gap-2 shrink-0">
									<button class="btn btn-sm preset-outlined-primary-500" onclick={() => iniciarEdicao(u)}>Editar</button>
									<button class="btn btn-sm preset-filled-error-500" onclick={() => solicitarExclusao(u.id, u.nome)}>Excluir</button>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>

		<p class="mt-3 text-surface-500 text-sm">{unidades.length} unidade{unidades.length !== 1 ? 's' : ''} cadastrada{unidades.length !== 1 ? 's' : ''}</p>
	{/if}
</div>
