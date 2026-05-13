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
	import {
		useAutorizacao,
		getSavedFilters,
		useAssinaturaEscala,
		useMobile
	} from '$lib/composables';
	import PaginationControls from '$lib/components/PaginationControls.svelte';
	import SignaturePad from '$lib/components/SignaturePad.svelte';
	import PainelAssinaturaToken from '$lib/components/PainelAssinaturaToken.svelte';
	import { page, navigating } from '$app/state';
	import SkeletonCard from '$lib/components/SkeletonCard.svelte';
	import FloatingRefresh from '$lib/components/FloatingRefresh.svelte';
	import ModalNovaEscala from './_components/ModalNovaEscala.svelte';

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
	const MESES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

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

	let dialogNovaEscalaAberto = $state(false);

	let visao = $state<'home' | 'lista' | 'assinaturas'>(
		untrack(() => {
			const iv = (data as Record<string, any>).initialView;
			return iv === 'lista' || iv === 'assinaturas' ? (iv as 'lista' | 'assinaturas') : 'home';
		})
	);

	// Sincroniza visao quando a URL muda para /escalas sem params (ex: clique na aba de navegação)
	$effect(() => {
		const iv = (data as any).initialView as string;
		if (iv === 'home' || iv === 'assinaturas') {
			visao = iv;
		}
	});

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
	const podeOIPSolicitar = $derived((data.podeOIPSolicitar as boolean) ?? false);
	type SolicitacaoInfo = {
		tipo: 'unidade' | 'respondencia';
		destinatario_nome?: string;
		destinatario_id?: number;
	};
	const solicitacoesMap = $derived((data.solicitacoesMap ?? {}) as Record<number, SolicitacaoInfo>);

	let dialogSolicitar = $state(false);
	let escalaSolicitandoId = $state<number | null>(null);
	let opcaoSolicitacao = $state<'unidade' | 'respondencia'>('unidade');
	let buscaDestinatario = $state('');
	let destinatarioSelecionado = $state<{ id: number; nome: string; lotacao: string } | null>(null);
	let resultadosBuscaDestinatario = $state<
		Array<{ id: number; nome: string; cargo: string; lotacao: string }>
	>([]);
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

</script>

<svelte:head>
	<title>Arquivo de Escalas - Portal de Escalas</title>
</svelte:head>

