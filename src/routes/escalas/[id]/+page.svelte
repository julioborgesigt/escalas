<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { toaster } from '$lib/toast';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import type { Policial, EscalaPolicialComDados } from '$lib/types';
	import type { Escala } from '$lib/server/schema';
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
	let dataPlantao = $derived(data.escala?.data_inicio || '');
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
					.filter((p: any) => p.cargo === cargoBusca)
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

	// ---- Actions via fetch ----

	async function handleAdd(e: Event) {
		e.preventDefault();
		if (!policialId || !dataPlantao) return;
		addingPending = true;
		const ds = calcularDataSaidaInicial(dataPlantao, `${addHoraEntrada}:00`, `${addHoraSaida}:00`);
		const fd = new FormData();
		fd.set('policial_id', policialId);
		fd.set('data_plantao', dataPlantao);
		fd.set('hora_entrada', addHoraEntrada);
		fd.set('hora_saida', addHoraSaida);
		fd.set('equipe', addEquipe);
		const resp = await fetch('?/adicionar', { method: 'POST', body: fd });
		addingPending = false;
		if (resp.ok) {
			const d = await resp.json();
			if (d.policiais) {
				policiaisEscala.length = 0;
				policiaisEscala.push(...d.policiais);
			}
			toaster.create({ title: 'Policial adicionado à escala', type: 'success' });
			cargoBusca = '';
			policialId = '';
		} else {
			const d = await resp.json().catch(() => ({}));
			toaster.create({ title: d.error || 'Erro ao adicionar', type: 'error' });
		}
	}

	async function handlePlantao(e: Event) {
		e.preventDefault();
		if (!policialId || addDatasSelecionadas.length === 0) return;
		plantaoPending = true;
		const he = `${addHoraEntrada}:${addMinutoEntrada}`;
		const hs = `${addHoraSaida}:${addMinutoSaida}`;
		const datas = addDatasSelecionadas.map((d) => ({
			data_plantao: d,
			data_saida: calcularDataSaidaInicial(d, he, hs)
		}));
		const fd = new FormData();
		fd.set('policial_id', policialId);
		fd.set('hora_entrada', addHoraEntrada);
		fd.set('hora_saida', addHoraSaida);
		fd.set('equipe', addEquipe);
		fd.set('datas', JSON.stringify(datas));
		const resp = await fetch('?/adicionarPlantao', { method: 'POST', body: fd });
		plantaoPending = false;
		if (resp.ok) {
			const d = await resp.json();
			if (d.policiais) {
				policiaisEscala.length = 0;
				policiaisEscala.push(...d.policiais);
			}
			toaster.create({ title: 'Servidor adicionado à escala de plantão', type: 'success' });
			cargoBusca = '';
			policialId = '';
			addPrimeiroPlantao = '';
			addEquipe = '1';
			addDatasSelecionadas = [];
		} else {
			const d = await resp.json().catch(() => ({}));
			toaster.create({ title: d.error || 'Erro ao adicionar', type: 'error' });
		}
	}

	async function handleAdicionarTodos() {
		adicionarTodosPending = true;
		const resp = await fetch('?/adicionarTodos', { method: 'POST', body: new FormData() });
		adicionarTodosPending = false;
		if (resp.ok) {
			const d = await resp.json();
			if (d.policiais) {
				policiaisEscala.length = 0;
				policiaisEscala.push(...d.policiais);
			}
			if (d.quantidade === 0)
				toaster.create({ title: 'Todos os servidores já estão na escala', type: 'warning' });
			else toaster.create({ title: `${d.quantidade} servidor(es) adicionado(s)`, type: 'success' });
		} else {
			const d = await resp.json().catch(() => ({}));
			toaster.create({ title: d.error || 'Erro', type: 'error' });
		}
	}

	async function handleGerarProximoMes() {
		gerarProximoMesPending = true;
		const resp = await fetch('?/gerarProximoMes', { method: 'POST', body: new FormData() });
		gerarProximoMesPending = false;
		const d = await resp.json();
		if (resp.ok) {
			const tipo = escala?.tipo === 'plantao' ? 'Plantão' : 'Expediente';
			if (d.nao_processados?.length > 0) {
				const nomes = d.nao_processados.map((p: any) => p.nome).join(', ');
				toaster.create({
					title: `Escala gerada! ${d.adicionados} servidor(es).`,
					description: `Não processados: ${nomes}`,
					type: 'warning'
				});
			} else {
				toaster.create({
					title: `Escala de ${tipo} do próximo mês criada!`,
					description: `${d.adicionados} servidor(es).`,
					type: 'success'
				});
			}
			goto(`/escalas/${d.escala_id}`);
		} else if (resp.status === 409 && d.escala_id) {
			toaster.create({ title: d.error, description: 'Redirecionando...', type: 'warning' });
			goto(`/escalas/${d.escala_id}`);
		} else {
			toaster.create({ title: d.error || 'Erro ao gerar próximo mês', type: 'error' });
		}
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

	async function handleSalvarEdicao(itemId: number) {
		editPending = true;
		const fd = new FormData();
		fd.set('item_id', String(itemId));
		fd.set('data_plantao', editDataEntrada);
		fd.set('data_saida', editDataSaida);
		fd.set('hora_entrada', `${editHoraEntrada}:${editMinutoEntrada}`);
		fd.set('hora_saida', `${editHoraSaida}:${editMinutoSaida}`);
		fd.set('observacoes', editObservacoes);
		const resp = await fetch('?/editar', { method: 'POST', body: fd });
		editPending = false;
		if (resp.ok) {
			const d = await resp.json();
			if (d.policiais) {
				policiaisEscala.length = 0;
				policiaisEscala.push(...d.policiais);
			}
			editingId = null;
		} else {
			toaster.create({ title: 'Erro ao salvar', type: 'error' });
		}
	}

	function solicitarRemocao(itemId: number, nome: string) {
		confirmDialog.openDialog({ itemId, nome });
	}

	async function confirmarRemocao() {
		const item = confirmDialog.currentItem;
		if (!item) return;
		removendo = true;
		const fd = new FormData();
		fd.set('item_id', String(item.itemId));
		const resp = await fetch('?/remover', { method: 'POST', body: fd });
		removendo = false;
		if (resp.ok) {
			const d = await resp.json();
			if (d.policiais) {
				policiaisEscala.length = 0;
				policiaisEscala.push(...d.policiais);
			}
			toaster.create({ title: `${item.nome} removido da escala`, type: 'success' });
			confirmDialog.closeDialog();
		} else {
			const d = await resp.json().catch(() => ({}));
			toaster.create({ title: d.error || 'Erro ao remover', type: 'error' });
		}
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

	async function toggleDiaServidor(grupo: any, dataISO: string) {
		const itemExistente = grupo.itens.find((i: any) => i.data_plantao === dataISO);
		if (itemExistente) {
			const fd = new FormData();
			fd.set('item_id', String(itemExistente.id));
			const resp = await fetch('?/remover', { method: 'POST', body: fd });
			if (resp.ok) {
				const d = await resp.json();
				if (d.policiais) {
					policiaisEscala.length = 0;
					policiaisEscala.push(...d.policiais);
				}
			}
		} else {
			const template = grupo.itens[0] || {};
			const he = template.hora_entrada || escala?.hora_entrada || '08:00';
			const hs = template.hora_saida || escala?.hora_saida || '08:00';
			const ds = calcularDataSaidaInicial(dataISO, he, hs);
			const fd = new FormData();
			fd.set('policial_id', String(grupo.policial_id));
			fd.set('data_plantao', dataISO);
			fd.set('hora_entrada', String(he).split(':')[0]);
			fd.set('hora_saida', String(hs).split(':')[0]);
			fd.set('equipe', grupo.equipe || '');
			const resp = await fetch('?/adicionar', { method: 'POST', body: fd });
			if (resp.ok) {
				const d = await resp.json();
				if (d.policiais) {
					policiaisEscala.length = 0;
					policiaisEscala.push(...d.policiais);
				}
			}
		}
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
					<button
						class="btn preset-filled-error-500"
						disabled={removendo}
						onclick={confirmarRemocao}
					>
						{#if removendo}<Spinner size="sm" />{/if}
						{removendo ? 'Removendo...' : 'Remover'}
					</button>
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
						Adiciona automaticamente todos os servidores cadastrados com regime de expediente (ou
						ambos) da {escala.lotacao} que ainda não estão na escala.
					</p>
				</div>
				<button
					class="btn preset-filled-primary-500 shrink-0 font-semibold flex items-center gap-2"
					onclick={handleAdicionarTodos}
					disabled={adicionarTodosPending}
				>
					{#if adicionarTodosPending}<Spinner size="md" />{/if}
					{adicionarTodosPending ? 'Adicionando...' : '+ Adicionar Todos'}
				</button>
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
				<button
					class="btn preset-outlined-primary-500 shrink-0 font-semibold flex items-center gap-2"
					onclick={handleGerarProximoMes}
					disabled={gerarProximoMesPending}
				>
					{#if gerarProximoMesPending}<Spinner size="md" />{/if}
					{gerarProximoMesPending ? 'Gerando...' : 'Gerar Próximo Mês →'}
				</button>
			</div>
		</div>
	{/if}

	{#if !documentoAssinadoInfo}
		<div
			class="p-4 sm:p-6 mb-4 rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20"
		>
			<h3 class="font-semibold text-sm mb-3">Adicionar DPC/OIP à Escala</h3>
			{#if escala.tipo === 'plantao'}
				<form onsubmit={handlePlantao}>
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
						<label class="label">
							<span class="label-text">Servidor</span>
							<select class="select" bind:value={policialId} disabled={!cargoBusca}>
								<option value="">Selecione...</option>
								{#each policialsFiltrados as p (p.id)}
									<option value={String(p.id)}>{p.nome}{p.lotacao ? ' — ' + p.lotacao : ''}</option>
								{/each}
							</select>
						</label>
						<label class="label"
							><span class="label-text">Equipe</span>
							<select class="select" bind:value={addEquipe}>
								{#each ['1', '2', '3', '4', '5'] as n}<option value={n}>Equipe {n}</option>{/each}
							</select>
						</label>
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
						<div class="flex flex-col gap-1">
							<span class="label-text text-xs">Hora Entrada</span>
							<div class="flex gap-1">
								<select class="select flex-1" bind:value={addHoraEntrada}
									>{#each horas as h}<option value={h}>{h}h</option>{/each}</select
								>
								<select class="select flex-1" bind:value={addMinutoEntrada}
									>{#each minutos as m}<option value={m}>{m}m</option>{/each}</select
								>
							</div>
						</div>
						<div class="flex flex-col gap-1">
							<span class="label-text text-xs">Hora Saída</span>
							<div class="flex gap-1">
								<select class="select flex-1" bind:value={addHoraSaida}
									>{#each horas as h}<option value={h}>{h}h</option>{/each}</select
								>
								<select class="select flex-1" bind:value={addMinutoSaida}
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
				<form onsubmit={handleAdd}>
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
						<label class="label">
							<span class="label-text">Servidor</span>
							<select class="select" bind:value={policialId} disabled={!cargoBusca}>
								<option value="">Selecione...</option>
								{#each policialsFiltrados as p (p.id)}
									<option value={String(p.id)}>{p.nome}{p.lotacao ? ' — ' + p.lotacao : ''}</option>
								{/each}
							</select>
						</label>
						<label class="label"
							><span class="label-text">Data</span>
							<input
								type="date"
								class="input"
								bind:value={dataPlantao}
								min={escala.data_inicio}
								max={escala.data_fim}
								required
							/>
						</label>
						<label class="label"
							><span class="label-text">Equipe</span>
							<select class="select" bind:value={addEquipe}>
								{#each ['1', '2', '3', '4', '5'] as n}<option value={n}>Equipe {n}</option>{/each}
							</select>
						</label>
					</div>
					<div class="flex flex-col sm:flex-row gap-3 mb-4">
						<div class="flex-1">
							<span class="label-text text-xs">Hora Entrada</span>
							<div class="flex gap-1">
								<select class="select flex-1" bind:value={addHoraEntrada}
									>{#each horas as h}<option value={h}>{h}h</option>{/each}</select
								><select class="select flex-1" bind:value={addMinutoEntrada}
									>{#each minutos as m}<option value={m}>{m}m</option>{/each}</select
								>
							</div>
						</div>
						<div class="flex-1">
							<span class="label-text text-xs">Hora Saída</span>
							<div class="flex gap-1">
								<select class="select flex-1" bind:value={addHoraSaida}
									>{#each horas as h}<option value={h}>{h}h</option>{/each}</select
								><select class="select flex-1" bind:value={addMinutoSaida}
									>{#each minutos as m}<option value={m}>{m}m</option>{/each}</select
								>
							</div>
						</div>
					</div>
					<button
						type="submit"
						class="btn preset-filled-primary-500"
						disabled={addingPending || !policialId || !dataPlantao}
					>
						{#if addingPending}<Spinner size="sm" />{/if}
						{addingPending ? 'Adicionando...' : 'Adicionar à Escala'}
					</button>
				</form>
			{/if}
		</div>
	{/if}

	{#if policiaisEscala.length === 0}
		<div class="text-center py-12 text-surface-500"><p>Nenhum policial nesta escala ainda.</p></div>
	{:else}
		<!-- Agrupado por data -->
		<div class="space-y-6">
			{#each agruparPorData(policiaisEscala) as [dataGrupo, items]}
				<div>
					<h3 class="text-sm font-bold text-surface-500 uppercase tracking-wider mb-3">
						{formatarData(dataGrupo)}
					</h3>
					<div class="space-y-2">
						{#each items as p}
							<div
								class="p-3 rounded-xl bg-surface-100/50 dark:bg-surface-800/50 border border-surface-200 dark:border-white/10 flex items-center justify-between gap-3"
							>
								{#if editingId === p.id}
									<div class="flex flex-col sm:flex-row gap-2 flex-1">
										<input
											type="date"
											class="input text-xs py-1 h-8"
											bind:value={editDataEntrada}
										/>
										<input type="date" class="input text-xs py-1 h-8" bind:value={editDataSaida} />
										<div class="flex gap-1">
											<select class="select text-xs py-1 h-8 flex-1" bind:value={editHoraEntrada}>
												{#each horas as h}<option value={h}>{h}</option>{/each}
											</select>
											<span class="flex items-center">:</span>
											<select class="select text-xs py-1 h-8 flex-1" bind:value={editMinutoEntrada}>
												{#each minutos as m}<option value={m}>{m}</option>{/each}
											</select>
										</div>
										<div class="flex gap-1">
											<select class="select text-xs py-1 h-8 flex-1" bind:value={editHoraSaida}>
												{#each horas as h}<option value={h}>{h}</option>{/each}
											</select>
											<span class="flex items-center">:</span>
											<select class="select text-xs py-1 h-8 flex-1" bind:value={editMinutoSaida}>
												{#each minutos as m}<option value={m}>{m}</option>{/each}
											</select>
										</div>
										<input
											class="input text-xs py-1 h-8 flex-1"
											type="text"
											bind:value={editObservacoes}
											placeholder="Obs."
										/>
										<div class="flex gap-2">
											<button
												class="btn btn-sm preset-filled-primary-500"
												onclick={() => handleSalvarEdicao(p.id)}
												disabled={editPending}
											>
												{#if editPending}<Spinner size="xs" />{/if}Salvar
											</button>
											<button
												class="btn btn-sm preset-outlined-surface"
												onclick={() => {
													editingId = null;
												}}>Cancelar</button
											>
										</div>
									</div>
								{:else}
									<div class="flex-1 min-w-0">
										<div class="flex items-center gap-2 flex-wrap">
											<span class="font-semibold text-sm">{p.nome}</span>
											<span
												class="badge text-xs {p.cargo === 'DPC'
													? 'preset-filled-primary-500'
													: 'preset-filled-warning-500'}">{p.cargo}</span
											>
											{#if p.equipe}<span class="text-[0.65rem] text-surface-400"
													>Eq. {p.equipe}</span
												>{/if}
										</div>
										<div class="text-xs text-surface-500 mt-0.5 flex items-center gap-2 flex-wrap">
											<span>{p.matricula}</span>
											{#if p.classe}<span class="text-surface-400">{p.classe}</span>{/if}
											{#if p.lotacao}<span class="text-surface-400">{p.lotacao}</span>{/if}
										</div>
										<div class="text-xs text-surface-500 mt-0.5">
											{formatarDataPlantao(p)} · {formatarHorario(p)}
											{#if p.observacoes}<span class="italic text-surface-400 ml-2"
													>({p.observacoes})</span
												>{/if}
										</div>
									</div>
									{#if !documentoAssinadoInfo}
										<div class="flex gap-2 shrink-0">
											<button
												class="btn btn-sm preset-outlined-primary-500"
												onclick={() => startEdit(p)}>Editar</button
											>
											<button
												class="btn btn-sm preset-filled-error-500"
												onclick={() => solicitarRemocao(p.id, p.nome)}>Remover</button
											>
										</div>
									{/if}
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
{/if}
