<script lang="ts">
	/**
	 * Lista e CADASTRO de policiais — a tela de onde nasce o vínculo de cada
	 * pessoa com uma unidade, e por consequência todo o escopo de RBAC.
	 *
	 * Listagem paginada no servidor (20 por página) com filtros de lotação,
	 * cargo, seccional e busca, persistidos em localStorage por
	 * `useFiltrosPaginados`. O filtro por seccional é do CLIENTE: ele restringe
	 * as opções de lotação do dropdown, não a consulta. `'__todas__'` é a
	 * sentinela de "sem filtro" que o servidor entende.
	 *
	 * O que a tela deliberadamente NÃO faz:
	 *
	 * - não define senha. O cadastro cria o registro com senha aleatória e
	 *   `primeiro_acesso`, e o policial entra pelo link enviado por e-mail;
	 * - não exibe CPF de ninguém: o campo é de ENTRADA, mascarado ao digitar
	 *   (`formatarCPF`) e enviado limpo (`limparCPF`) para ser cifrado no
	 *   servidor. A lista não traz CPF em claro do banco.
	 *
	 * O formulário de cadastro PODE conceder papel administrativo já na criação —
	 * e aí `papel_unidade_id` é obrigatório, porque papel sem alcance deixa o
	 * escopo indefinido (`papelSemUnidade` trava o submit). A única exceção é o
	 * admin de unidade cadastrando outro admin da própria unidade, onde o alcance
	 * é implícito. Alterar papel depois é na tela do policial
	 * (`/policiais/[id]`).
	 */
	import type { PageProps } from './$types';
	import { goto } from '$app/navigation';
	import { invalidateShared } from '$lib/cross-tab-invalidate';
	import { fly } from 'svelte/transition';
	import SkeletonCards from '$lib/components/SkeletonCards.svelte';
	import SkeletonTableRows from '$lib/components/SkeletonTableRows.svelte';
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import PaginationControls from '$lib/components/PaginationControls.svelte';
	import { SegmentedControl } from '@skeletonlabs/skeleton-svelte';
	import BotaoLimparFiltros from '$lib/components/BotaoLimparFiltros.svelte';
	import EstadoVazio from '$lib/components/EstadoVazio.svelte';
	import ModalShell from '$lib/components/ModalShell.svelte';
	import ModalCadastrarPolicial from './_components/ModalCadastrarPolicial.svelte';
	import {
		useAutorizacao,
		getSavedFilters,
		useConfirmationDialog,
		useFiltrosPaginados,
		useSamePathNavigating
	} from '$lib/composables';
	import type { Policial, Unidade } from '$lib/types';
	import type { ActionResult } from '@sveltejs/kit';

	const { data }: PageProps = $props();

	const auth = useAutorizacao();
	const isAdmin = $derived(auth.isAdmin);
	const samePathNav = useSamePathNavigating();
	const isAdminOrSeccional = $derived(auth.isAdminOrSeccional);
	const isAdminUnidade = $derived(auth.isAdminUnidade);
	const savedFilters = getSavedFilters('filtros_policiais', {
		lotacao: '',
		cargo: '',
		seccional: 'todas',
		busca: ''
	});

	const unidades = $derived(data.unidades as Unidade[]);
	const policiais = $derived(data.policiais as Policial[]);

	// Paginação
	let paginaAtual = $state(untrack(() => data.pagination.page));
	const totalPaginas = $derived(data.pagination.totalPages);
	const ITEMS_POR_PAGINA = 20;

	// Filtros
	let filtroLotacao = $state(untrack(() => data.filtros.lotacao || savedFilters.lotacao));
	let filtroCargo = $state(untrack(() => data.filtros.cargo || savedFilters.cargo));
	let filtroSeccional = $state<number | 'todas'>(
		untrack(() => {
			const raw = data.filtros.seccional || savedFilters.seccional;
			return raw === 'todas' ? 'todas' : Number(raw);
		})
	);
	let filtroBusca = $state(untrack(() => data.filtros.busca || savedFilters.busca));

	const seccionais = $derived(unidades.filter((u) => u.tipo === 'seccional'));
	const delegaciasDropdown = $derived(
		filtroSeccional === 'todas'
			? unidades.filter((u) => u.tipo === 'delegacia')
			: unidades.filter((u) => u.tipo === 'delegacia' && u.seccional_id === filtroSeccional)
	);

	// Dialog de confirmação
	const confirmDialog = useConfirmationDialog<{ id: number; nome: string }>();

	// Special sentinel value for "sem lotação" filter
	const SEM_LOTACAO = '__sem_lotacao__';
	const TODAS_UNIDADES = '__todas__';

	// Persistência dos filtros + navegação (query server-side). A paginação
	// abaixo preserva a URL corrente; por isso navegarComFiltros vai sempre à
	// página 1.
	const filtros = useFiltrosPaginados({
		chave: 'filtros_policiais',
		snapshot: () => ({
			lotacao: filtroLotacao,
			cargo: filtroCargo,
			seccional: filtroSeccional,
			busca: filtroBusca
		}),
		query: (p) => {
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			const params = new URLSearchParams();
			if (
				filtroLotacao &&
				filtroLotacao !== 'todas' &&
				filtroLotacao !== TODAS_UNIDADES &&
				filtroLotacao !== SEM_LOTACAO
			) {
				params.set('lotacao', filtroLotacao);
			}
			if (filtroCargo) params.set('cargo', filtroCargo);
			if (filtroBusca) params.set('busca', filtroBusca);
			if (filtroSeccional && filtroSeccional !== 'todas') {
				params.set('seccional', String(filtroSeccional));
			}
			params.set('page', String(p));
			return params;
		}
	});

	// Cadastro
	let cadastroOpen = $state(false);
	let excluindo = $state(false);

	$effect(() => {
		// Resetar para página 1 ao filtrar
		if (filtroCargo || filtroBusca || filtroLotacao || filtroSeccional) {
			paginaAtual = 1;
		}
	});

	function navegarComFiltros() {
		filtros.navegar(1);
	}

	function solicitarExclusao(id: number, nome: string) {
		confirmDialog.openDialog({ id, nome });
	}

	function handleExcluir() {
		excluindo = true;
		return async ({ result }: { result: ActionResult }) => {
			if (result.type === 'success') {
				await invalidateShared('app:policiais');
				toaster.create({
					title: `${confirmDialog.currentItem?.nome} removido com sucesso`,
					type: 'success'
				});
				confirmDialog.closeDialog();
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				toaster.create({ title: String(d?.error || 'Erro ao remover'), type: 'error' });
			}
			excluindo = false;
		};
	}

	// Valor "base" de lotação para o papel atual (o que deve estar ao limpar filtros)
	// admin_unidade: sua própria lotação (filtro fixo, não pode limpar)
	// admin_seccional: '' (o servidor aplica o escopo automaticamente)
	const filtroLotacaoBase = $derived(isAdminUnidade ? (data.lotacaoUsuario ?? '') : '');

	function limparFiltros() {
		filtroLotacao = filtroLotacaoBase;
		filtroCargo = '';
		filtroSeccional = 'todas';
		filtroBusca = '';
		paginaAtual = 1;
		navegarComFiltros();
	}

	const temFiltros = $derived(
		filtroLotacao !== filtroLotacaoBase ||
			filtroCargo !== '' ||
			filtroSeccional !== 'todas' ||
			filtroBusca !== ''
	);

	let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	function handleBuscaInput() {
		if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
		searchDebounceTimer = setTimeout(navegarComFiltros, 400);
	}
