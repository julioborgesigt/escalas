<script lang="ts">
	import { goto, invalidate, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import PaginationControls from '$lib/components/PaginationControls.svelte';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import { browser } from '$app/environment';
	import { formatarTelefone, formatarCPF, limparCPF } from '$lib/utils';
	import { useAutorizacao, getSavedFilters, useConfirmationDialog } from '$lib/composables';
	import { loading } from '$lib/loading.svelte';
	import type { Policial, Unidade } from '$lib/types';

	let { data, form } = $props();

	function handleCadastro({ formData }: { formData: FormData }) {
		loading.show('Cadastrando policial...');
		return async ({ result }: any) => {
			loading.hide();
			if (result.type === 'success') {
				await invalidateAll();
				toaster.create({ title: 'Policial cadastrado com sucesso!', type: 'success' });
				resetForm();
				cadastroOpen = false;
			} else {
				const d = result.data as Record<string, unknown> | undefined;
				if (d?.error) toaster.create({ title: String(d.error), type: 'error' });
			}
		};
	}

	const { isAdmin, isAdminOrSeccional, isAdminUnidade, lotacaoUsuario } = useAutorizacao();
	const savedFilters = getSavedFilters('filtros_policiais', {
		lotacao: '',
		cargo: '',
		seccional: 'todas',
		busca: ''
	});

	const unidades = $derived(data.unidades as Unidade[]);
	const policiais = $derived(data.policiais as any[]);

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

	// Salvar filtros no localStorage a cada mudança
	$effect(() => {
		if (browser) {
			localStorage.setItem(
				'filtros_policiais',
				JSON.stringify({
					lotacao: filtroLotacao,
					cargo: filtroCargo,
					seccional: filtroSeccional,
					busca: filtroBusca
				})
			);
		}
	});

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
	let excluindo = $state(false);

	const seccionaisParaPapel = $derived(unidades.filter((u: any) => u.tipo === 'seccional'));
	const unidadesParaAdmin = $derived(unidades.filter((u: any) => u.tipo !== 'seccional'));

	$effect(() => {
		if (cadastroOpen) {
			lotacaoInput = isAdmin ? '' : (data.lotacaoUsuario ?? '');
		}
	});

	const classesDisponiveis = $derived(
		cargo === 'DPC'
			? ['1', '2', '3', 'Especial']
			: ['A', 'B', 'C', 'D']
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
	}

	// Removido filtragem local: agora é feita no servidor para respeitar a paginação
	const totalItens = $derived(data.pagination.total);

	$effect(() => {
		// Resetar para página 1 ao filtrar
		if (filtroCargo || filtroBusca || filtroLotacao || filtroSeccional) {
			paginaAtual = 1;
		}
	});

	function navegarComFiltros() {
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
		params.set('page', '1');
		const query = params.toString();
		goto(`/policiais?${query}`, { keepFocus: true, noScroll: true });
	}

	function solicitarExclusao(id: number, nome: string) {
		confirmDialog.openDialog({ id, nome });
	}

	function handleExcluir() {
		excluindo = true;
		return async ({ result }: any) => {
			if (result.type === 'success') {
				await invalidateAll();
				toaster.create({ title: `${confirmDialog.currentItem?.nome} removido com sucesso`, type: 'success' });
				confirmDialog.closeDialog();
			} else {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error || 'Erro ao remover'), type: 'error' });
			}
			excluindo = false;
		};
	}

	// Valor "base" de lotação para o papel atual (o que deve estar ao limpar filtros)
	// admin_unidade: sua própria lotação (filtro fixo, não pode limpar)
	// admin_seccional / admin_geral: '' (o servidor aplica o escopo automaticamente)
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
</script>

<svelte:head>
	<title>Gerenciar Policiais - Portal de Escalas</title>
</svelte:head>

