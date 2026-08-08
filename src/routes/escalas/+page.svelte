<script lang="ts">
	/**
	 * Tela de ESCALAS — três visões em uma rota, alternadas por `visao`:
	 *
	 * - `home`: atalhos e pendências (o que o usuário vê ao entrar);
	 * - `lista`: a tabela filtrável de escalas, paginada no servidor —
	 *   `?status=aguardando` (criadas, ainda não arquivadas) ou
	 *   `?status=arquivada` (assinadas / FDS enviadas);
	 * - `assinaturas`: as escalas que dependem da assinatura deste usuário.
	 *
	 * A visão inicial vem do servidor (`data.initialView`, derivada do `?v=`):
	 * qualquer query string já indica busca/filtro e abre direto na `lista`. Isso
	 * mantém link compartilhado e recarga de página estáveis, em vez de sempre
	 * cair na home e obrigar a refiltrar.
	 *
	 * Filtros: `useFiltrosPaginados` cuida de persistir em localStorage, navegar
	 * no servidor e resetar a página quando qualquer filtro muda — exceto a busca,
	 * que tem handler próprio (debounce). `seccional` participa da assinatura de
	 * mudança mas NÃO vai para a query: ela só filtra o dropdown de delegacias no
	 * cliente.
	 *
	 * A tela também é um dos pontos de assinatura: hospeda o SignaturePad, o
	 * painel de token e a oferta de cadastro de RUBRICA reutilizável — oferecida
	 * apenas a quem pode assinar por token, tem pendência e ainda não tem rubrica
	 * (`useOfertaRubrica`), para não virar interrupção para o resto.
	 */
	import type { PageProps } from './$types';
	import { opcoesMeses } from '$lib/utils/datas';
	import { PenLine, Clock, Archive, Plus } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { invalidateShared } from '$lib/cross-tab-invalidate';
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import type { EscalaListagem, Unidade } from '$lib/types';
	import { apiFetch } from '$lib/api-fetch';
	import { loading } from '$lib/loading.svelte';
	import type { ActionResult } from '@sveltejs/kit';
	import {
		useAutorizacao,
		getSavedFilters,
		useAssinaturaEscala,
		useMobile,
		useFiltrosPaginados,
		useOfertaRubrica,
		rubricaValida,
		useInvalidateOnFocus
	} from '$lib/composables';
	import { fetchSyncEstado } from '$lib/sync-estado';
	import SignaturePad from '$lib/components/SignaturePad.svelte';
	import type { SignaturePadConfirmPayload } from '$lib/components/SignaturePadTypes';
	import PainelAssinaturaToken from '$lib/components/PainelAssinaturaToken.svelte';
	import { page } from '$app/state';
	import FloatingRefresh from '$lib/components/FloatingRefresh.svelte';
	import ModalNovaEscala from './_components/ModalNovaEscala.svelte';
	import TabelaEscalas from './_components/TabelaEscalas.svelte';
	import SecaoAssinaturas from './_components/SecaoAssinaturas.svelte';
	import ModalCadastrarRubrica from '$lib/components/ModalCadastrarRubrica.svelte';
	import DialogSolicitarAssinatura from '$lib/components/DialogSolicitarAssinatura.svelte';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import BotaoVoltar from '$lib/components/BotaoVoltar.svelte';
	import BotaoLimparFiltros from '$lib/components/BotaoLimparFiltros.svelte';
	import ModalShell from '$lib/components/ModalShell.svelte';

	const { data }: PageProps = $props();

	const auth = useAutorizacao();
	const isAdmin = $derived(auth.isAdmin);
	const isAdminSeccional = $derived(auth.isAdminSeccional);
	const lotacaoUsuario = $derived(auth.lotacaoUsuario);
	const papelUnidadeId = $derived(data.papelUnidadeId);

	const isAdminDPC = $derived(
		!isAdmin && (auth.isAdminSeccional || auth.isAdminUnidade) && page.data.usuario?.cargo === 'DPC'
	);
	const savedFilters = getSavedFilters('filtros_escalas', {
		lotacao: '',
		mes: new Date().getMonth() + 1,
		ano: new Date().getFullYear(),
		tipo: 'todos',
		seccional: 'todas',
		busca: '',
		status: ''
	});

	const unidades = $derived(data.unidades);
	const paginaAtual = $derived(data.pagination.page);

	let filtroLotacao = $state(untrack(() => data.filtros.lotacao || savedFilters.lotacao));
	let filtroMes = $state(untrack(() => data.filtros.mes || savedFilters.mes));
	let filtroAno = $state(untrack(() => data.filtros.ano || savedFilters.ano));
	let filtroTipo = $state(untrack(() => data.filtros.tipo || savedFilters.tipo));
	let filtroSeccional = $state<number | 'todas'>(
		(savedFilters.seccional as unknown as number) || 'todas'
	);
	let filtroBusca = $state(untrack(() => data.filtros.busca || savedFilters.busca));
	let filtroStatus = $state<'aguardando' | 'arquivada' | ''>(
		untrack(() => {
			const s = data.filtros.status || savedFilters.status;
			return s === 'aguardando' || s === 'arquivada' ? s : '';
		})
	);

	// Persistência (localStorage) + navegação server-side + auto-nav ao mudar
	// qualquer filtro exceto a busca (que navega via seu próprio handler).
	// `seccional` entra na assinatura (reseta a página) mas não vai à query —
	// só afeta o dropdown de delegacias no cliente.
	const filtros = useFiltrosPaginados({
		chave: 'filtros_escalas',
		snapshot: () => ({
			lotacao: filtroLotacao,
			mes: filtroMes,
			ano: filtroAno,
			tipo: filtroTipo,
			seccional: filtroSeccional,
			busca: filtroBusca,
			status: filtroStatus
		}),
		query: buildQueryParamsComFiltros,
		auto: {
			assinatura: () => [
				filtroSeccional ?? 'todas',
				filtroLotacao ?? '',
				filtroTipo ?? 'todos',
				filtroMes ?? 0,
				filtroAno ?? 0,
				filtroStatus ?? ''
			]
		}
	});

	// Normaliza null vindo do clear do SearchableSelect (mantém o default no select).
	$effect(() => {
		if (filtroSeccional === null) filtroSeccional = 'todas';
		if (filtroLotacao === null) filtroLotacao = '';
		if (filtroTipo === null) filtroTipo = 'todos';
		if (filtroMes === null) filtroMes = 0;
		if (filtroAno === null) filtroAno = 0;
	});

	const seccionais = $derived(unidades.filter((u: Unidade) => u.tipo === 'seccional'));
	const delegaciasDropdown = $derived(
		filtroSeccional === 'todas'
			? unidades.filter((u: Unidade) => u.tipo === 'delegacia')
			: unidades.filter(
					(u: Unidade) => u.tipo === 'delegacia' && u.seccional_id === filtroSeccional
				)
	);
	const delegaciasDaSeccional = $derived(
		unidades.filter((u: Unidade) => u.tipo === 'delegacia' && u.seccional_id === papelUnidadeId)
	);

	const seccionaisOptions = $derived([
		{ value: 'todas', label: 'Todas as Seccionais' },
		...seccionais.map((sec) => ({ value: sec.id, label: sec.nome }))
	]);

	const unidadesOptions = $derived([
		{ value: '', label: 'Selecione uma unidade...' },
		{ value: 'todas', label: 'Todas as unidades' },
		...delegaciasDropdown.map((del) => ({ value: del.nome, label: del.nome }))
	]);

	const unidadesDaSeccionalOptions = $derived([
		{ value: '', label: 'Todas as unidades' },
		...delegaciasDaSeccional.map((del) => ({ value: del.nome, label: del.nome }))
	]);

	const escalas = $derived(data.escalas ?? []);
	// Exclusão otimista: ids removidos somem da tabela na hora; o
	// invalidate('app:escalas') que segue corrige total/paginação no fundo.
	let removidosLocais = $state<number[]>([]);
	const escalasVisiveis = $derived(escalas.filter((e) => !removidosLocais.includes(e.id)));
	const totalPaginas = $derived(data.pagination.totalPages);

	let dialogOpen = $state(false);
	let dialogRevogarOpen = $state(false);
	let escalaParaExcluir = $state<{ id: number; titulo: string } | null>(null);
	let escalaParaRevogar = $state<{ id: number; titulo: string } | null>(null);
	let pendingExcluir = $state(false);
	let pendingRevogar = $state(false);

	const meses = opcoesMeses();
	const anos = [0, ...Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 1 + i)];

	const tiposOptions = [
		{ value: 'todos', label: 'Todos' },
		{ value: 'plantao', label: 'Plantão' },
		{ value: 'expediente', label: 'Expediente' },
		{ value: 'fds', label: 'Final de Semana' }
	];

	const mesesOptions = meses;
	const anosOptions = $derived(
		anos.map((ano) => ({ value: ano, label: ano === 0 ? 'Todos' : String(ano) }))
	);

	function buildQueryParamsComFiltros(p: number) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const params = new URLSearchParams();
		if (filtroLotacao && filtroLotacao !== 'todas') params.set('lotacao', filtroLotacao);
		if (filtroMes) params.set('mes', String(filtroMes));
		if (filtroAno) params.set('ano', String(filtroAno));
		if (filtroTipo && filtroTipo !== 'todos') params.set('tipo', filtroTipo);
		if (filtroBusca) params.set('busca', filtroBusca);
		if (filtroStatus === 'aguardando' || filtroStatus === 'arquivada') {
			params.set('status', filtroStatus);
		}
		params.set('page', String(p));
		return params;
	}

	function limparFiltros() {
		filtroSeccional = 'todas';
		filtroLotacao = 'todas';
		filtroMes = new Date().getMonth() + 1;
		filtroAno = new Date().getFullYear();
		filtroTipo = 'todos';
		filtroBusca = '';
		// Mantém `filtroStatus`: limpar filtros não troca a pasta (aguardando/arquivada).

		filtros.navegar(1);
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
		try {
			await apiFetch(`/api/escalas/${id}/documento-assinado`, { method: 'DELETE' });
			toaster.create({
				title: 'Assinatura revogada',
				description: 'A escala agora pode ser editada.',
				type: 'info'
			});
			goto(`/escalas/${id}`);
		} catch (e: unknown) {
			toaster.create({
				title: e instanceof Error ? e.message : 'Erro ao revogar assinatura',
				type: 'error'
			});
		} finally {
			pendingRevogar = false;
			escalaParaRevogar = null;
		}
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
		return async ({ result }: { result: ActionResult }) => {
			pendingExcluir = false;
			if (result.type === 'success') {
				const removida = escalaParaExcluir;
				toaster.create({
					title: `Escala de ${removida!.titulo} removida`,
					type: 'success'
				});
				if (removida) removidosLocais = [...removidosLocais, removida.id];
				dialogOpen = false;
				escalaParaExcluir = null;
				await invalidateShared('app:escalas');
				removidosLocais = [];
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				toaster.create({ title: String(d?.error || 'Erro ao remover'), type: 'error' });
			}
		};
	}

	let dialogNovaEscalaAberto = $state(false);

	let visao = $state<'home' | 'lista' | 'assinaturas'>(
		untrack(() => {
			const iv = data.initialView;
			return iv === 'lista' || iv === 'assinaturas' ? iv : 'home';
		})
	);

	function abrirLista(status: 'aguardando' | 'arquivada') {
		filtroStatus = status;
		visao = 'lista';
		goto(`?${buildQueryParamsComFiltros(1)}`, {
			replaceState: true,
			noScroll: true,
			keepFocus: true
		});
	}

	$effect(() => {
		const iv = data.initialView;
		if (iv === 'home' || iv === 'assinaturas') {
			visao = iv;
		}
	});

	$effect(() => {
		const s = data.filtros.status;
		if (s === 'aguardando' || s === 'arquivada') filtroStatus = s;
		else if (data.initialView === 'home') filtroStatus = '';
	});

	const tituloLista = $derived(
		filtroStatus === 'arquivada'
			? 'Escalas criadas (arquivo)'
			: filtroStatus === 'aguardando'
				? 'Escalas aguardando ass'
				: 'Arquivo'
	);

	const podeAssinar = $derived(data.podeAssinar);
	const escalasParaAssinar = $derived(data.escalasParaAssinar);

	// Pendências: foco + broadcast + poll quente se houver fila ou visão assinaturas.
	useInvalidateOnFocus('app:escalas', {
		isHot: () => escalasParaAssinar.length > 0 || visao === 'assinaturas',
		probe: async () => {
			try {
				const e = await fetchSyncEstado();
				// Sem fatia para este papel: pula o tick (não força invalidate).
				return e.escalas?.stamp ?? null;
			} catch {
				return null;
			}
		}
	});

	// --- Rubrica reutilizável (cadastro para assinatura por token) ---
	let minhaRubrica = $state<string | null>(untrack(() => rubricaValida(data.minhaRubrica)));
	let cadastrandoRubrica = $state(false);
	// Lógica 2a: quem pode assinar por token, tem pendência e NÃO tem rubrica.
	const precisaRubrica = $derived(podeAssinar && escalasParaAssinar.length > 0 && !minhaRubrica);
	useOfertaRubrica(
		() => precisaRubrica,
		() => cadastrandoRubrica,
		() => (cadastrandoRubrica = true)
	);

	const podeOIPSolicitar = $derived(data.podeOIPSolicitar);
	const solicitacoesMap = $derived(data.solicitacoesMap);

	let dialogSolicitar = $state(false);
	let escalaSolicitandoId = $state<number | null>(null);

	function abrirDialogSolicitar(escalaId: number) {
		escalaSolicitandoId = escalaId;
		dialogSolicitar = true;
	}

	async function cancelarSolicitacao(escalaId: number) {
		loading.show('Cancelando solicitação...');
		try {
			await apiFetch(`/api/escalas/${escalaId}/solicitar-assinatura`, { method: 'DELETE' });
			await invalidateShared('app:escalas');
			toaster.create({ title: 'Solicitação cancelada', type: 'success' });
		} catch (e: unknown) {
			toaster.create({
				title: e instanceof Error ? e.message : 'Erro ao cancelar solicitação',
				type: 'error'
			});
		} finally {
			loading.hide();
		}
	}

	const usuarioLogado = $derived(page.data.usuario ?? null);
	const mobileState = useMobile();
	const isMobile = $derived(mobileState.isMobile);
	const restringirSmartphone = $derived((page.data.restringirSmartphone as boolean) ?? false);
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
			await invalidateShared('app:escalas');
		}
	});

	let painelTokenRapidoControl = $state<{ assinarComSerpro: () => Promise<void> } | null>(null);

	function iniciarAssinaturaTela(id: number) {
		escalaAssinandoId = id;
		dialogAssinaturaTela = true;
	}

	async function iniciarAssinaturaToken(id: number) {
		escalaAssinandoId = id;
		await Promise.resolve();
		await painelTokenRapidoControl?.assinarComSerpro();
	}

	let signatureStep = $state<'signature' | 'camera' | 'email_code'>('signature');
	$effect(() => {
		if (dialogAssinaturaTela) {
			signatureStep = 'signature';
		}
	});

	const signatureTitulo = $derived(
		signatureStep === 'camera'
			? 'Prova de Vida'
			: signatureStep === 'email_code'
				? 'Confirmação de Identidade'
				: 'Assinatura Digital em Tela'
	);
	const signatureDescricao = $derived(
		signatureStep === 'camera'
			? 'Cumpra o desafio de presença na tela para provar que você está ativo.'
			: signatureStep === 'email_code'
				? 'Por razões de segurança, insira o código enviado para o seu e-mail funcional.'
				: 'Desenhe sua rubrica no quadro abaixo para assinar este documento.'
	);
