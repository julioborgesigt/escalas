<script lang="ts">
	import { page } from '$app/stores';
	import type { Escala, Policial, EscalaPolicialComDados } from '$lib/types';

	let escala = $state<Escala | null>(null);
	let policiaisEscala = $state<EscalaPolicialComDados[]>([]);
	let todosOsPoliciais = $state<Policial[]>([]);
	let loading = $state(true);
	let message = $state('');
	let messageType = $state<'success' | 'error'>('success');

	// Form de adicionar
	let policialId = $state('');
	let dataPlantao = $state('');
	let adding = $state(false);

	// Horário em edição
	let editingHorarioId = $state<number | null>(null);
	let editingHorarioValue = $state('');

	function formatarData(dateStr: string): string {
		const [year, month, day] = dateStr.split('-');
		return `${day}/${month}/${year}`;
	}

	function datasDoPlantao(escala: Escala): string[] {
		const datas: string[] = [];
		const inicio = new Date(escala.data_inicio + 'T00:00:00');
		const fim = new Date(escala.data_fim + 'T00:00:00');
		const current = new Date(inicio);
		while (current <= fim) {
			datas.push(current.toISOString().split('T')[0]);
			current.setDate(current.getDate() + 1);
		}
		return datas;
	}

	function getHorarioDisplay(p: EscalaPolicialComDados): string {
		return p.horario || escala?.horario || '';
	}

	async function carregar() {
		const id = $page.params.id;
		loading = true;

		const [escalaRes, policiaisRes, todosRes] = await Promise.all([
			fetch(`/api/escalas`).then(r => r.json()),
			fetch(`/api/escalas/${id}/policiais`).then(r => r.json()),
			fetch('/api/policiais').then(r => r.json())
		]);

		escala = (escalaRes as Escala[]).find((e: Escala) => e.id === Number(id)) || null;
		policiaisEscala = policiaisRes;
		todosOsPoliciais = todosRes;

		if (escala && !dataPlantao) {
			dataPlantao = escala.data_inicio;
		}
		loading = false;
	}

	async function adicionar(e: Event) {
		e.preventDefault();
		if (!policialId || !dataPlantao) return;
		adding = true;

		const res = await fetch(`/api/escalas/${$page.params.id}/policiais`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				policial_id: Number(policialId),
				data_plantao: dataPlantao,
				horario: escala?.horario || ''
			})
		});

		if (res.ok) {
			message = 'Policial adicionado à escala';
			messageType = 'success';
			policialId = '';
			carregar();
		} else {
			message = 'Erro ao adicionar';
			messageType = 'error';
		}
		adding = false;
	}

	function startEditHorario(item: EscalaPolicialComDados) {
		editingHorarioId = item.id;
		editingHorarioValue = item.horario || escala?.horario || '';
	}

	async function salvarHorario(itemId: number) {
		const res = await fetch(`/api/escalas/${$page.params.id}/policiais`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ item_id: itemId, horario: editingHorarioValue })
		});

		if (res.ok) {
			editingHorarioId = null;
			carregar();
		}
	}

	function cancelEditHorario() {
		editingHorarioId = null;
	}

	function handleHorarioKeydown(e: KeyboardEvent, itemId: number) {
		if (e.key === 'Enter') {
			e.preventDefault();
			salvarHorario(itemId);
		} else if (e.key === 'Escape') {
			cancelEditHorario();
		}
	}

	async function remover(itemId: number, nome: string) {
		if (!confirm(`Remover ${nome} desta escala?`)) return;
		const res = await fetch(`/api/escalas/${$page.params.id}/policiais?item_id=${itemId}`, { method: 'DELETE' });
		if (res.ok) {
			message = `${nome} removido da escala`;
			messageType = 'success';
			carregar();
		}
	}

	function download(format: string) {
		window.open(`/api/escalas/${$page.params.id}/download?format=${format}`, '_blank');
	}

	// Group by date for display
	function agruparPorData(items: EscalaPolicialComDados[]): Map<string, EscalaPolicialComDados[]> {
		const map = new Map<string, EscalaPolicialComDados[]>();
		for (const item of items) {
			const list = map.get(item.data_plantao) || [];
			list.push(item);
			map.set(item.data_plantao, list);
		}
		return new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
	}

	$effect(() => { carregar(); });
</script>

