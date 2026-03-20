<script lang="ts">
	import { page } from '$app/state';
	import { toaster } from '$lib/toast';
	import { Dialog, Popover, Portal } from '@skeletonlabs/skeleton-svelte';
	import type { Escala } from '$lib/types';

	let escalas = $state<Escala[]>([]);
	let loading = $state(true);
	let saving = $state(false);
	let filtroLotacao = $state('');
	let lotacoes = $state<string[]>([]);

	let dialogOpen = $state(false);
	let escalaParaExcluir = $state<{id: number, titulo: string} | null>(null);

	const isAdmin = $derived(page.data.usuario?.tipo === 'admin');

	function formatarData(dateStr: string): string {
		const [year, month, day] = dateStr.split('-');
		return `${day}/${month}/${year}`;
	}

	async function carregar() {
		if (isAdmin && !filtroLotacao) {
			escalas = [];
			loading = false;
			return;
		}

		loading = true;
		const params = filtroLotacao ? `?lotacao=${encodeURIComponent(filtroLotacao)}` : '';
		const res = await fetch(`/api/escalas${params}`);
		escalas = await res.json();
		loading = false;
	}

	async function carregarLotacoes() {
		const res = await fetch('/api/lotacoes');
		lotacoes = await res.json();
	}

	function solicitarExclusao(id: number, titulo: string) {
		escalaParaExcluir = { id, titulo };
		dialogOpen = true;
	}

	async function confirmarExclusao() {
		if (!escalaParaExcluir) return;
		
		const id = escalaParaExcluir.id;
		const titulo = escalaParaExcluir.titulo;
		dialogOpen = false;

		const res = await fetch(`/api/escalas?id=${id}`, { method: 'DELETE' });
		if (res.ok) {
			toaster.create({ title: `Escala de ${titulo} removida`, type: 'success' });
			escalas = escalas.filter(e => e.id !== id);
		} else {
			toaster.create({ title: 'Erro ao remover', type: 'error' });
		}
		escalaParaExcluir = null;
	}

	$effect(() => {
		carregar();
		carregarLotacoes();
	});

	$effect(() => {
		filtroLotacao;
		carregar();
	});
</script>

<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
	<h1 class="h1 text-xl font-bold">Escalas de Plantão</h1>
	<a href="/escalas/nova" class="btn preset-filled-primary-500">Nova Escala</a>
</div>

<Dialog open={dialogOpen} onOpenChange={(e) => dialogOpen = e.open}>
	<Dialog.Content class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm">
		<div class="card p-6 max-w-sm w-full bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10">
			<Dialog.Title class="h3 font-bold mb-2">Excluir Escala?</Dialog.Title>
			<Dialog.Description class="text-surface-600 dark:text-surface-400 mb-6">
				Tem certeza que deseja excluir a escala "{escalaParaExcluir?.titulo}"? Esta ação não pode ser desfeita.
			</Dialog.Description>
			<div class="flex justify-end gap-3">
				<Dialog.CloseTrigger class="btn preset-outlined-surface">Cancelar</Dialog.CloseTrigger>
				<button class="btn preset-filled-error-500" onclick={confirmarExclusao}>Excluir</button>
			</div>
		</div>
	</Dialog.Content>
</Dialog>