</script>

<svelte:head>
	<title>Arquivo de Escalas - Portal de Escalas</title>
</svelte:head>

{#if visao === 'home'}
	<div class="space-y-8 sm:space-y-10">
		<h1 class="h1 text-2xl font-bold">Escalas ordinárias</h1>

		<div class="flex flex-col items-center gap-4 sm:gap-6">
			{#if isAdminDPC}
				<div class="grid grid-cols-1 gap-6 w-full max-w-xs">
					{#if podeAssinar && escalasParaAssinar.length > 0}
						<button
							type="button"
							onclick={() => {
								visao = 'assinaturas';
								goto('/escalas?v=assinaturas', { replaceState: true, noScroll: true });
							}}
							class="card-elevated rounded-2xl p-5 sm:p-6 flex flex-col items-start gap-1.5 text-left cursor-pointer transition-colors hover:border-primary-500/40 group"
						>
							<span
								class="inline-flex items-center gap-2 text-base font-semibold text-surface-900 dark:text-surface-50 group-hover:text-tertiary-600 dark:group-hover:text-tertiary-400 transition-colors"
							>
								Assinaturas Pendentes
								<span
									class="min-w-[1.4rem] h-[1.4rem] flex items-center justify-center rounded-full bg-tertiary-500 text-white text-xs font-bold px-1"
									>{escalasParaAssinar.length}</span
								>
							</span>
							<span class="text-sm text-surface-600 dark:text-surface-400"
								>Escalas prontas para assinar com sua assinatura digital</span
							>
						</button>
					{:else}
						<div
							class="card-elevated rounded-2xl p-5 sm:p-6 flex flex-col items-start gap-1.5 text-left"
						>
							<span class="text-base font-semibold text-surface-900 dark:text-surface-50"
								>Nenhuma pendência</span
							>
							<span class="text-sm text-surface-600 dark:text-surface-400"
								>Não há escalas aguardando sua assinatura no momento.</span
							>
						</div>
					{/if}
				</div>
			{:else}
				<div
					class="grid grid-cols-1 gap-6 w-full {podeAssinar && escalasParaAssinar.length > 0
						? 'sm:grid-cols-2 lg:grid-cols-4 max-w-5xl'
						: 'sm:grid-cols-2 lg:grid-cols-3 max-w-4xl'}"
				>
					<button
						type="button"
						onclick={() => (dialogNovaEscalaAberto = true)}
						class="card-elevated rounded-2xl p-5 sm:p-6 flex flex-col items-start gap-1.5 text-left cursor-pointer transition-colors border-primary-500 hover:border-primary-500/40 group"
					>
						<span
							class="inline-flex items-center gap-2 text-base font-semibold text-surface-900 dark:text-surface-50 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors"
						>
							<Plus
								class="h-5 w-5 shrink-0 text-primary-600 dark:text-primary-400"
								aria-hidden="true"
							/>
							Nova Escala
						</span>
						<span class="text-sm text-surface-600 dark:text-surface-400"
							>Criar uma nova escala de plantão, expediente ou final de semana</span
						>
					</button>
					<button
						type="button"
						onclick={() => abrirLista('aguardando')}
						class="card-elevated rounded-2xl p-5 sm:p-6 flex flex-col items-start gap-1.5 text-left cursor-pointer transition-colors hover:border-primary-500/40 group"
					>
						<span
							class="inline-flex items-center gap-2 text-base font-semibold text-surface-900 dark:text-surface-50 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors"
						>
							<Clock
								class="h-5 w-5 shrink-0 text-warning-600 dark:text-warning-400"
								aria-hidden="true"
							/>
							Escalas aguardando ass
						</span>
						<span class="text-sm text-surface-600 dark:text-surface-400"
							>Em preenchimento ou com assinatura pendente</span
						>
					</button>
					<button
						type="button"
						onclick={() => abrirLista('arquivada')}
						class="card-elevated rounded-2xl p-5 sm:p-6 flex flex-col items-start gap-1.5 text-left cursor-pointer transition-colors hover:border-primary-500/40 group"
					>
						<span
							class="inline-flex items-center gap-2 text-base font-semibold text-surface-900 dark:text-surface-50 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors"
						>
							<Archive
								class="h-5 w-5 shrink-0 text-surface-600 dark:text-surface-400"
								aria-hidden="true"
							/>
							Escalas criadas (arquivo)
						</span>
						<span class="text-sm text-surface-600 dark:text-surface-400">Assinadas e enviadas</span>
					</button>
					{#if podeAssinar && escalasParaAssinar.length > 0}
						<button
							type="button"
							onclick={() => {
								visao = 'assinaturas';
								goto('/escalas?v=assinaturas', { replaceState: true, noScroll: true });
							}}
							class="card-elevated rounded-2xl p-5 sm:p-6 flex flex-col items-start gap-1.5 text-left cursor-pointer transition-colors hover:border-primary-500/40 group"
						>
							<span
								class="inline-flex items-center gap-2 text-base font-semibold text-surface-900 dark:text-surface-50 group-hover:text-tertiary-600 dark:group-hover:text-tertiary-400 transition-colors"
							>
								Assinaturas Pendentes
								<span
									class="min-w-[1.4rem] h-[1.4rem] flex items-center justify-center rounded-full bg-tertiary-500 text-white text-xs font-bold px-1"
									>{escalasParaAssinar.length}</span
								>
							</span>
							<span class="text-sm text-surface-600 dark:text-surface-400"
								>Escalas prontas para assinar com sua assinatura digital</span
							>
						</button>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{:else if visao === 'lista'}
	<div class="mb-6 space-y-3">
		<BotaoVoltar
			onclick={() => {
				filtroStatus = '';
				visao = 'home';
				goto('/escalas', { replaceState: true, noScroll: true });
			}}
		/>
		<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
			<h1 class="h1 text-2xl font-bold">{tituloLista}</h1>
			<div class="flex gap-2 justify-end w-full sm:w-auto">
				<BotaoLimparFiltros {temFiltros} onclick={limparFiltros} />
			</div>
		</div>
	</div>

	<ModalShell
		bind:open={dialogOpen}
		title="Excluir Escala?"
		largura="sm"
		pending={pendingExcluir}
		cancelLabel="Cancelar"
	>
		{#snippet description()}
			Tem certeza que deseja excluir a escala "{escalaParaExcluir?.titulo}"? Esta ação não pode ser
			desfeita.
		{/snippet}

		{#snippet footer()}
			<form method="POST" action="?/excluir" use:enhance={handleExcluir} class="contents">
				<input type="hidden" name="escala_id" value={escalaParaExcluir?.id} />
				<button
					type="submit"
					class="btn preset-filled-error-500 flex items-center gap-2 transition-all"
					disabled={pendingExcluir}
				>
					{pendingExcluir ? 'Excluindo...' : 'Excluir'}
				</button>
			</form>
		{/snippet}
	</ModalShell>

	<ModalShell
		bind:open={dialogRevogarOpen}
		title="Editar Escala Assinada?"
		largura="md"
		pending={pendingRevogar}
		cancelLabel="Voltar"
	>
		{#snippet description()}
			<div class="space-y-4">
				<p class="text-surface-600 dark:text-surface-400">
					Esta escala já possui uma <strong>assinatura digital</strong> válida. Ao editá-la, a
					assinatura atual será
					<span class="text-error-500 font-bold underline">revogada</span> (removida).
				</p>
				<p class="text-surface-600 dark:text-surface-400 text-sm">
					Se você deseja apenas visualizar a escala oficial, utilize a opção <strong
						>Exportar</strong
					> ou clique no título da escala.
				</p>
			</div>
		{/snippet}

		{#snippet footer()}
			<button
				type="button"
				class="btn preset-filled-error-500 flex items-center gap-2 transition-all"
				onclick={confirmarRevogacao}
				disabled={pendingRevogar}
			>
				{pendingRevogar ? 'Revogando...' : 'Revogar e Editar'}
			</button>
		{/snippet}
	</ModalShell>

	<div class="card-glass p-4 rounded-3xl overflow-hidden mt-4">
		<div
			class="grid grid-cols-12 gap-2 mb-6 p-3 rounded-2xl bg-surface-100/30 dark:bg-surface-800/20 border border-surface-200 dark:border-white/5 items-end"
		>
			{#if isAdmin}
				<div class="flex flex-col gap-1 col-span-12 lg:col-span-3">
					<span class="label-text font-semibold mb-1">Seccional</span>
					<SearchableSelect
						options={seccionaisOptions}
						bind:value={filtroSeccional}
						ariaLabel="Filtrar por seccional"
						placeholder="Todas as Seccionais"
						class="[&_input]:px-2.5 [&_input]:py-1.5 [&_input]:text-xs sm:[&_input]:text-sm"
					/>
				</div>
				<div class="flex flex-col gap-1 col-span-12 lg:col-span-3">
					<span class="label-text font-semibold mb-1">Unidade de Lotação</span>
					<SearchableSelect
						options={unidadesOptions}
						bind:value={filtroLotacao}
						ariaLabel="Filtrar por unidade de lotação"
						placeholder="Selecione uma unidade..."
						class="[&_input]:px-2.5 [&_input]:py-1.5 [&_input]:text-xs sm:[&_input]:text-sm"
					/>
				</div>
			{:else if isAdminSeccional}
				<div class="flex flex-col gap-1 col-span-12 lg:col-span-6">
					<span class="label-text font-semibold mb-1">Unidade de Lotação</span>
					<SearchableSelect
						options={unidadesDaSeccionalOptions}
						bind:value={filtroLotacao}
						ariaLabel="Filtrar por unidade de lotação"
						placeholder="Todas as unidades"
						class="[&_input]:px-2.5 [&_input]:py-1.5 [&_input]:text-xs sm:[&_input]:text-sm"
					/>
				</div>
			{/if}

			<div
				class="flex flex-col gap-1 col-span-12 {isAdmin || isAdminSeccional
					? 'lg:col-span-2'
					: 'lg:col-span-6'}"
			>
				<span class="label-text font-semibold mb-1">Tipo</span>
				<SearchableSelect
					options={tiposOptions}
					bind:value={filtroTipo}
					ariaLabel="Filtrar por tipo de escala"
					placeholder="Todos"
					class="[&_input]:px-2.5 [&_input]:py-1.5 [&_input]:text-xs sm:[&_input]:text-sm"
				/>
			</div>

			<div
				class="flex flex-col gap-1 col-span-6 {isAdmin || isAdminSeccional
					? 'lg:col-span-2'
					: 'lg:col-span-4'}"
			>
				<span class="label-text font-semibold mb-1">Mês</span>
				<SearchableSelect
					options={mesesOptions}
					bind:value={filtroMes}
					ariaLabel="Filtrar por mês"
					placeholder="Todos"
					class="[&_input]:px-2.5 [&_input]:py-1.5 [&_input]:text-xs sm:[&_input]:text-sm"
				/>
			</div>

			<div class="flex flex-col gap-1 col-span-6 lg:col-span-2">
				<span class="label-text font-semibold mb-1">Ano</span>
				<SearchableSelect
					options={anosOptions}
					bind:value={filtroAno}
					ariaLabel="Filtrar por ano"
					placeholder="Todos"
					class="[&_input]:px-2.5 [&_input]:py-1.5 [&_input]:text-xs sm:[&_input]:text-sm"
				/>
			</div>
		</div>

		<TabelaEscalas
			escalas={escalasVisiveis}
			{podeOIPSolicitar}
			{solicitacoesMap}
			{paginaAtual}
			{totalPaginas}
			onSolicitarEdicao={solicitarEdicao}
			onSolicitarExclusao={solicitarExclusao}
			onAbrirDialogSolicitar={abrirDialogSolicitar}
			onCancelarSolicitacao={cancelarSolicitacao}
			onNovaEscala={() => (dialogNovaEscalaAberto = true)}
			onPageChange={filtros.irParaPagina}
		/>
	</div>
{:else if visao === 'assinaturas'}
	{#if precisaRubrica}
		<div
			class="mx-auto mb-4 max-w-3xl rounded-xl border border-tertiary-300 bg-tertiary-50 dark:border-tertiary-700 dark:bg-tertiary-900/30 p-4 flex flex-col sm:flex-row sm:items-center gap-3"
		>
			<PenLine
				class="w-7 h-7 shrink-0 text-tertiary-600 dark:text-tertiary-400"
				aria-hidden="true"
			/>
			<div class="flex-1 text-sm">
				<p class="font-bold">Cadastre sua rubrica</p>
				<p class="text-surface-600 dark:text-surface-300">
					Sua rubrica aparecerá no campo de assinatura dos documentos que você assinar por token. É
					de uso pessoal e opcional — você pode assinar sem ela.
				</p>
			</div>
			<button
				type="button"
				class="btn preset-filled-tertiary-500 whitespace-nowrap"
				onclick={() => (cadastrandoRubrica = true)}
			>
				Cadastrar rubrica
			</button>
		</div>
	{/if}
	<SecaoAssinaturas
		{escalasParaAssinar}
		{assinaturaTelaBloqueada}
		{isMobile}
		onIniciarAssinaturaTela={iniciarAssinaturaTela}
		onIniciarAssinaturaToken={iniciarAssinaturaToken}
		onVoltar={() => {
			visao = 'home';
			goto('/escalas', { replaceState: true, noScroll: true });
		}}
	/>
{/if}

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
			await invalidateShared('app:escalas');
		}}
	/>
</div>

<ModalShell
	bind:open={dialogRevogarSolicitacaoOpen}
	title="Cancelar solicitação?"
	largura="sm"
	pending={loading.active}
	onOpenChange={(open) => {
		if (!open) {
			escalaAbrirComSolicitacao = null;
		}
	}}
>
	{#snippet description()}
		<span class="text-sm">
			Esta escala possui uma solicitação de assinatura pendente. Ao abri-la para edição, a
			solicitação será cancelada automaticamente.
		</span>
	{/snippet}

	<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
		<button
			type="button"
			class="btn preset-outlined-surface-500"
			onclick={() => {
				dialogRevogarSolicitacaoOpen = false;
				escalaAbrirComSolicitacao = null;
			}}>Voltar</button
		>
		<button
			type="button"
			class="btn preset-filled-warning-500 font-bold transition-all"
			onclick={async () => {
				const id = escalaAbrirComSolicitacao!;
				dialogRevogarSolicitacaoOpen = false;
				escalaAbrirComSolicitacao = null;
				await cancelarSolicitacao(id);
				goto(`/escalas/${id}`);
			}}>Cancelar e Abrir</button
		>
	</div>
</ModalShell>

<DialogSolicitarAssinatura
	bind:open={dialogSolicitar}
	escalaId={escalaSolicitandoId}
	onConfirmado={async () => {
		escalaSolicitandoId = null;
		// Invalidação segmentada: refaz só o load da listagem (depends em
		// /escalas/+page.server.ts), não o layout inteiro.
		await invalidateShared('app:escalas');
	}}
/>

<ModalShell
	bind:open={dialogAssinaturaTela}
	title={signatureTitulo}
	description={signatureDescricao}
	largura="lg"
	familia="escalas"
	pending={assinaturaRapida.assinandoSimples}
>
	{#if dialogAssinaturaTela}
		<SignaturePad
			message="Rubrica do Organizador"
			onConfirm={async (p: SignaturePadConfirmPayload) => {
				await assinaturaRapida.assinarSimples(
					p.rubrica,
					p.lat,
					p.lng,
					p.selfie,
					p.codigoEmail,
					p.desafioId,
					p.liveness
				);
			}}
			onCancel={() => (dialogAssinaturaTela = false)}
			exigirFoto={page.data.exigirFotoAssinatura ?? true}
			exigirGps={page.data.exigirGpsAssinatura ?? true}
			exigirCodigoEmail={page.data.exigirCodigoEmailAssinatura ?? false}
			bind:step={signatureStep}
		/>
	{/if}
</ModalShell>

<!-- Cadastro/gestão da rubrica reutilizável (assinatura por token no computador) -->
<ModalCadastrarRubrica
	bind:open={cadastrandoRubrica}
	rubricaAtual={minhaRubrica}
	onSaved={(nova) => (minhaRubrica = rubricaValida(nova))}
/>

<ModalNovaEscala
	bind:open={dialogNovaEscalaAberto}
	{isAdmin}
	{lotacaoUsuario}
	{unidades}
	escalasExistentes={data.escalasExistentes}
	oncriado={(id) => goto(`/escalas/${id}`)}
	onfechar={() => {}}
/>

<FloatingRefresh chaves="app:escalas" />
