<script lang="ts">
	import { page } from '$app/stores';
	import { toaster } from '$lib/toast';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import type { Escala, Policial, EscalaPolicialComDados } from '$lib/types';

	const horas = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));

	let escala = $state<Escala | null>(null);
	let policiaisEscala = $state<EscalaPolicialComDados[]>([]);
	let todosOsPoliciais = $state<Policial[]>([]);
	let loading = $state(true);

	let dpcId = $state('');
	let oipId = $state('');
	let policialId = $derived(dpcId || oipId);
	let dataPlantao = $state('');
	let adding = $state(false);

	let dialogOpen = $state(false);
	let policialParaRemover = $state<{itemId: number, nome: string} | null>(null);

	let editingId = $state<number | null>(null);
	let editDataEntrada = $state('');
	let editDataSaida = $state('');
	let editEntrada = $state('');
	let editSaida = $state('');

	function formatarData(dateStr: string): string {
		if (!dateStr) return '';
		const [year, month, day] = dateStr.split('-');
		return `${day}/${month}/${year}`;
	}

	function proximoDia(dateStr: string): string {
		const d = new Date(dateStr + 'T00:00:00');
		d.setDate(d.getDate() + 1);
		return d.toISOString().split('T')[0];
	}

	function getHoraEntrada(p: EscalaPolicialComDados): string {
		return p.hora_entrada || escala?.hora_entrada || '08';
	}

	function getHoraSaida(p: EscalaPolicialComDados): string {
		return p.hora_saida || escala?.hora_saida || '08';
	}

	function getDataSaida(p: EscalaPolicialComDados): string {
		if (p.data_saida) return p.data_saida;
		const he = Number(getHoraEntrada(p));
		const hs = Number(getHoraSaida(p));
		if (hs <= he) return proximoDia(p.data_plantao);
		return p.data_plantao;
	}

	function formatarHorario(p: EscalaPolicialComDados): string {
		return `${getHoraEntrada(p)}H A ${getHoraSaida(p)}H`;
	}

	function formatarDataPlantao(p: EscalaPolicialComDados): string {
		const dataEntrada = formatarData(p.data_plantao);
		const dataSaida = getDataSaida(p);
		if (dataSaida !== p.data_plantao) {
			return `${dataEntrada} à ${formatarData(dataSaida)}`;
		}
		return dataEntrada;
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

	function calcularDataSaidaInicial(dataEntrada: string, horaEntrada: string, horaSaida: string): string {
		const he = Number(horaEntrada);
		const hs = Number(horaSaida);
		if (hs <= he) return proximoDia(dataEntrada);
		return dataEntrada;
	}

	async function carregar() {
		const id = $page.params.id;
		loading = true;

		const [escalaRes, policiaisRes, todosRes] = await Promise.all([
			fetch(`/api/escalas`).then(r => r.json()),
			fetch(`/api/escalas/${id}/policiais`).then(r => r.json()),
			fetch('/api/policiais?todos=1').then(r => r.json())
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

		const he = escala?.hora_entrada || '08';
		const hs = escala?.hora_saida || '08';
		const ds = calcularDataSaidaInicial(dataPlantao, he, hs);

		const res = await fetch(`/api/escalas/${$page.params.id}/policiais`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				policial_id: Number(policialId),
				data_plantao: dataPlantao,
				data_saida: ds,
				hora_entrada: he,
				hora_saida: hs
			})
		});

		if (res.ok) {
			toaster.create({ title: 'Policial adicionado à escala', type: 'success' });
			dpcId = '';
			oipId = '';
			carregar();
		} else {
			toaster.create({ title: 'Erro ao adicionar', type: 'error' });
		}
		adding = false;
	}

	function startEdit(p: EscalaPolicialComDados) {
		editingId = p.id;
		editDataEntrada = p.data_plantao;
		editDataSaida = getDataSaida(p);
		editEntrada = getHoraEntrada(p);
		editSaida = getHoraSaida(p);
	}

	function editPreviewData(): string {
		if (!editDataEntrada) return '';
		const de = formatarData(editDataEntrada);
		if (editDataSaida && editDataSaida !== editDataEntrada) {
			return `${de} à ${formatarData(editDataSaida)}`;
		}
		return de;
	}

	async function salvarEdicao(itemId: number) {
		const res = await fetch(`/api/escalas/${$page.params.id}/policiais`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				item_id: itemId,
				data_plantao: editDataEntrada,
				data_saida: editDataSaida,
				hora_entrada: editEntrada,
				hora_saida: editSaida
			})
		});

		if (res.ok) {
			editingId = null;
			carregar();
		}
	}

	function cancelEdit() {
		editingId = null;
	}

	function solicitarRemocao(itemId: number, nome: string) {
		policialParaRemover = { itemId, nome };
		dialogOpen = true;
	}

	async function confirmarRemocao() {
		if (!policialParaRemover) return;
		
		const itemId = policialParaRemover.itemId;
		const nome = policialParaRemover.nome;
		dialogOpen = false;

		const res = await fetch(`/api/escalas/${$page.params.id}/policiais?item_id=${itemId}`, { method: 'DELETE' });
		if (res.ok) {
			toaster.create({ title: `${nome} removido da escala`, type: 'success' });
			carregar();
		}
		policialParaRemover = null;
	}

	function download(format: string) {
		window.open(`/api/escalas/${$page.params.id}/download?format=${format}`, '_blank');
	}

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
	<p class="text-center py-12 text-surface-500">Carregando...</p>
{:else if !escala}
	<div class="text-center py-12 text-surface-500"><p>Escala não encontrada.</p></div>
{:else}
	<div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-6">
		<div>
			<h1 class="h1 text-lg sm:text-xl font-bold">{escala.titulo}</h1>
			<p class="text-surface-500 text-sm mt-1">
				{escala.cidade} &bull; {formatarData(escala.data_inicio)} a {formatarData(escala.data_fim)} &bull; {escala.hora_entrada || '08'}H a {escala.hora_saida || '08'}H
			</p>
		</div>
		<a href="/escalas" class="btn preset-outlined-primary-500 shrink-0">Voltar</a>
	</div>

	<Dialog open={dialogOpen} onOpenChange={(e) => dialogOpen = e.open}>
		<Dialog.Content class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm">
			<div class="card p-6 max-w-sm w-full bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10">
				<Dialog.Title class="h3 font-bold mb-2">Remover Policial?</Dialog.Title>
				<Dialog.Description class="text-surface-600 dark:text-surface-400 mb-6">
					Tem certeza que deseja remover o policial "{policialParaRemover?.nome}" desta escala?
				</Dialog.Description>
				<div class="flex justify-end gap-3">
					<Dialog.CloseTrigger class="btn preset-outlined-surface">Cancelar</Dialog.CloseTrigger>
					<button class="btn preset-filled-error-500" onclick={confirmarRemocao}>Remover</button>
				</div>
			</div>
		</Dialog.Content>
	</Dialog>

	<!-- Export buttons -->
	{#if policiaisEscala.length > 0}
		<div class="card p-4 mb-4">
			<h3 class="font-semibold text-sm mb-3">Exportar Escala</h3>
			<div class="flex gap-2 flex-wrap">
				<button class="btn btn-sm preset-filled-primary-500" onclick={() => download('docx')}>Word (.docx)</button>
				<button class="btn btn-sm preset-filled-primary-500" onclick={() => download('odt')}>ODT (.odt)</button>
				<button class="btn btn-sm preset-filled-primary-500" onclick={() => download('xlsx')}>Excel (.xlsx)</button>
				<button class="btn btn-sm preset-filled-primary-500" onclick={() => download('ods')}>ODS (.ods)</button>
				<button class="btn btn-sm preset-filled-primary-500" onclick={() => download('pdf')}>PDF (.pdf)</button>
			</div>
		</div>
	{/if}

	<!-- Add form -->
	<div class="card p-4 sm:p-6 mb-4">
		<h3 class="font-semibold text-sm mb-3">Adicionar DPC/OIP à Escala</h3>
		<form onsubmit={adicionar}>
			<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
				<label class="label">
					<span class="label-text">Delegado</span>
					<select class="select" bind:value={dpcId} onchange={() => { if (dpcId) oipId = ''; }}>
						<option value="">Selecione...</option>
						{#each todosOsPoliciais.filter(p => p.cargo === 'DPC').sort((a, b) => a.nome.localeCompare(b.nome)) as p}
							<option value={String(p.id)}>{p.nome} - {p.lotacao}</option>
						{/each}
					</select>
				</label>
				<label class="label">
					<span class="label-text">Oficial Investigador</span>
					<select class="select" bind:value={oipId} onchange={() => { if (oipId) dpcId = ''; }}>
						<option value="">Selecione...</option>
						{#each todosOsPoliciais.filter(p => p.cargo === 'OIP').sort((a, b) => a.nome.localeCompare(b.nome)) as p}
							<option value={String(p.id)}>{p.nome} - {p.lotacao}</option>
						{/each}
					</select>
				</label>
				<label class="label">
					<span class="label-text">Data do plantão</span>
					<select class="select" bind:value={dataPlantao} required>
						{#each datasDoPlantao(escala) as d}
							<option value={d}>{formatarData(d)}</option>
						{/each}
					</select>
				</label>
				<div>
					<button type="submit" class="btn preset-filled-primary-500 w-full sm:w-auto" disabled={adding || !policialId}>
						{adding ? 'Adicionando...' : 'Adicionar'}
					</button>
				</div>
			</div>
		</form>
	</div>

	<!-- Policiais list -->
	{#if policiaisEscala.length === 0}
		<div class="card p-8 text-center text-surface-500">
			<p>Nenhum policial na escala. Adicione policiais acima.</p>
		</div>
	{:else}
		{#each [...agruparPorData(policiaisEscala)] as [, policiais]}
			<!-- Desktop table -->
			<div class="card p-0 overflow-hidden mb-4 hidden md:block">
				<div class="table-wrap">
					<table class="table">
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
									<td>
										<span class="badge text-xs {p.cargo === 'DPC' ? 'preset-filled-primary-500' : 'preset-filled-warning-500'}">{p.cargo}</span>
									</td>
									<td>{p.telefone}</td>
									<td>{p.lotacao}</td>
									{#if editingId === p.id}
										<td colspan="2" class="bg-surface-200 dark:bg-surface-800 rounded-lg">
											<div class="flex flex-col gap-2 py-1">
												<div class="flex items-center gap-2">
													<span class="text-xs font-semibold text-surface-500 w-14">Entrada:</span>
													<input type="date" bind:value={editDataEntrada} class="input text-sm flex-1 min-w-[120px]" />
													<select bind:value={editEntrada} class="select text-sm w-16">
														{#each horas as h}<option value={h}>{h}h</option>{/each}
													</select>
												</div>
												<div class="flex items-center gap-2">
													<span class="text-xs font-semibold text-surface-500 w-14">Saída:</span>
													<input type="date" bind:value={editDataSaida} class="input text-sm flex-1 min-w-[120px]" />
													<select bind:value={editSaida} class="select text-sm w-16">
														{#each horas as h}<option value={h}>{h}h</option>{/each}
													</select>
												</div>
												<p class="text-xs text-surface-500 italic">{editPreviewData()} &bull; {editEntrada}H A {editSaida}H</p>
												<div class="flex gap-1">
													<button class="btn btn-sm preset-filled-primary-500" onclick={() => salvarEdicao(p.id)}>Salvar</button>
													<button class="btn btn-sm preset-outlined-primary-500" onclick={cancelEdit}>Cancelar</button>
												</div>
											</div>
										</td>
									{:else}
										<td>
											<button class="border border-dashed border-surface-300 rounded px-2 py-1 text-sm w-full text-center hover:border-primary-500 hover:bg-surface-100 transition-colors" onclick={() => startEdit(p)} title="Clique para editar">
												{formatarDataPlantao(p)}
											</button>
										</td>
										<td>
											<button class="border border-dashed border-surface-300 rounded px-2 py-1 text-sm w-full text-center hover:border-primary-500 hover:bg-surface-100 transition-colors" onclick={() => startEdit(p)} title="Clique para editar">
												{formatarHorario(p)}
											</button>
										</td>
									{/if}
									<td>
										<button class="btn btn-sm preset-filled-error-500" onclick={() => solicitarRemocao(p.id, p.nome)}>Remover</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>

			<!-- Mobile cards -->
			<div class="md:hidden space-y-3 mb-4">
				{#each policiais as p}
					<div class="card border border-surface-200 p-4">
						<div class="flex items-center justify-between mb-2">
							<span class="font-semibold text-sm">{p.nome}</span>
							<span class="badge text-xs {p.cargo === 'DPC' ? 'preset-filled-primary-500' : 'preset-filled-warning-500'}">{p.cargo}</span>
						</div>
						<div class="space-y-1 text-sm text-surface-600 mb-3">
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
								<span>{p.lotacao}</span>
							</div>
						</div>

						{#if editingId === p.id}
							<div class="bg-surface-200 dark:bg-surface-800 rounded-lg p-3 space-y-2 mb-3">
								<div class="grid grid-cols-2 gap-2">
									<label class="label">
										<span class="label-text text-xs">Data entrada</span>
										<input type="date" bind:value={editDataEntrada} class="input text-sm" />
									</label>
									<label class="label">
										<span class="label-text text-xs">Hora entrada</span>
										<select bind:value={editEntrada} class="select text-sm">
											{#each horas as h}<option value={h}>{h}h</option>{/each}
										</select>
									</label>
								</div>
								<div class="grid grid-cols-2 gap-2">
									<label class="label">
										<span class="label-text text-xs">Data saída</span>
										<input type="date" bind:value={editDataSaida} class="input text-sm" />
									</label>
									<label class="label">
										<span class="label-text text-xs">Hora saída</span>
										<select bind:value={editSaida} class="select text-sm">
											{#each horas as h}<option value={h}>{h}h</option>{/each}
										</select>
									</label>
								</div>
								<p class="text-xs text-surface-500 italic">{editPreviewData()} &bull; {editEntrada}H A {editSaida}H</p>
								<div class="flex gap-2">
									<button class="btn btn-sm preset-filled-primary-500" onclick={() => salvarEdicao(p.id)}>Salvar</button>
									<button class="btn btn-sm preset-outlined-primary-500" onclick={cancelEdit}>Cancelar</button>
								</div>
							</div>
						{:else}
							<div class="flex gap-2 mb-3">
								<button class="flex-1 border border-dashed border-surface-300 rounded px-2 py-2 text-sm text-center hover:border-primary-500 transition-colors" onclick={() => startEdit(p)}>
									{formatarDataPlantao(p)}
								</button>
								<button class="flex-1 border border-dashed border-surface-300 rounded px-2 py-2 text-sm text-center hover:border-primary-500 transition-colors" onclick={() => startEdit(p)}>
									{formatarHorario(p)}
								</button>
							</div>
						{/if}

						<div class="flex justify-end">
							<button class="btn btn-sm preset-filled-error-500" onclick={() => solicitarRemocao(p.id, p.nome)}>Remover</button>
						</div>
					</div>
				{/each}
			</div>
		{/each}
	{/if}
{/if}
