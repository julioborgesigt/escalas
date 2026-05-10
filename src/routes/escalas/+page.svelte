<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import { Dialog, Popover, Portal } from '@skeletonlabs/skeleton-svelte';
	import { browser } from '$app/environment';
	import type { EscalaListagem, Unidade } from '$lib/types';
	import { formatarData } from '$lib/utils';
	import { csrfHeaders } from '$lib/csrf';
	import { useAutorizacao, getSavedFilters, useAssinaturaEscala, useMobile } from '$lib/composables';
	import PaginationControls from '$lib/components/PaginationControls.svelte';
	import SignaturePad from '$lib/components/SignaturePad.svelte';
	import PainelAssinaturaToken from '$lib/components/PainelAssinaturaToken.svelte';
	import { page } from '$app/state';

	let { data, form } = $props();

	const auth = useAutorizacao();
	const isAdmin = $derived(auth.isAdmin);
	const isAdminSeccional = $derived(auth.isAdminSeccional);
	const lotacaoUsuario = $derived(auth.lotacaoUsuario);
	const papelUnidadeId = $derived(data.papelUnidadeId as number | null);
	const savedFilters = getSavedFilters('filtros_escalas', {
		lotacao: '',
		mes: new Date().getMonth() + 1,
		ano: new Date().getFullYear(),
		tipo: 'todos',
		seccional: 'todas',
		busca: ''
	});

	const unidades = $derived(data.unidades as Unidade[]);

	/** Página atual vem só do servidor — mudanças de página atualizam a URL (`goto`). */
	const paginaAtual = $derived(data.pagination.page);

	// Filtros — inicializa com valores do server ou localStorage
	let filtroLotacao = $state(untrack(() => data.filtros.lotacao || savedFilters.lotacao));
	let filtroMes = $state(untrack(() => data.filtros.mes || savedFilters.mes));
	let filtroAno = $state(untrack(() => data.filtros.ano || savedFilters.ano));
	let filtroTipo = $state(untrack(() => data.filtros.tipo || savedFilters.tipo));
	let filtroSeccional = $state<number | 'todas'>(
		(savedFilters.seccional as unknown as number) || 'todas'
	);
	let filtroBusca = $state(untrack(() => data.filtros.busca || savedFilters.busca));

	// Salvar filtros no localStorage a cada mudança
	$effect(() => {
		if (browser) {
			localStorage.setItem(
				'filtros_escalas',
				JSON.stringify({
					lotacao: filtroLotacao,
					mes: filtroMes,
					ano: filtroAno,
					tipo: filtroTipo,
					seccional: filtroSeccional,
					busca: filtroBusca
				})
			);
		}
	});

	const seccionais = $derived(unidades.filter((u: Unidade) => u.tipo === 'seccional'));
	const delegaciasDropdown = $derived(
		filtroSeccional === 'todas'
			? unidades.filter((u: Unidade) => u.tipo === 'delegacia')
			: unidades.filter(
					(u: Unidade) => u.tipo === 'delegacia' && u.seccional_id === filtroSeccional
				)
	);
	// Unidades visíveis para admin_seccional (somente delegacias da sua seccional)
	const delegaciasDaSeccional = $derived(
		unidades.filter((u: Unidade) => u.tipo === 'delegacia' && u.seccional_id === papelUnidadeId)
	);

	const escalas = $derived((data.escalas ?? []) as EscalaListagem[]);
	const totalPaginas = $derived(data.pagination.totalPages);
	const ITEMS_POR_PAGINA = 20;

	let dialogOpen = $state(false);
	let dialogRevogarOpen = $state(false);
	let escalaParaExcluir = $state<{ id: number; titulo: string } | null>(null);
	let escalaParaRevogar = $state<{ id: number; titulo: string } | null>(null);
	let pendingExcluir = $state(false);
	let pendingRevogar = $state(false);

	const meses = [
		{ value: 0, label: 'Todos' },
		{ value: 1, label: 'Janeiro' },
		{ value: 2, label: 'Fevereiro' },
		{ value: 3, label: 'Março' },
		{ value: 4, label: 'Abril' },
		{ value: 5, label: 'Maio' },
		{ value: 6, label: 'Junho' },
		{ value: 7, label: 'Julho' },
		{ value: 8, label: 'Agosto' },
		{ value: 9, label: 'Setembro' },
		{ value: 10, label: 'Outubro' },
		{ value: 11, label: 'Novembro' },
		{ value: 12, label: 'Dezembro' }
	];
	const anos = [0, ...Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 1 + i)];

	function buildQueryParamsComFiltros(page: number) {
		const params = new URLSearchParams();
		if (filtroLotacao && filtroLotacao !== 'todas') {
			params.set('lotacao', filtroLotacao);
		}
		if (filtroMes) params.set('mes', String(filtroMes));
		if (filtroAno) params.set('ano', String(filtroAno));
		if (filtroTipo && filtroTipo !== 'todos') params.set('tipo', filtroTipo);
		if (filtroBusca) params.set('busca', filtroBusca);
		params.set('page', String(page));
		return params.toString();
	}

	function navegarComFiltros() {
		goto(`?${buildQueryParamsComFiltros(1)}`, { keepFocus: true, noScroll: true });
	}

	function irParaPaginaListagem(p: number) {
		goto(`?${buildQueryParamsComFiltros(p)}`, { keepFocus: true, noScroll: true });
	}

	function limparFiltros() {
		filtroSeccional = 'todas';
		filtroLotacao = 'todas';
		filtroMes = new Date().getMonth() + 1;
		filtroAno = new Date().getFullYear();
		filtroTipo = 'todos';
		filtroBusca = '';
		navegarComFiltros();
	}

	function solicitarExclusao(id: number, titulo: string) {
		escalaParaExcluir = { id, titulo };
		dialogOpen = true;
	}

	let escalaAbrirComSolicitacao = $state<number | null>(null);
	let dialogRevogarSolicitacaoOpen = $state(false);

	function solicitarEdicao(esc: EscalaListagem) {
		if (esc.is_assinada) {
			escalaParaRevogar = { id: esc.id, titulo: esc.titulo };
			dialogRevogarOpen = true;
		} else if (podeOIPSolicitar && solicitacoesMap[esc.id]) {
			escalaAbrirComSolicitacao = esc.id;
			dialogRevogarSolicitacaoOpen = true;
		} else {
			goto(`/escalas/${esc.id}`);
		}
	}

	async function confirmarRevogacao() {
		if (!escalaParaRevogar) return;
		pendingRevogar = true;
		const id = escalaParaRevogar.id;
		dialogRevogarOpen = false;

		const res = await fetch(`/api/escalas/${id}/documento-assinado`, {
			method: 'DELETE',
			headers: csrfHeaders()
		});
		pendingRevogar = false;
		if (res.ok) {
			toaster.create({
				title: 'Assinatura revogada',
				description: 'A escala agora pode ser editada.',
				type: 'info'
			});
			goto(`/escalas/${id}`);
		} else {
			const err = await res.json().catch(() => ({}));
			toaster.create({
				title: err.error || 'Erro ao revogar assinatura',
				type: 'error'
			});
		}
		escalaParaRevogar = null;
	}

	const temFiltros = $derived(
		filtroSeccional !== 'todas' ||
			filtroLotacao !== 'todas' ||
			filtroMes !== new Date().getMonth() + 1 ||
			filtroAno !== new Date().getFullYear() ||
			filtroTipo !== 'todos'
	);

	function handleExcluir() {
		pendingExcluir = true;
		return async ({ result }: { result: any }) => {
			pendingExcluir = false;
			if (result.type === 'success') {
				toaster.create({
					title: `Escala de ${escalaParaExcluir!.titulo} removida`,
					type: 'success'
				});
				dialogOpen = false;
				escalaParaExcluir = null;
				await invalidateAll();
			} else {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error || 'Erro ao remover'), type: 'error' });
			}
		};
	}

	// ========== Modal Nova Escala ==========
	const MESES_PT_NE = [
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
	const DIAS_SEM_NE = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

	let dialogNovaEscalaAberto = $state(false);
	let novaEscalaTipo = $state<'plantao' | 'expediente' | 'fds' | null>(null);
	let pendingCriar = $state(false);
	let pendingComBase = $state(false);
	let neTitulo = $state('');
	let neCidade = $state('');
	let neDataInicio = $state('');
	let neDataFim = $state('');
	let neHoraEntrada = $state('00');
	let neMinutoEntrada = $state('00');
	let neHoraSaida = $state('23');
	let neMinutoSaida = $state('59');
	let neLotacao = $state('');

	let nePickerAno = $state(new Date().getFullYear());

	let fdsDiasSelecionados = $state<string[]>([]);
	let calAno = $state(new Date().getFullYear());
	let calMes = $state(new Date().getMonth());
	let fdsHoraEntrada = $state('08');
	let fdsMinutoEntrada = $state('00');
	let fdsHoraSaida = $state('08');
	let fdsMinutoSaida = $state('00');

	const delegaciasNE = $derived(unidades.filter((u: Unidade) => u.tipo === 'delegacia'));
	const unidadeNovaEscala = $derived(
		isAdmin
			? (delegaciasNE.find((u: Unidade) => u.nome === neLotacao) ?? null)
			: (unidades.find((u: Unidade) => u.nome === lotacaoUsuario) ?? null)
	);
	const fdsDiasOrdenadosNE = $derived([...fdsDiasSelecionados].sort());
	const fdsDataInicioNE = $derived(fdsDiasOrdenadosNE[0] ?? '');
	const fdsDataFimNE = $derived(fdsDiasOrdenadosNE.at(-1) ?? '');
	const fdsLotacaoNE = $derived(isAdmin ? neLotacao : (lotacaoUsuario ?? ''));
	const fdsCidadeNE = $derived(unidadeNovaEscala?.cidade ?? '');
	const fdsTituloAutoNE = $derived.by(() => {
		if (!fdsLotacaoNE || fdsDiasOrdenadosNE.length === 0) return '';
		const inicio = new Date(fdsDiasOrdenadosNE[0] + 'T00:00:00');
		const fim = new Date(fdsDiasOrdenadosNE.at(-1)! + 'T00:00:00');
		const dS = String(inicio.getDate()).padStart(2, '0');
		const mS = String(inicio.getMonth() + 1).padStart(2, '0');
		const dF = String(fim.getDate()).padStart(2, '0');
		const mF = String(fim.getMonth() + 1).padStart(2, '0');
		return `ESCALA DE PLANTÃO DO FINAL DE SEMANA - ${fdsLotacaoNE.toUpperCase()} - ${dS}/${mS} a ${dF}/${mF}`;
	});
	const gradeCalendarioNE = $derived.by(() => {
		const first = new Date(calAno, calMes, 1).getDay();
		const n = new Date(calAno, calMes + 1, 0).getDate();
		const cells: ({ day: number } | null)[] = [];
		for (let i = 0; i < first; i++) cells.push(null);
		for (let d = 1; d <= n; d++) cells.push({ day: d });
		while (cells.length % 7 !== 0) cells.push(null);
		while (cells.length < 42) cells.push(null);
		return cells;
	});

	// Mês selecionado no picker mensal
	const neMesSelecionado = $derived.by(() => {
		if (!neDataInicio || !novaEscalaTipo || novaEscalaTipo === 'fds') return null;
		const parts = neDataInicio.split('-').map(Number);
		return { mes: parts[1], ano: parts[0] };
	});

	// Informações sobre o mês anterior (para opção "com base no mês passado")
	const mesAnteriorInfo = $derived.by(() => {
		if (!neMesSelecionado || !neLotacao || !novaEscalaTipo || novaEscalaTipo === 'fds') return null;
		const { mes, ano } = neMesSelecionado;
		const mesPrev = mes === 1 ? 12 : mes - 1;
		const anoPrev = mes === 1 ? ano - 1 : ano;
		const existe = (data.escalasExistentes as any[]).some(
			(e) =>
				e.lotacao === neLotacao &&
				e.tipo === novaEscalaTipo &&
				e.mes === mesPrev &&
				e.ano === anoPrev
		);
		return { mes: mesPrev, ano: anoPrev, existe };
	});

	function mesOcupado(mes: number, ano: number): boolean {
		if (!neLotacao || !novaEscalaTipo || novaEscalaTipo === 'fds') return false;
		return (data.escalasExistentes as any[]).some(
			(e) => e.lotacao === neLotacao && e.tipo === novaEscalaTipo && e.mes === mes && e.ano === ano
		);
	}

	function selecionarMesNE(mes: number) {
		const unid = unidadeNovaEscala;
		if (unid && novaEscalaTipo && novaEscalaTipo !== 'fds') {
			preencherMensalNE(novaEscalaTipo, unid, mes, nePickerAno);
		}
	}

	function sabadoDaSemanaLocal(): Date {
		const hoje = new Date();
		const dow = hoje.getDay();
		const offset = dow === 0 ? -1 : 6 - dow;
		const sab = new Date(hoje);
		sab.setDate(hoje.getDate() + offset);
		return sab;
	}
	function toISONE(y: number, m: number, d: number): string {
		return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
	}
	function diasNoMesNE(y: number, m: number): number {
		return new Date(y, m, 0).getDate();
	}
	function nextMesNE(): number {
		const m = new Date().getMonth() + 1;
		return m === 12 ? 1 : m + 1;
	}
	function nextAnoNE(): number {
		const h = new Date();
		return h.getMonth() + 1 === 12 ? h.getFullYear() + 1 : h.getFullYear();
	}
	function isoDiaLocalNE(year: number, month: number, day: number): string {
		return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
	}
	function fmtDiaNE(iso: string): string {
		const [, m, d] = iso.split('-');
		return `${d}/${m}`;
	}

	function tiposDisponiveisNE(u: Unidade) {
		const sab = sabadoDaSemanaLocal();
		const dS = String(sab.getDate()).padStart(2, '0');
		const mS = String(sab.getMonth() + 1).padStart(2, '0');
		const tipos: Array<{
			tipo: 'plantao' | 'expediente' | 'fds';
			label: string;
			desc: string;
			icon: string;
		}> = [];
		if (u.tem_plantao)
			tipos.push({
				tipo: 'plantao',
				label: 'Plantão Mensal',
				desc: `${MESES_PT_NE[nextMesNE() - 1]} ${nextAnoNE()}`,
				icon: '🌙'
			});
		if (u.tem_expediente)
			tipos.push({
				tipo: 'expediente',
				label: 'Expediente Mensal',
				desc: `${MESES_PT_NE[nextMesNE() - 1]} ${nextAnoNE()}`,
				icon: '☀️'
			});
		if (u.tem_fds)
			tipos.push({ tipo: 'fds', label: 'Final de Semana', desc: `FDS ${dS}/${mS}`, icon: '📅' });
		return tipos;
	}

	function preencherMensalNE(tipo: 'plantao' | 'expediente', u: Unidade, mes: number, ano: number) {
		neDataInicio = toISONE(ano, mes, 1);
		neDataFim = toISONE(ano, mes, diasNoMesNE(ano, mes));
		neHoraEntrada = '00';
		neMinutoEntrada = '00';
		neHoraSaida = '23';
		neMinutoSaida = '59';
		const tipoLabel = tipo === 'plantao' ? 'PLANTÃO' : 'EXPEDIENTE';
		neTitulo = `ESCALA DE ${tipoLabel} DA ${u.nome.toUpperCase()} – ${MESES_PT_NE[mes - 1].toUpperCase()} ${ano}`;
		neCidade = u.cidade || '';
		neLotacao = u.nome;
	}

	function escolherTipoNE(tipo: 'plantao' | 'expediente' | 'fds') {
		if (tipo === 'fds') {
			const sab = sabadoDaSemanaLocal();
			const dom = new Date(sab);
			dom.setDate(sab.getDate() + 1);
			const fmt = (d: Date) =>
				`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
			fdsDiasSelecionados = [fmt(sab), fmt(dom)];
			calAno = sab.getFullYear();
			calMes = sab.getMonth();
			fdsHoraEntrada = '08';
			fdsMinutoEntrada = '00';
			fdsHoraSaida = '08';
			fdsMinutoSaida = '00';
		} else {
			neDataInicio = '';
			neDataFim = '';
			neTitulo = '';
			nePickerAno = new Date().getFullYear();
		}
		novaEscalaTipo = tipo;
	}

	const horasNE = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
	const minutosNE = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
	const fdsHorarioLabelNE = $derived(
		`${fdsHoraEntrada}:${fdsMinutoEntrada}H A ${fdsHoraSaida}:${fdsMinutoSaida}H`
	);

	function calToggleDiaNE(iso: string) {
		if (fdsDiasSelecionados.includes(iso)) {
			fdsDiasSelecionados = fdsDiasSelecionados.filter((d) => d !== iso);
		} else {
			fdsDiasSelecionados = [...fdsDiasSelecionados, iso];
		}
	}
	function calRemoverDiaNE(iso: string) {
		fdsDiasSelecionados = fdsDiasSelecionados.filter((d) => d !== iso);
	}
	function calMesAnteriorNE() {
		if (calMes === 0) {
			calMes = 11;
			calAno--;
		} else calMes--;
	}
	function calMesProximoNE() {
		if (calMes === 11) {
			calMes = 0;
			calAno++;
		} else calMes++;
	}

	let visao = $state<'home' | 'lista' | 'assinaturas'>(
		untrack(() => {
			const iv = (data as Record<string, any>).initialView;
			return iv === 'lista' || iv === 'assinaturas' ? (iv as 'lista' | 'assinaturas') : 'home';
		})
	);
	let abriuDoHome = $state(false);

	const podeAssinar = $derived(data.podeAssinar as boolean);
	const escalasParaAssinar = $derived(
		(data.escalasParaAssinar ?? []) as Array<{
			id: number;
			titulo: string;
			cidade: string;
			data_inicio: string;
			data_fim: string;
			tipo: string;
			lotacao: string;
		}>
	);

	// ========== Solicitação de Assinatura (OIP Admins) ==========
	const podeOIPSolicitar = $derived(data.podeOIPSolicitar as boolean ?? false);
	type SolicitacaoInfo = { tipo: 'unidade' | 'respondencia'; destinatario_nome?: string; destinatario_id?: number };
	const solicitacoesMap = $derived((data.solicitacoesMap ?? {}) as Record<number, SolicitacaoInfo>);

	let dialogSolicitar = $state(false);
	let escalaSolicitandoId = $state<number | null>(null);
	let opcaoSolicitacao = $state<'unidade' | 'respondencia'>('unidade');
	let buscaDestinatario = $state('');
	let destinatarioSelecionado = $state<{ id: number; nome: string; lotacao: string } | null>(null);
	let resultadosBuscaDestinatario = $state<Array<{ id: number; nome: string; cargo: string; lotacao: string }>>([]);
	let buscandoDestinatario = $state(false);
	let enviandoSolicitacao = $state(false);
	let erroBuscaDestinatario = $state('');

	function abrirDialogSolicitar(escalaId: number) {
		escalaSolicitandoId = escalaId;
		opcaoSolicitacao = 'unidade';
		buscaDestinatario = '';
		destinatarioSelecionado = null;
		resultadosBuscaDestinatario = [];
		erroBuscaDestinatario = '';
		dialogSolicitar = true;
	}

	let buscaTimer: ReturnType<typeof setTimeout> | null = null;
	async function buscarDestinatarios(q: string) {
		if (buscaTimer) clearTimeout(buscaTimer);
		resultadosBuscaDestinatario = [];
		erroBuscaDestinatario = '';
		if (q.trim().length < 2) return;
		buscaTimer = setTimeout(async () => {
			buscandoDestinatario = true;
			try {
				const res = await fetch(
					`/api/policiais/search?cargo=DPC&somente_admins=true&q=${encodeURIComponent(q.trim())}&limit=8`
				);
				if (res.ok) {
					const json = await res.json();
					resultadosBuscaDestinatario = json.policiais ?? [];
					if (resultadosBuscaDestinatario.length === 0) {
						erroBuscaDestinatario = 'Nenhum delegado (DPC) administrador encontrado.';
					}
				}
			} finally {
				buscandoDestinatario = false;
			}
		}, 300);
	}

	async function confirmarSolicitacao() {
		if (!escalaSolicitandoId) return;
		if (opcaoSolicitacao === 'respondencia' && !destinatarioSelecionado) return;
		enviandoSolicitacao = true;
		try {
			const res = await fetch(`/api/escalas/${escalaSolicitandoId}/solicitar-assinatura`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
				body: JSON.stringify({
					tipo: opcaoSolicitacao,
					destinatario_id: destinatarioSelecionado?.id
				})
			});
			if (res.ok) {
				dialogSolicitar = false;
				escalaSolicitandoId = null;
				await invalidateAll();
			}
		} finally {
			enviandoSolicitacao = false;
		}
	}

	async function cancelarSolicitacao(escalaId: number) {
		await fetch(`/api/escalas/${escalaId}/solicitar-assinatura`, {
			method: 'DELETE',
			headers: csrfHeaders()
		});
		await invalidateAll();
	}

	// ========== Assinatura Rápida (Assinaturas Pendentes) ==========
	const usuarioLogado = $derived(page.data.usuario ?? null);
	const mobileState = useMobile();
	const isMobile = $derived(mobileState.isMobile);
	const restringirSmartphone = $derived(page.data.restringirSmartphone as boolean ?? false);
	const assinaturaTelaBloqueada = $derived(restringirSmartphone && !isMobile);

	let escalaAssinandoId = $state<number | null>(null);
	let dialogAssinaturaTela = $state(false);

	const assinaturaRapida = useAssinaturaEscala({
		getParams: () => ({
			escalaId: String(escalaAssinandoId ?? ''),
			isFDS: false,
			policiaisCount: 1,
			usuario: usuarioLogado
		}),
		onDocumentoAssinado: async () => {
			dialogAssinaturaTela = false;
			escalaAssinandoId = null;
			await invalidateAll();
		}
	});

	let painelTokenRapidoControl = $state<{ assinarComSerpro: () => Promise<void> } | null>(null);

	function iniciarAssinaturaTela(id: number) {
		escalaAssinandoId = id;
		dialogAssinaturaTela = true;
	}

	async function iniciarAssinaturaToken(id: number) {
		escalaAssinandoId = id;
		await Promise.resolve(); // deixa reatividade propagar as URLs
		await painelTokenRapidoControl?.assinarComSerpro();
	}

	function abrirNovaEscala() {
		novaEscalaTipo = null;
		fdsDiasSelecionados = [];
		neTitulo = '';
		neDataInicio = '';
		neDataFim = '';
		neCidade = '';
		nePickerAno = new Date().getFullYear();
		if (!isAdmin) neLotacao = '';
		dialogNovaEscalaAberto = true;
	}

	function fecharNovaEscala() {
		dialogNovaEscalaAberto = false;
		novaEscalaTipo = null;
		fdsDiasSelecionados = [];
		neTitulo = '';
		neDataInicio = '';
		neDataFim = '';
		neCidade = '';
		nePickerAno = new Date().getFullYear();
		if (!isAdmin) neLotacao = '';
		if (abriuDoHome) {
			abriuDoHome = false;
			visao = 'home';
			goto('/escalas', { replaceState: true, noScroll: true });
		}
	}

	function handleCriar({ cancel }: any) {
		if (novaEscalaTipo === 'fds' && fdsDiasOrdenadosNE.length === 0) {
			toaster.create({ title: 'Selecione pelo menos um dia', type: 'error' });
			cancel();
			return;
		}
		pendingCriar = true;
		return async ({ result }: { result: any }) => {
			pendingCriar = false;
			const d = result.data as Record<string, unknown> | undefined;
			if (result.type === 'success' && d?.id) {
				fecharNovaEscala();
				toaster.create({ title: 'Escala criada com sucesso', type: 'success' });
				goto(`/escalas/${d.id}`);
			} else if (result.type === 'failure' || result.type === 'error') {
				toaster.create({ title: String(d?.error || 'Erro ao criar escala'), type: 'error' });
			}
		};
	}

	function handleCriarComBase() {
		pendingComBase = true;
		return async ({ result }: { result: any }) => {
			pendingComBase = false;
			const d = result.data as Record<string, unknown> | undefined;
			if (result.type === 'success' && d?.id) {
				const adicionados = (d.adicionados as number) ?? 0;
				const naoProcessados = (d.nao_processados as Array<{ nome: string }>) ?? [];
				fecharNovaEscala();
				if (naoProcessados.length > 0) {
					toaster.create({
						title: `Escala criada com ${adicionados} servidor(es)`,
						description: `${naoProcessados.length} servidor(es) não processados (rotação não identificada).`,
						type: 'success'
					});
				} else {
					toaster.create({
						title: `Escala criada com ${adicionados} servidor(es)`,
						type: 'success'
					});
				}
				goto(`/escalas/${d.id}`);
			} else if (result.type === 'failure' || result.type === 'error') {
				toaster.create({ title: String(d?.error || 'Erro ao criar escala'), type: 'error' });
			}
		};
	}
</script>

<svelte:head>
	<title>Arquivo de Escalas - Portal de Escalas</title>
</svelte:head>

{#if visao === 'home'}
	<div class="flex flex-col items-center justify-center min-h-[60vh] gap-6">
		<h1 class="h1 text-2xl font-bold text-center">Escalas</h1>
		<div
			class="grid grid-cols-1 gap-6 w-full {podeAssinar && escalasParaAssinar.length > 0
				? 'sm:grid-cols-3 max-w-4xl'
				: 'sm:grid-cols-2 max-w-xl'}"
		>
			<button
				type="button"
				onclick={() => {
					abriuDoHome = true;
					visao = 'lista';
					abrirNovaEscala();
				}}
				class="card p-8 flex flex-col items-center gap-4 cursor-pointer hover:shadow-xl transition-shadow border-2 border-primary-500 bg-surface-50 dark:bg-surface-900 rounded-2xl group"
			>
				<span class="text-4xl">📋</span>
				<span class="text-xl font-bold group-hover:text-primary-500 transition-colors"
					>Nova Escala</span
				>
				<span class="text-sm text-surface-500 text-center"
					>Criar uma nova escala de plantão, expediente ou final de semana</span
				>
			</button>
			<button
				type="button"
				onclick={() => { visao = 'lista'; goto(`?${buildQueryParamsComFiltros(1)}`, { replaceState: true, noScroll: true, keepFocus: true }); }}
				class="card p-8 flex flex-col items-center gap-4 cursor-pointer hover:shadow-xl transition-shadow border-2 border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-900 rounded-2xl group"
			>
				<span class="text-4xl">🗂️</span>
				<span class="text-xl font-bold group-hover:text-primary-500 transition-colors"
					>Escalas criadas/Arquivo</span
				>
				<span class="text-sm text-surface-500 text-center"
					>Consultar e gerenciar as escalas já cadastradas</span
				>
			</button>
			{#if podeAssinar && escalasParaAssinar.length > 0}
				<button
					type="button"
					onclick={() => { visao = 'assinaturas'; goto('/escalas?v=assinaturas', { replaceState: true, noScroll: true }); }}
					class="card p-8 flex flex-col items-center gap-4 cursor-pointer hover:shadow-xl transition-shadow border-2 border-tertiary-500 bg-surface-50 dark:bg-surface-900 rounded-2xl group"
				>
					<div class="relative">
						<span class="text-4xl">✍️</span>
						<span
							class="absolute -top-2 -right-4 min-w-[1.4rem] h-[1.4rem] flex items-center justify-center rounded-full bg-tertiary-500 text-white text-xs font-black px-1 shadow"
							>{escalasParaAssinar.length}</span
						>
					</div>
					<span class="text-xl font-bold group-hover:text-tertiary-500 transition-colors"
						>Assinaturas Pendentes</span
					>
					<span class="text-sm text-surface-500 text-center"
						>Escalas prontas para assinar com sua assinatura digital</span
					>
				</button>
			{/if}
		</div>
	</div>
{:else if visao === 'lista'}
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
		<div class="flex items-center gap-3">
			<button
				type="button"
				class="btn btn-sm preset-outlined-surface"
				onclick={() => { visao = 'home'; goto('/escalas', { replaceState: true, noScroll: true }); }}>← Voltar</button
			>
			<h1 class="h1 text-xl font-bold">Arquivo</h1>
		</div>
		<div class="flex items-center gap-2">
			<button
				type="button"
				class="btn btn-sm {temFiltros
					? 'preset-filled-warning-500'
					: 'preset-outlined-primary-500 opacity-40'}"
				onclick={limparFiltros}
				disabled={!temFiltros}
			>
				Limpar filtros
			</button>
			<button type="button" class="btn btn-sm preset-filled-primary-500" onclick={abrirNovaEscala}
				>Nova Escala</button
			>
		</div>
	</div>

	<Dialog open={dialogOpen} onOpenChange={(e) => (dialogOpen = e.open)}>
		<Dialog.Content
			class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm"
		>
			<div
				class="card p-6 max-w-sm w-full bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10"
			>
				<Dialog.Title class="h3 font-bold mb-2">Excluir Escala?</Dialog.Title>
				<Dialog.Description class="text-surface-600 dark:text-surface-400 mb-6">
					Tem certeza que deseja excluir a escala "{escalaParaExcluir?.titulo}"? Esta ação não pode
					ser desfeita.
				</Dialog.Description>
				<div class="flex justify-end gap-3">
					<Dialog.CloseTrigger class="btn preset-outlined-surface" disabled={pendingExcluir}
						>Cancelar</Dialog.CloseTrigger
					>
					<form method="POST" action="?/excluir" use:enhance={handleExcluir} class="contents">
						<input type="hidden" name="escala_id" value={escalaParaExcluir?.id} />
						<button
							type="submit"
							class="btn preset-filled-error-500 flex items-center gap-2"
							disabled={pendingExcluir}
						>
							{pendingExcluir ? 'Excluindo...' : 'Excluir'}
						</button>
					</form>
				</div>
			</div>
		</Dialog.Content>
	</Dialog>

	<Dialog open={dialogRevogarOpen} onOpenChange={(e) => (dialogRevogarOpen = e.open)}>
		<Dialog.Content
			class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm"
		>
			<div
				class="card p-6 max-w-md w-full bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10"
			>
				<Dialog.Title class="h3 font-bold mb-2">Editar Escala Assinada?</Dialog.Title>
				<Dialog.Description class="space-y-4 mb-6">
					<p class="text-surface-600 dark:text-surface-400">
						Esta escala já possui uma <strong>assinatura digital</strong>
						válida. Ao editá-la, a assinatura atual será
						<span class="text-error-500 font-bold underline">revogada</span> (removida).
					</p>
					<p class="text-surface-500 text-sm">
						Se você deseja apenas visualizar a escala oficial, utilize a opção <strong
							>Exportar</strong
						> ou clique no título da escala.
					</p>
				</Dialog.Description>
				<div class="flex justify-end gap-3">
					<Dialog.CloseTrigger class="btn preset-outlined-surface">Voltar</Dialog.CloseTrigger>
					<button
						type="button"
						class="btn preset-filled-error-500 flex items-center gap-2"
						onclick={confirmarRevogacao}
						disabled={pendingRevogar}
					>
						{pendingRevogar ? 'Revogando...' : 'Revogar e Editar'}
					</button>
				</div>
			</div>
		</Dialog.Content>
	</Dialog>

	<Dialog
		open={dialogNovaEscalaAberto}
		onOpenChange={(e) => {
			if (!e.open) fecharNovaEscala();
		}}
	>
		<Dialog.Content
			class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm"
		>
			<div
				class="card p-6 w-full max-w-lg bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10 overflow-y-auto max-h-[90vh]"
			>
				<Dialog.Title class="h3 font-bold mb-4">Nova Escala</Dialog.Title>

				{#if novaEscalaTipo === null}
					<!-- Passo 1: escolha de tipo (e unidade para admin global) -->
					{#if isAdmin}
						<label class="label mb-4">
							<span class="label-text font-semibold">Unidade</span>
							<select class="select" bind:value={neLotacao}>
								<option value="" disabled>Selecione uma unidade...</option>
								{#each delegaciasNE as del (del.id)}
									<option value={del.nome}>{del.nome}</option>
								{/each}
							</select>
						</label>
					{/if}

					{#if unidadeNovaEscala}
						{#if !isAdmin}
							<p class="text-sm font-semibold text-surface-600 dark:text-surface-400 mb-3">
								{unidadeNovaEscala.nome}
							</p>
						{/if}
						<p class="text-sm text-surface-500 mb-3">Qual tipo de escala?</p>
						<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
							{#each tiposDisponiveisNE(unidadeNovaEscala) as t}
								<button
									type="button"
									class="p-4 rounded-2xl border-2 border-surface-200 dark:border-white/10 bg-surface-100/60 dark:bg-surface-800/60 hover:border-primary-500 hover:bg-primary-500/10 transition-all text-center group"
									onclick={() => escolherTipoNE(t.tipo)}
								>
									<p class="text-2xl mb-1">{t.icon}</p>
									<p class="font-bold text-sm group-hover:text-primary-500 transition-colors">
										{t.label}
									</p>
									<p class="text-xs text-surface-500 mt-0.5">{t.desc}</p>
								</button>
							{/each}
						</div>
					{:else if !isAdmin}
						<p class="text-sm text-surface-500 py-4 text-center">
							Nenhum tipo de escala configurado para sua unidade.
						</p>
					{/if}

					<div class="flex justify-end mt-6">
						<button type="button" class="btn preset-outlined-surface" onclick={fecharNovaEscala}
							>Cancelar</button
						>
					</div>
				{:else if novaEscalaTipo === 'fds'}
					<!-- Calendário FDS -->
					<div class="space-y-2.5">
						<div>
							<h2 class="text-base font-bold text-surface-900 dark:text-surface-50 leading-tight">
								Nova Escala — Final de Semana
							</h2>
							{#if unidadeNovaEscala}
								<p class="text-xs text-surface-500 mt-0.5">{unidadeNovaEscala.nome}</p>
							{/if}
						</div>

						<div
							class="rounded-xl border border-surface-200 dark:border-surface-700 p-2 sm:p-2.5 space-y-1 bg-white dark:bg-surface-800/40"
						>
							<div class="flex items-center justify-between gap-1.5">
								<button
									type="button"
									class="btn preset-outlined-surface-500 p-1.5 rounded-lg shrink-0"
									aria-label="Mês anterior"
									onclick={calMesAnteriorNE}
								>
									<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"
										><path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M15 19l-7-7 7-7"
										/></svg
									>
								</button>
								<p
									class="text-xs sm:text-sm font-semibold text-surface-800 dark:text-surface-100 text-center min-w-0 flex-1"
								>
									{MESES_PT_NE[calMes]} de {calAno}
								</p>
								<button
									type="button"
									class="btn preset-outlined-surface-500 p-1.5 rounded-lg shrink-0"
									aria-label="Próximo mês"
									onclick={calMesProximoNE}
								>
									<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"
										><path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M9 5l7 7-7 7"
										/></svg
									>
								</button>
							</div>
							<div
								class="grid grid-cols-7 gap-px text-center text-[0.55rem] sm:text-[0.6rem] font-semibold uppercase tracking-wide text-surface-400 py-0.5"
							>
								{#each DIAS_SEM_NE as ds}<span>{ds}</span>{/each}
							</div>
							<div class="grid grid-cols-7 gap-0.5">
								{#each gradeCalendarioNE as cell}
									{#if cell}
										{@const iso = isoDiaLocalNE(calAno, calMes, cell.day)}
										{@const sel = fdsDiasSelecionados.includes(iso)}
										<button
											type="button"
											onclick={() => calToggleDiaNE(iso)}
											class="h-9 rounded-md text-xs font-medium transition-colors border flex items-center justify-center touch-manipulation
											{sel
												? 'border-warning-500 bg-warning-500/15 text-warning-900 dark:text-warning-100'
												: 'border-transparent bg-surface-100/80 dark:bg-surface-700/50 text-surface-700 dark:text-surface-200 hover:bg-surface-200/80 dark:hover:bg-surface-600'}"
											aria-pressed={sel}
											aria-label="Dia {cell.day} de {MESES_PT_NE[calMes]}">{cell.day}</button
										>
									{:else}
										<div class="h-9"></div>
									{/if}
								{/each}
							</div>
						</div>

						{#if fdsDiasOrdenadosNE.length > 0}
							<div class="min-w-0 space-y-0.5">
								<span class="text-[0.65rem] font-semibold text-surface-500"
									>Dias selecionados ({fdsDiasOrdenadosNE.length})</span
								>
								<div
									class="flex flex-nowrap items-stretch gap-1.5 overflow-x-auto max-w-full pb-0.5 [scrollbar-width:thin]"
								>
									{#each fdsDiasOrdenadosNE as iso}
										<span
											class="inline-flex items-center gap-0.5 pl-1.5 pr-0.5 py-0.5 rounded-md text-[0.65rem] font-medium border shrink-0 border-warning-400/80 bg-warning-500/10 text-warning-900 dark:text-warning-100"
										>
											{fmtDiaNE(iso)}
											<button
												type="button"
												class="p-0.5 rounded text-surface-400 hover:text-error-600 dark:hover:text-error-400 shrink-0"
												aria-label="Remover {fmtDiaNE(iso)}"
												onclick={() => calRemoverDiaNE(iso)}
											>
												<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"
													><path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M6 18L18 6M6 6l12 12"
													/></svg
												>
											</button>
										</span>
									{/each}
								</div>
							</div>
						{/if}

						<div
							class="rounded-xl border border-surface-200 dark:border-surface-700 p-2.5 space-y-1.5"
						>
							<p
								class="text-[0.65rem] sm:text-xs font-semibold text-surface-600 dark:text-surface-400"
							>
								Horário
							</p>
							<div class="grid grid-cols-2 gap-2">
								<div>
									<span class="text-[0.65rem] text-surface-500 block mb-0.5">Hora entrada</span>
									<div class="flex gap-1">
										<select class="select text-xs flex-1" bind:value={fdsHoraEntrada}>
											{#each horasNE as h (h)}<option value={h}>{h}h</option>{/each}
										</select>
										<select class="select text-xs flex-1" bind:value={fdsMinutoEntrada}>
											{#each minutosNE as m (m)}<option value={m}>{m}m</option>{/each}
										</select>
									</div>
								</div>
								<div>
									<span class="text-[0.65rem] text-surface-500 block mb-0.5">Hora saída</span>
									<div class="flex gap-1">
										<select class="select text-xs flex-1" bind:value={fdsHoraSaida}>
											{#each horasNE as h (h)}<option value={h}>{h}h</option>{/each}
										</select>
										<select class="select text-xs flex-1" bind:value={fdsMinutoSaida}>
											{#each minutosNE as m (m)}<option value={m}>{m}m</option>{/each}
										</select>
									</div>
								</div>
							</div>
							<p class="text-[0.65rem] text-primary-600 dark:text-primary-400 font-medium">
								{fdsHorarioLabelNE}
							</p>
						</div>

						{#if fdsTituloAutoNE}
							<div class="rounded-lg bg-surface-100 dark:bg-surface-800/50 px-3 py-2">
								<p class="text-[0.6rem] text-surface-400 mb-0.5">Título gerado</p>
								<p class="text-xs text-surface-700 dark:text-surface-200 font-medium leading-snug">
									{fdsTituloAutoNE}
								</p>
							</div>
						{/if}

						<div class="flex justify-end gap-2 pt-1">
							<button
								type="button"
								class="btn preset-outlined-surface text-xs sm:text-sm px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg sm:rounded-xl"
								onclick={() => (novaEscalaTipo = null)}
							>
								← Voltar
							</button>
							<form method="POST" action="?/criar" use:enhance={handleCriar} class="contents">
								<input type="hidden" name="tipo" value="fds" />
								<input type="hidden" name="data_inicio" value={fdsDataInicioNE} />
								<input type="hidden" name="data_fim" value={fdsDataFimNE} />
								<input
									type="hidden"
									name="hora_entrada"
									value={`${fdsHoraEntrada}:${fdsMinutoEntrada}`}
								/>
								<input
									type="hidden"
									name="hora_saida"
									value={`${fdsHoraSaida}:${fdsMinutoSaida}`}
								/>
								<input type="hidden" name="cidade" value={fdsCidadeNE} />
								<input type="hidden" name="lotacao" value={fdsLotacaoNE} />
								<input type="hidden" name="titulo" value={fdsTituloAutoNE} />
								<button
									type="submit"
									class="btn preset-filled-warning-500 border-2 border-warning-600/30 hover:border-warning-600 text-xs sm:text-sm px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg sm:rounded-xl transition-all"
									disabled={pendingCriar || fdsDiasOrdenadosNE.length === 0}
								>
									{pendingCriar ? 'Criando...' : 'Criar Escala'}
								</button>
							</form>
						</div>
					</div>
				{:else}
					<!-- Plantão / Expediente — Picker de mês -->
					<div class="space-y-4">
						<div>
							<h2 class="text-base font-bold text-surface-900 dark:text-surface-50 leading-tight">
								Nova Escala — {novaEscalaTipo === 'plantao'
									? 'Plantão Mensal'
									: 'Expediente Mensal'}
							</h2>
							{#if unidadeNovaEscala}
								<p class="text-xs text-surface-500 mt-0.5">{unidadeNovaEscala.nome}</p>
							{/if}
						</div>

						<!-- Navegação de ano -->
						<div class="flex items-center justify-between gap-2">
							<button
								type="button"
								class="btn preset-outlined-surface-500 p-1.5 rounded-lg"
								aria-label="Ano anterior"
								onclick={() => nePickerAno--}
							>
								<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M15 19l-7-7 7-7"
									/></svg
								>
							</button>
							<span class="font-bold text-lg text-surface-900 dark:text-surface-50"
								>{nePickerAno}</span
							>
							<button
								type="button"
								class="btn preset-outlined-surface-500 p-1.5 rounded-lg"
								aria-label="Próximo ano"
								onclick={() => nePickerAno++}
							>
								<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M9 5l7 7-7 7"
									/></svg
								>
							</button>
						</div>

						<!-- Grade de meses -->
						<div class="grid grid-cols-4 gap-2">
							{#each MESES_PT_NE as nomeMes, i}
								{@const mesNum = i + 1}
								{@const ocupado = mesOcupado(mesNum, nePickerAno)}
								{@const selecionado =
									neMesSelecionado?.mes === mesNum && neMesSelecionado?.ano === nePickerAno}
								<button
									type="button"
									disabled={ocupado}
									onclick={() => selecionarMesNE(mesNum)}
									class="py-2.5 px-1 rounded-xl border-2 text-sm font-medium transition-all relative
									{ocupado
										? 'opacity-40 cursor-not-allowed border-surface-200 dark:border-white/10 text-surface-400 dark:text-surface-500 bg-surface-100 dark:bg-surface-800/30'
										: selecionado
											? 'border-primary-500 bg-primary-500/15 text-primary-700 dark:text-primary-400'
											: 'border-surface-200 dark:border-white/10 hover:border-primary-400 hover:bg-primary-500/10 text-surface-700 dark:text-surface-300 bg-white dark:bg-surface-800/30'}"
									title={ocupado ? 'Escala já criada para este mês' : nomeMes}
								>
									{nomeMes.substring(0, 3)}
									{#if ocupado}
										<span
											class="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-surface-400 dark:bg-surface-500"
										></span>
									{/if}
								</button>
							{/each}
						</div>

						{#if neTitulo}
							<div class="rounded-lg bg-surface-100 dark:bg-surface-800/50 px-3 py-2">
								<p class="text-[0.6rem] text-surface-400 mb-0.5">Título gerado</p>
								<p class="text-xs text-surface-700 dark:text-surface-200 font-medium leading-snug">
									{neTitulo}
								</p>
							</div>

							<p class="text-xs font-semibold text-surface-500">Como deseja criar esta escala?</p>

							<div class="grid grid-cols-2 gap-2">
								<!-- Opção 1: Com base no mês anterior -->
								<form
									method="POST"
									action="?/criarComBase"
									use:enhance={handleCriarComBase}
									class="contents"
								>
									<input type="hidden" name="lotacao" value={neLotacao} />
									<input type="hidden" name="tipo" value={novaEscalaTipo} />
									<input type="hidden" name="mes" value={neMesSelecionado?.mes} />
									<input type="hidden" name="ano" value={neMesSelecionado?.ano} />
									<button
										type="submit"
										disabled={pendingComBase || !mesAnteriorInfo?.existe}
										title={mesAnteriorInfo?.existe ? '' : 'Sem escala no mês anterior para copiar'}
										class="p-3 rounded-xl border-2 text-left transition-all h-full
										{mesAnteriorInfo?.existe
											? 'border-surface-300 dark:border-white/15 hover:border-primary-500 hover:bg-primary-500/10 cursor-pointer'
											: 'opacity-40 cursor-not-allowed border-surface-200 dark:border-white/10 bg-surface-50 dark:bg-surface-800/20'}"
									>
										<p
											class="font-semibold text-sm text-surface-800 dark:text-surface-100 leading-tight"
										>
											Com base em {MESES_PT_NE[
												(mesAnteriorInfo?.mes ?? 1) - 1
											]}/{mesAnteriorInfo?.ano}
										</p>
										<p class="text-xs text-surface-500 mt-1 leading-snug">
											{novaEscalaTipo === 'plantao'
												? 'Copia os servidores e recalcula os dias pela rotação'
												: 'Copia os servidores do mês anterior'}
										</p>
										{#if pendingComBase}<p class="text-xs text-primary-500 mt-1">Gerando...</p>{/if}
									</button>
								</form>

								<!-- Opção 2: Escala limpa -->
								<form method="POST" action="?/criar" use:enhance={handleCriar} class="contents">
									<input type="hidden" name="titulo" value={neTitulo} />
									<input type="hidden" name="data_inicio" value={neDataInicio} />
									<input type="hidden" name="data_fim" value={neDataFim} />
									<input
										type="hidden"
										name="hora_entrada"
										value={`${neHoraEntrada}:${neMinutoEntrada}`}
									/>
									<input
										type="hidden"
										name="hora_saida"
										value={`${neHoraSaida}:${neMinutoSaida}`}
									/>
									<input type="hidden" name="tipo" value={novaEscalaTipo} />
									<input type="hidden" name="cidade" value={neCidade} />
									<input type="hidden" name="lotacao" value={neLotacao} />
									<button
										type="submit"
										disabled={pendingCriar}
										class="p-3 rounded-xl border-2 text-left transition-all h-full border-surface-300 dark:border-white/15 hover:border-success-500 hover:bg-success-500/10 cursor-pointer"
									>
										<p
											class="font-semibold text-sm text-surface-800 dark:text-surface-100 leading-tight"
										>
											Escala limpa
										</p>
										<p class="text-xs text-surface-500 mt-1 leading-snug">
											Começa do zero, sem servidores
										</p>
										{#if pendingCriar}<p class="text-xs text-success-500 mt-1">Criando...</p>{/if}
									</button>
								</form>
							</div>
						{/if}

						<div class="flex justify-start pt-1">
							<button
								type="button"
								class="btn btn-sm preset-outlined-surface"
								onclick={() => {
									novaEscalaTipo = null;
									neDataInicio = '';
									neDataFim = '';
									neTitulo = '';
								}}>← Voltar</button
							>
						</div>
					</div>
				{/if}
			</div>
		</Dialog.Content>
	</Dialog>

	<div
		class="p-6 rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20 overflow-hidden mt-6"
	>
		<div
			class="grid grid-cols-12 gap-3 mb-8 p-6 rounded-2xl bg-surface-100/30 dark:bg-surface-800/20 border border-surface-200 dark:border-white/5"
		>
			{#if isAdmin}
				<label class="label col-span-12 sm:col-span-3">
					<span class="label-text font-semibold mb-1">Seccional</span>
					<select
						class="select"
						bind:value={filtroSeccional}
						onchange={() => {
							filtroLotacao = '';
							navegarComFiltros();
						}}
					>
						<option value="todas">Todas as Seccionais</option>
						{#each seccionais as sec (sec.id)}
							<option value={sec.id}>{sec.nome}</option>
						{/each}
					</select>
				</label>

				<label class="label col-span-12 sm:col-span-5">
					<span class="label-text font-semibold mb-1">Unidade de Lotação</span>
					<select class="select" bind:value={filtroLotacao} onchange={navegarComFiltros}>
						<option value="">Selecione uma unidade...</option>
						<option value="todas">Todas as unidades</option>
						{#each delegaciasDropdown as del (del.id)}
							<option value={del.nome}>{del.nome}</option>
						{/each}
					</select>
				</label>
			{:else if isAdminSeccional}
				<label class="label col-span-12 sm:col-span-8">
					<span class="label-text font-semibold mb-1">Unidade de Lotação</span>
					<select class="select" bind:value={filtroLotacao} onchange={navegarComFiltros}>
						<option value="">Todas as unidades</option>
						{#each delegaciasDaSeccional as del (del.id)}
							<option value={del.nome}>{del.nome}</option>
						{/each}
					</select>
				</label>
			{/if}

			<label
				class="label col-span-12 {isAdmin || isAdminSeccional ? 'sm:col-span-2' : 'sm:col-span-6'}"
			>
				<span class="label-text font-semibold mb-1">Tipo</span>
				<select class="select" bind:value={filtroTipo} onchange={navegarComFiltros}>
					<option value="todos">Todos</option>
					<option value="plantao">Plantão</option>
					<option value="expediente">Expediente</option>
					<option value="fds">Final de Semana</option>
				</select>
			</label>

			<label
				class="label col-span-6 {isAdmin || isAdminSeccional ? 'sm:col-span-1' : 'sm:col-span-3'}"
			>
				<span class="label-text font-semibold mb-1">Mês</span>
				<select class="select" bind:value={filtroMes} onchange={navegarComFiltros}>
					{#each meses as mes}
						<option value={mes.value}>{mes.label}</option>
					{/each}
				</select>
			</label>

			<label
				class="label col-span-6 {isAdmin || isAdminSeccional ? 'sm:col-span-1' : 'sm:col-span-3'}"
			>
				<span class="label-text font-semibold mb-1">Ano</span>
				<select class="select" bind:value={filtroAno} onchange={navegarComFiltros}>
					{#each anos as ano}
						<option value={ano}>{ano === 0 ? 'Todos' : ano}</option>
					{/each}
				</select>
			</label>
		</div>

		{#if data.skipLoad}
			<div class="text-center py-20">
				<div
					class="bg-surface-200/50 dark:bg-surface-800/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 grayscale opacity-50"
				>
					<svg
						class="w-8 h-8 text-surface-400"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
						/></svg
					>
				</div>
				<p class="text-surface-600 dark:text-surface-400 text-lg">
					Escolha uma unidade para exibir os dados.
				</p>
			</div>
		{:else if escalas.length === 0}
			<div class="text-center py-12 text-surface-500">
				<p class="mb-4">Nenhuma escala criada para os filtros selecionados.</p>
				<button type="button" class="btn preset-filled-primary-500" onclick={abrirNovaEscala}
					>Criar Escala</button
				>
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
							<th>Status</th>
							<th>Ações</th>
						</tr>
					</thead>
					<tbody>
						{#each escalas as esc (esc.id)}
							<tr>
								<td><a href="/escalas/{esc.id}" class="anchor">{esc.titulo}</a></td>
								<td>{esc.cidade}</td>
								<td class="whitespace-nowrap"
									>{formatarData(esc.data_inicio)} a {formatarData(esc.data_fim)}</td
								>
								<td>{esc.horario}</td>
								<td>
									{#if esc.is_assinada}
										<span
											class="badge preset-filled-success-500 font-bold px-2 py-1 flex items-center gap-1 w-max shadow-sm"
										>
											<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"
												><path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M5 13l4 4L19 7"
												/></svg
											>
											Assinada
										</span>
									{:else if esc.tipo === 'fds' && esc.finalizada_em}
										<span
											class="badge preset-filled-success-500 font-bold px-2 py-1 flex items-center gap-1 w-max shadow-sm"
										>
											<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"
												><path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M5 13l4 4L19 7"
												/></svg
											>
											Enviada
										</span>
									{:else if (esc.tipo === 'plantao' || esc.tipo === 'expediente') && solicitacoesMap[esc.id]}
										<span
											class="badge preset-tonal-warning font-bold px-2 py-1 flex items-center gap-1 w-max shadow-sm"
										>
											<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"
												><path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
												/></svg
											>
											Ass. Pendente
										</span>
									{:else}
										<span
											class="badge preset-tonal-surface font-bold px-2 py-1 flex items-center gap-1 w-max shadow-sm"
										>
											<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"
												><path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
												/></svg
											>
											{esc.tipo === 'fds' ? 'Pendente' : 'Em preenchimento'}
										</span>
									{/if}
								</td>
								<td>
									<div class="flex gap-2 justify-end">
										<button
											type="button"
											class="btn btn-sm {esc.is_assinada
												? 'preset-filled-warning-500'
												: 'preset-outlined-primary-500'}"
											onclick={() => solicitarEdicao(esc)}
										>
											{esc.is_assinada ? 'Editar' : 'Abrir'}
										</button>
										<Popover
											positioning={{
												placement: 'bottom-end',
												offset: { mainAxis: 4 }
											}}
										>
											<Popover.Trigger class="btn btn-sm preset-outlined-primary-500"
												>Exportar ▾</Popover.Trigger
											>
											<Portal>
												<Popover.Positioner class="z-50">
													<Popover.Content
														class="card p-1 bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-white/10 shadow-xl flex flex-col min-w-[160px]"
													>
														{#if esc.is_assinada}
															<a
																class="w-full text-left px-4 py-2 text-sm font-bold text-success-600 dark:text-success-400 rounded hover:bg-success-500/10 transition-colors flex items-center gap-2 no-underline"
																href={`/api/escalas/${esc.id}/documento-assinado`}
																target="_blank"
															>
																<svg
																	class="w-4 h-4"
																	fill="none"
																	viewBox="0 0 24 24"
																	stroke="currentColor"
																	><path
																		stroke-linecap="round"
																		stroke-linejoin="round"
																		stroke-width="2"
																		d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
																	/></svg
																>
																PDF Oficial
															</a>
															<hr class="opacity-10 my-1" />
														{/if}
														<a
															class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
															href={`/api/escalas/${esc.id}/download?format=docx`}
															target="_blank">Word (.docx)</a
														>
														<a
															class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
															href={`/api/escalas/${esc.id}/download?format=excel`}
															target="_blank">Excel (.xlsx)</a
														>
														<a
															class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
															href={`/api/escalas/${esc.id}/download?format=pdf`}
															target="_blank">PDF (.pdf)</a
														>
													</Popover.Content>
												</Popover.Positioner>
											</Portal>
										</Popover>
										{#if podeOIPSolicitar && (esc.tipo === 'plantao' || esc.tipo === 'expediente') && !esc.is_assinada}
											{#if solicitacoesMap[esc.id]}
												<button
													type="button"
													class="btn btn-sm preset-outlined-error-500"
													onclick={() => cancelarSolicitacao(esc.id)}>Cancelar Ass.</button
												>
											{:else}
												<button
													type="button"
													class="btn btn-sm preset-filled-success-500"
													onclick={() => abrirDialogSolicitar(esc.id)}>Solicitar Ass.</button
												>
											{/if}
										{/if}
										<button
											type="button"
											class="btn btn-sm preset-filled-error-500 flex-1"
											onclick={() => solicitarExclusao(esc.id, esc.titulo)}>Excluir</button
										>
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
					<div
						class="p-4 rounded-2xl bg-surface-100/50 dark:bg-surface-800/50 border border-surface-200 dark:border-white/10 hover:border-primary-500/30 transition-colors"
					>
						<div class="flex justify-between items-start mb-3 gap-2">
							<a
								href="/escalas/{esc.id}"
								class="anchor font-semibold text-sm block text-primary-600 dark:text-primary-400 no-underline hover:text-primary-500 dark:hover:text-primary-300"
								>{esc.titulo}</a
							>
							{#if esc.is_assinada}
								<span
									class="badge preset-filled-success-500 font-bold px-1.5 py-0.5 text-[0.65rem] rounded flex items-center gap-1 shadow-sm"
								>
									<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"
										><path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M5 13l4 4L19 7"
										/></svg
									>
									Assinada
								</span>
							{:else if esc.tipo === 'fds' && esc.finalizada_em}
								<span
									class="badge preset-filled-success-500 font-bold px-1.5 py-0.5 text-[0.65rem] rounded flex items-center gap-1 shadow-sm"
								>
									<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"
										><path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M5 13l4 4L19 7"
										/></svg
									>
									Enviada
								</span>
							{:else if (esc.tipo === 'plantao' || esc.tipo === 'expediente') && solicitacoesMap[esc.id]}
								<span
									class="badge preset-tonal-warning font-bold px-1.5 py-0.5 text-[0.65rem] rounded flex items-center gap-1 shadow-sm"
								>
									<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"
										><path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
										/></svg
									>
									Ass. Pendente
								</span>
							{:else}
								<span
									class="badge preset-tonal-surface font-bold px-1.5 py-0.5 text-[0.65rem] rounded flex items-center gap-1 shadow-sm"
								>
									<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"
										><path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
										/></svg
									>
									{esc.tipo === 'fds' ? 'Pendente' : 'Em preenchimento'}
								</span>
							{/if}
						</div>
						<div class="space-y-1 mb-3 text-sm">
							<div class="flex justify-between">
								<span class="text-surface-500 font-medium">Cidade</span>
								<span class="text-surface-900 dark:text-surface-100">{esc.cidade}</span>
							</div>
							<div class="flex justify-between">
								<span class="text-surface-500 font-medium">Período</span>
								<span class="text-surface-900 dark:text-surface-100"
									>{formatarData(esc.data_inicio)} a {formatarData(esc.data_fim)}</span
								>
							</div>
							<div class="flex justify-between">
								<span class="text-surface-500 font-medium">Horário</span>
								<span class="text-surface-900 dark:text-surface-100">{esc.horario}</span>
							</div>
						</div>
						<div class="flex gap-2 pt-3 border-t border-white/5">
							<button
								type="button"
								class="btn btn-sm {esc.is_assinada
									? 'preset-filled-warning-500'
									: 'preset-outlined-primary-500'} flex-1"
								onclick={() => solicitarEdicao(esc)}
							>
								{esc.is_assinada ? 'Editar' : 'Abrir'}
							</button>
							<Popover
								positioning={{
									placement: 'bottom-end',
									offset: { mainAxis: 4 }
								}}
							>
								<Popover.Trigger
									class="btn btn-sm preset-outlined-primary-500 hover:bg-primary-500/10"
									>Exportar ▾</Popover.Trigger
								>
								<Portal>
									<Popover.Positioner class="z-50">
										<Popover.Content
											class="card p-1 bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-white/10 shadow-xl flex flex-col min-w-[160px]"
										>
											{#if esc.is_assinada}
												<a
													class="w-full text-left px-4 py-2 text-sm font-bold text-success-600 dark:text-success-400 rounded hover:bg-success-500/10 transition-colors flex items-center gap-2 no-underline"
													href={`/api/escalas/${esc.id}/documento-assinado`}
													target="_blank"
												>
													<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"
														><path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
														/></svg
													>
													PDF Oficial
												</a>
												<hr class="opacity-10 my-1" />
											{/if}
											<a
												class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
												href={`/api/escalas/${esc.id}/download?format=docx`}
												target="_blank">Word (.docx)</a
											>
											<a
												class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
												href={`/api/escalas/${esc.id}/download?format=excel`}
												target="_blank">Excel (.xlsx)</a
											>
											<a
												class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
												href={`/api/escalas/${esc.id}/download?format=pdf`}
												target="_blank">PDF (.pdf)</a
											>
										</Popover.Content>
									</Popover.Positioner>
								</Portal>
							</Popover>
							<button
								type="button"
								class="btn btn-sm preset-filled-error-500 flex-1"
								onclick={() => solicitarExclusao(esc.id, esc.titulo)}>Excluir</button
							>
						</div>
						{#if podeOIPSolicitar && (esc.tipo === 'plantao' || esc.tipo === 'expediente') && !esc.is_assinada}
							{#if solicitacoesMap[esc.id]}
								<div class="flex gap-2 mt-2 pt-2 border-t border-white/10">
									<button
										type="button"
										class="btn btn-sm preset-outlined-error-500 text-xs flex-1"
										onclick={() => cancelarSolicitacao(esc.id)}>Cancelar Ass.</button
									>
								</div>
							{:else}
								<button
									type="button"
									class="btn btn-sm preset-filled-success-500 w-full mt-2"
									onclick={() => abrirDialogSolicitar(esc.id)}
								>
									<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
									Solicitar Assinatura
								</button>
							{/if}
						{/if}
					</div>
				{/each}
			</div>
			<PaginationControls
				{paginaAtual}
				{totalPaginas}
				totalItens={escalas.length}
				itensPorPagina={ITEMS_POR_PAGINA}
				labelSingular="escala"
				labelPlural="escala(s)"
				onPageChange={irParaPaginaListagem}
			/>
		{/if}
	</div>
{:else if visao === 'assinaturas'}
	<div class="flex flex-col gap-6">
		<div class="flex items-center gap-3 mb-2">
			<button
				type="button"
				class="btn btn-sm preset-outlined-surface"
				onclick={() => { visao = 'home'; goto('/escalas', { replaceState: true, noScroll: true }); }}>← Voltar</button
			>
			<h1 class="h1 text-xl font-bold">Assinaturas Pendentes</h1>
			<span class="badge preset-filled-tertiary-500 text-white font-bold text-sm px-2"
				>{escalasParaAssinar.length}</span
			>
		</div>

		{#if escalasParaAssinar.length === 0}
			<div class="text-center py-12 text-surface-500">
				<p>Nenhuma escala pendente de assinatura.</p>
			</div>
		{:else}
			<div class="space-y-3">
				{#each escalasParaAssinar as esc (esc.id)}
					<div
						class="p-4 rounded-2xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-sm hover:border-tertiary-500/30 transition-colors"
					>
						<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
							<div class="min-w-0">
								<div class="flex items-center gap-2 mb-1">
									<span
										class="badge {esc.tipo === 'plantao'
											? 'preset-tonal-primary'
											: 'preset-tonal-secondary'} text-xs font-bold px-2 py-0.5"
									>
										{esc.tipo === 'plantao' ? 'Plantão' : 'Expediente'}
									</span>
									<span class="text-xs text-surface-400">{esc.lotacao}</span>
								</div>
								<h3
									class="font-semibold text-sm text-surface-800 dark:text-surface-100 leading-snug line-clamp-1"
								>
									{esc.titulo}
								</h3>
								<p class="text-xs text-surface-500 mt-0.5">
									{esc.cidade} · {formatarData(esc.data_inicio)} a {formatarData(esc.data_fim)}
								</p>
							</div>
							<div class="flex gap-2 shrink-0 flex-wrap justify-end">
								<a
									href="/escalas/{esc.id}"
									target="_blank"
									class="btn btn-sm preset-outlined-surface-500 no-underline"
								>
									Ver Escala
								</a>
								<a
									href="/api/escalas/{esc.id}/download?format=pdf"
									target="_blank"
									class="btn btn-sm preset-outlined-surface-500 no-underline"
								>
									PDF
								</a>
								<button
									type="button"
									class="btn btn-sm preset-filled-warning-500 font-bold disabled:opacity-40 disabled:cursor-not-allowed"
									disabled={assinaturaTelaBloqueada}
									title={assinaturaTelaBloqueada ? 'Restrito a dispositivos móveis pelo administrador' : undefined}
									onclick={() => iniciarAssinaturaTela(esc.id)}
								>
									Assinar (Tela)
								</button>
								<button
									type="button"
									class="btn btn-sm preset-filled-tertiary-500 font-bold"
									onclick={() => iniciarAssinaturaToken(esc.id)}
								>
									Assinar (Token)
								</button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<!-- PainelAssinaturaToken para assinatura rápida (montado fora da árvore de visão) -->
<div class="sr-only" aria-hidden="true">
	<PainelAssinaturaToken
		bind:control={painelTokenRapidoControl}
		signerName={usuarioLogado?.nome ?? ''}
		signerCpf={usuarioLogado?.cpf ?? ''}
		prepararUrl="/api/escalas/{escalaAssinandoId}/preparar-assinatura"
		finalizarUrl="/api/escalas/{escalaAssinandoId}/finalizar-assinatura"
		nomeArquivo="escala_assinada.pdf"
		onSuccess={async () => {
			escalaAssinandoId = null;
			await invalidateAll();
		}}
	/>
</div>

<!-- Dialog de aviso: abrir escala com solicitação pendente (cancela a solicitação) -->
<Dialog open={dialogRevogarSolicitacaoOpen} onOpenChange={(e) => { if (!e.open) { dialogRevogarSolicitacaoOpen = false; escalaAbrirComSolicitacao = null; } }}>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm"
	>
		<div
			class="card p-6 max-w-sm w-full bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10"
		>
			<Dialog.Title class="h3 font-bold mb-2">Cancelar solicitação?</Dialog.Title>
			<Dialog.Description class="text-sm text-surface-500 dark:text-surface-400 mb-5">
				Esta escala possui uma solicitação de assinatura pendente. Ao abri-la para edição, a solicitação será cancelada automaticamente.
			</Dialog.Description>
			<div class="flex gap-3 justify-end">
				<button
					type="button"
					class="btn preset-outlined-surface-500"
					onclick={() => { dialogRevogarSolicitacaoOpen = false; escalaAbrirComSolicitacao = null; }}>Voltar</button
				>
				<button
					type="button"
					class="btn preset-filled-warning-500 font-bold"
					onclick={async () => {
						const id = escalaAbrirComSolicitacao!;
						dialogRevogarSolicitacaoOpen = false;
						escalaAbrirComSolicitacao = null;
						await cancelarSolicitacao(id);
						goto(`/escalas/${id}`);
					}}>Cancelar e Abrir</button
				>
			</div>
		</div>
	</Dialog.Content>
</Dialog>

<!-- Dialog Solicitar Assinatura (OIP admins) -->
<Dialog open={dialogSolicitar} onOpenChange={(e) => { if (!e.open) dialogSolicitar = false; }}>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm"
	>
		<div
			class="card p-6 max-w-md w-full bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10"
		>
			<Dialog.Title class="h3 font-bold mb-1">Solicitar Assinatura</Dialog.Title>
			<Dialog.Description class="text-sm text-surface-500 dark:text-surface-400 mb-5">
				Quem deve assinar esta escala?
			</Dialog.Description>

			<div class="space-y-3 mb-5">
				<!-- Opção 1: Admin da Unidade -->
				<button
					type="button"
					class="w-full p-4 rounded-xl border-2 text-left transition-all {opcaoSolicitacao === 'unidade'
						? 'border-primary-500 bg-primary-500/10'
						: 'border-surface-300 dark:border-white/10 hover:border-primary-400/60'}"
					onclick={() => { opcaoSolicitacao = 'unidade'; destinatarioSelecionado = null; }}
				>
					<div class="flex items-start gap-3">
						<div
							class="mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors {opcaoSolicitacao === 'unidade'
								? 'border-primary-500'
								: 'border-surface-400'}"
						>
							{#if opcaoSolicitacao === 'unidade'}
								<div class="w-2.5 h-2.5 rounded-full bg-primary-500"></div>
							{/if}
						</div>
						<div>
							<div class="font-semibold text-sm">Admin da Unidade</div>
							<div class="text-xs text-surface-500 mt-0.5">
								O delegado titular da unidade assina o documento
							</div>
						</div>
					</div>
				</button>

				<!-- Opção 2: Admin em Respondência -->
				<button
					type="button"
					class="w-full p-4 rounded-xl border-2 text-left transition-all {opcaoSolicitacao === 'respondencia'
						? 'border-tertiary-500 bg-tertiary-500/10'
						: 'border-surface-300 dark:border-white/10 hover:border-tertiary-400/60'}"
					onclick={() => { opcaoSolicitacao = 'respondencia'; }}
				>
					<div class="flex items-start gap-3">
						<div
							class="mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors {opcaoSolicitacao === 'respondencia'
								? 'border-tertiary-500'
								: 'border-surface-400'}"
						>
							{#if opcaoSolicitacao === 'respondencia'}
								<div class="w-2.5 h-2.5 rounded-full bg-tertiary-500"></div>
							{/if}
						</div>
						<div>
							<div class="font-semibold text-sm">Admin em Respondência</div>
							<div class="text-xs text-surface-500 mt-0.5">
								Escolha um delegado de outra unidade para assinar
							</div>
						</div>
					</div>
				</button>

				<!-- Busca de destinatário (somente quando respondência selecionada) -->
				{#if opcaoSolicitacao === 'respondencia'}
					<div class="pl-4 space-y-2 pt-1 animate-fade-in">
						{#if destinatarioSelecionado}
							<div
								class="flex items-center gap-3 p-3 rounded-xl bg-tertiary-500/10 border border-tertiary-500/30"
							>
								<div class="flex-1 min-w-0">
									<div class="text-sm font-semibold truncate">{destinatarioSelecionado.nome}</div>
									<div class="text-xs text-surface-500 truncate">{destinatarioSelecionado.lotacao}</div>
								</div>
								<button
									type="button"
									class="btn btn-sm preset-outlined-surface-500 shrink-0"
									onclick={() => { destinatarioSelecionado = null; buscaDestinatario = ''; resultadosBuscaDestinatario = []; }}
								>
									Trocar
								</button>
							</div>
						{:else}
							<div class="relative">
								<input
									type="text"
									class="input w-full text-sm pr-8"
									placeholder="Buscar delegado (DPC) por nome ou matrícula…"
									bind:value={buscaDestinatario}
									oninput={(e) => buscarDestinatarios(e.currentTarget.value)}
								/>
								{#if buscandoDestinatario}
									<div
										class="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-tertiary-500 border-t-transparent rounded-full animate-spin"
									></div>
								{/if}
							</div>
							{#if resultadosBuscaDestinatario.length > 0}
								<div
									class="card rounded-xl border border-surface-200 dark:border-white/10 overflow-hidden max-h-44 overflow-y-auto shadow-md"
								>
									{#each resultadosBuscaDestinatario as p (p.id)}
										<button
											type="button"
											class="w-full text-left px-3 py-2.5 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors border-b border-surface-100 dark:border-white/5 last:border-0"
											onclick={() => {
												destinatarioSelecionado = p;
												resultadosBuscaDestinatario = [];
												buscaDestinatario = '';
											}}
										>
											<div class="text-sm font-medium">{p.nome}</div>
											<div class="text-xs text-surface-500">{p.lotacao}</div>
										</button>
									{/each}
								</div>
							{:else if erroBuscaDestinatario && !buscandoDestinatario}
								<p class="text-xs text-surface-400 px-1">{erroBuscaDestinatario}</p>
							{/if}
						{/if}
					</div>
				{/if}
			</div>

			<div class="flex gap-3 justify-end">
				<button
					type="button"
					class="btn preset-outlined-surface-500"
					onclick={() => (dialogSolicitar = false)}>Cancelar</button
				>
				<button
					type="button"
					class="btn preset-filled-primary-500 font-bold disabled:opacity-40 disabled:cursor-not-allowed"
					disabled={enviandoSolicitacao ||
						(opcaoSolicitacao === 'respondencia' && !destinatarioSelecionado)}
					onclick={confirmarSolicitacao}
				>
					{enviandoSolicitacao ? 'Enviando…' : 'Confirmar'}
				</button>
			</div>
		</div>
	</Dialog.Content>
</Dialog>

<!-- Dialog de assinatura na tela (assinatura rápida) -->
<Dialog open={dialogAssinaturaTela} onOpenChange={(e) => { if (!e.open) dialogAssinaturaTela = false; }}>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm"
	>
		<div
			class="card p-6 max-w-lg w-full bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10"
		>
			<Dialog.Title class="h3 font-bold mb-2">Assinatura Digital em Tela</Dialog.Title>
			<Dialog.Description class="text-xs text-surface-600 dark:text-surface-400 mb-4">
				Desenhe sua rubrica no quadro abaixo para assinar este documento.
			</Dialog.Description>
			<SignaturePad
				message="Rubrica do Organizador"
				onConfirm={async (rubrica: string, lat?: number, lng?: number, selfie?: string | null, codigo?: string, desafioId?: string) => {
					await assinaturaRapida.assinarSimples(rubrica, lat, lng, selfie, codigo, desafioId);
				}}
				onCancel={() => (dialogAssinaturaTela = false)}
				exigirFoto={page.data.exigirFotoAssinatura ?? true}
				exigirGps={page.data.exigirGpsAssinatura ?? true}
				exigirCodigoEmail={page.data.exigirCodigoEmailAssinatura ?? false}
			/>
		</div>
	</Dialog.Content>
</Dialog>