<div class="p-6 rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20 overflow-hidden mt-6">
	{#if isAdmin}
		<div class="flex flex-col sm:flex-row sm:items-end gap-4 mb-8 p-6 rounded-2xl bg-surface-100/30 dark:bg-surface-800/20 border border-surface-200 dark:border-white/5">
			<label class="label flex-1 max-w-sm">
				<span class="label-text font-semibold mb-1">Unidade de Lotação</span>
				<select class="select" bind:value={filtroLotacao}>
					<option value="">Selecione uma unidade...</option>
					{#each lotacoes as lot (lot)}
						<option value={lot}>{lot}</option>
					{/each}
				</select>
			</label>
			<p class="text-xs text-surface-500 mb-2 italic">Selecione uma unidade para visualizar as escalas dela.</p>
		</div>
	{/if}

	{#if loading}
		<p class="text-center py-12 text-surface-500">Carregando...</p>
	{:else if isAdmin && !filtroLotacao}
		<div class="text-center py-20">
			<div class="bg-surface-200/50 dark:bg-surface-800/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 grayscale opacity-50">
				<svg class="w-8 h-8 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
			</div>
			<p class="text-surface-600 dark:text-surface-400 text-lg">Escolha uma unidade para exibir os dados.</p>
		</div>
	{:else if escalas.length === 0}
		<div class="text-center py-12 text-surface-500">
			<p class="mb-4">Nenhuma escala criada para esta unidade.</p>
			<a href="/escalas/nova" class="btn preset-filled-primary-500">Criar Escala</a>
		</div>
	{:else}
		<!-- Desktop: tabela -->
		<div class="hidden md:block table-wrap">
			<table class="table">
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
					{#each escalas as esc (esc.id)}
						<tr>
							<td><a href="/escalas/{esc.id}" class="anchor">{esc.titulo}</a></td>
							<td>{esc.cidade}</td>
							<td class="whitespace-nowrap">{formatarData(esc.data_inicio)} a {formatarData(esc.data_fim)}</td>
							<td>{esc.horario}</td>
							<td>
								<div class="flex gap-2 justify-end">
									<a href="/escalas/{esc.id}" class="btn btn-sm preset-filled-surface hover:preset-filled-primary-500 transition-colors">Abrir</a>
									<Popover positioning={{ placement: "bottom-end", offset: { mainAxis: 4 } }}>
										<Popover.Trigger class="btn btn-sm preset-outlined-primary-500">Exportar ▾</Popover.Trigger>
										<Portal>
											<Popover.Positioner class="z-50">
												<Popover.Content class="card p-1 bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-white/10 shadow-xl flex flex-col min-w-[160px]">
													<button class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors" onclick={() => window.open(`/api/escalas/${esc.id}/download?format=docx`, '_blank')}>Word (.docx)</button>
													<button class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors" onclick={() => window.open(`/api/escalas/${esc.id}/download?format=odt`, '_blank')}>ODT (.odt)</button>
													<button class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors" onclick={() => window.open(`/api/escalas/${esc.id}/download?format=excel`, '_blank')}>Excel (.xlsx)</button>
													<button class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors" onclick={() => window.open(`/api/escalas/${esc.id}/download?format=ods`, '_blank')}>ODS (.ods)</button>
													<button class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors" onclick={() => window.open(`/api/escalas/${esc.id}/download?format=pdf`, '_blank')}>PDF (.pdf)</button>
												</Popover.Content>
											</Popover.Positioner>
										</Portal>
									</Popover>
									<button class="btn btn-sm preset-filled-error-500" onclick={() => solicitarExclusao(esc.id, esc.titulo)}>Excluir</button>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Mobile: cards -->
		<div class="md:hidden space-y-3">
			{#each escalas as esc (esc.id)}
				<div class="p-4 rounded-2xl bg-surface-100/50 dark:bg-surface-800/50 border border-surface-200 dark:border-white/10 hover:border-primary-500/30 transition-colors">
					<a href="/escalas/{esc.id}" class="anchor font-semibold text-sm block mb-3 text-primary-600 dark:text-primary-400 no-underline hover:text-primary-500 dark:hover:text-primary-300">{esc.titulo}</a>
					<div class="space-y-1 mb-3 text-sm">
						<div class="flex justify-between">
							<span class="text-surface-500 font-medium">Cidade</span>
							<span class="text-surface-900 dark:text-surface-100">{esc.cidade}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-surface-500 font-medium">Período</span>
							<span class="text-surface-900 dark:text-surface-100">{formatarData(esc.data_inicio)} a {formatarData(esc.data_fim)}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-surface-500 font-medium">Horário</span>
							<span class="text-surface-900 dark:text-surface-100">{esc.horario}</span>
						</div>
					</div>
					<div class="flex gap-2 pt-3 border-t border-white/5">
						<a href="/escalas/{esc.id}" class="btn btn-sm preset-outlined-primary-500 hover:bg-primary-500/10 transition-colors">Abrir</a>
						<Popover positioning={{ placement: "bottom-end", offset: { mainAxis: 4 } }}>
							<Popover.Trigger class="btn btn-sm preset-outlined-primary-500 hover:bg-primary-500/10">Exportar ▾</Popover.Trigger>
							<Portal>
								<Popover.Positioner class="z-50">
									<Popover.Content class="card p-1 bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-white/10 shadow-xl flex flex-col min-w-[160px]">
										<button class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors" onclick={() => window.open(`/api/escalas/${esc.id}/download?format=docx`, '_blank')}>Word (.docx)</button>
										<button class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors" onclick={() => window.open(`/api/escalas/${esc.id}/download?format=odt`, '_blank')}>ODT (.odt)</button>
										<button class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors" onclick={() => window.open(`/api/escalas/${esc.id}/download?format=excel`, '_blank')}>Excel (.xlsx)</button>
										<button class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors" onclick={() => window.open(`/api/escalas/${esc.id}/download?format=ods`, '_blank')}>ODS (.ods)</button>
										<button class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors" onclick={() => window.open(`/api/escalas/${esc.id}/download?format=pdf`, '_blank')}>PDF (.pdf)</button>
									</Popover.Content>
								</Popover.Positioner>
							</Portal>
						</Popover>
						<button class="btn btn-sm preset-filled-error-500 hover:-translate-y-0.5 transition-all" onclick={() => solicitarExclusao(esc.id, esc.titulo)}>Excluir</button>
					</div>
				</div>
			{/each}
		</div>
		<p class="mt-3 text-surface-500 text-sm hidden md:block">{escalas.length} escala(s) encontrada(s)</p>
	{/if}
</div>
