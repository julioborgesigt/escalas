<script lang="ts">
	import type { Escala } from '$lib/types';

	let escalas = $state<Escala[]>([]);
	let loading = $state(true);
	let message = $state('');
	let exportMenuId = $state<number | null>(null);
	let exportMenuPos = $state({ top: 0, left: 0 });

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

	function download(id: number, format: string) {
		window.open(`/api/escalas/${id}/download?format=${format}`, '_blank');
		exportMenuId = null;
	}

	function toggleExportMenu(id: number, e: MouseEvent) {
		if (exportMenuId === id) {
			exportMenuId = null;
			return;
		}
		const btn = e.currentTarget as HTMLElement;
		const rect = btn.getBoundingClientRect();
		exportMenuPos = { top: rect.bottom + 4, left: rect.left };
		exportMenuId = id;
	}

	$effect(() => { carregar(); });
</script>

<svelte:window onclick={(e) => {
	if (!(e.target as HTMLElement).closest('.export-wrapper')) exportMenuId = null;
}} />

<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
	<h1 class="h1 text-xl font-bold">Escalas de Plantão</h1>
	<a href="/escalas/nova" class="btn preset-filled-primary-500">Nova Escala</a>
</div>

{#if message}
	<aside class="preset-tonal-success p-3 rounded-lg text-sm mb-4">{message}</aside>
{/if}

<div class="p-6 rounded-3xl bg-surface-900/60 backdrop-blur-md border border-white/5 shadow-xl shadow-black/20">
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
								<div class="flex gap-2 items-center flex-wrap">
									<a href="/escalas/{esc.id}" class="btn btn-sm preset-outlined-primary-500">Gerenciar</a>
									<div class="export-wrapper relative inline-block">
										<button class="btn btn-sm preset-outlined-primary-500" onclick={(e) => toggleExportMenu(esc.id, e)}>Exportar ▾</button>
									</div>
									<button class="btn btn-sm preset-filled-error-500" onclick={() => excluir(esc.id, esc.titulo)}>Excluir</button>
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
					<div class="flex gap-2 flex-wrap pt-3 border-t border-white/5">
						<a href="/escalas/{esc.id}" class="btn btn-sm preset-outlined-primary-500 hover:bg-primary-500/10 hover:-translate-y-0.5 transition-all">Gerenciar</a>
						<div class="export-wrapper relative inline-block">
							<button class="btn btn-sm preset-outlined-primary-500 hover:bg-primary-500/10" onclick={(e) => toggleExportMenu(esc.id, e)}>Exportar ▾</button>
						</div>
						<button class="btn btn-sm preset-filled-error-500 hover:-translate-y-0.5 transition-all" onclick={() => excluir(esc.id, esc.titulo)}>Excluir</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

{#if exportMenuId !== null}
	{@const escId = exportMenuId}
	<div class="fixed z-50 bg-surface-900 border border-white/10 rounded-xl shadow-2xl shadow-black/50 min-w-[150px] overflow-hidden backdrop-blur-xl" style="top: {exportMenuPos.top}px; left: {exportMenuPos.left}px;">
		<button class="block w-full px-4 py-2 text-left text-sm text-surface-200 hover:bg-primary-500/20 hover:text-primary-100 transition-colors" onclick={() => download(escId, 'docx')}>Word (.docx)</button>
		<button class="block w-full px-4 py-2 text-left text-sm text-surface-200 hover:bg-primary-500/20 hover:text-primary-100 transition-colors border-t border-white/5" onclick={() => download(escId, 'odt')}>ODT (.odt)</button>
		<button class="block w-full px-4 py-2 text-left text-sm text-surface-200 hover:bg-primary-500/20 hover:text-primary-100 transition-colors border-t border-white/5" onclick={() => download(escId, 'xlsx')}>Excel (.xlsx)</button>
		<button class="block w-full px-4 py-2 text-left text-sm text-surface-200 hover:bg-primary-500/20 hover:text-primary-100 transition-colors border-t border-white/5" onclick={() => download(escId, 'ods')}>ODS (.ods)</button>
		<button class="block w-full px-4 py-2 text-left text-sm text-surface-200 hover:bg-primary-500/20 hover:text-primary-100 transition-colors border-t border-white/5" onclick={() => download(escId, 'pdf')}>PDF (.pdf)</button>
	</div>
{/if}
