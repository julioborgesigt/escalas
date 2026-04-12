<script lang="ts">
	import { page } from '$app/state';
	import { invalidate, invalidateAll } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import { browser } from '$app/environment';
	import type { Unidade } from '$lib/types';
	import { CIDADES_CEARA } from '$lib/constants/cidades';
	import Spinner from '$lib/components/Spinner.svelte';
	import { useAutorizacao, getSavedFilters } from '$lib/composables';

	let { data, form } = $props();

	const { isAdmin } = useAutorizacao();
	const savedFilters = getSavedFilters('filtros_unidades', { seccional: 'todas', busca: '' });

	let unidades = $derived(data.unidades as Unidade[]);

	// Filtros
	let filtroSeccional = $state<number | 'todas'>(
		(savedFilters.seccional as unknown as number) || 'todas'
	);
	let filtroBusca = $state(savedFilters.busca);

	// Salvar filtros a cada mudança
	$effect(() => {
		if (browser) {
			localStorage.setItem(
				'filtros_unidades',
				JSON.stringify({
					seccional: filtroSeccional,
					busca: filtroBusca
				})
			);
		}
	});

	const unidadesFiltradas = $derived(
		unidades.filter((u) => {
			if (filtroSeccional !== 'todas') {
				if (u.tipo === 'seccional' && u.id !== filtroSeccional) return false;
				if (u.tipo === 'delegacia' && u.seccional_id !== filtroSeccional) return false;
			}
			if (filtroBusca && !u.nome.toLowerCase().includes(filtroBusca.toLowerCase())) return false;
			return true;
		})
	);

	const unidadesAgrupadas = $derived.by(() => {
		const result: (Unidade & {
			isChild?: boolean;
			isLastChild?: boolean;
			hasChildren?: boolean;
		})[] = [];
		const seccionais = unidadesFiltradas.filter((u) => u.tipo === 'seccional');
		const delegacias = unidadesFiltradas.filter((u) => u.tipo === 'delegacia');

		for (const sec of seccionais) {
			const filhos = delegacias.filter((d) => d.seccional_id === sec.id);
			result.push({ ...sec, isChild: false, isLastChild: false, hasChildren: filhos.length > 0 });
			filhos.forEach((f, index) => {
				result.push({ ...f, isChild: true, isLastChild: index === filhos.length - 1 });
			});
		}

		const orfaos = delegacias.filter((d) => !seccionais.some((s) => s.id === d.seccional_id));
		for (const f of orfaos) {
			result.push({ ...f, isChild: false, isLastChild: false, hasChildren: false });
		}

		return result;
	});

	// Estado para o cadastro guiado
	let tipoUnidade = $state<'delegacia' | 'seccional'>('delegacia');
	let delegaciaPrefixo = $state('');
	let delegaciaSufixo = $state('');
	let seccionalPrefixo = $state('');
	let seccionalSufixo = $state('Interior Sul');

	const novoNome = $derived(
		tipoUnidade === 'delegacia'
			? `${delegaciaPrefixo ? delegaciaPrefixo + ' ' : ''}Delegacia de Polícia Civil de ${delegaciaSufixo}`.trim()
			: `${seccionalPrefixo ? seccionalPrefixo + ' ' : ''}Seccional do ${seccionalSufixo}`.trim()
	);

	let novoSeccionalId = $state<number | null>(null);
	const seccionais = $derived(unidades.filter((u) => u.tipo === 'seccional'));

	let novoTemPlantao = $state(false);
	let novoTemExpediente = $state(false);
	let novoTemFds = $state(false);

	// Edição inline
	let editandoId = $state<number | null>(null);
	let editNome = $state('');
	let editTipo = $state<'seccional' | 'delegacia'>('delegacia');
	let editSeccionalId = $state<number | null>(null);
	let editTemPlantao = $state(false);
	let editTemExpediente = $state(false);
	let editTemFds = $state(false);
	let editCidade = $state('');
	let buscaCidade = $state('');
	let salvandoEdicao = $state(false);
	let excluindo = $state(false);

	// Exclusão
	let dialogOpen = $state(false);
	let unidadeParaExcluir = $state<{ id: number; nome: string } | null>(null);

	// Cadastro
	let cadastroOpen = $state(false);

	function iniciarEdicao(u: Unidade) {
		editandoId = u.id;
		editNome = u.nome;
		editTipo = u.tipo;
		editSeccionalId = u.seccional_id;
		editTemPlantao = u.tem_plantao ?? false;
		editTemExpediente = u.tem_expediente ?? false;
		editTemFds = u.tem_fds ?? false;
		editCidade = u.cidade ?? '';
	}

	function cancelarEdicao() {
		editandoId = null;
		editNome = '';
		editTipo = 'delegacia';
		editSeccionalId = null;
		editTemPlantao = false;
		editTemExpediente = false;
		editTemFds = false;
		editCidade = '';
	}

	function handleEditar() {
		salvandoEdicao = true;
		return async ({ result }: { result: any }) => {
			if (result.type === 'success') {
				await invalidateAll();
				toaster.create({ title: 'Unidade atualizada com sucesso!', type: 'success' });
				cancelarEdicao();
			} else {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error || 'Erro ao atualizar unidade'), type: 'error' });
			}
			salvandoEdicao = false;
		};
	}

	function mudarSeccional() {
		// filtro local, sem ação necessária
	}

	function solicitarExclusao(id: number, nome: string) {
		unidadeParaExcluir = { id, nome };
		dialogOpen = true;
	}

	function handleExcluir() {
		excluindo = true;
		return async ({ result }: any) => {
			if (result.type === 'success') {
				await invalidateAll();
				toaster.create({ title: `Unidade "${unidadeParaExcluir?.nome}" removida com sucesso`, type: 'success' });
				dialogOpen = false;
				unidadeParaExcluir = null;
			} else {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error || 'Erro ao remover unidade'), type: 'error' });
			}
			excluindo = false;
		};
	}

	function limparFiltros() {
		filtroSeccional = 'todas';
		filtroBusca = '';
	}

	let cadastroPending = $state(false);
	function handleCadastro({ formData }: { formData: FormData }) {
		cadastroPending = true;
		return async ({ result }: { result: any }) => {
			if (result.type === 'success') {
				await invalidateAll();
				toaster.create({ title: 'Unidade cadastrada com sucesso!', type: 'success' });
				delegaciaPrefixo = '';
				delegaciaSufixo = '';
				seccionalPrefixo = '';
				seccionalSufixo = 'Interior Sul';
				novoSeccionalId = null;
				novoTemPlantao = false;
				novoTemExpediente = false;
				novoTemFds = false;
				cadastroOpen = false;
			} else if (result.type === 'failure' && d?.error) {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error || 'Erro ao cadastrar'), type: 'error' });
			}
			cadastroPending = false;
		};
	}

	const temFiltros = $derived(filtroSeccional !== 'todas' || filtroBusca !== '');
