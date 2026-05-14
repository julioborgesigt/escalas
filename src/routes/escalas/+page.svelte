<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import { browser } from '$app/environment';
	import type { EscalaListagem, Unidade } from '$lib/types';
	import { csrfHeaders } from '$lib/csrf';
	import {
		useAutorizacao,
		getSavedFilters,
		useAssinaturaEscala,
		useMobile
	} from '$lib/composables';
	import SignaturePad from '$lib/components/SignaturePad.svelte';
	import PainelAssinaturaToken from '$lib/components/PainelAssinaturaToken.svelte';
	import { page } from '$app/state';
	import FloatingRefresh from '$lib/components/FloatingRefresh.svelte';
	import ModalNovaEscala from './_components/ModalNovaEscala.svelte';
	import TabelaEscalas from './_components/TabelaEscalas.svelte';
	import SecaoAssinaturas from './_components/SecaoAssinaturas.svelte';
	import DialogSolicitarAssinatura from './_components/DialogSolicitarAssinatura.svelte';

	let { data, form } = $props();

	const auth = useAutorizacao();
	const isAdmin = $derived(auth.isAdmin);
	const isAdminSeccional = $derived(auth.isAdminSeccional);
	const lotacaoUsuario = $derived(auth.lotacaoUsuario);
	const papelUnidadeId = $derived(data.papelUnidadeId as number | null);

	const isAdminDPC = $derived(
		!isAdmin &&
		(auth.isAdminSeccional || auth.isAdminUnidade) &&
		page.data.usuario?.cargo === 'DPC'
	);
	const savedFilters = getSavedFilters('filtros_escalas', {
		lotacao: '',
		mes: new Date().getMonth() + 1,
		ano: new Date().getFullYear(),
		tipo: 'todos',
		seccional: 'todas',
		busca: ''
	});

	const unidades = $derived(data.unidades as Unidade[]);
	const paginaAtual = $derived(data.pagination.page);

	let filtroLotacao = $state(untrack(() => data.filtros.lotacao || savedFilters.lotacao));
	let filtroMes = $state(untrack(() => data.filtros.mes || savedFilters.mes));
	let filtroAno = $state(untrack(() => data.filtros.ano || savedFilters.ano));
	let filtroTipo = $state(untrack(() => data.filtros.tipo || savedFilters.tipo));
	let filtroSeccional = $state<number | 'todas'>(
		(savedFilters.seccional as unknown as number) || 'todas'
	);
	let filtroBusca = $state(untrack(() => data.filtros.busca || savedFilters.busca));

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

	function buildQueryParamsComFiltros(p: number) {
		const params = new URLSearchParams();
		if (filtroLotacao && filtroLotacao !== 'todas') params.set('lotacao', filtroLotacao);
		if (filtroMes) params.set('mes', String(filtroMes));
		if (filtroAno) params.set('ano', String(filtroAno));
		if (filtroTipo && filtroTipo !== 'todos') params.set('tipo', filtroTipo);
		if (filtroBusca) params.set('busca', filtroBusca);
		params.set('page', String(p));
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
			toaster.create({ title: 'Assinatura revogada', description: 'A escala agora pode ser editada.', type: 'info' });
			goto(`/escalas/${id}`);
		} else {
			const err = await res.json().catch(() => ({}));
			toaster.create({ title: err.error || 'Erro ao revogar assinatura', type: 'error' });
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
				toaster.create({ title: `Escala de ${escalaParaExcluir!.titulo} removida`, type: 'success' });
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
			is_assinada: boolean;
		}>
	);

	const podeOIPSolicitar = $derived((data.podeOIPSolicitar as boolean) ?? false);
	type SolicitacaoInfo = { tipo: 'unidade' | 'respondencia'; destinatario_nome?: string; destinatario_id?: number; };
	const solicitacoesMap = $derived((data.solicitacoesMap ?? {}) as Record<number, SolicitacaoInfo>);

	let dialogSolicitar = $state(false);
	let escalaSolicitandoId = $state<number | null>(null);

	function abrirDialogSolicitar(escalaId: number) {
		escalaSolicitandoId = escalaId;
		dialogSolicitar = true;
	}

	async function cancelarSolicitacao(escalaId: number) {
		await fetch(`/api/escalas/${escalaId}/solicitar-assinatura`, {
			method: 'DELETE',
			headers: csrfHeaders()
		});
		await invalidateAll();
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
		await Promise.resolve();
		await painelTokenRapidoControl?.assinarComSerpro();
	}
</script>

<svelte:head>
	<title>Arquivo de Escalas - Portal de Escalas</title>
</svelte:head>