{#if visao === 'home'}
	<div class="flex flex-col items-center justify-center min-h-[60vh] gap-4 sm:gap-6">
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
					dialogNovaEscalaAberto = true;
				}}
				class="card p-6 sm:p-8 flex flex-col items-center gap-4 cursor-pointer hover:shadow-xl transition-shadow border-2 border-primary-500 bg-surface-50 dark:bg-surface-900 rounded-2xl group"
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
				onclick={() => {
					visao = 'lista';
					goto(`?${buildQueryParamsComFiltros(1)}`, {
						replaceState: true,
						noScroll: true,
						keepFocus: true
					});
				}}
				class="card p-6 sm:p-8 flex flex-col items-center gap-4 cursor-pointer hover:shadow-xl transition-shadow border-2 border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-900 rounded-2xl group"
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
					onclick={() => {
						visao = 'assinaturas';
						goto('/escalas?v=assinaturas', { replaceState: true, noScroll: true });
					}}
					class="card p-6 sm:p-8 flex flex-col items-center gap-4 cursor-pointer hover:shadow-xl transition-shadow border-2 border-tertiary-500 bg-surface-50 dark:bg-surface-900 rounded-2xl group"
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
	<div class="flex items-center gap-3 mb-6">
		<button
			type="button"
			class="btn btn-sm preset-outlined-surface"
			onclick={() => {
				visao = 'home';
				goto('/escalas', { replaceState: true, noScroll: true });
			}}>← Voltar</button
		>
		<h1 class="h1 text-xl font-bold">Arquivo</h1>
	</div>

	<Dialog open={dialogOpen} onOpenChange={(e) => (dialogOpen = e.open)}>
		<Dialog.Content
			class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
		>
			<div
				class="card p-4 sm:p-6 max-w-sm w-full max-h-[calc(100dvh-2rem)] overflow-y-auto bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10"
			>
				<Dialog.Title class="h3 font-bold mb-2">Excluir Escala?</Dialog.Title>
				<Dialog.Description class="text-surface-600 dark:text-surface-400 mb-6">
					Tem certeza que deseja excluir a escala "{escalaParaExcluir?.titulo}"? Esta ação não pode
					ser desfeita.
				</Dialog.Description>
				<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
					<Dialog.CloseTrigger class="btn preset-outlined-surface" disabled={pendingExcluir}
						>Cancelar</Dialog.CloseTrigger
					>
					<form method="POST" action="?/excluir" use:enhance={handleExcluir} class="contents">
						<input type="hidden" name="escala_id" value={escalaParaExcluir?.id} />
						<button
							type="submit"
							class="btn preset-filled-error-500 flex items-center gap-2 active:scale-95 transition-all"
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
			class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
		>
			<div
				class="card p-4 sm:p-6 max-w-md w-full max-h-[calc(100dvh-2rem)] overflow-y-auto bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10"
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
				<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
					<Dialog.CloseTrigger class="btn preset-outlined-surface">Voltar</Dialog.CloseTrigger>
					<button
						type="button"
						class="btn preset-filled-error-500 flex items-center gap-2 active:scale-95 transition-all"
						onclick={confirmarRevogacao}
						disabled={pendingRevogar}
					>
						{pendingRevogar ? 'Revogando...' : 'Revogar e Editar'}
					</button>
				</div>
			</div>
		</Dialog.Content>
	</Dialog>

	<ModalNovaEscala
		bind:open={dialogNovaEscalaAberto}
		{isAdmin}
		{lotacaoUsuario}
		{unidades}
		escalasExistentes={data.escalasExistentes}
		oncriado={(id) => {
			if (abriuDoHome) abriuDoHome = false;
			goto(`/escalas/${id}`);
		}}
		onfechar={() => {
			if (abriuDoHome) {
				abriuDoHome = false;
				visao = 'home';
				goto('/escalas', { replaceState: true, noScroll: true });
			}
		}}
	/>

	<div
		class="p-6 rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20 overflow-hidden mt-6"
	>
		<div
			class="grid grid-cols-12 gap-3 mb-8 p-6 rounded-2xl bg-surface-100/30 dark:bg-surface-800/20 border border-surface-200 dark:border-white/5"
		>
			{#if isAdmin}
				<label class="label col-span-12 lg:col-span-3">
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

				<label class="label col-span-12 lg:col-span-3">
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
				<label class="label col-span-12 lg:col-span-6">
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
				class="label col-span-12 {isAdmin || isAdminSeccional ? 'lg:col-span-2' : 'lg:col-span-5'}"
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
				class="label col-span-6 {isAdmin || isAdminSeccional ? 'lg:col-span-1' : 'lg:col-span-3'}"
			>
				<span class="label-text font-semibold mb-1">Mês</span>
				<select class="select" bind:value={filtroMes} onchange={navegarComFiltros}>
					{#each meses as mes}
						<option value={mes.value}>{mes.label}</option>
					{/each}
				</select>
			</label>

			<label
				class="label col-span-6 {isAdmin || isAdminSeccional ? 'lg:col-span-1' : 'lg:col-span-2'}"
			>
				<span class="label-text font-semibold mb-1">Ano</span>
				<select class="select" bind:value={filtroAno} onchange={navegarComFiltros}>
					{#each anos as ano}
						<option value={ano}>{ano === 0 ? 'Todos' : ano}</option>
					{/each}
				</select>
			</label>

			<div class="col-span-12 lg:col-span-2 flex items-end">
				<button
					type="button"
					class="btn btn-sm w-full {temFiltros
						? 'preset-filled-warning-500'
						: 'preset-outlined-surface opacity-40'}"
					onclick={limparFiltros}
					disabled={!temFiltros}
				>
					Limpar filtros
				</button>
			</div>
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
				<button
					type="button"
					class="btn preset-filled-primary-500 active:scale-95 transition-all"
					onclick={() => (dialogNovaEscalaAberto = true)}>Criar Escala</button
				>
			</div>
		{:else}
			<!-- Desktop: tabela -->
			<div class="hidden lg:block table-wrap">
				<table class="table">
					<thead>
						<tr>
							<th>Título</th>
							<th>Cidade</th>
							<th>Período</th>
							<th>Status</th>
							<th>Ações</th>
						</tr>
					</thead>
					<tbody>
						{#if navigating?.to && navigating.to.url.pathname === page.url.pathname}
							{#each { length: 8 } as _}
								<tr class="animate-pulse">
									<td class="px-4 py-3"
										><div class="h-4 w-36 rounded bg-surface-200 dark:bg-surface-700"></div></td
									>
									<td class="px-4 py-3"
										><div class="h-4 w-20 rounded bg-surface-200 dark:bg-surface-700"></div></td
									>
									<td class="px-4 py-3"
										><div class="h-4 w-32 rounded bg-surface-200 dark:bg-surface-700"></div></td
									>
									<td class="px-4 py-3"
										><div
											class="h-6 w-24 rounded-full bg-surface-200 dark:bg-surface-700"
										></div></td
									>
									<td class="px-4 py-3"
										><div class="flex gap-2">
											<div class="h-8 w-14 rounded-lg bg-surface-200 dark:bg-surface-700"></div>
											<div class="h-8 w-18 rounded-lg bg-surface-200 dark:bg-surface-700"></div>
										</div></td
									>
								</tr>
							{/each}
						{:else}
							{#each escalas as esc (esc.id)}
								{@const dRow = new Date(esc.data_inicio + 'T00:00:00')}
								<tr>
									<td>
										<div class="flex flex-col gap-0.5">
											{#if esc.tipo === 'expediente'}
												<span
													class="badge preset-outlined-secondary-500 font-bold text-xs px-2 py-0.5 w-fit"
													>Expediente</span
												>
											{:else if esc.tipo === 'fds'}
												<span
													class="badge preset-outlined-tertiary-500 font-bold text-xs px-2 py-0.5 w-fit"
													>FDS</span
												>
											{:else}
												<span
													class="badge preset-outlined-primary-500 font-bold text-xs px-2 py-0.5 w-fit"
													>Plantão</span
												>
											{/if}
											<a href="/escalas/{esc.id}" class="anchor text-sm font-semibold">
												{esc.tipo !== 'fds'
													? `${MESES_PT[dRow.getMonth()]} ${dRow.getFullYear()}`
													: `${formatarData(esc.data_inicio)} a ${formatarData(esc.data_fim)}`}
											</a>
											<span class="text-xs text-surface-500 truncate">{esc.lotacao}</span>
										</div>
									</td>
									<td>{esc.cidade}</td>
									<td class="font-mono tabular-nums text-sm">
										<div class="flex flex-col leading-snug">
											<span>{formatarData(esc.data_inicio)}</span>
											<span class="text-surface-400 dark:text-surface-500 text-xs">a</span>
											<span>{formatarData(esc.data_fim)}</span>
										</div>
									</td>
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
															class="card p-1 bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-white/10 shadow-xl flex flex-col min-w-[160px] max-w-[calc(100vw-1rem)]"
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
														class="btn btn-sm preset-filled-success-500 active:scale-95 transition-all"
														onclick={() => abrirDialogSolicitar(esc.id)}>Solicitar Ass.</button
													>
												{/if}
											{/if}
											<button
												type="button"
												class="btn btn-sm preset-filled-error-500 flex-1 active:scale-95 transition-all"
												onclick={() => solicitarExclusao(esc.id, esc.titulo)}>Excluir</button
											>
										</div>
									</td>
								</tr>
							{/each}
						{/if}
					</tbody>
				</table>
			</div>

			<!-- Mobile: cards -->
			<div class="lg:hidden space-y-3">
				{#if navigating?.to && navigating.to.url.pathname === page.url.pathname}
					{#each { length: 5 } as _}
						<SkeletonCard />
					{/each}
				{:else}
					{#each escalas as esc (esc.id)}
						{@const d = new Date(esc.data_inicio + 'T00:00:00')}
						<div
							class="p-4 rounded-2xl bg-surface-100/50 dark:bg-surface-800/50 border border-surface-200 dark:border-white/10 hover:border-primary-500/30 transition-colors"
						>
							<div class="flex justify-between items-start mb-3 gap-2">
								<div class="min-w-0 flex-1">
									{#if esc.tipo === 'expediente'}
										<span
											class="badge preset-outlined-secondary-500 font-bold text-[0.65rem] px-2 py-0.5 mb-0.5 inline-block"
											>Expediente</span
										>
									{:else if esc.tipo === 'fds'}
										<span
											class="badge preset-outlined-tertiary-500 font-bold text-[0.65rem] px-2 py-0.5 mb-0.5 inline-block"
											>FDS</span
										>
									{:else}
										<span
											class="badge preset-outlined-primary-500 font-bold text-[0.65rem] px-2 py-0.5 mb-0.5 inline-block"
											>Plantão</span
										>
									{/if}
									<a
										href="/escalas/{esc.id}"
										class="font-bold text-sm text-surface-900 dark:text-surface-50 no-underline hover:text-primary-500 dark:hover:text-primary-400 leading-tight block"
									>
										{esc.tipo !== 'fds'
											? `${MESES_PT[d.getMonth()]} ${d.getFullYear()}`
											: `${formatarData(esc.data_inicio)} a ${formatarData(esc.data_fim)}`}
									</a>
									<p class="text-xs text-surface-500 dark:text-surface-400 truncate">
										{esc.lotacao}
									</p>
								</div>
								{#if esc.is_assinada}
									<span
										class="badge preset-filled-success-500 font-bold px-1.5 py-0.5 text-[0.65rem] rounded-full flex items-center gap-1 shadow-sm"
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
										class="badge preset-filled-success-500 font-bold px-1.5 py-0.5 text-[0.65rem] rounded-full flex items-center gap-1 shadow-sm"
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
										class="badge preset-tonal-warning font-bold px-1.5 py-0.5 text-[0.65rem] rounded-full flex items-center gap-1 shadow-sm"
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
										class="badge preset-tonal-surface font-bold px-1.5 py-0.5 text-[0.65rem] rounded-full flex items-center gap-1 shadow-sm"
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
									<span
										class="text-surface-900 dark:text-surface-100 font-mono tabular-nums text-xs"
										>{formatarData(esc.data_inicio)} a {formatarData(esc.data_fim)}</span
									>
								</div>
								{#if esc.tipo === 'fds'}
									<div class="flex justify-between">
										<span class="text-surface-500 font-medium">Horário</span>
										<span class="text-surface-900 dark:text-surface-100 font-mono tabular-nums"
											>{esc.horario}</span
										>
									</div>
								{/if}
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
												class="card p-1 bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-white/10 shadow-xl flex flex-col min-w-[160px] max-w-[calc(100vw-1rem)]"
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
								<button
									type="button"
									class="btn btn-sm preset-filled-error-500 flex-1 active:scale-95 transition-all"
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
										class="btn btn-sm preset-filled-success-500 w-full mt-2 active:scale-95 transition-all"
										onclick={() => abrirDialogSolicitar(esc.id)}
									>
										<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"
											><path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
											/></svg
										>
										Solicitar Assinatura
									</button>
								{/if}
							{/if}
						</div>
					{/each}
				{/if}
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
		<div class="flex items-center gap-3">
			<button
				type="button"
				class="btn btn-sm preset-outlined-surface"
				onclick={() => {
					visao = 'home';
					goto('/escalas', { replaceState: true, noScroll: true });
				}}>← Voltar</button
			>
			<h1 class="h1 text-xl font-bold">Assinaturas Pendentes</h1>
			<span class="badge preset-filled-tertiary-500 text-white font-bold text-sm px-2"
				>{escalasParaAssinar.length}</span
			>
		</div>

		{#if escalasParaAssinar.length === 0}
			<div class="text-center py-16 text-surface-500">
				<svg class="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				<p class="font-semibold">Nenhuma escala pendente de assinatura.</p>
			</div>
		{:else}
			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				{#each escalasParaAssinar as esc (esc.id)}
					{@const dAss = new Date(esc.data_inicio + 'T00:00:00')}
					{@const isPlantao = esc.tipo === 'plantao'}
					{@const isExp = esc.tipo === 'expediente'}
					{@const accentBar = isPlantao ? 'bg-primary-500' : isExp ? 'bg-secondary-500' : 'bg-tertiary-500'}
					{@const tipoBadgeClass = isPlantao
						? 'bg-primary-500/10 text-primary-700 dark:text-primary-400'
						: isExp
							? 'bg-secondary-500/10 text-secondary-700 dark:text-secondary-400'
							: 'bg-tertiary-500/10 text-tertiary-700 dark:text-tertiary-400'}
					{@const tipoLabel = isPlantao ? 'Plantão' : isExp ? 'Expediente' : 'FDS'}
					{@const tituloPeriodo = esc.tipo !== 'fds'
						? `${MESES_PT[dAss.getMonth()]} ${dAss.getFullYear()}`
						: `${formatarData(esc.data_inicio)} – ${formatarData(esc.data_fim)}`}

					<div class="flex flex-col rounded-2xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-sm overflow-hidden hover:shadow-md hover:border-tertiary-500/40 dark:hover:border-tertiary-400/20 transition-all duration-200 group">
						<!-- Color accent strip -->
						<div class="h-1 {accentBar}"></div>

						<div class="flex flex-col gap-3 p-4 sm:p-5 flex-1">
							<!-- Badges -->
							<div class="flex items-center gap-2 flex-wrap">
								<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[0.62rem] font-bold uppercase tracking-wide {tipoBadgeClass}">
									{tipoLabel}
								</span>
								<span class="inline-flex items-center gap-1 rounded-full bg-warning-500/15 px-2 py-0.5 text-[0.62rem] font-bold uppercase tracking-wide text-warning-700 dark:text-warning-400">
									<svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
									</svg>
									Aguardando assinatura
								</span>
							</div>

							<!-- Title + meta -->
							<div class="flex-1">
								<p class="text-base sm:text-lg font-bold text-surface-800 dark:text-surface-100 leading-tight group-hover:text-tertiary-600 dark:group-hover:text-tertiary-300 transition-colors">
									{tituloPeriodo}
								</p>
								<p class="text-sm font-medium text-surface-600 dark:text-surface-300 mt-1 truncate">
									{esc.lotacao}
								</p>
								<p class="text-xs text-surface-400 dark:text-surface-500 mt-0.5">
									{esc.cidade} · {formatarData(esc.data_inicio)} a {formatarData(esc.data_fim)}
								</p>
							</div>

							<!-- Actions -->
							<div class="flex flex-col gap-2 pt-3 border-t border-surface-100 dark:border-surface-700/50 min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
								<Popover positioning={{ placement: 'bottom-start', offset: { mainAxis: 4 } }}>
									<Popover.Trigger class="btn btn-sm preset-outlined-surface-500 text-xs px-3 py-1.5 w-full min-[420px]:w-auto">
										Opções ▾
									</Popover.Trigger>
									<Portal>
										<Popover.Positioner class="z-50">
											<Popover.Content
												class="card p-1 bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-white/10 shadow-xl flex flex-col min-w-[160px] max-w-[calc(100vw-1rem)]"
											>
												<button
													type="button"
													class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
													onclick={() => solicitarEdicao(esc as EscalaListagem)}
												>
													Editar escala
												</button>
												<a
													class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
													href="/api/escalas/{esc.id}/download?format=pdf"
													target="_blank"
												>
													Ver em PDF
												</a>
											</Popover.Content>
										</Popover.Positioner>
									</Portal>
								</Popover>

								<div class="flex gap-2">
									<button
										type="button"
										class="btn btn-sm preset-filled-warning-500 font-bold text-xs px-3 py-1.5 flex-1 min-[420px]:flex-none disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all"
										disabled={assinaturaTelaBloqueada}
										title={assinaturaTelaBloqueada ? 'Restrito a dispositivos móveis pelo administrador' : undefined}
										onclick={() => iniciarAssinaturaTela(esc.id)}
									>
										Assinar (Tela)
									</button>
									<button
										type="button"
										class="btn btn-sm preset-filled-tertiary-500 font-bold text-xs px-3 py-1.5 flex-1 min-[420px]:flex-none active:scale-95 transition-all"
										onclick={() => iniciarAssinaturaToken(esc.id)}
									>
										Assinar (Token)
									</button>
								</div>
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
<Dialog
	open={dialogRevogarSolicitacaoOpen}
	onOpenChange={(e) => {
		if (!e.open) {
			dialogRevogarSolicitacaoOpen = false;
			escalaAbrirComSolicitacao = null;
		}
	}}
>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="card p-4 sm:p-6 max-w-sm w-full max-h-[calc(100dvh-2rem)] overflow-y-auto bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10"
		>
			<Dialog.Title class="h3 font-bold mb-2">Cancelar solicitação?</Dialog.Title>
			<Dialog.Description class="text-sm text-surface-500 dark:text-surface-400 mb-5">
				Esta escala possui uma solicitação de assinatura pendente. Ao abri-la para edição, a
				solicitação será cancelada automaticamente.
			</Dialog.Description>
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
					class="btn preset-filled-warning-500 font-bold active:scale-95 transition-all"
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
<Dialog
	open={dialogSolicitar}
	onOpenChange={(e) => {
		if (!e.open) dialogSolicitar = false;
	}}
>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="card p-4 sm:p-6 max-w-md w-full max-h-[calc(100dvh-2rem)] overflow-y-auto bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10"
		>
			<Dialog.Title class="h3 font-bold mb-1">Solicitar Assinatura</Dialog.Title>
			<Dialog.Description class="text-sm text-surface-500 dark:text-surface-400 mb-5">
				Quem deve assinar esta escala?
			</Dialog.Description>

			<div class="space-y-3 mb-5">
				<!-- Opção 1: Admin da Unidade -->
				<button
					type="button"
					class="w-full p-4 rounded-xl border-2 text-left transition-all {opcaoSolicitacao ===
					'unidade'
						? 'border-primary-500 bg-primary-500/10'
						: 'border-surface-300 dark:border-white/10 hover:border-primary-400/60'}"
					onclick={() => {
						opcaoSolicitacao = 'unidade';
						destinatarioSelecionado = null;
					}}
				>
					<div class="flex items-start gap-3">
						<div
							class="mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors {opcaoSolicitacao ===
							'unidade'
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
					class="w-full p-4 rounded-xl border-2 text-left transition-all {opcaoSolicitacao ===
					'respondencia'
						? 'border-tertiary-500 bg-tertiary-500/10'
						: 'border-surface-300 dark:border-white/10 hover:border-tertiary-400/60'}"
					onclick={() => {
						opcaoSolicitacao = 'respondencia';
					}}
				>
					<div class="flex items-start gap-3">
						<div
							class="mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors {opcaoSolicitacao ===
							'respondencia'
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
									<div class="text-xs text-surface-500 truncate">
										{destinatarioSelecionado.lotacao}
									</div>
								</div>
								<button
									type="button"
									class="btn btn-sm preset-outlined-surface-500 shrink-0"
									onclick={() => {
										destinatarioSelecionado = null;
										buscaDestinatario = '';
										resultadosBuscaDestinatario = [];
									}}
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

			<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
				<button
					type="button"
					class="btn preset-outlined-surface-500"
					onclick={() => (dialogSolicitar = false)}>Cancelar</button
				>
				<button
					type="button"
					class="btn preset-filled-primary-500 font-bold disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all"
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
<Dialog
	open={dialogAssinaturaTela}
	onOpenChange={(e) => {
		if (!e.open) dialogAssinaturaTela = false;
	}}
>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="card p-4 sm:p-6 max-w-lg w-full max-h-[calc(100dvh-2rem)] overflow-y-auto bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10"
		>
			<Dialog.Title class="h3 font-bold mb-2">Assinatura Digital em Tela</Dialog.Title>
			<Dialog.Description class="text-xs text-surface-600 dark:text-surface-400 mb-4">
				Desenhe sua rubrica no quadro abaixo para assinar este documento.
			</Dialog.Description>
			<SignaturePad
				message="Rubrica do Organizador"
				onConfirm={async (
					rubrica: string,
					lat?: number,
					lng?: number,
					selfie?: string | null,
					codigo?: string,
					desafioId?: string
				) => {
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
<FloatingRefresh />
