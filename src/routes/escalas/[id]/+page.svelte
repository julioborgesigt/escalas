<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import type { Policial, EscalaPolicialComDados, Escala } from '$lib/types';
	import { formatarData, proximoDia } from '$lib/utils';
	import PainelAssinaturaEscala from '$lib/components/PainelAssinaturaEscala.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import { useConfirmationDialog } from '$lib/composables';

	let { data } = $props();

	const horas = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
	const minutos = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

	const confirmDialog = useConfirmationDialog<{ itemId: number; nome: string }>();

	// Dados do server
	let escala = $derived(data.escala);
	let policiaisEscala = $derived(data.policiaisEscala as EscalaPolicialComDados[]);
	let todosOsPoliciais = $derived(data.todosPoliciais as any[]);
	let documentoAssinadoInfo = $derived(
		data.documentoAssinadoInfo
			? {
					existe: data.documentoAssinadoInfo.existe,
					assinante_nome: data.documentoAssinadoInfo.assinante_nome,
					assinante_cpf: data.documentoAssinadoInfo.assinante_cpf ?? undefined,
					data: data.documentoAssinadoInfo.data ?? undefined
				}
			: null
	);

	let cargoBusca = $state<'DPC' | 'OIP' | ''>('');
	let policialId = $state('');
	let dataPlantao = $state('');

	$effect(() => { if (escala?.data_inicio) dataPlantao = escala.data_inicio; });

	function getDaysInRange(start: string, end: string) {
		if (!start || !end) return [];
		const days = [];
		let current = new Date(start + 'T00:00:00');
		const last = new Date(end + 'T00:00:00');
		while (current <= last) {
			days.push(new Date(current).toISOString().split('T')[0]);
			current.setDate(current.getDate() + 1);
		}
		return days;
	}

	const diasEscala = $derived(escala ? getDaysInRange(escala.data_inicio, escala.data_fim) : []);
	let addHoraEntrada = $state('08');
	let addMinutoEntrada = $state('00');
	let addHoraSaida = $state('08');
	let addMinutoSaida = $state('00');
	let addEquipe = $state('1');
	let addTipoEscala = $state<'1x3' | '2x6'>('1x3');
	let addPrimeiroPlantao = $state('');
	let addDatasSelecionadas = $state<string[]>([]);

	const policialsFiltrados = $derived(
		cargoBusca
			? todosOsPoliciais
					.filter((p: any) => p.cargo && p.cargo.startsWith(cargoBusca))
					.sort((a: any, b: any) => a.nome.localeCompare(b.nome))
			: []
	);

	let editingId = $state<number | null>(null);
	let editDataEntrada = $state('');
	let editDataSaida = $state('');
	let editHoraEntrada = $state('');
	let editMinutoEntrada = $state('');
	let editHoraSaida = $state('');
	let editMinutoSaida = $state('');
	let editObservacoes = $state('');

	// Pending states
	let addingPending = $state(false);
	let plantaoPending = $state(false);
	let adicionarTodosPending = $state(false);
	let gerarProximoMesPending = $state(false);
	let editPending = $state(false);
	let removendo = $state(false);

	function getHoraEntrada(p: EscalaPolicialComDados): string {
		return p.hora_entrada || escala?.hora_entrada || '08';
	}

	function getHoraSaida(p: EscalaPolicialComDados): string {
		return p.hora_saida || escala?.hora_saida || '08';
	}

	function getDataSaida(p: EscalaPolicialComDados): string {
		if (p.data_saida) return p.data_saida;
		const he = Number(getHoraEntrada(p).split(':')[0]);
		const hs = Number(getHoraSaida(p).split(':')[0]);
		if (hs <= he) return proximoDia(p.data_plantao);
		return p.data_plantao;
	}

	function calcularDataSaidaInicial(de: string, he: string, hs: string): string {
		const hEnt = Number(he.split(':')[0]);
		const hSai = Number(hs.split(':')[0]);
		if (hSai <= hEnt) return proximoDia(de);
		return de;
	}

	const isFDS = $derived(escala?.tipo === 'fds');

	function calcularDatasPlantao(primeiroPlantao: string, tipo: '1x3' | '2x6'): string[] {
		if (!primeiroPlantao || !escala) return [];
		const datas: string[] = [];
		const inicio = new Date(escala.data_inicio + 'T00:00:00');
		const fim = new Date(escala.data_fim + 'T00:00:00');
		let d = new Date(primeiroPlantao + 'T00:00:00');
		if (tipo === '1x3') {
			while (d <= fim) {
				if (d >= inicio) datas.push(d.toISOString().split('T')[0]);
				d.setDate(d.getDate() + 4);
			}
		} else {
			while (d <= fim) {
				if (d >= inicio) datas.push(d.toISOString().split('T')[0]);
				const d2 = new Date(d);
				d2.setDate(d2.getDate() + 1);
				if (d2 <= fim && d2 >= inicio) datas.push(d2.toISOString().split('T')[0]);
				d.setDate(d.getDate() + 8);
			}
		}
		return datas;
	}

	function toggleDataPlantao(data: string) {
		const idx = addDatasSelecionadas.indexOf(data);
		if (idx >= 0) addDatasSelecionadas = addDatasSelecionadas.filter((d) => d !== data);
		else addDatasSelecionadas = [...addDatasSelecionadas, data].sort();
	}

	$effect(() => {
		addDatasSelecionadas = calcularDatasPlantao(addPrimeiroPlantao, addTipoEscala);
	});

	// ---- Computed for plantão form ----
	const datasPlantaoJson = $derived(
		JSON.stringify(
			addDatasSelecionadas.map((d) => ({
				data_plantao: d,
				data_saida: calcularDataSaidaInicial(d, `${addHoraEntrada}:${addMinutoEntrada}`, `${addHoraSaida}:${addMinutoSaida}`)
			}))
		)
	);

	// ---- Actions via use:enhance ----

	function handleAdd({ cancel }: { cancel: () => void }) {
		if (!policialId) { cancel(); return; }
		addingPending = true;
		return async ({ result, update }: any) => {
			addingPending = false;
			if (result.type === 'success') {
				toaster.create({ title: 'Policial adicionado à escala', type: 'success' });
				cargoBusca = '';
				policialId = '';
				await update({ reset: false });
			} else {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error || 'Erro ao adicionar'), type: 'error' });
			}
		};
	}

	function handlePlantao({ cancel }: { cancel: () => void }) {
		if (!policialId || addDatasSelecionadas.length === 0) { cancel(); return; }
		plantaoPending = true;
		return async ({ result, update }: any) => {
			plantaoPending = false;
			if (result.type === 'success') {
				toaster.create({ title: 'Servidor adicionado à escala de plantão', type: 'success' });
				cargoBusca = '';
				policialId = '';
				addPrimeiroPlantao = '';
				addEquipe = '1';
				addDatasSelecionadas = [];
				await update({ reset: false });
			} else {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error || 'Erro ao adicionar'), type: 'error' });
			}
		};
	}

	function handleAdicionarTodos() {
		adicionarTodosPending = true;
		return async ({ result, update }: any) => {
			adicionarTodosPending = false;
			if (result.type === 'success') {
				const d = result.data as Record<string, unknown>;
				if (Number(d.quantidade) === 0)
					toaster.create({ title: 'Todos os servidores já estão na escala', type: 'warning' });
				else toaster.create({ title: `${d.quantidade} servidor(es) adicionado(s)`, type: 'success' });
				await update({ reset: false });
			} else {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error || 'Erro'), type: 'error' });
			}
		};
	}

	function handleGerarProximoMes() {
		gerarProximoMesPending = true;
		return async ({ result }: any) => {
			gerarProximoMesPending = false;
			const d = result.data as Record<string, unknown> | undefined;
			if (result.type === 'success') {
				const tipo = escala?.tipo === 'plantao' ? 'Plantão' : 'Expediente';
				const naoProcessados = (d?.nao_processados as any[]) || [];
				if (naoProcessados.length > 0) {
					const nomes = naoProcessados.map((p: any) => p.nome).join(', ');
					toaster.create({ title: `Escala gerada! ${d?.adicionados} servidor(es).`, description: `Não processados: ${nomes}`, type: 'warning' });
				} else {
					toaster.create({ title: `Escala de ${tipo} do próximo mês criada!`, description: `${d?.adicionados} servidor(es).`, type: 'success' });
				}
				goto(`/escalas/${d?.escala_id}`);
			} else if (result.type === 'failure' && d?.escala_id) {
				toaster.create({ title: String(d.error), description: 'Redirecionando...', type: 'warning' });
				goto(`/escalas/${d.escala_id}`);
			} else {
				toaster.create({ title: String(d?.error || 'Erro ao gerar próximo mês'), type: 'error' });
			}
		};
	}

	function startEdit(p: EscalaPolicialComDados) {
		editingId = p.id;
		editDataEntrada = p.data_plantao;
		editDataSaida = getDataSaida(p);
		const [he, me = '00'] = getHoraEntrada(p).split(':');
		editHoraEntrada = he;
		editMinutoEntrada = me;
		const [hs, ms = '00'] = getHoraSaida(p).split(':');
		editHoraSaida = hs;
		editMinutoSaida = ms;
		editObservacoes = p.observacoes || '';
	}

	function handleEditar() {
		editPending = true;
		return async ({ result, update }: any) => {
			editPending = false;
			if (result.type === 'success') {
				editingId = null;
				await update({ reset: false });
			} else {
				toaster.create({ title: 'Erro ao salvar', type: 'error' });
			}
		};
	}

	function solicitarRemocao(itemId: number, nome: string) {
		confirmDialog.openDialog({ itemId, nome });
	}

	function handleRemover() {
		removendo = true;
		return async ({ result, update }: any) => {
			removendo = false;
			if (result.type === 'success') {
				toaster.create({ title: `${confirmDialog.currentItem?.nome} removido da escala`, type: 'success' });
				confirmDialog.closeDialog();
				await update({ reset: false });
			} else {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error || 'Erro ao remover'), type: 'error' });
			}
		};
	}

	// Agrupamentos
	function agruparPorData(items: EscalaPolicialComDados[]): Map<string, EscalaPolicialComDados[]> {
		const map = new Map<string, EscalaPolicialComDados[]>();
		for (const item of items) {
			const list = map.get(item.data_plantao) || [];
			list.push(item);
			map.set(item.data_plantao, list);
		}
		return new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
	}

	function agruparPorEquipe(
		items: EscalaPolicialComDados[]
	): Map<string, EscalaPolicialComDados[]> {
		const map = new Map<string, EscalaPolicialComDados[]>();
		for (const item of items) {
			const eq = item.equipe || '';
			const list = map.get(eq) || [];
			list.push(item);
			map.set(eq, list);
		}
		for (const list of map.values()) {
			list.sort((a, b) => {
				if (a.cargo !== b.cargo) return a.cargo === 'DPC' ? -1 : 1;
				if (a.nome !== b.nome) return a.nome.localeCompare(b.nome);
				return a.data_plantao.localeCompare(b.data_plantao);
			});
		}
		return new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
	}

	function agruparPorServidor(items: EscalaPolicialComDados[]) {
		const grupos = new Map<
			number,
			{
				policial_id: number;
				nome: string;
				matricula: string;
				cargo: string;
				telefone: string;
				lotacao: string;
				classe?: string;
				equipe: string;
				itens: EscalaPolicialComDados[];
			}
		>();
		for (const item of items) {
			if (!grupos.has(item.policial_id)) {
				grupos.set(item.policial_id, {
					policial_id: item.policial_id,
					nome: item.nome,
					matricula: item.matricula,
					cargo: item.cargo,
					telefone: item.telefone || '',
					lotacao: item.lotacao || '',
					classe: item.classe,
					equipe: item.equipe || '',
					itens: []
				});
			}
			grupos.get(item.policial_id)!.itens.push(item);
		}
		for (const g of grupos.values())
			g.itens.sort((a, b) => a.data_plantao.localeCompare(b.data_plantao));
		return Array.from(grupos.values());
	}

	let servidoresExpandidos = $state(new Set<number>());
	function toggleExpandirServidor(id: number) {
		if (servidoresExpandidos.has(id)) servidoresExpandidos.delete(id);
		else servidoresExpandidos.add(id);
		servidoresExpandidos = new Set(servidoresExpandidos);
	}

	function formatarDataPlantao(p: EscalaPolicialComDados): string {
		const de = formatarData(p.data_plantao);
		const ds = getDataSaida(p);
		if (ds !== p.data_plantao) return `${de} à ${formatarData(ds)}`;
		return de;
	}

	function formatarHorario(p: EscalaPolicialComDados): string {
		return `${getHoraEntrada(p)}H A ${getHoraSaida(p)}H`;
	}