</script>

<svelte:head>
	<title>Gerenciar Policiais - Portal de Escalas</title>
</svelte:head>

<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
	<h1 class="h1 text-2xl font-bold">Gerenciar Policiais</h1>
	<div class="flex flex-wrap justify-end gap-2">
		<BotaoLimparFiltros {temFiltros} onclick={limparFiltros} />
		{#if isAdmin}
			<a
				href="/policiais/upload"
				class="btn btn-sm preset-outlined-primary-500 hidden sm:inline-flex">Importar Excel</a
			>
		{/if}
		<button
			type="button"
			class="btn btn-sm preset-filled-primary-500 transition-all"
			onclick={() => (cadastroOpen = true)}>Novo Policial</button
		>
	</div>
</div>

<ModalCadastrarPolicial
	bind:open={cadastroOpen}
	{unidades}
	{isAdmin}
	{isAdminOrSeccional}
	{isAdminUnidade}
	lotacaoUsuario={data.lotacaoUsuario}
/>

<ModalShell
	bind:open={confirmDialog.isOpen}
	title="Excluir Policial?"
	largura="sm"
	pending={excluindo}
	cancelLabel="Cancelar"
>
	{#snippet description()}
		Tem certeza que deseja excluir o policial "{confirmDialog.currentItem?.nome}" do sistema de
		cadastro?
	{/snippet}

	{#snippet footer()}
		<form method="POST" action="?/excluir" use:enhance={handleExcluir} class="contents">
			<input type="hidden" name="policial_id" value={confirmDialog.currentItem?.id} />
			<button
				type="submit"
				class="btn btn-sm preset-filled-error-500 flex items-center gap-2 transition-all"
				disabled={excluindo}
			>
				{excluindo ? 'Excluindo...' : 'Remover Policial'}
			</button>
		</form>
	{/snippet}
</ModalShell>

<div class="card-glass p-4 sm:p-6 rounded-3xl overflow-hidden mt-6">
	<div
		class="flex flex-col md:flex-row md:flex-wrap xl:flex-nowrap items-stretch md:items-end gap-4 mb-8 p-4 sm:p-6 rounded-2xl bg-surface-100/30 dark:bg-surface-800/20 border border-surface-200 dark:border-white/10"
	>
		{#if isAdmin}
			<label class="label flex-1 min-w-[220px] lg:max-w-xs">
				<span class="label-text font-semibold mb-1 ml-0.5">Seccional</span>
				<select
					class="select w-full"
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
			<label class="label flex-1 min-w-[240px] lg:max-w-xs">
				<span class="label-text font-semibold mb-1 ml-0.5">Unidade de Lotação</span>
				<select class="select w-full" bind:value={filtroLotacao} onchange={navegarComFiltros}>
					<option value="">Selecione uma unidade...</option>
					<option value={TODAS_UNIDADES}>Todas as unidades</option>
					{#each delegaciasDropdown as del (del.id)}
						<option value={del.nome}>{del.nome}</option>
					{/each}
					<option value={SEM_LOTACAO}>— Sem lotação —</option>
				</select>
			</label>
		{/if}
		<div class="flex flex-col gap-1.5 flex-1 min-w-[220px] lg:max-w-xs">
			<span class="label-text font-semibold ml-0.5">Cargo</span>
			<SegmentedControl
				value={filtroCargo || ''}
				onValueChange={(e) => {
					filtroCargo = e.value ?? '';
					navegarComFiltros();
				}}
				class="w-full"
			>
				<SegmentedControl.Control
					class="flex items-center w-full rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-800 p-1 gap-1"
				>
					{#each [['', 'Todos'], ['DPC', 'DPC'], ['OIP', 'OIP']] as [val, label] (val)}
						<SegmentedControl.Item
							value={val}
							class="flex-1 px-3 py-1.5 text-center text-sm font-semibold rounded-lg cursor-pointer select-none transition-all duration-200 text-surface-600 dark:text-surface-400 data-[state=checked]:bg-primary-500 data-[state=checked]:text-white data-[state=checked]:shadow-md data-[state=checked]:shadow-primary-500/25 hover:text-surface-700 dark:hover:text-surface-200"
						>
							<SegmentedControl.ItemText>{label}</SegmentedControl.ItemText>
							<SegmentedControl.ItemHiddenInput />
						</SegmentedControl.Item>
					{/each}
				</SegmentedControl.Control>
			</SegmentedControl>
		</div>

		<label class="label flex-1 min-w-[220px]">
			<span class="label-text font-semibold mb-1 ml-0.5">Buscar por Nome ou Matrícula</span>
			<div class="relative w-full">
				<input
					type="text"
					class="input pl-10 pr-4 w-full"
					bind:value={filtroBusca}
					placeholder="Nome ou matrícula..."
					oninput={handleBuscaInput}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
							navegarComFiltros();
						}
					}}
				/>
				<div class="absolute inset-y-0 left-3 flex items-center pointer-events-none opacity-50">
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
						/></svg
					>
				</div>
			</div>
		</label>
	</div>
	{#if isAdmin && !filtroLotacao && !filtroBusca}
		<p class="text-xs text-surface-600 dark:text-surface-400 -mt-5 mb-4 italic px-1">
			Selecione uma unidade ou pesquise por nome/matrícula para visualizar os policiais.
		</p>
	{/if}

	{#if policiais.length === 0}
		<EstadoVazio>
			<p class="mb-4">
				{filtroCargo
					? `Nenhum policial com cargo ${filtroCargo} encontrado.`
					: 'Nenhum policial cadastrado.'}
			</p>
			{#if !filtroCargo}
				<a
					href="/policiais"
					class="btn preset-filled-primary-500 transition-all"
					onclick={(e) => {
						e.preventDefault();
						cadastroOpen = true;
					}}>Cadastrar Policial</a
				>
			{/if}
		</EstadoVazio>
	{:else}
		<!-- Desktop table -->
		<div class="hidden md:block table-wrap">
			<table class="table">
				<thead>
					<tr>
						<th>Nome</th>
						<th>Matrícula</th>
						<th>Cargo</th>
						<th>Telefone</th>
						<th>Lotação</th>
						<th>Ações</th>
					</tr>
				</thead>
				<tbody>
					{#if samePathNav.current}
						<SkeletonTableRows
							cols={[
								'h-4 w-40',
								'h-4 w-20',
								'h-6 w-16 rounded-full',
								'h-4 w-28',
								'h-4 w-32',
								'h-8 w-32 rounded-lg'
							]}
						/>
					{:else}
						{#each policiais as p (p.id)}
							<tr>
								<td>{p.nome}</td>
								<td class="font-mono tabular-nums">{p.matricula}</td>
								<td>
									<span
										class="badge text-xs {p.cargo === 'DPC'
											? 'preset-filled-primary-500'
											: 'preset-filled-warning-500'}">{p.cargo}</span
									>
								</td>
								<td class="font-mono tabular-nums">{p.telefone}</td>
								<td>{p.lotacao}</td>
								<td>
									<div class="flex gap-2">
										<a
											href="/policiais/{p.id}"
											class="btn btn-sm preset-outlined-primary-500"
											title="Gerenciar cadastro, movimentações e histórico">Gerenciar</a
										>
										<button
											type="button"
											class="btn btn-sm preset-filled-error-500 transition-all"
											onclick={() => solicitarExclusao(p.id, p.nome)}>Excluir</button
										>
									</div>
								</td>
							</tr>
						{/each}
					{/if}
				</tbody>
			</table>
		</div>

		<!-- Mobile cards -->
		<div class="md:hidden space-y-3">
			{#if samePathNav.current}
				<SkeletonCards />
			{:else}
				{#each policiais as p, i (p.id)}
					<div
						transition:fly={{ y: 8, delay: i * 30, duration: 200 }}
						class="p-4 rounded-2xl bg-surface-100/50 dark:bg-surface-800/50 border border-surface-200 dark:border-white/10 hover:border-primary-500/30 transition-colors"
					>
						<div class="flex items-center justify-between mb-2">
							<span class="font-semibold text-sm">{p.nome}</span>
							<span
								class="badge text-xs {p.cargo === 'DPC'
									? 'preset-filled-primary-500'
									: 'preset-filled-warning-500'}">{p.cargo}</span
							>
						</div>
						<div class="space-y-1 text-sm mb-3">
							<div class="flex justify-between">
								<span class="text-surface-600 dark:text-surface-400">Matrícula</span>
								<span class="text-surface-900 dark:text-surface-100 font-mono tabular-nums"
									>{p.matricula}</span
								>
							</div>
							<div class="flex justify-between">
								<span class="text-surface-600 dark:text-surface-400">Telefone</span>
								<span class="text-surface-900 dark:text-surface-100 font-mono tabular-nums"
									>{p.telefone}</span
								>
							</div>
							<div class="flex justify-between">
								<span class="text-surface-600 dark:text-surface-400">Lotação</span>
								<span class="text-right text-surface-900 dark:text-surface-100">{p.lotacao}</span>
							</div>
						</div>
						<div class="flex gap-2 pt-3 border-t border-surface-200 dark:border-white/5">
							<a
								href="/policiais/{p.id}"
								class="btn btn-sm preset-outlined-primary-500 hover:bg-primary-500/10 transition-all flex-1 text-center"
								title="Gerenciar cadastro, movimentações e histórico">Gerenciar</a
							>
							<button
								type="button"
								class="btn btn-sm preset-filled-error-500 transition-all flex-1"
								onclick={() => solicitarExclusao(p.id, p.nome)}>Excluir</button
							>
						</div>
					</div>
				{/each}
			{/if}
		</div>

		<PaginationControls
			{paginaAtual}
			{totalPaginas}
			totalItens={data.pagination.total}
			itensPorPagina={ITEMS_POR_PAGINA}
			labelSingular="policial"
			labelPlural="policial(is)"
			onPageChange={(p: number) => {
				paginaAtual = p;
				const params = new URLSearchParams(window.location.search);
				params.set('page', p.toString());
				goto(`?${params.toString()}`, { keepFocus: true, noScroll: true });
			}}
		/>
	{/if}
</div>
