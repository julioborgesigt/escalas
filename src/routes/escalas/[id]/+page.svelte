<script lang="ts">
	import { page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import { untrack, tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import type { Policial, EscalaPolicialComDados, Escala } from '$lib/types';
	import { formatarData, proximoDia } from '$lib/utils';
	import PainelAssinaturaEscala from '$lib/components/PainelAssinaturaEscala.svelte';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import { useConfirmationDialog } from '$lib/composables';
	import { loading } from '$lib/loading.svelte';

	let { data } = $props();

	const horas = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
	const minutos = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

	const confirmDialog = useConfirmationDialog<{ itemId: number; nome: string }>();

	// Dados do server
	let escala = $derived(data.escala);
	let finalizadaEm = $state<string | null>(untrack(() => data.escala?.finalizada_em ?? null));
	$effect(() => {
		finalizadaEm = data.escala?.finalizada_em ?? null;
	});
	const emailEnvioInicial = $derived(data.escala?.email_envio ?? null);
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

	// Estado local da lista — atualizado diretamente pelos actions (sem round-trip extra)
	let policiaisEscalaLocal = $state<EscalaPolicialComDados[]>(
		untrack(() => data.policiaisEscala as EscalaPolicialComDados[])
	);
	$effect(() => {
		// Sincroniza com dados frescos do servidor ao navegar de volta para esta página
		policiaisEscalaLocal = data.policiaisEscala as EscalaPolicialComDados[];
	});

	/**
	 * Busca incremental no servidor (substitui o load eager de até 10 000 linhas).
	 * `cargoBusca` é incluído na query — o servidor já filtra por DPC/OIP.
	 * O `signal` é usado pelo `SearchableSelect` para abortar buscas em flight.
	 */
	const buscarPoliciaisAsync = (q: string, sig: AbortSignal) => buscarPoliciais(cargoBusca, q, sig);

	// Estados de loading inline por ação (sem overlay global)
	let pendingAdd = $state(false);
	let pendingPlantao = $state(false);
	let pendingAdicionarTodos = $state(false);
	let pendingEditar = $state(false);
	let pendingRemover = $state(false);

	let cargoBusca = $state<'DPC' | 'OIP' | ''>('');
	let policialId = $state('');
	let dataPlantao = $state('');

	$effect(() => {
		if (escala?.data_inicio) dataPlantao = escala.data_inicio;
	});

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

	let editingId = $state<number | null>(null);
	let editDataEntrada = $state('');
	let editDataSaida = $state('');
	let editHoraEntrada = $state('');
	let editMinutoEntrada = $state('');
	let editHoraSaida = $state('');
	let editMinutoSaida = $state('');
	let editObservacoes = $state('');

	// Pending states

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

	const datasCalc = $derived(calcularDatasPlantao(addPrimeiroPlantao, addTipoEscala));

	$effect(() => {
		// Reseta seleção do usuário quando a base muda (data inicial / tipo).
		addDatasSelecionadas = datasCalc;
	});

	// ---- Computed for plantão form ----
	const datasPlantaoJson = $derived(
		JSON.stringify(
			addDatasSelecionadas.map((d) => ({
				data_plantao: d,
				data_saida: calcularDataSaidaInicial(
					d,
					`${addHoraEntrada}:${addMinutoEntrada}`,
					`${addHoraSaida}:${addMinutoSaida}`
				)
			}))
		)
	);

	// ---- Actions via use:enhance ----

	function handleAdd({ cancel }: { cancel: () => void }) {
		if (!policialId) {
			cancel();
			return;
		}
		pendingAdd = true;
		return async ({ result }: any) => {
			pendingAdd = false;
			if (result.type === 'success') {
				policiaisEscalaLocal = result.data.policiais;
				toaster.create({ title: 'Policial adicionado à escala', type: 'success' });
				cargoBusca = '';
				policialId = '';
			} else if (result.type === 'error') {
				toaster.create({ title: 'Erro de conexão. Tente novamente.', type: 'error' });
			} else {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error || 'Erro ao adicionar'), type: 'error' });
			}
		};
	}

	function handlePlantao({ cancel }: { cancel: () => void }) {
		if (!policialId || addDatasSelecionadas.length === 0) {
			cancel();
			return;
		}
		pendingPlantao = true;
		return async ({ result }: any) => {
			pendingPlantao = false;
			if (result.type === 'success') {
				policiaisEscalaLocal = result.data.policiais;
				const conflitantes = (result.data.conflitantes as { data: string; motivo: string }[]) ?? [];
				if (conflitantes.length > 0) {
					const datas = conflitantes.map((c) => c.data).join(', ');
					toaster.create({
						title: `Adicionado — ${conflitantes.length} dia(s) com choque ignorado(s)`,
						description: `Dias ignorados: ${datas}`,
						type: 'warning'
					});
				} else {
					toaster.create({ title: 'Servidor adicionado à escala de plantão', type: 'success' });
				}
				cargoBusca = '';
				policialId = '';
				addPrimeiroPlantao = '';
				addEquipe = '1';
				addDatasSelecionadas = [];
			} else if (result.type === 'error') {
				toaster.create({ title: 'Erro de conexão. Tente novamente.', type: 'error' });
			} else {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error || 'Erro ao adicionar'), type: 'error' });
			}
		};
	}

	function handleAdicionarTodos() {
		pendingAdicionarTodos = true;
		return async ({ result }: any) => {
			pendingAdicionarTodos = false;
			if (result.type === 'success') {
				const d = result.data as Record<string, unknown>;
				policiaisEscalaLocal = result.data.policiais;
				if (Number(d.quantidade) === 0)
					toaster.create({ title: 'Todos os servidores já estão na escala', type: 'warning' });
				else
					toaster.create({ title: `${d.quantidade} servidor(es) adicionado(s)`, type: 'success' });
			} else if (result.type === 'error') {
				toaster.create({ title: 'Erro de conexão. Tente novamente.', type: 'error' });
			} else {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error || 'Erro'), type: 'error' });
			}
		};
	}

	function handleGerarProximoMes() {
		loading.show('Gerando escala do próximo mês...');
		return async ({ result }: any) => {
			loading.hide();
			const d = result.data as Record<string, unknown> | undefined;
			if (result.type === 'success') {
				const tipo = escala?.tipo === 'plantao' ? 'Plantão' : 'Expediente';
				const naoProcessados = (d?.nao_processados as any[]) || [];
				if (naoProcessados.length > 0) {
					const nomes = naoProcessados.map((p: any) => p.nome).join(', ');
					toaster.create({
						title: `Escala gerada! ${d?.adicionados} servidor(es).`,
						description: `Não processados: ${nomes}`,
						type: 'warning'
					});
				} else {
					toaster.create({
						title: `Escala de ${tipo} do próximo mês criada!`,
						description: `${d?.adicionados} servidor(es).`,
						type: 'success'
					});
				}
				goto(`/escalas/${d?.escala_id}`);
			} else if (result.type === 'failure' && d?.escala_id) {
				toaster.create({
					title: String(d.error),
					description: 'Redirecionando...',
					type: 'warning'
				});
				goto(`/escalas/${d.escala_id}`);
			} else if (result.type === 'error') {
				toaster.create({
					title: 'Erro de conexão ao gerar próximo mês. Tente novamente.',
					type: 'error'
				});
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
		pendingEditar = true;
		return async ({ result }: any) => {
			pendingEditar = false;
			if (result.type === 'success') {
				policiaisEscalaLocal = result.data.policiais;
				editingId = null;
			} else if (result.type === 'error') {
				toaster.create({ title: 'Erro de conexão. Tente novamente.', type: 'error' });
			} else {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error || 'Erro ao salvar'), type: 'error' });
			}
		};
	}

	function solicitarRemocao(itemId: number, nome: string) {
		confirmDialog.openDialog({ itemId, nome });
	}

	function handleRemover() {
		const itemNome = confirmDialog.currentItem?.nome;
		const itemId = confirmDialog.currentItem?.itemId;
		const backup = [...policiaisEscalaLocal];

		// Update otimista: remove imediatamente e fecha o diálogo
		policiaisEscalaLocal = policiaisEscalaLocal.filter((p) => p.id !== itemId);
		confirmDialog.closeDialog();

		return async ({ result }: any) => {
			if (result.type === 'success') {
				policiaisEscalaLocal = result.data.policiais; // confirma com dados do servidor
				toaster.create({ title: `${itemNome} removido da escala`, type: 'success' });
			} else {
				policiaisEscalaLocal = backup; // rollback
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

	// === FDS: add per-day ===
	let fdsAddingDia = $state<string | null>(null);
	let fdsAddingCargo = $state<'DPC' | 'OIP' | null>(null);
	let fdsPolicialId = $state('');
	let fdsAddHoraEntrada = $state('08');
	let fdsAddMinutoEntrada = $state('00');
	let fdsAddHoraSaida = $state('08');
	let fdsAddMinutoSaida = $state('00');

	async function buscarPoliciais(cargo: string, query: string, signal: AbortSignal) {
		if (!cargo) return [];
		const params = new URLSearchParams({ cargo, limit: '50' });
		if (query) params.set('q', query);
		const res = await fetch(`/api/policiais/search?${params}`, { signal });
		if (!res.ok) {
			const err = await res.json().catch(() => ({ error: 'Erro na busca' }));
			throw new Error(err.error ?? 'Erro na busca');
		}
		const json = (await res.json()) as {
			policiais: { id: number; nome: string; lotacao: string }[];
		};
		return json.policiais.map((p) => ({
			value: String(p.id),
			label: `${p.nome}${p.lotacao ? ' — ' + p.lotacao : ''}`
		}));
	}

	const buscarPoliciaisFds = (q: string, sig: AbortSignal) =>
		buscarPoliciais(fdsAddingCargo ?? '', q, sig);

	async function openFdsAdd(dia: string, cargo: 'DPC' | 'OIP') {
		if (fdsAddingDia === dia && fdsAddingCargo === cargo) {
			fdsAddingDia = null;
			fdsAddingCargo = null;
			fdsPolicialId = '';
			return;
		}
		fdsAddingDia = dia;
		fdsAddingCargo = cargo;
		fdsPolicialId = '';
		const [hEnt = '08', mEnt = '00'] = (escala?.hora_entrada ?? '08:00').split(':');
		const [hSai = '08', mSai = '00'] = (escala?.hora_saida ?? '08:00').split(':');
		fdsAddHoraEntrada = hEnt;
		fdsAddMinutoEntrada = mEnt;
		fdsAddHoraSaida = hSai;
		fdsAddMinutoSaida = mSai;
		await tick();
		document
			.getElementById(`fds-add-${dia}`)
			?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	}

	function cancelFdsAdd() {
		fdsAddingDia = null;
		fdsAddingCargo = null;
		fdsPolicialId = '';
	}

	function handleFdsAdd({ cancel }: { cancel: () => void }) {
		if (!fdsPolicialId) {
			cancel();
			return;
		}
		pendingAdd = true;
		return async ({ result }: any) => {
			pendingAdd = false;
			if (result.type === 'success') {
				policiaisEscalaLocal = result.data.policiais;
				toaster.create({ title: 'Policial adicionado à escala', type: 'success' });
				fdsAddingDia = null;
				fdsAddingCargo = null;
				fdsPolicialId = '';
			} else if (result.type === 'error') {
				toaster.create({ title: 'Erro de conexão. Tente novamente.', type: 'error' });
			} else {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error || 'Erro ao adicionar'), type: 'error' });
			}
		};
	}

	function diaSemanaLabel(iso: string): string {
		return ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][new Date(iso + 'T12:00:00').getDay()];
	}

	// === Gerenciar dias da escala (FDS) ===
	let localDataInicio = $state<string>('');
	let localDataFim = $state<string>('');
	$effect(() => {
		localDataInicio = data.escala?.data_inicio ?? '';
		localDataFim = data.escala?.data_fim ?? '';
	});
	const diasEscalaLocal = $derived(
		localDataInicio && localDataFim ? getDaysInRange(localDataInicio, localDataFim) : diasEscala
	);

	// === Modal de edição de dias (calendário) ===
	const MESES_CAL_ED = [
		'Janeiro',
		'Fevereiro',
		'Março',
		'Abril',
		'Maio',
		'Junho',
		'Julho',
		'Agosto',
		'Setembro',
		'Outubro',
		'Novembro',
		'Dezembro'
	];
	const DIAS_SEM_ED = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

	let showEditarDiasModal = $state(false);
	let editDiasSelecionados = $state<string[]>([]);
	let editCalAno = $state(new Date().getFullYear());
	let editCalMes = $state(new Date().getMonth());
	let pendingEditarDias = $state(false);

	const editCalGrade = $derived.by(() => {
		const first = new Date(editCalAno, editCalMes, 1).getDay();
		const n = new Date(editCalAno, editCalMes + 1, 0).getDate();
		const cells: ({ day: number } | null)[] = [];
		for (let i = 0; i < first; i++) cells.push(null);
		for (let d = 1; d <= n; d++) cells.push({ day: d });
		while (cells.length % 7 !== 0) cells.push(null);
		while (cells.length < 42) cells.push(null);
		return cells;
	});

	const editDiasOrdenados = $derived([...editDiasSelecionados].sort());
	const editDiasJson = $derived(JSON.stringify(editDiasOrdenados));

	function editIsoLocal(y: number, m: number, d: number): string {
		return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
	}

	function editFmtDia(iso: string): string {
		const [, m, d] = iso.split('-');
		return `${d}/${m}`;
	}

	function editCalToggle(iso: string) {
		const set = new Set(editDiasSelecionados);
		if (set.has(iso)) set.delete(iso);
		else set.add(iso);
		if (set.size > 1) {
			const sorted = [...set].sort();
			// Preenchimento automático: a escala usa um intervalo contínuo
			editDiasSelecionados = getDaysInRange(sorted[0], sorted[sorted.length - 1]);
		} else {
			editDiasSelecionados = [...set];
		}
	}

	function editCalMesAnterior() {
		if (editCalMes === 0) {
			editCalMes = 11;
			editCalAno--;
		} else editCalMes--;
	}
	function editCalMesProximo() {
		if (editCalMes === 11) {
			editCalMes = 0;
			editCalAno++;
		} else editCalMes++;
	}

	function abrirEditarDiasModal() {
		editDiasSelecionados = [...diasEscalaLocal];
		if (diasEscalaLocal.length > 0) {
			const [y, m] = diasEscalaLocal[0].split('-').map(Number);
			editCalAno = y;
			editCalMes = m - 1;
		}
		showEditarDiasModal = true;
	}

	function handleEditarDias({ cancel }: { cancel: () => void }) {
		if (editDiasOrdenados.length === 0) {
			toaster.create({ title: 'Selecione pelo menos um dia', type: 'error' });
			cancel();
			return;
		}
		pendingEditarDias = true;
		return async ({ result }: any) => {
			pendingEditarDias = false;
			if (result.type === 'success') {
				localDataInicio = result.data.data_inicio;
				localDataFim = result.data.data_fim;
				policiaisEscalaLocal = result.data.policiais;
				showEditarDiasModal = false;
				toaster.create({ title: 'Dias da escala atualizados!', type: 'success' });
				await invalidateAll();
			} else if (result.type === 'error') {
				toaster.create({ title: 'Erro de conexão. Tente novamente.', type: 'error' });
			} else {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error || 'Erro ao atualizar dias'), type: 'error' });
			}
		};
	}

	// === Copiar para WhatsApp ===
	function copiarParaWhatsApp() {
		if (!escala) return;
		const linhas: string[] = [];
		linhas.push(`*${escala.titulo}*`);
		linhas.push('');
		for (const dia of diasEscalaLocal) {
			const itens = policiaisEscalaLocal.filter((p) => p.data_plantao === dia);
			if (itens.length === 0) continue;
			linhas.push(`*${diaSemanaLabel(dia)}, ${formatarData(dia)}:*`);
			for (const p of itens) {
				const partes = p.nome.split(' ');
				const nomeResumido = partes.length >= 2 ? `${partes[0]} ${partes[1]}` : partes[0];
				linhas.push(`• ${nomeResumido} (${p.cargo})`);
			}
			linhas.push('');
		}
		navigator.clipboard
			.writeText(linhas.join('\n').trimEnd())
			.then(() =>
				toaster.create({ title: 'Escala copiada para a área de transferência!', type: 'success' })
			)
			.catch(() => toaster.create({ title: 'Erro ao copiar', type: 'error' }));
	}

	// === Repetir policial em outros dias ===
	let repetindoId = $state<number | null>(null);
	let repeticaoDatas = $state<string[]>([]);
	let pendingRepetir = $state(false);

	function openRepetir(p: EscalaPolicialComDados) {
		if (repetindoId === p.id) {
			repetindoId = null;
			repeticaoDatas = [];
			return;
		}
		editingId = null;
		repetindoId = p.id;
		repeticaoDatas = [];
	}

	function toggleRepeticaoData(dia: string) {
		if (repeticaoDatas.includes(dia)) {
			repeticaoDatas = repeticaoDatas.filter((d) => d !== dia);
		} else {
			repeticaoDatas = [...repeticaoDatas, dia];
		}
	}

	function diasJaAdicionadosPolicial(policialId: number): Set<string> {
		return new Set(
			policiaisEscalaLocal.filter((p) => p.policial_id === policialId).map((p) => p.data_plantao)
		);
	}

	const repeticaoDatasJson = $derived(JSON.stringify(repeticaoDatas));

	function handleRepetir({ cancel }: { cancel: () => void }) {
		if (repeticaoDatas.length === 0) {
			cancel();
			return;
		}
		pendingRepetir = true;
		return async ({ result }: any) => {
			pendingRepetir = false;
			if (result.type === 'success') {
				policiaisEscalaLocal = result.data.policiais;
				const conflitantes = (result.data.conflitantes as { data: string; motivo: string }[]) ?? [];
				if (conflitantes.length > 0) {
					const datas = conflitantes.map((c) => c.data).join(', ');
					toaster.create({
						title: `Adicionado — ${conflitantes.length} dia(s) com choque ignorado(s)`,
						description: `Dias ignorados: ${datas}`,
						type: 'warning'
					});
				} else {
					toaster.create({
						title: `Servidor adicionado em ${repeticaoDatas.length} dia(s)`,
						type: 'success'
					});
				}
				repetindoId = null;
				repeticaoDatas = [];
			} else if (result.type === 'error') {
				toaster.create({ title: 'Erro de conexão. Tente novamente.', type: 'error' });
			} else {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error || 'Erro ao repetir'), type: 'error' });
			}
		};
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
		policiaisCount={policiaisEscalaLocal.length}
		usuario={page.data.usuario}
		bind:documentoAssinadoInfo
		bind:finalizadaEm
		{emailEnvioInicial}
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
					<Dialog.CloseTrigger class="btn preset-outlined-surface">Cancelar</Dialog.CloseTrigger>
					<form method="POST" action="?/remover" use:enhance={handleRemover} class="contents">
						<input type="hidden" name="item_id" value={confirmDialog.currentItem?.itemId} />
						<button type="submit" class="btn preset-filled-error-500">Remover</button>
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
						Adiciona automaticamente todos os servidores cadastrados com regime de expediente da {escala.lotacao}
						que ainda não estão na escala.
					</p>
				</div>
				<form
					method="POST"
					action="?/adicionarTodos"
					use:enhance={handleAdicionarTodos}
					class="contents"
				>
					<button
						type="submit"
						class="btn preset-filled-primary-500 shrink-0 font-semibold flex items-center gap-2"
						disabled={pendingAdicionarTodos}
					>
						{pendingAdicionarTodos ? 'Adicionando...' : '+ Adicionar Todos'}
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
				<form
					method="POST"
					action="?/gerarProximoMes"
					use:enhance={handleGerarProximoMes}
					class="contents"
				>
					<button
						type="submit"
						class="btn preset-outlined-primary-500 shrink-0 font-semibold flex items-center gap-2"
						disabled={loading.active}
					>
						{#if loading.active}
							<span class="animate-spin inline-block mr-1">⟳</span>Gerando...
						{:else}
							Gerar Próximo Mês →
						{/if}
					</button>
				</form>
			</div>
		</div>
	{/if}

	{#if !isFDS && !documentoAssinadoInfo?.existe && !finalizadaEm}
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
							{#key cargoBusca}
								<SearchableSelect
									name="policial_id"
									bind:value={policialId}
									disabled={!cargoBusca}
									loadOptions={buscarPoliciaisAsync}
									placeholder={cargoBusca
										? 'Digite para buscar servidor...'
										: 'Selecione o cargo primeiro'}
									class="w-full"
								/>
							{/key}
						</label>
						{#if !isFDS}
							<label class="label">
								<span class="label-text">Equipe</span>
								<select class="select" name="equipe" bind:value={addEquipe}>
									{#each ['1', '2', '3', '4', '5'] as n (n)}<option value={n}>Equipe {n}</option
										>{/each}
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
								<select
									class="select flex-1 h-9 py-0 px-2"
									name="hora_entrada"
									bind:value={addHoraEntrada}
									>{#each horas as h (h)}<option value={h}>{h}h</option>{/each}</select
								>
								<select
									class="select flex-1 h-9 py-0 px-2"
									name="minuto_entrada"
									bind:value={addMinutoEntrada}
									>{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}</select
								>
							</div>
						</div>
						<div class="flex flex-col gap-1 w-32">
							<span class="label-text text-xs">Hora Saída</span>
							<div class="flex gap-1">
								<select
									class="select flex-1 h-9 py-0 px-2"
									name="hora_saida"
									bind:value={addHoraSaida}
									>{#each horas as h (h)}<option value={h}>{h}h</option>{/each}</select
								>
								<select
									class="select flex-1 h-9 py-0 px-2"
									name="minuto_saida"
									bind:value={addMinutoSaida}
									>{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}</select
								>
							</div>
						</div>
					</div>
					{#if addPrimeiroPlantao}
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
						disabled={pendingPlantao || !policialId || addDatasSelecionadas.length === 0}
					>
						{pendingPlantao ? 'Adicionando...' : 'Adicionar à Escala'}
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

						<label class="label sm:col-span-4 self-center">
							<span class="label-text">Servidor</span>
							{#key cargoBusca}
								<SearchableSelect
									name="policial_id"
									bind:value={policialId}
									disabled={!cargoBusca}
									loadOptions={buscarPoliciaisAsync}
									placeholder={cargoBusca
										? 'Digite para buscar servidor...'
										: 'Selecione o cargo primeiro'}
									class="w-full h-9"
								/>
							{/key}
						</label>

						<label class="label sm:col-span-2">
							<span class="label-text">Data</span>
							{#if isFDS}
								<select
									name="data_plantao"
									class="select h-9 py-0 px-2"
									bind:value={dataPlantao}
									required
								>
									{#each diasEscalaLocal as d (d)}
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
								<select
									class="select flex-1 h-9 py-0 px-1"
									name="hora_entrada"
									bind:value={addHoraEntrada}
									>{#each horas as h (h)}<option value={h}>{h}h</option>{/each}</select
								>
								<select
									class="select flex-1 h-9 py-0 px-1"
									name="minuto_entrada"
									bind:value={addMinutoEntrada}
									>{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}</select
								>
							</div>
						</div>

						<div class="sm:col-span-2">
							<span class="label-text text-xs">Saída</span>
							<div class="flex gap-1">
								<select
									class="select flex-1 h-9 py-0 px-1"
									name="hora_saida"
									bind:value={addHoraSaida}
									>{#each horas as h (h)}<option value={h}>{h}h</option>{/each}</select
								>
								<select
									class="select flex-1 h-9 py-0 px-1"
									name="minuto_saida"
									bind:value={addMinutoSaida}
									>{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}</select
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
								disabled={pendingAdd || !policialId || !dataPlantao}
							>
								{pendingAdd ? '...' : '＋'}
							</button>
						</div>
					</div>
				</form>
			{/if}
		</div>
	{/if}

	{#if isFDS}
		<!-- =========== FDS: Toolbar (copiar + gerenciar dias) =========== -->
		<div class="flex flex-wrap items-center justify-between gap-2 mb-3">
			<button
				type="button"
				onclick={copiarParaWhatsApp}
				class="btn text-xs font-semibold px-3 py-2 rounded-xl border border-success-500/40 bg-success-500/10 text-success-700 dark:text-success-400 hover:bg-success-500/20 transition-colors flex items-center gap-2"
			>
				<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
					<path
						d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"
					/>
					<path
						d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.123 1.535 5.849L.057 23.571a.75.75 0 00.921.921l5.783-1.478A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.89 0-3.663-.524-5.18-1.435l-.37-.221-3.836.981.998-3.748-.242-.386A9.96 9.96 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"
					/>
				</svg>
				Copiar para WhatsApp
			</button>

			{#if !documentoAssinadoInfo?.existe && !finalizadaEm}
				<button
					type="button"
					onclick={abrirEditarDiasModal}
					class="btn text-xs font-semibold px-3 py-2 rounded-xl border border-warning-500/40 bg-warning-500/10 text-warning-700 dark:text-warning-400 hover:bg-warning-500/20 transition-colors flex items-center gap-2"
				>
					<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
						/>
					</svg>
					Editar Qtd. dias ({diasEscalaLocal.length})
				</button>
			{/if}
		</div>

		<!-- =========== FDS: Containers por dia =========== -->
		<div class="space-y-4">
			{#each diasEscalaLocal as dia}
				{@const diaItems = policiaisEscalaLocal
					.filter((p) => p.data_plantao === dia)
					.sort((a, b) => {
						if (a.cargo !== b.cargo) return a.cargo === 'DPC' ? -1 : 1;
						return a.nome.localeCompare(b.nome);
					})}
				{@const dpcs = diaItems.filter((p) => p.cargo === 'DPC').length}
				{@const oips = diaItems.filter((p) => p.cargo === 'OIP').length}
				{@const addHere = fdsAddingDia === dia}

				<div
					class="rounded-2xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-white/10 shadow-md overflow-visible"
				>
					<!-- Header do dia -->
					<div
						class="flex items-center justify-between gap-3 px-4 py-3 bg-surface-50 dark:bg-surface-800/50 border-b border-surface-100 dark:border-white/5 rounded-t-2xl"
					>
						<div class="flex flex-col gap-1 min-w-0">
							<span class="font-bold text-sm text-surface-900 dark:text-surface-50">
								{diaSemanaLabel(dia)}, {formatarData(dia)}
							</span>
							{#if dpcs > 0 || oips > 0}
								<div class="flex gap-1.5">
									{#if dpcs > 0}
										<span
											class="badge text-[0.55rem] font-bold px-1.5 py-0.5 bg-primary-500/15 text-primary-700 dark:text-primary-300 border border-primary-500/20 rounded"
										>
											{dpcs} DPC
										</span>
									{/if}
									{#if oips > 0}
										<span
											class="badge text-[0.55rem] font-bold px-1.5 py-0.5 bg-warning-500/15 text-warning-700 dark:text-warning-300 border border-warning-500/20 rounded"
										>
											{oips} OIP
										</span>
									{/if}
								</div>
							{/if}
						</div>
						{#if !documentoAssinadoInfo?.existe && !finalizadaEm}
							<div class="flex gap-1.5 shrink-0">
								<button
									type="button"
									class="btn text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors
										{addHere && fdsAddingCargo === 'DPC'
										? 'border-primary-500 bg-primary-500/20 text-primary-700 dark:text-primary-300'
										: 'border-primary-500/30 bg-primary-500/10 text-primary-700 dark:text-primary-300 hover:bg-primary-500/20'}"
									onclick={() => openFdsAdd(dia, 'DPC')}
								>
									+ DPC
								</button>
								<button
									type="button"
									class="btn text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors
										{addHere && fdsAddingCargo === 'OIP'
										? 'border-warning-500 bg-warning-500/20 text-warning-700 dark:text-warning-300'
										: 'border-warning-500/30 bg-warning-500/10 text-warning-700 dark:text-warning-300 hover:bg-warning-500/20'}"
									onclick={() => openFdsAdd(dia, 'OIP')}
								>
									+ OIP
								</button>
							</div>
						{/if}
					</div>

					<!-- Lista de servidores do dia -->
					{#if diaItems.length > 0}
						<div class="divide-y divide-surface-100 dark:divide-white/5">
							{#each diaItems as p (p.id)}
								{#if editingId === p.id}
									<!-- Formulário de edição inline -->
									<div class="px-4 py-3 bg-primary-500/5 dark:bg-primary-500/8">
										<p
											class="text-[0.6rem] font-semibold text-primary-600 dark:text-primary-400 mb-2 uppercase tracking-wide"
										>
											Editando: {p.nome}
										</p>
										<form
											method="POST"
											action="?/editar"
											use:enhance={handleEditar}
											class="flex items-end gap-1.5 flex-wrap"
										>
											<input type="hidden" name="item_id" value={editingId} />
											<div class="shrink-0">
												<span class="label-text text-[0.55rem] block mb-0.5">Início</span>
												<input
													type="date"
													class="input text-xs h-8 px-1 rounded-lg w-[7.5rem]"
													bind:value={editDataEntrada}
												/>
											</div>
											<div class="shrink-0">
												<span class="label-text text-[0.55rem] block mb-0.5">Saída</span>
												<input
													type="date"
													class="input text-xs h-8 px-1 rounded-lg w-[7.5rem]"
													bind:value={editDataSaida}
												/>
											</div>
											<div class="shrink-0">
												<span class="label-text text-[0.55rem] block mb-0.5">Entrada</span>
												<div class="flex gap-1">
													<select
														class="select text-xs h-8 py-0 rounded-lg px-1 w-12"
														bind:value={editHoraEntrada}
													>
														{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
													</select>
													<select
														class="select text-xs h-8 py-0 rounded-lg px-1 w-12"
														bind:value={editMinutoEntrada}
													>
														{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}
													</select>
												</div>
											</div>
											<div class="shrink-0">
												<span class="label-text text-[0.55rem] block mb-0.5">Saída hr</span>
												<div class="flex gap-1">
													<select
														class="select text-xs h-8 py-0 rounded-lg px-1 w-12"
														bind:value={editHoraSaida}
													>
														{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
													</select>
													<select
														class="select text-xs h-8 py-0 rounded-lg px-1 w-12"
														bind:value={editMinutoSaida}
													>
														{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}
													</select>
												</div>
											</div>
											<div class="flex gap-1 ml-auto shrink-0">
												<button
													type="submit"
													class="btn btn-sm h-8 preset-filled-primary-500 rounded-lg px-3 font-bold"
													disabled={pendingEditar}
												>
													{pendingEditar ? '...' : 'Salvar'}
												</button>
												<button
													type="button"
													class="w-8 h-8 flex items-center justify-center rounded-lg border border-surface-300 dark:border-surface-600 text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-sm font-bold"
													onclick={() => (editingId = null)}>×</button
												>
											</div>
											<input
												type="hidden"
												name="hora_entrada"
												value="{editHoraEntrada}:{editMinutoEntrada}"
											/>
											<input
												type="hidden"
												name="hora_saida"
												value="{editHoraSaida}:{editMinutoSaida}"
											/>
											<input type="hidden" name="data_plantao" value={editDataEntrada} />
											<input type="hidden" name="data_saida" value={editDataSaida} />
											<input type="hidden" name="observacoes" value={editObservacoes} />
										</form>
									</div>
								{:else}
									<!-- Card do servidor (responsivo mobile) -->
									<div
										class="flex items-start justify-between gap-3 px-4 py-3 hover:bg-surface-50/50 dark:hover:bg-surface-800/20 transition-colors"
									>
										<div class="flex-1 min-w-0">
											<div class="flex items-center flex-wrap gap-1.5 mb-0.5">
												<span
													class="font-semibold text-sm text-surface-900 dark:text-surface-100 uppercase leading-tight"
												>
													{p.nome}
												</span>
												<span
													class="badge px-1.5 py-0.5 rounded text-[0.55rem] font-bold uppercase shrink-0
													{p.cargo === 'DPC'
														? 'bg-primary-500/15 text-primary-700 dark:text-primary-400 border border-primary-500/20'
														: 'bg-warning-500/15 text-warning-700 dark:text-warning-400 border border-warning-500/20'}"
												>
													{p.cargo}
												</span>
											</div>
											<div class="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-surface-500">
												<span>{p.matricula}</span>
												{#if p.telefone}<span>{p.telefone}</span>{/if}
												<span class="max-w-[200px] truncate">{p.lotacao || '-'}</span>
												<span
													class="font-medium text-surface-600 dark:text-surface-400 whitespace-nowrap"
													>{formatarHorario(p)}</span
												>
											</div>
										</div>
										{#if !documentoAssinadoInfo?.existe && !finalizadaEm}
											<div class="flex items-center gap-1 shrink-0 mt-0.5">
												<button
													type="button"
													title="Editar"
													class="p-1.5 rounded transition-colors text-surface-400 hover:text-primary-500 hover:bg-primary-500/10"
													onclick={() => {
														editingId = null;
														startEdit(p);
														repetindoId = null;
														repeticaoDatas = [];
													}}
												>
													<svg
														class="w-3.5 h-3.5"
														fill="none"
														viewBox="0 0 24 24"
														stroke="currentColor"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
														/>
													</svg>
												</button>
												<button
													type="button"
													title="Repetir em outros dias"
													class="p-1.5 rounded transition-colors {repetindoId === p.id
														? 'text-success-600 dark:text-success-400 bg-success-500/10'
														: 'text-surface-400 hover:text-success-600 hover:bg-success-500/10'}"
													onclick={() => {
														editingId = null;
														openRepetir(p);
													}}
												>
													<svg
														class="w-3.5 h-3.5"
														fill="none"
														viewBox="0 0 24 24"
														stroke="currentColor"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
														/>
													</svg>
												</button>
												<button
													type="button"
													class="btn btn-sm preset-filled-error-500 rounded font-bold text-[0.65rem] uppercase px-2 py-0.5"
													onclick={() => solicitarRemocao(p.id, p.nome)}
												>
													Rem.
												</button>
											</div>
										{/if}
									</div>
								{/if}
								{#if repetindoId === p.id}
									{@const jaAdicionados = diasJaAdicionadosPolicial(p.policial_id)}
									<div
										class="border-t border-success-200 dark:border-success-500/15 px-4 py-3 bg-success-500/5 dark:bg-success-500/8"
									>
										<p
											class="text-[0.65rem] font-semibold text-success-700 dark:text-success-400 mb-2"
										>
											Adicionar <span class="uppercase">{p.nome}</span> em outros dias:
										</p>
										<form method="POST" action="?/repetir" use:enhance={handleRepetir}>
											<input type="hidden" name="policial_id" value={p.policial_id} />
											<input type="hidden" name="hora_entrada" value={getHoraEntrada(p)} />
											<input type="hidden" name="hora_saida" value={getHoraSaida(p)} />
											<input type="hidden" name="equipe" value={p.equipe || '1'} />
											<input type="hidden" name="datas" value={repeticaoDatasJson} />
											<div class="flex flex-wrap gap-1.5 mb-3">
												{#each diasEscalaLocal as d}
													{@const jaAdicionado = jaAdicionados.has(d)}
													<button
														type="button"
														disabled={jaAdicionado}
														class="px-2 py-1 text-[0.65rem] font-bold rounded-md border transition-all {jaAdicionado
															? 'bg-surface-100 dark:bg-surface-800 text-surface-300 dark:text-surface-600 border-surface-200 dark:border-white/5 cursor-not-allowed line-through'
															: repeticaoDatas.includes(d)
																? 'bg-success-500 text-white border-success-500'
																: 'bg-surface-50 dark:bg-surface-800/50 text-surface-600 dark:text-surface-400 border-surface-200 dark:border-white/10 hover:border-success-500/50'}"
														onclick={() => {
															if (!jaAdicionado) toggleRepeticaoData(d);
														}}
													>
														{diaSemanaLabel(d)}
														{formatarData(d)}
													</button>
												{/each}
											</div>
											<div class="flex gap-1.5 flex-wrap">
												<button
													type="submit"
													class="btn text-xs font-bold h-8 px-4 rounded-lg bg-success-600 text-white hover:bg-success-700 disabled:opacity-50"
													disabled={pendingRepetir || repeticaoDatas.length === 0}
												>
													{pendingRepetir
														? 'Adicionando...'
														: `Adicionar em ${repeticaoDatas.length || '–'} dia(s)`}
												</button>
												<button
													type="button"
													class="h-8 px-3 rounded-lg text-xs border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
													onclick={() => openRepetir(p)}
												>
													Cancelar
												</button>
											</div>
										</form>
									</div>
								{/if}
							{/each}
						</div>
					{:else if !addHere}
						<div class="px-4 py-8 text-center text-xs text-surface-400 dark:text-surface-500">
							Nenhum servidor adicionado neste dia
						</div>
					{/if}

					<!-- Formulário de adição inline (aparece ao clicar +DPC ou +OIP) -->
					{#if addHere}
						<div
							id="fds-add-{dia}"
							class="border-t border-surface-100 dark:border-white/5 px-4 py-3
							{fdsAddingCargo === 'DPC'
								? 'bg-primary-500/5 dark:bg-primary-500/8'
								: 'bg-warning-500/5 dark:bg-warning-500/8'}"
						>
							<p
								class="text-[0.65rem] font-semibold mb-2
								{fdsAddingCargo === 'DPC'
									? 'text-primary-600 dark:text-primary-400'
									: 'text-warning-600 dark:text-warning-400'}"
							>
								Adicionar {fdsAddingCargo} — {diaSemanaLabel(dia)}, {formatarData(dia)}
							</p>
							<form method="POST" action="?/adicionar" use:enhance={handleFdsAdd}>
								<input type="hidden" name="data_plantao" value={dia} />
								<input type="hidden" name="equipe" value="1" />
								<div class="flex flex-wrap items-end gap-2">
									<div class="flex-1 min-w-[200px] max-w-sm">
										{#key (fdsAddingDia ?? '') + (fdsAddingCargo ?? '')}
											<SearchableSelect
												name="policial_id"
												bind:value={fdsPolicialId}
												loadOptions={buscarPoliciaisFds}
												placeholder="Digite para buscar servidor..."
												class="w-full"
											/>
										{/key}
									</div>
									<div class="shrink-0">
										<span class="label-text text-[0.65rem] block mb-0.5">Entrada</span>
										<div class="flex gap-1">
											<select
												class="select text-xs h-9 py-0 px-2"
												name="hora_entrada"
												bind:value={fdsAddHoraEntrada}
											>
												{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
											</select>
											<select
												class="select text-xs h-9 py-0 px-2"
												name="minuto_entrada"
												bind:value={fdsAddMinutoEntrada}
											>
												{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}
											</select>
										</div>
									</div>
									<div class="shrink-0">
										<span class="label-text text-[0.65rem] block mb-0.5">Saída</span>
										<div class="flex gap-1">
											<select
												class="select text-xs h-9 py-0 px-2"
												name="hora_saida"
												bind:value={fdsAddHoraSaida}
											>
												{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
											</select>
											<select
												class="select text-xs h-9 py-0 px-2"
												name="minuto_saida"
												bind:value={fdsAddMinutoSaida}
											>
												{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}
											</select>
										</div>
									</div>
									<div class="flex gap-1.5 shrink-0">
										<button
											type="submit"
											class="btn text-xs font-bold h-9 px-4 rounded-lg
												{fdsAddingCargo === 'DPC' ? 'preset-filled-primary-500' : 'preset-filled-warning-500'}"
											disabled={pendingAdd || !fdsPolicialId}
										>
											{pendingAdd ? '...' : 'Adicionar'}
										</button>
										<button
											type="button"
											class="h-9 px-3 rounded-lg text-xs border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
											onclick={cancelFdsAdd}
										>
											Cancelar
										</button>
									</div>
								</div>
							</form>
						</div>
					{/if}
				</div>
			{/each}
		</div>

		<!-- Modal: Editar dias da escala -->
		<Dialog open={showEditarDiasModal} onOpenChange={(e) => (showEditarDiasModal = e.open)}>
			<Dialog.Content
				class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm"
			>
				<div
					class="card w-full max-w-sm bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-warning-500/20 p-5 space-y-4"
				>
					<div>
						<Dialog.Title class="font-bold text-base">Editar Qtd. dias da escala</Dialog.Title>
						<Dialog.Description class="text-xs text-surface-500 mt-0.5">
							Selecione os dias. Dias com policiais escalados não podem ser removidos.
						</Dialog.Description>
					</div>

					<!-- Calendário -->
					<div class="rounded-xl border border-surface-200 dark:border-surface-700 p-3 space-y-2">
						<div class="flex items-center justify-between">
							<button
								type="button"
								onclick={editCalMesAnterior}
								class="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-200 dark:hover:bg-surface-700 text-surface-600 dark:text-surface-300 transition-colors text-sm font-bold"
								>‹</button
							>
							<span class="text-xs font-semibold text-surface-700 dark:text-surface-200">
								{MESES_CAL_ED[editCalMes]}
								{editCalAno}
							</span>
							<button
								type="button"
								onclick={editCalMesProximo}
								class="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-200 dark:hover:bg-surface-700 text-surface-600 dark:text-surface-300 transition-colors text-sm font-bold"
								>›</button
							>
						</div>
						<div
							class="grid grid-cols-7 gap-px text-center text-[0.55rem] font-semibold uppercase tracking-wide text-surface-400 py-0.5"
						>
							{#each DIAS_SEM_ED as ds}<span>{ds}</span>{/each}
						</div>
						<div class="grid grid-cols-7 gap-0.5">
							{#each editCalGrade as cell}
								{#if cell}
									{@const iso = editIsoLocal(editCalAno, editCalMes, cell.day)}
									{@const sel = editDiasSelecionados.includes(iso)}
									<button
										type="button"
										onclick={() => editCalToggle(iso)}
										class="h-9 rounded-md text-xs font-medium transition-colors border flex items-center justify-center touch-manipulation
											{sel
											? 'border-warning-500 bg-warning-500/15 text-warning-900 dark:text-warning-100'
											: 'border-transparent bg-surface-100/80 dark:bg-surface-700/50 text-surface-700 dark:text-surface-200 hover:bg-surface-200/80 dark:hover:bg-surface-600'}"
										aria-pressed={sel}
									>
										{cell.day}
									</button>
								{:else}
									<div class="h-9"></div>
								{/if}
							{/each}
						</div>
					</div>

					<!-- Dias selecionados -->
					{#if editDiasOrdenados.length > 0}
						<div class="space-y-0.5">
							<span class="text-[0.65rem] font-semibold text-surface-500">
								Dias selecionados ({editDiasOrdenados.length}) — todos os dias entre o primeiro e o
								último são incluídos
							</span>
							<div class="flex flex-wrap gap-1.5">
								{#each editDiasOrdenados as iso}
									<span
										class="inline-flex items-center gap-0.5 pl-1.5 pr-0.5 py-0.5 rounded-md text-[0.65rem] font-medium border shrink-0 border-warning-400/80 bg-warning-500/10 text-warning-900 dark:text-warning-100"
									>
										{editFmtDia(iso)}
										<button
											type="button"
											aria-label="Remover dia {editFmtDia(iso)}"
											class="p-0.5 rounded text-surface-400 hover:text-error-600 dark:hover:text-error-400"
											onclick={() => editCalToggle(iso)}
										>
											<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M6 18L18 6M6 6l12 12"
												/>
											</svg>
										</button>
									</span>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Ações -->
					<div class="flex justify-end gap-2 pt-1">
						<button
							type="button"
							class="btn text-xs px-3 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
							onclick={() => (showEditarDiasModal = false)}
						>
							Cancelar
						</button>
						<form
							method="POST"
							action="?/editarDiasEscala"
							use:enhance={handleEditarDias}
							class="contents"
						>
							<input type="hidden" name="datas" value={editDiasJson} />
							<button
								type="submit"
								class="btn text-xs font-bold px-4 py-1.5 rounded-lg preset-filled-warning-500"
								disabled={pendingEditarDias || editDiasOrdenados.length === 0}
							>
								{pendingEditarDias ? 'Salvando...' : 'Salvar dias'}
							</button>
						</form>
					</div>
				</div>
			</Dialog.Content>
		</Dialog>
	{:else if policiaisEscalaLocal.length === 0}
		<div class="text-center py-12 text-surface-500"><p>Nenhum policial nesta escala ainda.</p></div>
	{:else}
		<!-- Agrupado por data (plantao/expediente) -->
		<div class="space-y-12">
			{#each agruparPorData(policiaisEscalaLocal) as [dataGrupo, items]}
				<div
					class="card p-0 bg-white dark:bg-surface-900 border border-surface-200 dark:border-white/10 rounded-2xl shadow-xl overflow-visible"
				>
					<div class="table-container p-2">
						<table class="table w-full text-[0.7rem] sm:text-xs !bg-transparent">
							<thead>
								<tr class="!bg-transparent border-b border-surface-100 dark:border-white/5">
									<th class="!py-4 !px-4 text-surface-500 font-medium uppercase tracking-tight"
										>Nome</th
									>
									<th
										class="!py-4 text-center text-surface-500 font-medium uppercase tracking-tight"
										>Matricula</th
									>
									<th
										class="!py-4 text-center text-surface-500 font-medium uppercase tracking-tight"
										>Cargo</th
									>
									<th
										class="!py-4 text-center text-surface-500 font-medium uppercase tracking-tight"
										>Telefone</th
									>
									<th class="!py-4 text-surface-500 font-medium uppercase tracking-tight"
										>Lotação</th
									>
									<th
										class="!py-4 text-center text-surface-500 font-medium uppercase tracking-tight"
										>Data</th
									>
									<th
										class="!py-4 text-center text-surface-500 font-medium uppercase tracking-tight"
										>Horário</th
									>
									<th
										class="!py-4 !px-4 text-right text-surface-500 font-medium uppercase tracking-tight"
										>Ações</th
									>
								</tr>
							</thead>
							<tbody class="divide-y divide-surface-100 dark:divide-white/5">
								{#each items as p (p.id)}
									{#if editingId === p.id}
										<tr class="!bg-primary-500/5">
											<td colspan="8" class="!py-4 !px-4">
												<form
													method="POST"
													action="?/editar"
													use:enhance={handleEditar}
													class="flex flex-wrap items-end gap-3"
												>
													<input type="hidden" name="item_id" value={editingId} />
													<div class="flex-1 min-w-[120px]">
														<label class="label mb-1">
															<span class="label-text text-[0.6rem]">Data Início</span>
															<input
																type="date"
																class="input text-xs h-8 px-2 rounded-lg"
																bind:value={editDataEntrada}
															/>
														</label>
													</div>
													<div class="flex-1 min-w-[120px]">
														<label class="label mb-1">
															<span class="label-text text-[0.6rem]">Data Saída</span>
															<input
																type="date"
																class="input text-xs h-8 px-2 rounded-lg"
																bind:value={editDataSaida}
															/>
														</label>
													</div>
													<div class="w-28">
														<label class="label mb-1">
															<span class="label-text text-[0.6rem]">Entrada</span>
															<div class="flex gap-1">
																<select
																	class="select text-xs h-8 py-0 rounded-lg flex-1 px-1"
																	bind:value={editHoraEntrada}
																	aria-label="Hora de Entrada"
																>
																	{#each horas as h (h)}<option value={h}>{h}</option>{/each}
																</select>
																<select
																	class="select text-xs h-8 py-0 rounded-lg flex-1 px-1"
																	bind:value={editMinutoEntrada}
																	aria-label="Minuto de Entrada"
																>
																	{#each minutos as m (m)}<option value={m}>{m}</option>{/each}
																</select>
															</div>
														</label>
													</div>
													<div class="w-28">
														<label class="label mb-1">
															<span class="label-text text-[0.6rem]">Saída</span>
															<div class="flex gap-1">
																<select
																	class="select text-xs h-8 py-0 rounded-lg flex-1 px-1"
																	bind:value={editHoraSaida}
																	aria-label="Hora de Saída"
																>
																	{#each horas as h (h)}<option value={h}>{h}</option>{/each}
																</select>
																<select
																	class="select text-xs h-8 py-0 rounded-lg flex-1 px-1"
																	bind:value={editMinutoSaida}
																	aria-label="Minuto de Saída"
																>
																	{#each minutos as m (m)}<option value={m}>{m}</option>{/each}
																</select>
															</div>
														</label>
													</div>
													<div class="flex gap-1">
														<button
															type="submit"
															class="btn btn-sm h-8 preset-filled-primary-500 rounded-lg px-3 font-bold"
															disabled={pendingEditar}
														>
															{pendingEditar ? 'Salvando...' : 'Salvar'}
														</button>
														<button
															type="button"
															class="w-8 h-8 flex items-center justify-center rounded-lg border border-surface-300 dark:border-surface-600 text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-sm font-bold"
															onclick={() => (editingId = null)}>×</button
														>
													</div>
													<input
														type="hidden"
														name="hora_entrada"
														value="{editHoraEntrada}:{editMinutoEntrada}"
													/>
													<input
														type="hidden"
														name="hora_saida"
														value="{editHoraSaida}:{editMinutoSaida}"
													/>
													<input type="hidden" name="data_plantao" value={editDataEntrada} />
													<input type="hidden" name="data_saida" value={editDataSaida} />
													<input type="hidden" name="observacoes" value={editObservacoes} />
												</form>
											</td>
										</tr>
									{:else}
										<tr
											class="!bg-transparent hover:!bg-surface-100/50 dark:hover:!bg-surface-800/20 transition-colors"
										>
											<td class="!py-4 !px-4 align-middle">
												<span
													class="font-bold text-surface-900 dark:text-surface-100 uppercase block leading-tight"
												>
													{p.nome}
												</span>
												{#if p.equipe && !isFDS}
													<span
														class="text-[0.6rem] text-primary-600 dark:text-primary-400 font-bold uppercase"
													>
														Equipe {p.equipe}
													</span>
												{/if}
											</td>
											<td class="!py-4 text-center align-middle opacity-80">{p.matricula}</td>
											<td class="!py-4 text-center align-middle">
												<span
													class="badge px-1.5 py-0.5 rounded font-bold text-[0.55rem] uppercase {p.cargo ===
													'DPC'
														? 'bg-primary-500/20 text-primary-700 dark:text-primary-400 border border-primary-500/20'
														: 'bg-warning-500/20 text-warning-700 dark:text-warning-400 border border-warning-500/20'}"
												>
													{p.cargo}
												</span>
											</td>
											<td class="!py-4 text-center align-middle text-surface-500 whitespace-nowrap"
												>{p.telefone || '-'}</td
											>
											<td class="!py-4 align-middle text-surface-500 leading-tight max-w-[150px]"
												>{p.lotacao || '-'}</td
											>
											<td class="!py-4 text-center align-middle">
												<div
													class="inline-block px-2 py-1 rounded border border-dashed border-surface-200 dark:border-surface-700 bg-surface-50/50 dark:bg-surface-800/30 text-[0.6rem] whitespace-nowrap"
												>
													{formatarDataPlantao(p)}
												</div>
											</td>
											<td class="!py-4 text-center align-middle">
												<div
													class="inline-block px-2 py-1 rounded border border-dashed border-surface-200 dark:border-surface-700 bg-surface-50/50 dark:bg-surface-800/30 text-[0.6rem] font-bold uppercase whitespace-nowrap"
												>
													{formatarHorario(p)}
												</div>
											</td>
											<td class="!py-4 !px-4 text-right align-middle">
												<div class="flex items-center justify-end gap-1">
													{#if !documentoAssinadoInfo?.existe && !finalizadaEm}
														<button
															type="button"
															title="Editar"
															class="p-1.5 rounded transition-colors text-surface-400 hover:text-primary-500 hover:bg-primary-500/10"
															onclick={() => startEdit(p)}
														>
															<svg
																class="w-3.5 h-3.5"
																fill="none"
																viewBox="0 0 24 24"
																stroke="currentColor"
															>
																<path
																	stroke-linecap="round"
																	stroke-linejoin="round"
																	stroke-width="2"
																	d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
																/>
															</svg>
														</button>
														<button
															type="button"
															class="btn btn-sm preset-filled-error-500 rounded font-bold text-[0.65rem] uppercase px-2 py-0.5"
															onclick={() => solicitarRemocao(p.id, p.nome)}
														>
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
