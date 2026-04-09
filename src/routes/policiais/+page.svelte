<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import Spinner from '$lib/components/Spinner.svelte';
	import PaginationControls from '$lib/components/PaginationControls.svelte';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import { browser } from '$app/environment';
	import { formatarTelefone, formatarCPF, limparCPF } from '$lib/utils';
	import { useAutorizacao, getSavedFilters, useConfirmationDialog } from '$lib/composables';
	import type { Policial, Unidade } from '$lib/types';

	let { data } = $props();
	import { policialSchema } from '$lib/schemas/policial';
	import { superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';

	// svelte-ignore state_referenced_locally
	const formObj = superForm(data.form, {
		validators: zod4Client(policialSchema),
		invalidateAll: false,
		onUpdated: async ({ form }) => {
			if (form.valid && form.message) {
				try {
					const msg = JSON.parse(form.message);
					if (msg.type === 'success') {
						toaster.create({ title: 'Policial cadastrado com sucesso!', type: 'success' });
						cadastroOpen = false;
						formObj.reset();
						await invalidateAll();
					} else {
						toaster.create({ title: msg.error || 'Erro ao cadastrar', type: 'error' });
					}
				} catch (e) {}
			} else if (!form.valid && form.message) {
				try {
					const msg = JSON.parse(form.message);
					if (msg.error) toaster.create({ title: msg.error, type: 'error' });
				} catch (e) {}
			}
		}
	});

	const formStore = formObj.form;
	const formErrors = formObj.errors;
	const formConstraints = formObj.constraints;
	const formEnhance = formObj.enhance;
	const formSubmitting = formObj.submitting;
	const formDelayed = formObj.delayed;

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
		(savedFilters.seccional as unknown as number) || 'todas'
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
	let excluindo = $state(false);

	const seccionaisParaPapel = $derived(unidades.filter((u: any) => u.tipo === 'seccional'));
	const unidadesParaAdmin = $derived(unidades.filter((u: any) => u.tipo !== 'seccional'));

	$effect(() => {
		if (cadastroOpen) {
			$formStore.lotacao = isAdmin ? '' : (data.lotacaoUsuario ?? '');
		}
	});

	const classesDisponiveis = $derived(
		$formStore.cargo === 'DPC'
			? ['1', '2', '3', 'Especial']
			: [
					'D - I',
					'D - II',
					'C - I',
					'C - II',
					'C - III',
					'C - IV',
					'C - V',
					'C - VI',
					'C - VII',
					'B - I',
					'B - II',
					'B - III',
					'B - IV',
					'B - V',
					'B - VI',
					'B - VII',
					'A - I',
					'A - II',
					'A - III',
					'A - IV'
				]
	);

	function resetForm() {
		formObj.reset();
	}

	const policiaisExibidos = $derived(
		policiais.filter((p) => {
			if (filtroCargo && p.cargo !== filtroCargo) return false;
			if (filtroBusca && !p.nome.toLowerCase().includes(filtroBusca.toLowerCase())) return false;
			return true;
		})
	);

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
		params.set('page', '1');
		const query = params.toString();
		goto(`?${query}`, { keepFocus: true, noScroll: true });
	}

	function solicitarExclusao(id: number, nome: string) {
		confirmDialog.openDialog({ id, nome });
	}

	function handleExcluir() {
		excluindo = true;
		return async ({ result }: { result: any }) => {
			excluindo = false;
			if (result.type === 'success') {
				toaster.create({ title: `${confirmDialog.currentItem?.nome} removido com sucesso`, type: 'success' });
				confirmDialog.closeDialog();
				await invalidateAll();
			} else {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error || 'Erro ao remover'), type: 'error' });
			}
		};
	}

	function limparFiltros() {
		filtroLotacao = isAdmin ? '' : (data.lotacaoUsuario ?? '');
		filtroCargo = '';
		filtroSeccional = 'todas';
		filtroBusca = '';
		paginaAtual = 1;
		navegarComFiltros();
	}

	const temFiltros = $derived(
		filtroLotacao !== (isAdmin ? '' : (data.lotacaoUsuario ?? '')) ||
			filtroCargo !== '' ||
			filtroSeccional !== 'todas' ||
			filtroBusca !== ''
	);
</script>