<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
	<h1 class="h1 text-xl font-bold">Gerenciar Policiais</h1>
	<div class="flex flex-wrap gap-2">
		<button type="button"
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
		<button type="button"
			class="btn btn-sm preset-filled-primary-500"
			onclick={() => {
				resetForm();
				cadastroOpen = true;
			}}>Novo Policial</button
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
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm"
	>
		<div
			class="card p-5 max-w-2xl w-full bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10"
		>
			<Dialog.Title class="h3 font-bold mb-5">Cadastrar Novo Policial</Dialog.Title>

			<form method="POST" action="?/criar" use:enhance={handleCadastro} class="space-y-3">
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
						<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1"
							>Nome completo (Conforme Certificado Digital)</span
						>
						<input class="input py-1 px-3 text-sm" type="text" name="nome" bind:value={nome} required />
					</label>
					<label class="label sm:col-span-2">
						<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1"
							>Matrícula</span
						>
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
						<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Cargo</span>
						<select class="select py-1 px-3 text-sm" name="cargo" bind:value={cargo}>
							<option value="DPC">DPC - Delegado</option>
							<option value="OIP">OIP - Investigador</option>
						</select>
					</label>
				</div>

				<!-- Linha 2: CPF (5), E-mail (7) -->
				<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
					<label class="label sm:col-span-5">
						<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1"
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
					<label class="label sm:col-span-7">
						<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1"
							>E-mail (para autenticação de dois fatores)</span
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

				<!-- Linha 3: Telefone (3), Classe (4), Regime (5) -->
				<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
					<label class="label sm:col-span-3">
						<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1"
							>Telefone</span
						>
						<input
							class="input py-1 px-3 text-sm"
							type="text"
							value={telefone}
							oninput={(e) => (telefone = formatarTelefone(e.currentTarget.value))}
							placeholder="(88) 9.0000-0000"
							maxlength="16"
						/>
					</label>
					<label class="label sm:col-span-4">
						<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Classe</span>
						<select class="select py-1 px-3 text-sm" name="classe" bind:value={classe} required>
							<option value="" disabled>-</option>
							{#each classesDisponiveis as c}
								<option value={c}>{c}</option>
							{/each}
						</select>
					</label>
					<label class="label sm:col-span-5">
						<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1"
							>Regime de Trabalho</span
						>
						<select class="select py-1 px-3 text-sm" bind:value={regime}>
							<option value="plantao">Plantão</option>
							<option value="expediente">Expediente</option>
						</select>
					</label>
				</div>

				<!-- Linha 4: Lotação (12) -->
				<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
					<label class="label sm:col-span-12">
						<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Lotação</span
						>
						{#if isAdmin}
							<select class="select py-1 px-3 text-sm" bind:value={lotacaoInput}>
								<option value="">— Sem lotação —</option>
								{#each unidades as u (u.id)}
									<option value={u.nome}>{u.nome}</option>
								{/each}
							</select>
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

				{#if isAdminOrSeccional || isAdminUnidade}
					<div class="p-3 rounded-xl bg-surface-500/5 border border-surface-500/10 space-y-3 mt-1">
						<h4 class="text-[0.7rem] font-bold uppercase opacity-50">
							Papel Administrativo (Opcional)
						</h4>
						<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
							<label class="label sm:col-span-5">
								<span class="label-text text-[0.7rem] font-bold opacity-70 ml-1">Papel</span>
								<select class="select py-1 px-3 text-sm" bind:value={papel}>
									<option value={null}>Servidor (sem papel)</option>
									{#if isAdminOrSeccional}
										<option value="admin_seccional">Admin Seccional</option>
									{/if}
									<option value="admin_unidade">Admin Unidade</option>
								</select>
							</label>
							{#if papel && !(isAdminUnidade && papel === 'admin_unidade')}
								<label class="label sm:col-span-7">
									<span class="label-text text-[0.7rem] font-bold opacity-70 ml-1">
										{papel === 'admin_seccional' ? 'Seccional de resp.' : 'Unidade de resp.'}
									</span>
									<select class="select py-1 px-3 text-sm" bind:value={papelUnidadeId}>
										<option value={null}>Selecionar...</option>
										{#each papel === 'admin_seccional' ? seccionaisParaPapel : unidadesParaAdmin as u}
											<option value={u.id}>{u.nome}</option>
										{/each}
									</select>
								</label>
							{:else if papel === 'admin_unidade' && isAdminUnidade}
								<p
									class="text-[0.65rem] text-surface-500 sm:col-span-7 flex items-end pb-2 ml-1 italic"
								>
									Será nomeado para a sua própria unidade.
								</p>
							{/if}
						</div>
					</div>
				{/if}

				<div class="flex justify-end gap-2 pt-4 border-t border-surface-200 dark:border-white/5">
					<Dialog.CloseTrigger class="btn btn-sm preset-outlined-surface"
						>Cancelar</Dialog.CloseTrigger
					>
					<button
					type="submit"
					class="btn btn-sm sm:btn-md preset-filled-primary-500 w-full flex items-center justify-center gap-2"
					disabled={loading.active}
				>
					{loading.active ? 'Processando...' : 'Cadastrar Policial'}
				</button>
				</div>
			</form>
		</div>
	</Dialog.Content>
</Dialog>

<Dialog open={confirmDialog.isOpen} onOpenChange={(e) => (confirmDialog.isOpen = e.open)}>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm"
	>
		<div
			class="card p-6 max-w-sm w-full bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10"
		>
			<Dialog.Title class="h3 font-bold mb-2">Excluir Policial?</Dialog.Title>
			<Dialog.Description class="text-surface-600 dark:text-surface-400 mb-6">
				Tem certeza que deseja excluir o policial "{confirmDialog.currentItem?.nome}" do sistema de
				cadastro?
			</Dialog.Description>
			<div class="flex justify-end gap-3">
				<Dialog.CloseTrigger class="btn preset-outlined-surface" disabled={loading.active}
					>Cancelar</Dialog.CloseTrigger
				>
				<form method="POST" action="?/excluir" use:enhance={handleExcluir} class="contents">
					<input type="hidden" name="policial_id" value={confirmDialog.currentItem?.id} />
						<button
							type="submit"
							class="btn btn-sm preset-filled-error-500 flex items-center gap-2"
							disabled={loading.active}
						>
							{loading.active ? 'Excluindo...' : 'Remover Policial'}
						</button>
				</form>
			</div>
		</div>
	</Dialog.Content>
</Dialog>

<div
	class="p-6 rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20 overflow-hidden mt-6"
>
	<div
		class="flex flex-col sm:flex-row sm:items-end gap-4 mb-8 p-6 rounded-2xl bg-surface-100/30 dark:bg-surface-800/20 border border-surface-200 dark:border-white/10"
	>
		{#if isAdmin}
			<label class="label flex-1 max-w-sm">
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
			<label class="label flex-1 max-w-sm">
				<span class="label-text font-semibold mb-1">Unidade de Lotação</span>
				<select class="select" bind:value={filtroLotacao} onchange={navegarComFiltros}>
					<option value="">Selecione uma unidade...</option>
					<option value={TODAS_UNIDADES}>Todas as unidades</option>
					{#each delegaciasDropdown as del (del.id)}
						<option value={del.nome}>{del.nome}</option>
					{/each}
					<option value={SEM_LOTACAO}>— Sem lotação —</option>
				</select>
			</label>
		{/if}
		<label class="label w-full sm:w-48 shrink-0">
			<span class="label-text font-semibold mb-1">Cargo</span>
			<select class="select" bind:value={filtroCargo} onchange={navegarComFiltros}>
				<option value="">Todos</option>
				<option value="DPC">DPC — Delegado</option>
				<option value="OIP">OIP — Oficial Investigador</option>
			</select>
		</label>

		<label class="label flex-1 min-w-[200px]">
			<span class="label-text font-semibold mb-1">Buscar por Nome ou Matrícula</span>
			<div class="relative flex gap-2">
				<div class="relative flex-1">
					<input
						type="text"
						class="input pl-10 pr-4"
						bind:value={filtroBusca}
						placeholder="Nome ou matrícula..."
						onkeydown={(e) => e.key === 'Enter' && navegarComFiltros()}
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
				<button
					type="button"
					class="btn btn-sm preset-filled-primary-500 shrink-0 self-end"
					onclick={navegarComFiltros}
				>
					Buscar
				</button>
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
					class="btn preset-filled-primary-500"
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
					{#each policiais as p (p.id)}
						<tr>
							<td>{p.nome}</td>
							<td>{p.matricula}</td>
							<td>
								<span
									class="badge text-xs {p.cargo === 'DPC'
										? 'preset-filled-primary-500'
										: 'preset-filled-warning-500'}">{p.cargo}</span
								>
							</td>
							<td>{p.telefone}</td>
							<td>{p.lotacao}</td>
							<td>
								<div class="flex gap-2">
									<a href="/policiais/{p.id}" class="btn btn-sm preset-outlined-primary-500"
										>Editar</a
									>
									<button type="button"
										class="btn btn-sm preset-filled-error-500"
										onclick={() => solicitarExclusao(p.id, p.nome)}>Excluir</button
									>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Mobile cards -->
		<div class="md:hidden space-y-3">
			{#each policiais as p (p.id)}
				<div
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
							<span class="text-surface-900 dark:text-surface-100">{p.matricula}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-surface-500">Telefone</span>
							<span class="text-surface-900 dark:text-surface-100">{p.telefone}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-surface-500">Lotação</span>
							<span class="text-right text-surface-900 dark:text-surface-100">{p.lotacao}</span>
						</div>
					</div>
					<div class="flex gap-2 pt-3 border-t border-surface-200 dark:border-white/5">
						<a
							href="/policiais/{p.id}"
							class="btn btn-sm preset-outlined-primary-500 hover:bg-primary-500/10 transition-all flex-1"
							>Editar</a
						>
						<button type="button"
							class="btn btn-sm preset-filled-error-500 transition-all flex-1"
							onclick={() => solicitarExclusao(p.id, p.nome)}>Excluir</button
						>
					</div>
				</div>
			{/each}
		</div>

		<PaginationControls
			{paginaAtual}
			{totalPaginas}
			totalItens={data.pagination.total}
			itensPorPagina={ITEMS_POR_PAGINA}
			labelSingular="policial"
			labelPlural="policial(is)"
			onPageChange={(p) => {
				paginaAtual = p;
				const params = new URLSearchParams(window.location.search);
				params.set('page', p.toString());
				goto(`?${params.toString()}`, { keepFocus: true, noScroll: true });
			}}
		/>
	{/if}
</div>