{#if loading}
	<p style="text-align: center; padding: 3rem; color: var(--text-light);">Carregando...</p>
{:else if !escala}
	<div class="empty-state"><p>Escala não encontrada.</p></div>
{:else}
	<div class="page-header">
		<div>
			<h1>{escala.titulo}</h1>
			<p style="color: var(--text-light); font-size: 0.9rem;">
				{escala.cidade} &bull; {formatarData(escala.data_inicio)} a {formatarData(escala.data_fim)} &bull; {escala.horario}
			</p>
		</div>
		<a href="/escalas" class="btn btn-outline">Voltar</a>
	</div>

	{#if message}
		<div class="alert alert-{messageType}">{message}</div>
	{/if}

	<!-- Download buttons -->
	{#if policiaisEscala.length > 0}
		<div class="card">
			<h3 style="margin-bottom: 0.75rem; font-size: 1rem;">Exportar Escala</h3>
			<div class="actions" style="flex-wrap: wrap;">
				<button class="btn btn-primary btn-sm" onclick={() => download('docx')}>Word (.docx)</button>
				<button class="btn btn-primary btn-sm" onclick={() => download('odt')}>ODT (.odt)</button>
				<button class="btn btn-primary btn-sm" onclick={() => download('xlsx')}>Excel (.xlsx)</button>
				<button class="btn btn-primary btn-sm" onclick={() => download('ods')}>ODS (.ods)</button>
				<button class="btn btn-primary btn-sm" onclick={() => download('pdf')}>PDF (.pdf)</button>
			</div>
		</div>
	{/if}

	<!-- Add policial to escala -->
	<div class="card">
		<h3 style="margin-bottom: 0.75rem; font-size: 1rem;">Adicionar Policial à Escala</h3>
		<form onsubmit={adicionar}>
			<div class="form-row" style="grid-template-columns: 1fr 1fr auto; align-items: end;">
				<div class="form-group">
					<label for="policial">Policial</label>
					<select id="policial" bind:value={policialId} required>
						<option value="">Selecione...</option>
						{#each todosOsPoliciais as p}
							<option value={String(p.id)}>{p.nome} ({p.cargo}) - {p.lotacao}</option>
						{/each}
					</select>
				</div>
				<div class="form-group">
					<label for="data_plantao">Data do plantão</label>
					<select id="data_plantao" bind:value={dataPlantao} required>
						{#each datasDoPlantao(escala) as d}
							<option value={d}>{formatarData(d)}</option>
						{/each}
					</select>
				</div>
				<div class="form-group">
					<button type="submit" class="btn btn-primary" disabled={adding}>
						{adding ? 'Adicionando...' : 'Adicionar'}
					</button>
				</div>
			</div>
		</form>
	</div>

	<!-- Schedule preview -->
	{#if policiaisEscala.length === 0}
		<div class="card empty-state">
			<p>Nenhum policial na escala. Adicione policiais acima.</p>
		</div>
	{:else}
		{#each [...agruparPorData(policiaisEscala)] as [data, policiais]}
			<div class="card" style="padding: 0; overflow: hidden;">
				<div style="overflow-x: auto;">
					<table>
						<thead>
							<tr>
								<th>Equipe de Plantão da DP</th>
								<th>Matrícula</th>
								<th>Cargo</th>
								<th>Telefone</th>
								<th>Lotação</th>
								<th>Data</th>
								<th>Horário</th>
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
									<td>{formatarData(data)}</td>
									<td class="horario-cell">
										{#if editingHorarioId === p.id}
											<div class="horario-edit">
												<input
													type="text"
													bind:value={editingHorarioValue}
													onkeydown={(e) => handleHorarioKeydown(e, p.id)}
													class="horario-input"
													autofocus
												/>
												<button class="btn btn-primary btn-xs" onclick={() => salvarHorario(p.id)} title="Salvar">OK</button>
												<button class="btn btn-outline btn-xs" onclick={cancelEditHorario} title="Cancelar">X</button>
											</div>
										{:else}
											<button class="horario-btn" onclick={() => startEditHorario(p)} title="Clique para editar o horário">
												{getHorarioDisplay(p)}
											</button>
										{/if}
									</td>
									<td>
										<button class="btn btn-danger btn-sm" onclick={() => remover(p.id, p.nome)}>Remover</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/each}
	{/if}
{/if}

<style>
	@media (max-width: 768px) {
		.form-row {
			grid-template-columns: 1fr !important;
		}
	}

	.horario-cell {
		min-width: 140px;
	}

	.horario-btn {
		background: none;
		border: 1px dashed var(--border, #cbd5e1);
		border-radius: 4px;
		padding: 0.25rem 0.5rem;
		cursor: pointer;
		font-size: 0.85rem;
		color: var(--text, #1e293b);
		transition: all 0.15s;
		width: 100%;
		text-align: center;
	}

	.horario-btn:hover {
		border-color: var(--primary, #1a365d);
		background: var(--bg-light, #f1f5f9);
	}

	.horario-edit {
		display: flex;
		gap: 0.25rem;
		align-items: center;
	}

	.horario-input {
		width: 100px;
		padding: 0.2rem 0.4rem;
		font-size: 0.85rem;
		border: 1px solid var(--primary, #1a365d);
		border-radius: 4px;
	}

	:global(.btn-xs) {
		padding: 0.15rem 0.4rem !important;
		font-size: 0.75rem !important;
		line-height: 1.2 !important;
	}
</style>