<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
	<h1 class="h1 text-xl font-bold">Gerenciar Policiais</h1>
	<div class="flex flex-wrap gap-2">
		<button
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

			<form method="POST" action="?/criar" use:formEnhance class="space-y-3">
				<!-- Campos hidden de selects opcionais para superforms funcionar lisinho -->
				<input type="hidden" name="papel" value={$formStore.papel ?? ''} />
				<input type="hidden" name="papel_unidade_id" value={$formStore.papel_unidade_id ?? ''} />

				<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
					<label class="label sm:col-span-7 relative mb-3">
						<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1"
							>Nome completo (Conforme Certificado Digital)</span
						>
						<input class="input py-1 px-3 text-sm {$formErrors.nome ? 'input-error' : ''}" type="text" name="nome" bind:value={$formStore.nome} {...$formConstraints.nome} aria-invalid={$formErrors.nome ? 'true' : undefined} />
						{#if $formErrors.nome}<div class="text-error-500 text-[0.65rem] absolute -bottom-4">{$formErrors.nome[0]}</div>{/if}
					</label>
					<label class="label sm:col-span-2 relative mb-3">
						<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1"
							>Matrícula</span
						>
						<input
							class="input py-1 px-3 text-sm {$formErrors.matricula ? 'input-error' : ''}"
							type="text"
							name="matricula"
							bind:value={$formStore.matricula}
							{...$formConstraints.matricula}
							aria-invalid={$formErrors.matricula ? 'true' : undefined}
							maxlength="10"
						/>
						{#if $formErrors.matricula}<div class="text-error-500 text-[0.65rem] absolute -bottom-4">{$formErrors.matricula[0]}</div>{/if}
					</label>
					<label class="label sm:col-span-3 relative mb-3">
						<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Cargo</span>
						<select class="select py-1 px-3 text-sm {$formErrors.cargo ? 'input-error' : ''}" name="cargo" bind:value={$formStore.cargo} {...$formConstraints.cargo} aria-invalid={$formErrors.cargo ? 'true' : undefined}>
							<option value="DPC">DPC - Delegado</option>
							<option value="OIP">OIP - Investigador</option>
						</select>
						{#if $formErrors.cargo}<div class="text-error-500 text-[0.65rem] absolute -bottom-4">{$formErrors.cargo[0]}</div>{/if}
					</label>
				</div>

				<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
					<label class="label sm:col-span-5 relative mb-3">
						<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1"
							>CPF (Obrigatório para Token)</span
						>
						<input
							class="input py-1 px-3 text-sm {$formErrors.cpf ? 'input-error' : ''}"
							type="text"
							name="cpf"
							value={$formStore.cpf}
							oninput={(e) => ($formStore.cpf = formatarCPF(e.currentTarget.value))}
							placeholder="000.000.000-00"
							maxlength="14"
							aria-invalid={$formErrors.cpf ? 'true' : undefined}
						/>
						{#if $formErrors.cpf}<div class="text-error-500 text-[0.65rem] absolute -bottom-4">{$formErrors.cpf[0]}</div>{/if}
					</label>
					<label class="label sm:col-span-7 relative mb-3">
						<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1"
							>E-mail (para autenticação de dois fatores)</span
						>
						<input
							class="input py-1 px-3 text-sm {$formErrors.email ? 'input-error' : ''}"
							type="email"
							name="email"
							bind:value={$formStore.email}
							{...$formConstraints.email}
							aria-invalid={$formErrors.email ? 'true' : undefined}
							placeholder="exemplo@gmail.com"
						/>
						{#if $formErrors.email}<div class="text-error-500 text-[0.65rem] absolute -bottom-4">{$formErrors.email[0]}</div>{/if}
					</label>
				</div>

				<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
					<label class="label sm:col-span-3 relative mb-3">
						<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1"
							>Telefone</span
						>
						<input
							class="input py-1 px-3 text-sm {$formErrors.telefone ? 'input-error' : ''}"
							type="text"
							name="telefone"
							value={$formStore.telefone}
							oninput={(e) => ($formStore.telefone = formatarTelefone(e.currentTarget.value))}
							placeholder="(88) 9.0000-0000"
							maxlength="16"
							aria-invalid={$formErrors.telefone ? 'true' : undefined}
						/>
						{#if $formErrors.telefone}<div class="text-error-500 text-[0.65rem] absolute -bottom-4">{$formErrors.telefone[0]}</div>{/if}
					</label>
					<label class="label sm:col-span-4 relative mb-3">
						<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Classe</span>
						<select class="select py-1 px-3 text-sm {$formErrors.classe ? 'input-error' : ''}" name="classe" bind:value={$formStore.classe} {...$formConstraints.classe} aria-invalid={$formErrors.classe ? 'true' : undefined}>
							<option value="" disabled>-</option>
							{#each classesDisponiveis as c}
								<option value={c}>{c}</option>
							{/each}
						</select>
						{#if $formErrors.classe}<div class="text-error-500 text-[0.65rem] absolute -bottom-4">{$formErrors.classe[0]}</div>{/if}
					</label>
					<label class="label sm:col-span-5 relative mb-3">
						<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1"
							>Regime de Trabalho</span
						>
						<select class="select py-1 px-3 text-sm {$formErrors.regime ? 'input-error' : ''}" name="regime" bind:value={$formStore.regime} {...$formConstraints.regime} aria-invalid={$formErrors.regime ? 'true' : undefined}>
							<option value="ambos">Plantão e Expediente</option>
							<option value="plantao">Somente Plantão</option>
							<option value="expediente">Somente Expediente</option>
						</select>
						{#if $formErrors.regime}<div class="text-error-500 text-[0.65rem] absolute -bottom-4">{$formErrors.regime[0]}</div>{/if}
					</label>
				</div>

				<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
					<label class="label sm:col-span-12 relative mb-3">
						<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Lotação</span
						>
						{#if isAdmin}
							<select class="select py-1 px-3 text-sm {$formErrors.lotacao ? 'input-error' : ''}" name="lotacao" bind:value={$formStore.lotacao} {...$formConstraints.lotacao} aria-invalid={$formErrors.lotacao ? 'true' : undefined}>
								<option value="">— Sem lotação —</option>
								{#each unidades as u (u.id)}
									<option value={u.nome}>{u.nome}</option>
								{/each}
							</select>
						{:else}
							<input
								class="input py-1 px-3 text-sm bg-surface-200 dark:bg-surface-800 cursor-not-allowed opacity-75 {$formErrors.lotacao ? 'input-error' : ''}"
								type="text"
								name="lotacao"
								value={$formStore.lotacao}
								readonly
								{...$formConstraints.lotacao}
							/>
						{/if}
						{#if $formErrors.lotacao}<div class="text-error-500 text-[0.65rem] absolute -bottom-4">{$formErrors.lotacao[0]}</div>{/if}
					</label>
				</div>

				{#if isAdminOrSeccional || isAdminUnidade}
					<div class="p-3 rounded-xl bg-surface-500/5 border border-surface-500/10 space-y-3 mt-1">
						<h4 class="text-[0.7rem] font-bold uppercase opacity-50">
							Papel Administrativo (Opcional)
						</h4>
						<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
							<label class="label sm:col-span-5 relative mb-3">
								<span class="label-text text-[0.7rem] font-bold opacity-70 ml-1">Papel</span>
								<select class="select py-1 px-3 text-sm {$formErrors.papel ? 'input-error' : ''}" bind:value={$formStore.papel} aria-invalid={$formErrors.papel ? 'true' : undefined}>
									<option value={null}>Servidor (sem papel)</option>
									{#if isAdminOrSeccional}
										<option value="admin_seccional">Admin Seccional</option>
									{/if}
									<option value="admin_unidade">Admin Unidade</option>
								</select>
								{#if $formErrors.papel}<div class="text-error-500 text-[0.65rem] absolute -bottom-4">{$formErrors.papel[0]}</div>{/if}
							</label>
							{#if $formStore.papel && !(isAdminUnidade && $formStore.papel === 'admin_unidade')}
								<label class="label sm:col-span-7 relative mb-3">
									<span class="label-text text-[0.7rem] font-bold opacity-70 ml-1">
										{$formStore.papel === 'admin_seccional' ? 'Seccional de resp.' : 'Unidade de resp.'}
									</span>
									<select class="select py-1 px-3 text-sm {$formErrors.papel_unidade_id ? 'input-error' : ''}" bind:value={$formStore.papel_unidade_id} aria-invalid={$formErrors.papel_unidade_id ? 'true' : undefined}>
										<option value={null}>Selecionar...</option>
										{#each $formStore.papel === 'admin_seccional' ? seccionaisParaPapel : unidadesParaAdmin as u}
											<option value={u.id}>{u.nome}</option>
										{/each}
									</select>
									{#if $formErrors.papel_unidade_id}<div class="text-error-500 text-[0.65rem] absolute -bottom-4">{$formErrors.papel_unidade_id[0]}</div>{/if}
								</label>
							{:else if $formStore.papel === 'admin_unidade' && isAdminUnidade}
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
						class="btn btn-sm preset-filled-primary-500 flex items-center gap-2"
						disabled={$formSubmitting}
					>
						{#if $formDelayed}<Spinner size="sm" />{/if}
						{$formSubmitting ? 'Guardando...' : 'Cadastrar'}
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
				<Dialog.CloseTrigger class="btn preset-outlined-surface" disabled={excluindo}
					>Cancelar</Dialog.CloseTrigger
				>
				<form method="POST" action="?/excluir" use:enhance={handleExcluir} class="contents">
					<input type="hidden" name="policial_id" value={confirmDialog.currentItem?.id} />
					<button type="submit" class="btn preset-filled-error-500 flex items-center gap-2" disabled={excluindo}>
						{#if excluindo}<Spinner size="sm" />{/if}
						{excluindo ? 'Excluindo...' : 'Excluir'}
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
			<select class="select" bind:value={filtroCargo}>
				<option value="">Todos</option>
				<option value="DPC">DPC — Delegado</option>
				<option value="OIP">OIP — Oficial Investigador</option>
			</select>
		</label>

		<label class="label flex-1 min-w-[200px]">
			<span class="label-text font-semibold mb-1">Buscar por Nome</span>
			<div class="relative">
				<input
					type="text"
					class="input pl-10"
					bind:value={filtroBusca}
					placeholder="Digite um nome..."
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
	{#if isAdmin && !filtroLotacao}
		<p class="text-xs text-surface-500 -mt-5 mb-4 italic px-1">
			Selecione uma unidade para visualizar os policiais cadastrados nela.
		</p>
	{/if}

	{#if policiaisExibidos.length === 0}
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
									<button
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
						<button
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
			totalItens={policiaisExibidos.length}
			itensPorPagina={ITEMS_POR_PAGINA}
			labelSingular="policial"
			labelPlural="policial(is)"
			onPageChange={(p) => (paginaAtual = p)}
		/>
	{/if}
</div>
