<script lang="ts">
	import type { PageProps } from './$types';
	import { goto, invalidateAll } from '$app/navigation';
	import { fly } from 'svelte/transition';
	import { page, navigating } from '$app/state';
	import SkeletonCard from '$lib/components/SkeletonCard.svelte';
	import FloatingRefresh from '$lib/components/FloatingRefresh.svelte';
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import { apiFetch } from '$lib/api-fetch';
	import PaginationControls from '$lib/components/PaginationControls.svelte';
	import { Dialog, SegmentedControl } from '@skeletonlabs/skeleton-svelte';
	import ToggleSwitch from '$lib/components/ToggleSwitch.svelte';
	import { formatarTelefone, formatarCPF, limparCPF } from '$lib/utils';
	import {
		useAutorizacao,
		getSavedFilters,
		useConfirmationDialog,
		useFiltrosPaginados
	} from '$lib/composables';
	import type { Policial, Unidade } from '$lib/types';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import type { ActionResult } from '@sveltejs/kit';

	const { data }: PageProps = $props();

	function handleSalvarPolicial() {
		pendingCadastro = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingCadastro = false;
			if (result.type === 'success') {
				await invalidateAll();
				toaster.create({ title: 'Policial cadastrado com sucesso!', type: 'success' });
				resetForm();
				cadastroOpen = false;
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				if (d?.error) toaster.create({ title: String(d.error), type: 'error' });
			}
		};
	}

	const auth = useAutorizacao();
	const isAdmin = $derived(auth.isAdmin);
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
	let nome = $state('');
	let matricula = $state('');
	let cargo = $state<'DPC' | 'OIP'>('OIP');
	let cpf = $state('');
	let telefone = $state('');
	let classe = $state('');
	let regime = $state<'plantao' | 'expediente'>('plantao');
	let lotacaoInput = $state('');
	let email = $state('');

	// Papel administrativo no cadastro
	let papel = $state<string | null>(null);
	let papelUnidadeId = $state<number | null>(null);
	// Chave "Conceder Admin Geral" no cadastro (submetida via input hidden).
	let concederAdminGeral = $state(false);
	let excluindo = $state(false);
	let pendingCadastro = $state(false);

	const seccionaisParaPapel = $derived(unidades.filter((u) => u.tipo === 'seccional'));
	const unidadesParaAdmin = $derived(unidades.filter((u) => u.tipo !== 'seccional'));

	$effect(() => {
		// Aplica a lotação padrão ao abrir o cadastro.
		if (cadastroOpen) {
			lotacaoInput = isAdmin ? '' : (data.lotacaoUsuario ?? '');
		}
	});

	const classesDisponiveis = $derived(
		cargo === 'DPC' ? ['1ª', '2ª', '3ª', 'ESPECIAL'] : ['A', 'B', 'C', 'D']
	);
	const lotacaoSelectedOption = $derived(
		lotacaoInput ? { value: lotacaoInput, label: lotacaoInput } : null
	);

	function resetForm() {
		nome = '';
		matricula = '';
		cargo = 'OIP';
		cpf = '';
		telefone = '';
		classe = '';
		regime = 'plantao';
		lotacaoInput = isAdmin ? '' : (data.lotacaoUsuario ?? '');
		email = '';
		papel = null;
		papelUnidadeId = null;
		concederAdminGeral = false;
	}

	function openCreateModal() {
		resetForm();
		cadastroOpen = true;
	}

	async function loadLotacoes(query: string, signal: AbortSignal) {
		// Lotação inclui delegacias (unidades operacionais) E seccionais,
		// pois as seccionais têm efetivo próprio.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const params = new URLSearchParams({
			tipo: 'delegacia,seccional',
			limit: '30'
		});
		if (query.trim()) params.set('q', query.trim());

		const dataRes = await apiFetch<{ items?: { nome: string }[] }>(
			`/api/unidades/search?${params.toString()}`,
			{ signal }
		);
		const baseOptions = (dataRes.items || []).map((u: { nome: string }) => ({
			value: u.nome,
			label: u.nome
		}));
		return [{ value: '', label: '— Sem lotação —' }, ...baseOptions];
	}

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
				await invalidateAll();
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
		{#if isAdmin}
			<a
				href="/policiais/upload"
				class="btn btn-sm preset-outlined-primary-500 hidden sm:inline-flex">Importar Excel</a
			>
		{/if}
		<button
			type="button"
			class="btn btn-sm preset-filled-primary-500 transition-all"
			onclick={openCreateModal}>Novo Policial</button
		>
	</div>
</div>

<Dialog
	open={cadastroOpen}
	onOpenChange={(e) => {
		cadastroOpen = e.open;
		if (!e.open) resetForm();
	}}
>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="cadastro-policial-modal card p-4 sm:p-5 max-w-2xl w-full max-h-[calc(100dvh-2rem)] overflow-y-auto card-elevated shadow-2xl rounded-2xl"
		>
			<Dialog.Title class="h3 font-bold mb-5">Cadastrar Novo Policial</Dialog.Title>

			<form
				id="policialForm"
				method="POST"
				action="?/criar"
				use:enhance={handleSalvarPolicial}
				class="space-y-3"
			>
				<!-- Campos hidden -->
				<input type="hidden" name="cpf" value={limparCPF(cpf)} />
				<input type="hidden" name="telefone" value={telefone} />
				<input type="hidden" name="lotacao" value={lotacaoInput} />
				<input type="hidden" name="regime" value={regime} />
				<input type="hidden" name="papel" value={papel ?? ''} />
				<input type="hidden" name="papel_unidade_id" value={papelUnidadeId ?? ''} />

				<!-- Linha 1: Nome (7), Matrícula (2), Cargo (3) -->
				<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
					<label class="label sm:col-span-7">
						<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1"
							>Nome completo (Conforme Certificado Digital)</span
						>
						<input
							class="input py-1 px-3 text-sm"
							type="text"
							name="nome"
							bind:value={nome}
							required
						/>
					</label>
					<label class="label sm:col-span-2">
						<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1">Matrícula</span>
						<input
							class="input py-1 px-3 text-sm"
							type="text"
							name="matricula"
							bind:value={matricula}
							maxlength="10"
							required
						/>
					</label>
					<label class="label sm:col-span-3">
						<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1">Cargo</span>
						<select class="select py-1 px-3 text-sm" name="cargo" bind:value={cargo}>
							<option value="DPC">DPC - Delegado</option>
							<option value="OIP">OIP - Investigador</option>
						</select>
					</label>
				</div>

				<!-- Linha 2: CPF (4), E-mail funcional (8). O e-mail pessoal é cadastrado
					 pelo próprio policial (recuperação de senha) — não vai no cadastro. -->
				<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
					<label class="label sm:col-span-4">
						<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1"
							>CPF (Obrigatório para Token)</span
						>
						<input
							class="input py-1 px-3 text-sm"
							type="text"
							value={cpf}
							oninput={(e) => (cpf = formatarCPF(e.currentTarget.value))}
							placeholder="000.000.000-00"
							maxlength="14"
						/>
					</label>
					<label class="label sm:col-span-8">
						<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1"
							>E-mail funcional (para 2FA)</span
						>
						<input
							class="input py-1 px-3 text-sm"
							type="email"
							name="email"
							bind:value={email}
							placeholder="exemplo@gmail.com"
						/>
					</label>
				</div>

				<!-- Linha 3: Telefone (3), Classe (2), Regime (3), Lotação (4) -->
				<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
					<label class="label sm:col-span-3">
						<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1">Telefone</span>
						<input
							class="input py-1 px-3 text-sm"
							type="text"
							value={telefone}
							oninput={(e) => (telefone = formatarTelefone(e.currentTarget.value))}
							placeholder="(88) 9.0000-0000"
							maxlength="16"
						/>
					</label>
					<label class="label sm:col-span-2">
						<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1">Classe</span>
						<select class="select py-1 px-3 text-sm" name="classe" bind:value={classe} required>
							<option value="" disabled>-</option>
							{#each classesDisponiveis as c (c)}
								<option value={c}>{c}</option>
							{/each}
						</select>
					</label>
					<label class="label sm:col-span-3">
						<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1"
							>Regime de Trabalho</span
						>
						<select class="select py-1 px-3 text-sm" bind:value={regime}>
							<option value="plantao">Plantão</option>
							<option value="expediente">Expediente</option>
						</select>
					</label>
					<label class="label sm:col-span-4">
						<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1">Lotação</span>
						{#if isAdmin}
							<SearchableSelect
								bind:value={lotacaoInput}
								loadOptions={loadLotacoes}
								selectedOption={lotacaoSelectedOption}
								class="lotacao-searchable"
								debounceMs={250}
								minSearchChars={0}
								placeholder="Buscar lotação..."
							/>
						{:else}
							<input
								class="input py-1 px-3 text-sm bg-surface-200 dark:bg-surface-800 cursor-not-allowed opacity-75"
								type="text"
								value={lotacaoInput}
								readonly
							/>
						{/if}
					</label>
				</div>

				<div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1 items-stretch">
					{#if isAdminOrSeccional || isAdminUnidade}
						<div
							class="p-3 rounded-xl bg-surface-500/5 border border-surface-500/10 space-y-2 flex flex-col"
						>
							<h4 class="text-2xs font-bold uppercase opacity-50">
								Papel Administrativo (Opcional)
							</h4>
							<p class="text-xs text-surface-500 leading-snug">
								Papel de gestão restrito a uma seccional ou unidade: gerencia escalas e policiais
								apenas do próprio escopo. Diferente do Admin Geral, não concede acesso global.
							</p>
							<label class="label">
								<span class="label-text text-2xs font-bold opacity-70 ml-1">Papel</span>
								<select class="select py-1 px-3 text-sm" bind:value={papel}>
									<option value={null}>Servidor (sem papel)</option>
									{#if isAdminOrSeccional}
										<option value="admin_seccional">Admin Seccional</option>
									{/if}
									<option value="admin_unidade">Admin Unidade</option>
								</select>
							</label>
							{#if papel && !(isAdminUnidade && papel === 'admin_unidade')}
								<label class="label">
									<span class="label-text text-2xs font-bold opacity-70 ml-1">
										{papel === 'admin_seccional' ? 'Seccional de resp.' : 'Unidade de resp.'}
									</span>
									<select class="select py-1 px-3 text-sm" bind:value={papelUnidadeId}>
										<option value={null}>Selecionar...</option>
										{#each papel === 'admin_seccional' ? seccionaisParaPapel : unidadesParaAdmin as u (u.id)}
											<option value={u.id}>{u.nome}</option>
										{/each}
									</select>
								</label>
							{:else if papel === 'admin_unidade' && isAdminUnidade}
								<p class="text-3xs text-surface-500 ml-1 italic">
									Será nomeado para a sua própria unidade.
								</p>
							{/if}
						</div>
					{/if}

					{#if isAdmin}
						<div class="p-3 rounded-xl bg-surface-500/5 border border-surface-500/10 flex flex-col">
							<h4 class="text-2xs font-bold uppercase opacity-50">Admin Geral (Opcional)</h4>
							<p class="text-xs text-surface-500 leading-snug mt-2">
								Cria a conta de Administrador Geral vinculada. A pessoa loga com a mesma
								matrícula/senha escolhendo "Administrador". Cumulativo com o papel.
							</p>
							<input
								type="hidden"
								name="conceder_admin_geral"
								value={concederAdminGeral ? '1' : '0'}
								form="policialForm"
							/>
							<div class="mt-auto pt-3">
								<ToggleSwitch
									reverse
									checked={concederAdminGeral}
									onCheckedChange={(v) => (concederAdminGeral = v)}
								>
									<span
										class="text-xs font-semibold {concederAdminGeral
											? 'text-success-700 dark:text-success-400'
											: 'text-surface-500'}"
									>
										{concederAdminGeral ? 'Conceder Admin Geral' : 'Não conceder'}
									</span>
								</ToggleSwitch>
							</div>
						</div>
					{/if}
				</div>
			</form>

			<div class="flex justify-end gap-2 pt-4 mt-3 border-t border-surface-200 dark:border-white/5">
				<Dialog.CloseTrigger class="btn btn-sm preset-outlined-surface-500"
					>Cancelar</Dialog.CloseTrigger
				>
				<button
					type="submit"
					form="policialForm"
					class="btn btn-sm sm:btn-md preset-filled-primary-500 w-full flex items-center justify-center gap-2"
					disabled={pendingCadastro}
				>
					{pendingCadastro ? 'Cadastrando...' : 'Cadastrar Policial'}
				</button>
			</div>
		</div>
	</Dialog.Content>
</Dialog>

<Dialog open={confirmDialog.isOpen} onOpenChange={(e) => (confirmDialog.isOpen = e.open)}>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="card p-4 sm:p-6 max-w-sm w-full max-h-[calc(100dvh-2rem)] overflow-y-auto card-elevated shadow-2xl rounded-2xl"
		>
			<Dialog.Title class="h3 font-bold mb-2">Excluir Policial?</Dialog.Title>
			<Dialog.Description class="text-surface-600 dark:text-surface-400 mb-6">
				Tem certeza que deseja excluir o policial "{confirmDialog.currentItem?.nome}" do sistema de
				cadastro?
			</Dialog.Description>
			<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
				<Dialog.CloseTrigger class="btn preset-outlined-surface-500" disabled={excluindo}
					>Cancelar</Dialog.CloseTrigger
				>
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
			</div>
		</div>
	</Dialog.Content>
</Dialog>

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
							class="flex-1 px-3 py-1.5 text-center text-sm font-semibold rounded-lg cursor-pointer select-none transition-all duration-200 text-surface-500 dark:text-surface-400 data-[state=checked]:bg-primary-500 data-[state=checked]:text-white data-[state=checked]:shadow-md data-[state=checked]:shadow-primary-500/25 hover:text-surface-700 dark:hover:text-surface-200"
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
		<p class="text-xs text-surface-500 -mt-5 mb-4 italic px-1">
			Selecione uma unidade ou pesquise por nome/matrícula para visualizar os policiais.
		</p>
	{/if}

	{#if policiais.length === 0}
		<div class="text-center py-12 text-surface-500">
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
						resetForm();
						cadastroOpen = true;
					}}>Cadastrar Policial</a
				>
			{/if}
		</div>
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
					{#if navigating?.to && navigating.to.url.pathname === page.url.pathname}
						{#each { length: 8 } as _, i (i)}
							<tr class="animate-pulse">
								<td class="px-4 py-3"
									><div class="h-4 w-40 rounded bg-surface-200 dark:bg-surface-700"></div></td
								>
								<td class="px-4 py-3"
									><div class="h-4 w-20 rounded bg-surface-200 dark:bg-surface-700"></div></td
								>
								<td class="px-4 py-3"
									><div class="h-6 w-16 rounded-full bg-surface-200 dark:bg-surface-700"></div></td
								>
								<td class="px-4 py-3"
									><div class="h-4 w-28 rounded bg-surface-200 dark:bg-surface-700"></div></td
								>
								<td class="px-4 py-3"
									><div class="h-4 w-32 rounded bg-surface-200 dark:bg-surface-700"></div></td
								>
								<td class="px-4 py-3"
									><div class="flex gap-2">
										<div class="h-8 w-14 rounded-lg bg-surface-200 dark:bg-surface-700"></div>
										<div class="h-8 w-14 rounded-lg bg-surface-200 dark:bg-surface-700"></div>
									</div></td
								>
							</tr>
						{/each}
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
			{#if navigating?.to && navigating.to.url.pathname === page.url.pathname}
				{#each { length: 5 } as _, i (i)}
					<SkeletonCard />
				{/each}
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
								<span class="text-surface-500">Matrícula</span>
								<span class="text-surface-900 dark:text-surface-100 font-mono tabular-nums"
									>{p.matricula}</span
								>
							</div>
							<div class="flex justify-between">
								<span class="text-surface-500">Telefone</span>
								<span class="text-surface-900 dark:text-surface-100 font-mono tabular-nums"
									>{p.telefone}</span
								>
							</div>
							<div class="flex justify-between">
								<span class="text-surface-500">Lotação</span>
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
								class="btn btn-sm preset-filled-error-500 transition-all flex-1 transition-all"
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
<FloatingRefresh />

<style>
	:global(.cadastro-policial-modal .input),
	:global(.cadastro-policial-modal .select),
	:global(.cadastro-policial-modal .lotacao-searchable input),
	:global(.cadastro-policial-modal .lotacao-searchable button) {
		background-color: var(--color-surface-50);
	}

	:global(.dark .cadastro-policial-modal .input),
	:global(.dark .cadastro-policial-modal .select),
	:global(.dark .cadastro-policial-modal .lotacao-searchable input),
	:global(.dark .cadastro-policial-modal .lotacao-searchable button) {
		background-color: var(--color-surface-800);
	}
</style>
