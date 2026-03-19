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
		<div style="overflow-x: auto; overflow-y: visible; position: relative;">
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
								<div class="export-wrapper">
									<button class="btn btn-outline btn-sm" onclick={(e) => toggleExportMenu(esc.id, e)}>Exportar ▾</button>
								</div>
								<button class="btn btn-danger btn-sm" onclick={() => excluir(esc.id, esc.titulo)}>Excluir</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

{#if exportMenuId !== null}
	{@const escId = exportMenuId}
	<div class="export-menu" style="top: {exportMenuPos.top}px; left: {exportMenuPos.left}px;">
		<button onclick={() => download(escId, 'docx')}>Word (.docx)</button>
		<button onclick={() => download(escId, 'odt')}>ODT (.odt)</button>
		<button onclick={() => download(escId, 'xlsx')}>Excel (.xlsx)</button>
		<button onclick={() => download(escId, 'ods')}>ODS (.ods)</button>
		<button onclick={() => download(escId, 'pdf')}>PDF (.pdf)</button>
	</div>
{/if}

<style>
	table tbody td {
		vertical-align: top;
		padding-top: 0.75rem;
		padding-bottom: 0.75rem;
	}

	.export-wrapper {
		position: relative;
		display: inline-block;
	}

	.export-menu {
		position: fixed;
		z-index: 100;
		background: white;
		border: 1px solid var(--border);
		border-radius: 0.375rem;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		min-width: 150px;
	}

	.export-menu button {
		display: block;
		width: 100%;
		padding: 0.5rem 0.75rem;
		border: none;
		background: none;
		text-align: left;
		font-size: 0.85rem;
		cursor: pointer;
		color: var(--text);
	}

	.export-menu button:hover {
		background: #f3f4f6;
	}

	.export-menu button:first-child {
		border-radius: 0.375rem 0.375rem 0 0;
	}

	.export-menu button:last-child {
		border-radius: 0 0 0.375rem 0.375rem;
	}
</style>