</script>

{#if !escala}
	<div class="text-center py-12 text-surface-500"><p>Escala não encontrada.</p></div>
{:else}
	<div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-6">
		<div>
			<h1 class="h1 text-lg sm:text-xl font-bold">{escala.titulo}</h1>
			<p class="text-surface-500 text-sm mt-1">
				{formatarData(escala.data_inicio)} a {formatarData(escala.data_fim)} &bull; {escala.hora_entrada ||
					'08:00'}H a {escala.hora_saida || '08:00'}H
			</p>
		</div>
		<a href="/escalas" class="btn preset-outlined-primary-500 shrink-0">Voltar</a>
	</div>

	<PainelAssinaturaEscala
		escalaId={String(data.escalaId)}
		{isFDS}
		policiaisCount={policiaisEscala.length}
		usuario={page.data.usuario}
		bind:documentoAssinadoInfo
	/>

	<Dialog open={confirmDialog.isOpen} onOpenChange={(e) => (confirmDialog.isOpen = e.open)}>
		<Dialog.Content
			class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm"
		>
			<div
				class="card p-6 max-w-sm w-full bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10"
			>
				<Dialog.Title class="h3 font-bold mb-2">Remover Policial?</Dialog.Title>
				<Dialog.Description class="text-surface-600 dark:text-surface-400 mb-6">
					Tem certeza que deseja remover o policial "{confirmDialog.currentItem?.nome}" desta
					escala?
				</Dialog.Description>
				<div class="flex justify-end gap-3">
					<Dialog.CloseTrigger class="btn preset-outlined-surface" disabled={removendo}
						>Cancelar</Dialog.CloseTrigger
					>
					<form method="POST" action="?/remover" use:enhance={handleRemover} class="contents">
						<input type="hidden" name="item_id" value={confirmDialog.currentItem?.itemId} />
						<button type="submit" class="btn preset-filled-error-500" disabled={removendo}>
							{#if removendo}<Spinner size="sm" />{/if}
							{removendo ? 'Removendo...' : 'Remover'}
						</button>
					</form>
				</div>
			</div>
		</Dialog.Content>
	</Dialog>

	{#if escala.tipo === 'expediente'}
		<div
			class="p-4 sm:p-5 mb-4 rounded-3xl bg-primary-500/8 border border-primary-500/25 backdrop-blur-md shadow-xl shadow-black/5 dark:shadow-black/20"
		>
			<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
				<div>
					<h3 class="font-semibold text-sm text-primary-700 dark:text-primary-400">
						Adicionar Todos os Servidores do Expediente
					</h3>
					<p class="text-xs text-surface-500 mt-1">
						Adiciona automaticamente todos os servidores cadastrados com regime de expediente
						da {escala.lotacao} que ainda não estão na escala.
					</p>
				</div>
				<form method="POST" action="?/adicionarTodos" use:enhance={handleAdicionarTodos} class="contents">
					<button
						type="submit"
						class="btn preset-filled-primary-500 shrink-0 font-semibold flex items-center gap-2"
						disabled={adicionarTodosPending}
					>
						{#if adicionarTodosPending}<Spinner size="md" />{/if}
						{adicionarTodosPending ? 'Adicionando...' : '+ Adicionar Todos'}
					</button>
				</form>
			</div>
		</div>
	{/if}

	{#if escala.tipo === 'plantao' || escala.tipo === 'expediente'}
		<div
			class="p-4 sm:p-5 mb-4 rounded-3xl bg-surface-100/80 dark:bg-surface-800/60 backdrop-blur-md border border-surface-200 dark:border-white/10 shadow-xl shadow-black/5 dark:shadow-black/20"
		>
			<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
				<div>
					<h3 class="font-semibold text-sm text-surface-700 dark:text-surface-300">
						Gerar Escala do Próximo Mês
					</h3>
					<p class="text-xs text-surface-500 mt-1 max-w-lg">
						{#if escala.tipo === 'plantao'}
							Cria a escala de plantão do próximo mês calculando automaticamente os dias de cada
							servidor pela rotação detectada (1x3 ou 2x6).
						{:else}
							Cria a escala de expediente do próximo mês com os mesmos servidores desta escala.
						{/if}
					</p>
				</div>
				<form method="POST" action="?/gerarProximoMes" use:enhance={handleGerarProximoMes} class="contents">
					<button
						type="submit"
						class="btn preset-outlined-primary-500 shrink-0 font-semibold flex items-center gap-2"
						disabled={gerarProximoMesPending}
					>
						{#if gerarProximoMesPending}<Spinner size="md" />{/if}
						{gerarProximoMesPending ? 'Gerando...' : 'Gerar Próximo Mês →'}
					</button>
				</form>
			</div>
		</div>
	{/if}

	{#if !documentoAssinadoInfo?.existe}
		<div
			class="p-4 sm:p-6 mb-4 rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20"
		>
			<h3 class="font-semibold text-sm mb-3">Adicionar DPC/OIP à Escala</h3>
			{#if escala.tipo === 'plantao'}
				<form method="POST" action="?/adicionarPlantao" use:enhance={handlePlantao}>
					<input type="hidden" name="datas" value={datasPlantaoJson} />
					<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
						<label class="label">
							<span class="label-text">Cargo</span>
							<select
								class="select"
								bind:value={cargoBusca}
								onchange={() => {
									policialId = '';
								}}
							>
								<option value="">Selecione...</option>
								<option value="DPC">DPC - Delegado de Polícia Civil</option>
								<option value="OIP">OIP - Oficial Investigador de Polícia</option>
							</select>
						</label>
						<label class="label lg:col-span-2">
							<span class="label-text">Servidor</span>
							<select class="select" name="policial_id" bind:value={policialId} disabled={!cargoBusca}>
								<option value="">Selecione...</option>
								{#each policialsFiltrados as p (p.id)}
									<option value={String(p.id)}>{p.nome}{p.lotacao ? ' — ' + p.lotacao : ''}</option>
								{/each}
							</select>
						</label>
						{#if !isFDS}
							<label class="label">
								<span class="label-text">Equipe</span>
								<select class="select" name="equipe" bind:value={addEquipe}>
									{#each ['1', '2', '3', '4', '5'] as n}<option value={n}>Equipe {n}</option>{/each}
								</select>
							</label>
						{:else}
							<input type="hidden" name="equipe" value="1" />
						{/if}
						<label class="label"
							><span class="label-text">Tipo de Escala</span>
							<select class="select" bind:value={addTipoEscala}>
								<option value="1x3">1×3 — 24h serviço, 3 dias folga</option>
								<option value="2x6">2×6 — 48h serviço, 6 dias folga</option>
							</select>
						</label>
					</div>
					<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
						<label class="label"
							><span class="label-text">Primeiro plantão do mês</span>
							<input
								type="date"
								class="input"
								bind:value={addPrimeiroPlantao}
								min={escala.data_inicio}
								max={escala.data_fim}
								required
							/>
						</label>
						<div class="flex flex-col gap-1 w-32">
							<span class="label-text text-xs">Hora Entrada</span>
							<div class="flex gap-1">
								<select class="select flex-1 h-9 py-0 px-2" name="hora_entrada" bind:value={addHoraEntrada}
									>{#each horas as h}<option value={h}>{h}h</option>{/each}</select
								>
								<select class="select flex-1 h-9 py-0 px-2" name="minuto_entrada" bind:value={addMinutoEntrada}
									>{#each minutos as m}<option value={m}>{m}m</option>{/each}</select
								>
							</div>
						</div>
						<div class="flex flex-col gap-1 w-32">
							<span class="label-text text-xs">Hora Saída</span>
							<div class="flex gap-1">
								<select class="select flex-1 h-9 py-0 px-2" name="hora_saida" bind:value={addHoraSaida}
									>{#each horas as h}<option value={h}>{h}h</option>{/each}</select
								>
								<select class="select flex-1 h-9 py-0 px-2" name="minuto_saida" bind:value={addMinutoSaida}
									>{#each minutos as m}<option value={m}>{m}m</option>{/each}</select
								>
							</div>
						</div>
					</div>
					{#if addPrimeiroPlantao}
						{@const datasCalc = calcularDatasPlantao(addPrimeiroPlantao, addTipoEscala)}
						<div class="mb-4">
							<p class="text-xs font-semibold text-surface-600 dark:text-surface-400 mb-2">
								Datas calculadas ({datasCalc.length} dias):
							</p>
							<div class="flex flex-wrap gap-1.5">
								{#each datasCalc as d}
									<button
										type="button"
										class="px-2 py-1 text-[0.65rem] font-bold rounded-md border transition-all {addDatasSelecionadas.includes(
											d
										)
											? 'bg-primary-500 text-white border-primary-500'
											: 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 border-surface-200 dark:border-white/10 hover:border-primary-500/50'}"
										onclick={() => toggleDataPlantao(d)}>{formatarData(d)}</button
									>
								{/each}
							</div>
						</div>
					{/if}
					<button
						type="submit"
						class="btn preset-filled-primary-500 w-full sm:w-auto"
						disabled={plantaoPending || !policialId || addDatasSelecionadas.length === 0}
					>
						{#if plantaoPending}<Spinner size="sm" />{/if}
						{plantaoPending ? 'Adicionando...' : 'Adicionar à Escala'}
					</button>
				</form>
			{:else}
				<form method="POST" action="?/adicionar" use:enhance={handleAdd}>
					<div class="grid grid-cols-1 sm:grid-cols-12 gap-4 items-end mb-4">
						<label class="label sm:col-span-1">
							<span class="label-text">Cargo</span>
							<select
								class="select h-9 py-0 px-2"
								bind:value={cargoBusca}
								onchange={() => {
									policialId = '';
								}}
							>
								<option value="">...</option>
								<option value="DPC">DPC</option>
								<option value="OIP">OIP</option>
							</select>
						</label>

						<label class="label sm:col-span-4">
							<span class="label-text">Servidor</span>
							<select class="select h-9 py-0 px-2" name="policial_id" bind:value={policialId} disabled={!cargoBusca}>
								<option value="">Selecione...</option>
								{#each policialsFiltrados as p (p.id)}
									<option value={String(p.id)}>{p.nome}{p.lotacao ? ' — ' + p.lotacao : ''}</option>
								{/each}
							</select>
						</label>

						<label class="label sm:col-span-2">
							<span class="label-text">Data</span>
							{#if isFDS}
								<select name="data_plantao" class="select h-9 py-0 px-2" bind:value={dataPlantao} required>
									{#each diasEscala as d}
										<option value={d}>{formatarData(d)}</option>
									{/each}
								</select>
							{:else}
								<input
									type="date"
									name="data_plantao"
									class="input h-9"
									bind:value={dataPlantao}
									min={escala.data_inicio}
									max={escala.data_fim}
									required
								/>
							{/if}
						</label>

						<div class="sm:col-span-2">
							<span class="label-text text-xs">Entrada</span>
							<div class="flex gap-1">
								<select class="select flex-1 h-9 py-0 px-1" name="hora_entrada" bind:value={addHoraEntrada}
									>{#each horas as h}<option value={h}>{h}h</option>{/each}</select
								>
								<select class="select flex-1 h-9 py-0 px-1" name="minuto_entrada" bind:value={addMinutoEntrada}
									>{#each minutos as m}<option value={m}>{m}m</option>{/each}</select
								>
							</div>
						</div>

						<div class="sm:col-span-2">
							<span class="label-text text-xs">Saída</span>
							<div class="flex gap-1">
								<select class="select flex-1 h-9 py-0 px-1" name="hora_saida" bind:value={addHoraSaida}
									>{#each horas as h}<option value={h}>{h}h</option>{/each}</select
								>
								<select class="select flex-1 h-9 py-0 px-1" name="minuto_saida" bind:value={addMinutoSaida}
									>{#each minutos as m}<option value={m}>{m}m</option>{/each}</select
								>
							</div>
						</div>

						{#if !isFDS}
							<input type="hidden" name="equipe" value="1" />
						{:else}
							<input type="hidden" name="equipe" value="1" />
						{/if}

						<div class="sm:col-span-1">
							<button
								type="submit"
								class="btn preset-filled-primary-500 w-full"
								disabled={addingPending || !policialId || !dataPlantao}
							>
								{#if addingPending}<Spinner size="sm" />{:else}＋{/if}
							</button>
						</div>
					</div>
				</form>
			{/if}
		</div>
	{/if}

	{#if policiaisEscala.length === 0}
		<div class="text-center py-12 text-surface-500"><p>Nenhum policial nesta escala ainda.</p></div>
	{:else}
		<!-- Agrupado por data (Visual de Tabela Refinado) -->
		<div class="space-y-12">
			{#each agruparPorData(policiaisEscala) as [dataGrupo, items]}
				<div
					class="card p-0 bg-white dark:bg-surface-900 border border-surface-200 dark:border-white/10 rounded-2xl shadow-xl overflow-hidden"
				>
					<div class="table-container p-2">
						<table class="table w-full text-[0.7rem] sm:text-xs !bg-transparent">
							<thead>
								<tr class="!bg-transparent border-b border-surface-100 dark:border-white/5">
									<th class="!py-4 !px-4 text-surface-500 font-medium uppercase tracking-tight">Nome</th>
									<th class="!py-4 text-center text-surface-500 font-medium uppercase tracking-tight">Matricula</th>
									<th class="!py-4 text-center text-surface-500 font-medium uppercase tracking-tight">Cargo</th>
									<th class="!py-4 text-center text-surface-500 font-medium uppercase tracking-tight">Telefone</th>
									<th class="!py-4 text-surface-500 font-medium uppercase tracking-tight">Lotação</th>
									<th class="!py-4 text-center text-surface-500 font-medium uppercase tracking-tight">Data</th>
									<th class="!py-4 text-center text-surface-500 font-medium uppercase tracking-tight">Horário</th>
									<th class="!py-4 !px-4 text-right text-surface-500 font-medium uppercase tracking-tight">Ações</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-surface-100 dark:divide-white/5">
								{#each items as p (p.id)}
									{#if editingId === p.id}
										<tr class="!bg-primary-500/5">
											<td colspan="8" class="!py-4 !px-4">
												<form method="POST" action="?/editar" use:enhance={handleEditar} class="flex flex-wrap items-end gap-3">
													<input type="hidden" name="item_id" value={editingId} />
													<div class="flex-1 min-w-[120px]">
														<label class="label mb-1">
															<span class="label-text text-[0.6rem]">Data Início</span>
															<input type="date" class="input text-xs h-8 px-2 rounded-lg" bind:value={editDataEntrada} />
														</label>
													</div>
													<div class="flex-1 min-w-[120px]">
														<label class="label mb-1">
															<span class="label-text text-[0.6rem]">Data Saída</span>
															<input type="date" class="input text-xs h-8 px-2 rounded-lg" bind:value={editDataSaida} />
														</label>
													</div>
													<div class="w-28">
														<label class="label mb-1">
															<span class="label-text text-[0.6rem]">Entrada</span>
															<div class="flex gap-1">
																<select class="select text-xs h-8 py-0 rounded-lg flex-1 px-1" bind:value={editHoraEntrada} aria-label="Hora de Entrada">
																	{#each horas as h}<option value={h}>{h}</option>{/each}
																</select>
																<select class="select text-xs h-8 py-0 rounded-lg flex-1 px-1" bind:value={editMinutoEntrada} aria-label="Minuto de Entrada">
																	{#each minutos as m}<option value={m}>{m}</option>{/each}
																</select>
															</div>
														</label>
													</div>
													<div class="w-28">
														<label class="label mb-1">
															<span class="label-text text-[0.6rem]">Saída</span>
															<div class="flex gap-1">
																<select class="select text-xs h-8 py-0 rounded-lg flex-1 px-1" bind:value={editHoraSaida} aria-label="Hora de Saída">
																	{#each horas as h}<option value={h}>{h}</option>{/each}
																</select>
																<select class="select text-xs h-8 py-0 rounded-lg flex-1 px-1" bind:value={editMinutoSaida} aria-label="Minuto de Saída">
																	{#each minutos as m}<option value={m}>{m}</option>{/each}
																</select>
															</div>
														</label>
													</div>
													<div class="flex gap-1">
														<button type="submit" class="btn btn-sm h-8 preset-filled-primary-500 rounded-lg px-3 font-bold" disabled={editPending}>
															{#if editPending}<Spinner size="xs" />{/if}Salvar
														</button>
														<button type="button" class="btn btn-sm h-8 preset-outlined-surface rounded-lg px-2" onclick={() => (editingId = null)}>×</button>
													</div>
													<input type="hidden" name="hora_entrada" value="{editHoraEntrada}:{editMinutoEntrada}" />
													<input type="hidden" name="hora_saida" value="{editHoraSaida}:{editMinutoSaida}" />
													<input type="hidden" name="data_plantao" value={editDataEntrada} />
													<input type="hidden" name="data_saida" value={editDataSaida} />
													<input type="hidden" name="observacoes" value={editObservacoes} />
												</form>
											</td>
										</tr>
									{:else}
										<tr class="!bg-transparent hover:!bg-surface-100/50 dark:hover:!bg-surface-800/20 transition-colors">
											<td class="!py-4 !px-4 align-middle">
												<span class="font-bold text-surface-900 dark:text-surface-100 uppercase block leading-tight">
													{p.nome}
												</span>
												{#if p.equipe && !isFDS}
													<span class="text-[0.6rem] text-primary-600 dark:text-primary-400 font-bold uppercase">
														Equipe {p.equipe}
													</span>
												{/if}
											</td>
											<td class="!py-4 text-center align-middle opacity-80">{p.matricula}</td>
											<td class="!py-4 text-center align-middle">
												<span class="badge px-1.5 py-0.5 rounded font-bold text-[0.55rem] uppercase {p.cargo === 'DPC' ? 'bg-primary-500/20 text-primary-700 dark:text-primary-400 border border-primary-500/20' : 'bg-warning-500/20 text-warning-700 dark:text-warning-400 border border-warning-500/20'}">
													{p.cargo}
												</span>
											</td>
											<td class="!py-4 text-center align-middle text-surface-500 whitespace-nowrap">{p.telefone || '-'}</td>
											<td class="!py-4 align-middle text-surface-500 leading-tight max-w-[150px]">{p.lotacao || '-'}</td>
											<td class="!py-4 text-center align-middle">
												<div class="inline-block px-2 py-1 rounded border border-dashed border-surface-200 dark:border-surface-700 bg-surface-50/50 dark:bg-surface-800/30 text-[0.6rem] whitespace-nowrap">
													{formatarDataPlantao(p)}
												</div>
											</td>
											<td class="!py-4 text-center align-middle">
												<div class="inline-block px-2 py-1 rounded border border-dashed border-surface-200 dark:border-surface-700 bg-surface-50/50 dark:bg-surface-800/30 text-[0.6rem] font-bold uppercase whitespace-nowrap">
													{formatarHorario(p)}
												</div>
											</td>
											<td class="!py-4 !px-4 text-right align-middle">
												<div class="flex items-center justify-end gap-1">
													{#if !documentoAssinadoInfo?.existe}
														<button type="button" title="Editar" class="p-1.5 rounded transition-colors text-surface-400 hover:text-primary-500 hover:bg-primary-500/10" onclick={() => startEdit(p)}>
															<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
																<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
															</svg>
														</button>
														<button type="button" class="btn btn-sm preset-filled-error-500 rounded font-bold text-[0.65rem] uppercase px-2 py-0.5" onclick={() => solicitarRemocao(p.id, p.nome)}>
															Remover
														</button>
													{/if}
												</div>
											</td>
										</tr>
									{/if}
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{/each}
		</div>
	{/if}
{/if}
