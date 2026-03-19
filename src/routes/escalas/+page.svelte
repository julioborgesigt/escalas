<script lang="ts">
	import { page } from '$app/stores';
	import { toaster } from '$lib/toast';
	import { Dialog, Popover } from '@skeletonlabs/skeleton-svelte';
	import type { Escala } from '$lib/types';

	let escalas = $state<Escala[]>([]);
	let loading = $state(true);
	let saving = $state(false);

	let dialogOpen = $state(false);
	let escalaParaExcluir = $state<{id: number, titulo: string} | null>(null);

	const usuario = $derived($page.data.usuario);
	const isAdmin = $derived(usuario?.tipo === 'admin');

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
			carregar();
		} else {
			toaster.create({ title: 'Erro ao remover', type: 'error' });
		}
		escalaParaExcluir = null;
	}

	$effect(() => {
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

<div class="p-6 rounded-3xl bg-surface-900/60 backdrop-blur-md border border-white/5 shadow-xl shadow-black/20 overflow-hidden mt-6">
	{#if loading}
		<p class="text-center py-8 text-surface-500">Carregando...</p>
	{:else if escalas.length === 0}
		<div class="text-center py-12 text-surface-500">
			<p class="mb-4">Nenhuma escala criada.</p>
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
					{#each escalas as esc}
						<tr>
							<td><a href="/escalas/{esc.id}" class="anchor">{esc.titulo}</a></td>
							<td>{esc.cidade}</td>
							<td class="whitespace-nowrap">{formatarData(esc.data_inicio)} a {formatarData(esc.data_fim)}</td>
							<td>{esc.horario}</td>
							<td>
								<div class="flex gap-2 justify-end">
									<a href="/escalas/{esc.id}" class="btn btn-sm preset-filled-surface hover:preset-filled-primary-500 transition-colors">Abrir</a>
									<Popover positioning={{ placement: "bottom-end" }}>
										<Popover.Trigger class="btn btn-sm preset-outlined-primary-500">Exportar ▾</Popover.Trigger>
										<Popover.Content class="card p-2 bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-white/10 shadow-2xl flex flex-col gap-1 min-w-[150px] z-50">
											<Popover.Arrow />
											<button class="w-full text-left px-3 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors" onclick={() => window.open(`/api/escalas/${esc.id}/export?format=pdf`, '_blank')}>Exportar PDF</button>
											<button class="w-full text-left px-3 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors" onclick={() => window.open(`/api/escalas/${esc.id}/export?format=excel`, '_blank')}>Exportar Excel</button>
										</Popover.Content>
									</Popover>
									{#if isAdmin}
										<button class="btn btn-sm preset-filled-error-500" onclick={() => solicitarExclusao(esc.id, esc.titulo)}>Excluir</button>
									{/if}
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Mobile: cards -->
		<div class="md:hidden space-y-3">
			{#each escalas as esc}
				<div class="p-4 rounded-2xl bg-surface-800/50 border border-white/10 hover:border-primary-500/30 transition-colors">
					<a href="/escalas/{esc.id}" class="anchor font-semibold text-sm block mb-3 text-primary-400 no-underline hover:text-primary-300">{esc.titulo}</a>
					<div class="space-y-1 mb-3 text-sm">
						<div class="flex justify-between">
							<span class="text-surface-500 font-medium">Cidade</span>
							<span class="text-surface-100">{esc.cidade}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-surface-500 font-medium">Período</span>
							<span class="text-surface-100">{formatarData(esc.data_inicio)} a {formatarData(esc.data_fim)}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-surface-500 font-medium">Horário</span>
							<span class="text-surface-100">{esc.horario}</span>
						</div>
					</div>
					<div class="flex gap-2 pt-3 border-t border-white/5">
						<a href="/escalas/{esc.id}" class="btn btn-sm preset-outlined-primary-500 hover:bg-primary-500/10 transition-colors">Abrir</a>
						<Popover positioning={{ placement: "bottom-end" }}>
							<Popover.Trigger class="btn btn-sm preset-outlined-primary-500 hover:bg-primary-500/10">Exportar ▾</Popover.Trigger>
							<Popover.Content class="card p-2 bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-white/10 shadow-2xl flex flex-col gap-1 min-w-[150px] z-50">
								<Popover.Arrow />
								<button class="w-full text-left px-3 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors" onclick={() => window.open(`/api/escalas/${esc.id}/export?format=pdf`, '_blank')}>Exportar PDF</button>
								<button class="w-full text-left px-3 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors" onclick={() => window.open(`/api/escalas/${esc.id}/export?format=excel`, '_blank')}>Exportar Excel</button>
							</Popover.Content>
						</Popover>
						{#if isAdmin}
							<button class="btn btn-sm preset-filled-error-500 hover:-translate-y-0.5 transition-all" onclick={() => solicitarExclusao(esc.id, esc.titulo)}>Excluir</button>
						{/if}
					</div>
				</div>
			{/each}
		</div>
		<p class="mt-3 text-surface-500 text-sm hidden md:block">{escalas.length} escala(s) encontrada(s)</p>
	{/if}
</div>