</script>

<svelte:head>
	<title>Gerenciar Unidades - Portal de Escalas</title>
</svelte:head>

<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
	<h1 class="h1 text-xl font-bold">Unidades Policiais</h1>
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
			<button class="btn btn-sm preset-filled-primary-500" onclick={() => (cadastroOpen = true)}>
				<svg class="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M12 4v16m8-8H4"
					/></svg
				>
				Cadastrar
			</button>
		{/if}
	</div>
</div>

<div
	class="p-6 rounded-2xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-md shadow-black/5 mb-6"
>
	<div class="flex flex-col sm:flex-row gap-4">
		<label class="label flex-1">
			<span class="label-text font-semibold mb-1">Filtrar por Seccional</span>
			<select class="select" bind:value={filtroSeccional} onchange={mudarSeccional}>
				<option value="todas">Todas as Seccionais</option>
				{#each seccionais as sec (sec.id)}
					<option value={sec.id}>{sec.nome}</option>
				{/each}
			</select>
		</label>
		<label class="label flex-1">
			<span class="label-text font-semibold mb-1">Buscar por Nome</span>
			<div class="relative">
				<input
					type="text"
					class="input pl-10"
					bind:value={filtroBusca}
					placeholder="Digite o nome da unidade..."
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
</div>

<Dialog open={dialogOpen} onOpenChange={(e) => (dialogOpen = e.open)}>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm"
	>
		<div
			class="card p-6 max-w-sm w-full bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10"
		>
			<Dialog.Title class="h3 font-bold mb-2">Excluir Unidade?</Dialog.Title>
			<Dialog.Description class="text-surface-600 dark:text-surface-400 mb-6">
				Tem certeza que deseja excluir a unidade "{unidadeParaExcluir?.nome}"? Esta ação não afeta
				os policiais já lotados nela.
			</Dialog.Description>
			<div class="flex justify-end gap-3">
				<Dialog.CloseTrigger class="btn preset-outlined-surface" disabled={excluindo}
					>Cancelar</Dialog.CloseTrigger
				>
				<form method="POST" action="?/excluir" use:enhance={handleExcluir} class="contents">
					<input type="hidden" name="unidade_id" value={unidadeParaExcluir?.id} />
					<button type="submit" class="btn preset-filled-error-500 flex items-center gap-2" disabled={excluindo}>
						{#if excluindo}<Spinner size="sm" />{/if}
						{excluindo ? 'Excluindo...' : 'Excluir'}
					</button>
				</form>
			</div>
		</div>
	</Dialog.Content>
</Dialog>

<!-- Modal de Cadastro -->
<Dialog
	open={cadastroOpen}
	onOpenChange={(e) => {
		cadastroOpen = e.open;
		if (!e.open) {
			delegaciaPrefixo = '';
			delegaciaSufixo = '';
			seccionalPrefixo = '';
			seccionalSufixo = 'Interior Sul';
			novoTemPlantao = false;
			novoTemExpediente = false;
			novoTemFds = false;
			buscaCidade = '';
		}
	}}
>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm"
	>
		<div
			class="card p-6 max-w-md w-full bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10"
		>
			<Dialog.Title class="h3 font-bold mb-5">Cadastrar Nova Unidade</Dialog.Title>
			<form method="POST" action="?/criar" use:enhance={handleCadastro} class="flex flex-col gap-4">
				<!-- Campos hidden -->
				<input type="hidden" name="nome" value={novoNome} />
				<input type="hidden" name="tipo" value={tipoUnidade} />
				<input type="hidden" name="seccional_id" value={novoSeccionalId ?? ''} />
				<input type="hidden" name="cidade" value={buscaCidade} />
				<input type="hidden" name="tem_plantao" value={novoTemPlantao ? 'on' : ''} />
				<input type="hidden" name="tem_expediente" value={novoTemExpediente ? 'on' : ''} />
				<input type="hidden" name="tem_fds" value={novoTemFds ? 'on' : ''} />

				<div
					class="flex flex-col gap-2 p-4 bg-surface-200/30 dark:bg-surface-800/20 rounded-xl border border-surface-200 dark:border-white/5"
				>
					<span class="text-sm font-semibold text-surface-600 dark:text-surface-400"
						>Tipo de Unidade</span
					>
					<div class="flex gap-2">
						<button
							type="button"
							class="btn btn-sm flex-1 {tipoUnidade === 'seccional'
								? 'preset-filled-primary-500'
								: 'preset-outlined-surface'}"
							onclick={() => (tipoUnidade = 'seccional')}>Seccional</button
						>
						<button
							type="button"
							class="btn btn-sm flex-1 {tipoUnidade === 'delegacia'
								? 'preset-filled-primary-500'
								: 'preset-outlined-surface'}"
							onclick={() => (tipoUnidade = 'delegacia')}>Delegacia</button
						>
					</div>
				</div>

				<label class="label">
					<span class="label-text font-semibold">Cidade no Ceará</span>
					<div class="relative">
						<input
							class="input"
							type="text"
							list="cidades-ce-registro"
							bind:value={buscaCidade}
							placeholder="Buscar e selecionar cidade..."
							required
						/>
						<datalist id="cidades-ce-registro">
							{#each CIDADES_CEARA as c}
								<option value={c}></option>
							{/each}
						</datalist>
					</div>
				</label>

				{#if tipoUnidade === 'delegacia'}
					<div class="flex flex-col gap-3 animate-in fade-in duration-300">
						<label class="label">
							<span class="label-text">Seccional Vinculada</span>
							<select class="select" bind:value={novoSeccionalId}>
								<option value={null}>Selecione uma Seccional...</option>
								{#each seccionais as sec}
									<option value={sec.id}>{sec.nome}</option>
								{/each}
							</select>
						</label>
						<div class="grid grid-cols-[6rem_1fr] gap-2">
							<label class="label">
								<span class="label-text">Prefixo</span>
								<select class="select" bind:value={delegaciaPrefixo}>
									<option value="">—</option>
									{#each Array.from({ length: 99 }, (_, i) => `${i + 1}ª`) as ord}
										<option value={ord}>{ord}</option>
									{/each}
								</select>
							</label>
							<label class="label">
								<span class="label-text">Local (cidade / nome)</span>
								<input
									class="input"
									type="text"
									bind:value={delegaciaSufixo}
									placeholder="Iguatu"
								/>
							</label>
						</div>
					</div>
				{:else}
					<div class="flex flex-col gap-3 animate-in fade-in duration-300">
						<div class="grid grid-cols-[6rem_1fr] gap-2">
							<label class="label">
								<span class="label-text">Prefixo</span>
								<select class="select" bind:value={seccionalPrefixo}>
									<option value="">—</option>
									{#each Array.from({ length: 99 }, (_, i) => `${i + 1}ª`) as ord}
										<option value={ord}>{ord}</option>
									{/each}
								</select>
							</label>
							<label class="label">
								<span class="label-text">Local</span>
								<input
									class="input"
									type="text"
									bind:value={seccionalSufixo}
									placeholder="Interior Sul"
								/>
							</label>
						</div>
					</div>
				{/if}

				<div class="p-3 bg-primary-500/10 border border-primary-500/20 rounded-lg">
					<p class="text-[10px] uppercase font-bold text-primary-600 dark:text-primary-400 mb-1">
						Preview do Nome:
					</p>
					<p class="text-sm font-semibold truncate">{novoNome || 'Preencha os campos...'}</p>
				</div>

				<div
					class="flex flex-col gap-2 p-3 bg-surface-200/50 dark:bg-surface-800/50 rounded-xl border border-surface-300 dark:border-white/5"
				>
					<p class="text-sm font-medium text-surface-600 dark:text-surface-400">
						Regimes de Escala:
					</p>
					<div class="flex gap-4">
						<label class="flex items-center space-x-2"
							><input class="checkbox" type="checkbox" bind:checked={novoTemPlantao} /><span
								>Plantão</span
							></label
						>
						<label class="flex items-center space-x-2"
							><input class="checkbox" type="checkbox" bind:checked={novoTemExpediente} /><span
								>Expediente</span
							></label
						>
						<label class="flex items-center space-x-2"
							><input class="checkbox" type="checkbox" bind:checked={novoTemFds} /><span
								>Fim de Semana</span
							></label
						>
					</div>
				</div>
				<div class="flex justify-end gap-3 pt-1">
					<Dialog.CloseTrigger class="btn preset-outlined-surface">Cancelar</Dialog.CloseTrigger>
					<button
						type="submit"
						class="btn preset-filled-primary-500 flex items-center gap-2"
						disabled={cadastroPending ||
							!novoNome.trim() ||
							(tipoUnidade === 'delegacia' && !novoSeccionalId)}
					>
						{#if cadastroPending}<Spinner size="sm" />{/if}
						{cadastroPending ? 'Salvando...' : 'Cadastrar'}
					</button>
				</div>
			</form>
		</div>
	</Dialog.Content>
</Dialog>

<div
	class="p-6 rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20 overflow-hidden"
>
	{#if data.unidades.length === 0}
		<div class="text-center py-20">
			<div
				class="bg-surface-200/50 dark:bg-surface-800/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 grayscale opacity-50"
			>
				<svg class="w-8 h-8 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
					/></svg
				>
			</div>
			<p class="text-surface-600 dark:text-surface-400 text-lg">Nenhuma unidade cadastrada.</p>
			{#if isAdmin}
				<p class="text-surface-500 text-sm mt-2">
					Cadastre unidades acima para habilitar a importação de policiais.
				</p>
			{/if}
		</div>
	{:else}
		<!-- Desktop table -->
		<div class="hidden md:block table-wrap">
			<table class="table">
				<thead>
					<tr>
						<th>Nome da Unidade</th>
						<th>Localização</th>
						{#if isAdmin}<th>Ações</th>{/if}
					</tr>
				</thead>
				<tbody>
					{#each unidadesAgrupadas as u (u.id)}
						<tr>
							<td class="relative {u.isChild ? 'pl-6' : ''}">
								{#if u.hasChildren}
									<div
										class="absolute left-1 top-1/2 bottom-0 w-px bg-surface-400 dark:bg-surface-500"
									></div>
								{/if}
								{#if u.isChild}
									<div
										class="absolute left-1 top-0 {u.isLastChild
											? 'bottom-1/2'
											: 'bottom-0'} w-px bg-surface-400 dark:bg-surface-500"
									></div>
									<div
										class="absolute left-1 top-1/2 w-4 h-px bg-surface-400 dark:bg-surface-500"
									></div>
								{/if}
								{#if isAdmin && editandoId === u.id}
									<div class="flex flex-col gap-2">
										<input
											class="input text-sm"
											type="text"
											bind:value={editNome}
											onkeydown={(e) => {
												if (e.key === 'Escape') cancelarEdicao();
											}}
										/>
										<div class="flex flex-wrap items-center gap-3 text-sm mt-1">
											<label class="flex items-center space-x-1.5"
												><input
													class="checkbox"
													type="checkbox"
													bind:checked={editTemPlantao}
												/><span>Plantão</span></label
											>
											<label class="flex items-center space-x-1.5"
												><input
													class="checkbox"
													type="checkbox"
													bind:checked={editTemExpediente}
												/><span>Expediente</span></label
											>
											<label class="flex items-center space-x-1.5"
												><input class="checkbox" type="checkbox" bind:checked={editTemFds} /><span
													>FDS</span
												></label
											>

											<div class="relative ml-2">
												<input
													class="input text-xs py-1 h-8 min-w-[140px] max-w-[200px]"
													type="text"
													list="cidades-ce-edicao"
													bind:value={editCidade}
													placeholder="Mudar cidade..."
												/>
												<datalist id="cidades-ce-edicao">
													{#each CIDADES_CEARA as c}
														<option value={c}></option>
													{/each}
												</datalist>
											</div>
										</div>
									</div>
								{:else}
									<div>
										<span class="font-medium block">{u.nome}</span>
										<div class="flex gap-1.5 mt-1.5 items-center">
											{#if u.tem_plantao}<span
													class="badge preset-filled-tertiary-500/20 text-tertiary-900 dark:text-tertiary-200 border border-tertiary-500/30 text-[10px] px-1.5 py-0 font-bold"
													>Plantão</span
												>{/if}
											{#if u.tem_expediente}<span
													class="badge preset-filled-primary-500/20 text-primary-900 dark:text-primary-200 border border-primary-500/30 text-[10px] px-1.5 py-0 font-bold"
													>Expediente</span
												>{/if}
											{#if u.tem_fds}<span
													class="badge preset-filled-warning-500/20 text-warning-900 dark:text-warning-200 border border-warning-500/30 text-[10px] px-1.5 py-0 font-bold"
													>FDS</span
												>{/if}
										</div>
									</div>
								{/if}
							</td>
							<td class="text-surface-600 dark:text-surface-300 text-sm font-medium italic"
								>{u.cidade || 'Sem cidade'}</td
							>
							{#if isAdmin}
								<td>
									{#if editandoId === u.id}
										<form method="POST" action="?/editar" use:enhance={handleEditar} class="flex gap-2">
											<input type="hidden" name="id" value={editandoId} />
											<input type="hidden" name="nome" value={editNome} />
											<input type="hidden" name="tipo" value={editTipo} />
											<input type="hidden" name="seccional_id" value={editSeccionalId ?? ''} />
											<input type="hidden" name="tem_plantao" value={editTemPlantao ? 'on' : ''} />
											<input type="hidden" name="tem_expediente" value={editTemExpediente ? 'on' : ''} />
											<input type="hidden" name="tem_fds" value={editTemFds ? 'on' : ''} />
											<input type="hidden" name="cidade" value={editCidade} />
											<button
												type="submit"
												class="btn btn-sm preset-filled-primary-500 flex items-center gap-1.5"
												disabled={salvandoEdicao || !editNome.trim()}
											>
												{#if salvandoEdicao}<Spinner size="xs" />{/if}
												{salvandoEdicao ? 'Salvando...' : 'Salvar'}
											</button>
											<button type="button" class="btn btn-sm preset-outlined-surface" onclick={cancelarEdicao}
												>Cancelar</button
											>
										</form>
									{:else}
										<div class="flex gap-2">
											<button
												class="btn btn-sm preset-outlined-primary-500"
												onclick={() => iniciarEdicao(u)}>Editar</button
											>
											<button
												class="btn btn-sm preset-filled-error-500"
												onclick={() => solicitarExclusao(u.id, u.nome)}>Excluir</button
											>
										</div>
									{/if}
								</td>
							{/if}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Mobile cards -->
		<div class="md:hidden space-y-3">
			{#each unidadesAgrupadas as u (u.id)}
				<div
					class="p-4 rounded-2xl bg-surface-100/50 dark:bg-surface-800/50 border {u.isChild
						? 'border-l-4 border-l-surface-400 dark:border-l-surface-600 border-surface-200 dark:border-white/10 ml-6'
						: 'border-surface-200 dark:border-white/10'}"
				>
					{#if isAdmin && editandoId === u.id}
						<div class="space-y-2">
							<input
								class="input text-sm w-full"
								type="text"
								bind:value={editNome}
								onkeydown={(e) => {
									if (e.key === 'Escape') cancelarEdicao();
								}}
							/>
							<div class="flex flex-wrap items-center gap-3 text-sm py-2">
								<label class="flex items-center space-x-1.5"
									><input class="checkbox" type="checkbox" bind:checked={editTemPlantao} /><span
										>Plantão</span
									></label
								>
								<label class="flex items-center space-x-1.5"
									><input class="checkbox" type="checkbox" bind:checked={editTemExpediente} /><span
										>Expediente</span
									></label
								>
								<label class="flex items-center space-x-1.5"
									><input class="checkbox" type="checkbox" bind:checked={editTemFds} /><span
										>FDS</span
									></label
								>
								<div class="relative w-full mt-1">
									<input
										class="input text-xs w-full"
										type="text"
										list="cidades-ce-edicao-mobile"
										bind:value={editCidade}
										placeholder="Mudar cidade..."
									/>
									<datalist id="cidades-ce-edicao-mobile">
										{#each CIDADES_CEARA as c}
											<option value={c}></option>
										{/each}
									</datalist>
								</div>
							</div>
							<form method="POST" action="?/editar" use:enhance={handleEditar} class="flex gap-2">
								<input type="hidden" name="id" value={editandoId} />
								<input type="hidden" name="nome" value={editNome} />
								<input type="hidden" name="tipo" value={editTipo} />
								<input type="hidden" name="seccional_id" value={editSeccionalId ?? ''} />
								<input type="hidden" name="tem_plantao" value={editTemPlantao ? 'on' : ''} />
								<input type="hidden" name="tem_expediente" value={editTemExpediente ? 'on' : ''} />
								<input type="hidden" name="tem_fds" value={editTemFds ? 'on' : ''} />
								<input type="hidden" name="cidade" value={editCidade} />
								<button
									type="submit"
									class="btn btn-sm preset-filled-primary-500 flex-1 flex items-center justify-center gap-1.5"
									disabled={salvandoEdicao || !editNome.trim()}
								>
									{#if salvandoEdicao}<Spinner size="xs" />{/if}
									{salvandoEdicao ? 'Salvando...' : 'Salvar'}
								</button>
								<button type="button" class="btn btn-sm preset-outlined-surface flex-1" onclick={cancelarEdicao}
									>Cancelar</button
								>
							</form>
						</div>
					{:else}
						<div class="flex items-center justify-between gap-3">
							<div class="min-w-0">
								<p class="font-semibold text-sm">{u.nome}</p>
								<div class="flex flex-wrap gap-1.5 mt-1.5 mb-1">
									{#if u.tem_plantao}<span
											class="badge preset-filled-tertiary-500/20 text-tertiary-900 dark:text-tertiary-200 border border-tertiary-500/30 text-[10px] px-1.5 py-0 font-bold"
											>Plantão</span
										>{/if}
									{#if u.tem_expediente}<span
											class="badge preset-filled-primary-500/20 text-primary-900 dark:text-primary-200 border border-primary-500/30 text-[10px] px-1.5 py-0 font-bold"
											>Expediente</span
										>{/if}
									{#if u.tem_fds}<span
											class="badge preset-filled-warning-500/20 text-warning-900 dark:text-warning-200 border border-warning-500/30 text-[10px] px-1.5 py-0 font-bold"
											>FDS</span
										>{/if}
								</div>
								<p
									class="text-[11px] text-surface-600 dark:text-surface-300 font-medium italic mt-1"
								>
									{u.cidade || 'Sem cidade'}
								</p>
							</div>
							{#if isAdmin}
								<div class="flex gap-2 shrink-0">
									<button
										class="btn btn-sm preset-outlined-primary-500"
										onclick={() => iniciarEdicao(u)}>Editar</button
									>
									<button
										class="btn btn-sm preset-filled-error-500"
										onclick={() => solicitarExclusao(u.id, u.nome)}>Excluir</button
									>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>

		<p class="mt-3 text-surface-500 text-sm">
			{unidadesFiltradas.length} unidade{unidadesFiltradas.length !== 1 ? 's' : ''} encontrada{unidadesFiltradas.length !==
			1
				? 's'
				: ''}
		</p>
	{/if}
</div>