{#if visao === 'home'}
	<div class="flex flex-col items-center justify-center min-h-[60vh] gap-4 sm:gap-6">
		<h1 class="h1 text-2xl font-bold text-center">Escalas</h1>

		{#if isAdminDPC}
			<div class="grid grid-cols-1 gap-6 w-full max-w-xs">
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
							<span class="absolute -top-2 -right-4 min-w-[1.4rem] h-[1.4rem] flex items-center justify-center rounded-full bg-tertiary-500 text-white text-xs font-black px-1 shadow"
								>{escalasParaAssinar.length}</span
							>
						</div>
						<span class="text-xl font-bold group-hover:text-tertiary-500 transition-colors">Assinaturas Pendentes</span>
						<span class="text-sm text-surface-500 text-center">Escalas prontas para assinar com sua assinatura digital</span>
					</button>
				{:else}
					<div class="card p-6 sm:p-8 flex flex-col items-center gap-3 border-2 border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900 rounded-2xl text-center">
						<span class="text-4xl">✅</span>
						<span class="text-xl font-bold">Nenhuma pendência</span>
						<span class="text-sm text-surface-500">Não há escalas aguardando sua assinatura no momento.</span>
					</div>
				{/if}
			</div>
		{:else}
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
					<span class="text-xl font-bold group-hover:text-primary-500 transition-colors">Nova Escala</span>
					<span class="text-sm text-surface-500 text-center">Criar uma nova escala de plantão, expediente ou final de semana</span>
				</button>
				<button
					type="button"
					onclick={() => {
						visao = 'lista';
						goto(`?${buildQueryParamsComFiltros(1)}`, { replaceState: true, noScroll: true, keepFocus: true });
					}}
					class="card p-6 sm:p-8 flex flex-col items-center gap-4 cursor-pointer hover:shadow-xl transition-shadow border-2 border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-900 rounded-2xl group"
				>
					<span class="text-4xl">🗂️</span>
					<span class="text-xl font-bold group-hover:text-primary-500 transition-colors">Escalas criadas/Arquivo</span>
					<span class="text-sm text-surface-500 text-center">Consultar e gerenciar as escalas já cadastradas</span>
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
							<span class="absolute -top-2 -right-4 min-w-[1.4rem] h-[1.4rem] flex items-center justify-center rounded-full bg-tertiary-500 text-white text-xs font-black px-1 shadow"
								>{escalasParaAssinar.length}</span
							>
						</div>
						<span class="text-xl font-bold group-hover:text-tertiary-500 transition-colors">Assinaturas Pendentes</span>
						<span class="text-sm text-surface-500 text-center">Escalas prontas para assinar com sua assinatura digital</span>
					</button>
				{/if}
			</div>
		{/if}
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
		<Dialog.Content class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto">
			<div class="card p-4 sm:p-6 max-w-sm w-full max-h-[calc(100dvh-2rem)] overflow-y-auto bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10">
				<Dialog.Title class="h3 font-bold mb-2">Excluir Escala?</Dialog.Title>
				<Dialog.Description class="text-surface-600 dark:text-surface-400 mb-6">
					Tem certeza que deseja excluir a escala "{escalaParaExcluir?.titulo}"? Esta ação não pode ser desfeita.
				</Dialog.Description>
				<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
					<Dialog.CloseTrigger class="btn preset-outlined-surface" disabled={pendingExcluir}>Cancelar</Dialog.CloseTrigger>
					<form method="POST" action="?/excluir" use:enhance={handleExcluir} class="contents">
						<input type="hidden" name="escala_id" value={escalaParaExcluir?.id} />
						<button type="submit" class="btn preset-filled-error-500 flex items-center gap-2 active:scale-95 transition-all" disabled={pendingExcluir}>
							{pendingExcluir ? 'Excluindo...' : 'Excluir'}
						</button>
					</form>
				</div>
			</div>
		</Dialog.Content>
	</Dialog>

	<Dialog open={dialogRevogarOpen} onOpenChange={(e) => (dialogRevogarOpen = e.open)}>
		<Dialog.Content class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto">
			<div class="card p-4 sm:p-6 max-w-md w-full max-h-[calc(100dvh-2rem)] overflow-y-auto bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10">
				<Dialog.Title class="h3 font-bold mb-2">Editar Escala Assinada?</Dialog.Title>
				<Dialog.Description class="space-y-4 mb-6">
					<p class="text-surface-600 dark:text-surface-400">
						Esta escala já possui uma <strong>assinatura digital</strong> válida. Ao editá-la, a assinatura atual será
						<span class="text-error-500 font-bold underline">revogada</span> (removida).
					</p>
					<p class="text-surface-500 text-sm">
						Se você deseja apenas visualizar a escala oficial, utilize a opção <strong>Exportar</strong> ou clique no título da escala.
					</p>
				</Dialog.Description>
				<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
					<Dialog.CloseTrigger class="btn preset-outlined-surface">Voltar</Dialog.CloseTrigger>
					<button type="button" class="btn preset-filled-error-500 flex items-center gap-2 active:scale-95 transition-all" onclick={confirmarRevogacao} disabled={pendingRevogar}>
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

	<div class="p-6 rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20 overflow-hidden mt-6">
		<div class="grid grid-cols-12 gap-3 mb-8 p-6 rounded-2xl bg-surface-100/30 dark:bg-surface-800/20 border border-surface-200 dark:border-white/5">
			{#if isAdmin}
				<label class="label col-span-12 lg:col-span-3">
					<span class="label-text font-semibold mb-1">Seccional</span>
					<select class="select" bind:value={filtroSeccional} onchange={() => { filtroLotacao = ''; navegarComFiltros(); }}>
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

			<label class="label col-span-12 {isAdmin || isAdminSeccional ? 'lg:col-span-2' : 'lg:col-span-5'}">
				<span class="label-text font-semibold mb-1">Tipo</span>
				<select class="select" bind:value={filtroTipo} onchange={navegarComFiltros}>
					<option value="todos">Todos</option>
					<option value="plantao">Plantão</option>
					<option value="expediente">Expediente</option>
					<option value="fds">Final de Semana</option>
				</select>
			</label>

			<label class="label col-span-6 {isAdmin || isAdminSeccional ? 'lg:col-span-1' : 'lg:col-span-3'}">
				<span class="label-text font-semibold mb-1">Mês</span>
				<select class="select" bind:value={filtroMes} onchange={navegarComFiltros}>
					{#each meses as mes}
						<option value={mes.value}>{mes.label}</option>
					{/each}
				</select>
			</label>

			<label class="label col-span-6 {isAdmin || isAdminSeccional ? 'lg:col-span-1' : 'lg:col-span-2'}">
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
					class="btn btn-sm w-full {temFiltros ? 'preset-filled-warning-500' : 'preset-outlined-surface opacity-40'}"
					onclick={limparFiltros}
					disabled={!temFiltros}
				>
					Limpar filtros
				</button>
			</div>
		</div>

		<TabelaEscalas
			{escalas}
			{podeOIPSolicitar}
			{solicitacoesMap}
			skipLoad={data.skipLoad}
			{paginaAtual}
			{totalPaginas}
			onSolicitarEdicao={solicitarEdicao}
			onSolicitarExclusao={solicitarExclusao}
			onAbrirDialogSolicitar={abrirDialogSolicitar}
			onCancelarSolicitacao={cancelarSolicitacao}
			onNovaEscala={() => (dialogNovaEscalaAberto = true)}
			onPageChange={irParaPaginaListagem}
		/>
	</div>
{:else if visao === 'assinaturas'}
	<SecaoAssinaturas
		{escalasParaAssinar}
		{assinaturaTelaBloqueada}
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
			await invalidateAll();
		}}
	/>
</div>

<Dialog
	open={dialogRevogarSolicitacaoOpen}
	onOpenChange={(e) => { if (!e.open) { dialogRevogarSolicitacaoOpen = false; escalaAbrirComSolicitacao = null; } }}
>
	<Dialog.Content class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto">
		<div class="card p-4 sm:p-6 max-w-sm w-full max-h-[calc(100dvh-2rem)] overflow-y-auto bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10">
			<Dialog.Title class="h3 font-bold mb-2">Cancelar solicitação?</Dialog.Title>
			<Dialog.Description class="text-sm text-surface-500 dark:text-surface-400 mb-5">
				Esta escala possui uma solicitação de assinatura pendente. Ao abri-la para edição, a solicitação será cancelada automaticamente.
			</Dialog.Description>
			<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
				<button
					type="button"
					class="btn preset-outlined-surface-500"
					onclick={() => { dialogRevogarSolicitacaoOpen = false; escalaAbrirComSolicitacao = null; }}>Voltar</button
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

<DialogSolicitarAssinatura
	bind:open={dialogSolicitar}
	escalaId={escalaSolicitandoId}
	onConfirmado={() => { escalaSolicitandoId = null; }}
/>

<Dialog
	open={dialogAssinaturaTela}
	onOpenChange={(e) => { if (!e.open) dialogAssinaturaTela = false; }}
>
	<Dialog.Content class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto">
		<div class="card p-4 sm:p-6 max-w-lg w-full max-h-[calc(100dvh-2rem)] overflow-y-auto bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10">
			<Dialog.Title class="h3 font-bold mb-2">Assinatura Digital em Tela</Dialog.Title>
			<Dialog.Description class="text-xs text-surface-600 dark:text-surface-400 mb-4">
				Desenhe sua rubrica no quadro abaixo para assinar este documento.
			</Dialog.Description>
			<SignaturePad
				message="Rubrica do Organizador"
				onConfirm={async (rubrica: string, lat: number | undefined, lng: number | undefined, selfie: string | undefined, codigo: string | undefined, desafioId: string | undefined) => {
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
