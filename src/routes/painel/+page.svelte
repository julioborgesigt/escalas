<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { page, navigating } from '$app/state';
	import SkeletonCard from '$lib/components/SkeletonCard.svelte';
	import FloatingRefresh from '$lib/components/FloatingRefresh.svelte';
	import { browser } from '$app/environment';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import { toaster } from '$lib/toast';
	import type { ItemCompliance } from '../api/admin/compliance/+server';
	import { useAutorizacao, getSavedFilters } from '$lib/composables';
	import { loading as loadingService } from '$lib/loading.svelte';
	import type { Unidade } from '$lib/types';

	let { data } = $props();

	const auth = useAutorizacao();
	const isAdmin = $derived(auth.isAdmin);
	const savedFilters = getSavedFilters('filtros_painel', {
		regime: 'todos',
		seccional: 'todas',
		unidade: '',
		mesCorrente: true,
		agrupamento: 'nenhum',
		pendentes: true,
		ignorados: false
	});

	let dados = $derived(data.compliance as ItemCompliance[]);
	let unidadesDB = $derived(data.unidades as Unidade[]);

	// Filtros
	let filtroRegime = $state<'todos' | 'plantao' | 'expediente' | 'fds'>(
		(savedFilters.regime as 'todos' | 'plantao' | 'expediente' | 'fds') || 'todos'
	);
	let filtroSeccional = $state<number | 'todas'>(
		(savedFilters.seccional as unknown as number) || 'todas'
	);
	let filtroUnidade = $state(savedFilters.unidade);
	let filtreMesCorrente = $state(
		savedFilters.mesCorrente !== undefined ? !!savedFilters.mesCorrente : true
	);
	let filtroAgrupamento = $state<'nenhum' | 'unidade' | 'regime' | 'ambos'>(
		(savedFilters.agrupamento as 'nenhum' | 'unidade' | 'regime' | 'ambos') || 'nenhum'
	);
	let filtroPendentes = $state(
		savedFilters.pendentes !== undefined ? !!savedFilters.pendentes : true
	);
	let mostrarIgnorados = $state(!!savedFilters.ignorados);

	// Salvar filtros a cada mudança
	$effect(() => {
		if (browser) {
			localStorage.setItem(
				'filtros_painel',
				JSON.stringify({
					regime: filtroRegime,
					seccional: filtroSeccional,
					unidade: filtroUnidade,
					mesCorrente: filtreMesCorrente,
					agrupamento: filtroAgrupamento,
					pendentes: filtroPendentes,
					ignorados: mostrarIgnorados
				})
			);
		}
	});

	// Reset de unidade (apenas no clique seccional)
	function mudarSeccional() {
		filtroUnidade = '';
		// carregar() não é necessário aqui pois dados já estão em memória
	}

	const seccionais = $derived(unidadesDB.filter((u) => u.tipo === 'seccional'));

	// Itens ignorados (persistidos no localStorage)
	let ignorados = $state<Set<string>>(new Set());

	function chaveIgnorado(item: ItemCompliance): string {
		return `${item.unidade_nome}|${item.tipo_regime}|${item.data_inicio}`;
	}

	function ignorarItem(item: ItemCompliance) {
		const chave = chaveIgnorado(item);
		ignorados = new Set([...ignorados, chave]);
		const arr = [...ignorados];
		localStorage.setItem('compliance_ignorados', JSON.stringify(arr));
	}

	function restaurarItem(item: ItemCompliance) {
		const chave = chaveIgnorado(item);
		const novoSet = new Set(ignorados);
		novoSet.delete(chave);
		ignorados = novoSet;
		localStorage.setItem('compliance_ignorados', JSON.stringify([...novoSet]));
	}

	const dadosFiltrados = $derived(
		dados.filter((d) => {
			const ignorado = ignorados.has(chaveIgnorado(d));
			if (!mostrarIgnorados && ignorado) return false;
			if (mostrarIgnorados && !ignorado) return false;
			if (filtroRegime !== 'todos' && d.tipo_regime !== filtroRegime) return false;
			if (filtroPendentes && d.status === 'ok') return false;

			if (filtroSeccional !== 'todas') {
				const udb = unidadesDB.find((u) => u.nome === d.unidade_nome);
				if (udb) {
					if (udb.tipo === 'seccional' && udb.id !== filtroSeccional) return false;
					if (udb.tipo === 'delegacia' && udb.seccional_id !== filtroSeccional) return false;
				}
			}

			if (filtroUnidade && d.unidade_nome !== filtroUnidade) return false;
			return true;
		})
	);

	interface GrupoCompliance {
		titulo: string;
		itens: ItemCompliance[];
	}

	const dadosAgrupados = $derived.by(() => {
		const base = [...dadosFiltrados];
		if (filtroAgrupamento === 'nenhum') {
			return [{ titulo: '', itens: base }];
		}

		const gruposMap = new Map<string, ItemCompliance[]>();
		for (const item of base) {
			let chave = '';
			if (filtroAgrupamento === 'unidade') chave = item.unidade_nome;
			else if (filtroAgrupamento === 'regime') chave = item.tipo_regime.toUpperCase();
			else if (filtroAgrupamento === 'ambos')
				chave = `${item.unidade_nome} - ${item.tipo_regime.toUpperCase()}`;

			if (!gruposMap.has(chave)) gruposMap.set(chave, []);
			gruposMap.get(chave)!.push(item);
		}

		return Array.from(gruposMap.entries()).map(([titulo, itens]) => ({ titulo, itens }));
	});

	const unidadesDropdown = $derived(
		[
			...new Set(
				dados
					.filter((d) => {
						if (filtroSeccional === 'todas') return true;
						const udb = unidadesDB.find((u) => u.nome === d.unidade_nome);
						if (!udb) return true;
						return (
							(udb.tipo === 'seccional' && udb.id === filtroSeccional) ||
							(udb.tipo === 'delegacia' && udb.seccional_id === filtroSeccional)
						);
					})
					.map((d) => d.unidade_nome)
			)
		].sort()
	);

	const totais = $derived({
		ok: dados.filter((d) => d.status === 'ok' && !ignorados.has(chaveIgnorado(d))).length,
		nao_assinada: dados.filter(
			(d) => d.status === 'nao_assinada' && !ignorados.has(chaveIgnorado(d))
		).length,
		nao_criada: dados.filter((d) => d.status === 'nao_criada' && !ignorados.has(chaveIgnorado(d)))
			.length,
		ignorados: ignorados.size
	});

	// Exclusão de escala (para "não assinada")
	let escalaExcluirOpen = $state(false);
	let itemParaExcluir = $state<ItemCompliance | null>(null);

	async function carregar() {
		loadingService.show('Atualizando dados de compliance...');
		try {
			const stored = localStorage.getItem('compliance_ignorados');
			if (stored) ignorados = new Set(JSON.parse(stored));
		} catch { /* ignora */ }
		await invalidate(page.url.pathname);
		loadingService.hide();
	}

	async function onMesCorrenteChange() {
		const params = new URLSearchParams(page.url.searchParams);
		if (!filtreMesCorrente) {
			params.set('todos', 'true');
		} else {
			params.delete('todos');
		}
		await goto(`?${params}`, { keepFocus: true, noScroll: true });
	}

	async function limparFiltros() {
		filtroRegime = 'todos';
		filtroSeccional = 'todas';
		filtroUnidade = '';
		filtroPendentes = true;
		mostrarIgnorados = false;
		filtreMesCorrente = true;
		filtroAgrupamento = 'nenhum';
		await goto('?', { keepFocus: true, noScroll: true });
	}

	function handleExcluirEscala() {
		loadingService.show('Excluindo escala...');
		return async ({ result }: { result: any }) => {
			loadingService.hide();
			if (result.type === 'success') {
				toaster.create({ title: 'Escala excluída com sucesso!', type: 'success' });
				await invalidate(page.url.pathname);
				escalaExcluirOpen = false;
				itemParaExcluir = null;
			} else {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error || 'Erro ao excluir escala'), type: 'error' });
			}
		};
	}

	const temFiltros = $derived(
		filtroRegime !== 'todos' ||
			filtroSeccional !== 'todas' ||
			filtroUnidade !== '' ||
			filtroPendentes !== true ||
			mostrarIgnorados !== false ||
			!filtreMesCorrente ||
			filtroAgrupamento !== 'nenhum'
	);

	$effect(() => {
		if (isAdmin && browser) {
			try {
				const stored = localStorage.getItem('compliance_ignorados');
				if (stored) ignorados = new Set(JSON.parse(stored));
			} catch { /* ignora */ }
		}
	});
</script>

<svelte:head>
	<title>Painel de Compliance | Escalas</title>
</svelte:head>

{#if !isAdmin}
	<div class="text-center py-32 text-surface-500">
		<p class="text-2xl mb-2">🔒</p>
		<p>Acesso restrito a administradores.</p>
	</div>
{:else}
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
		<div>
			<h1 class="h1 text-xl font-bold">Painel de Compliance</h1>
			<p class="text-sm text-surface-500 mt-0.5">
				Controle de envio e assinatura de escalas por unidade
			</p>
		</div>
		<div class="flex gap-2">
			<button type="button"
				class="btn btn-sm {temFiltros
					? 'preset-filled-warning-500'
					: 'preset-outlined-primary-500 opacity-40'}"
				onclick={limparFiltros}
				disabled={!temFiltros && !loadingService.active}
			>
				Limpar filtros
			</button>
			<button type="button" class="btn preset-outlined-primary-500 btn-sm" onclick={carregar} disabled={loadingService.active}>
				{#if loadingService.active}
					Atualizando...
				{:else}
					<svg class="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
						/>
					</svg>
				{/if}
				Atualizar
			</button>
		</div>
	</div>

	<!-- Cards de resumo -->
	{#if !loadingService.active}
		<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
			<div class="p-4 rounded-2xl bg-success-500/10 border border-success-500/20 text-center">
				<p class="text-2xl font-bold text-success-600 dark:text-success-400">{totais.ok}</p>
				<p class="text-xs text-surface-500 mt-1 font-medium">✅ Em dia</p>
			</div>
			<div class="p-4 rounded-2xl bg-warning-500/10 border border-warning-500/20 text-center">
				<p class="text-2xl font-bold text-warning-600 dark:text-warning-400">
					{totais.nao_assinada}
				</p>
				<p class="text-xs text-surface-500 mt-1 font-medium">🟡 Não Assinada</p>
			</div>
			<div class="p-4 rounded-2xl bg-error-500/10 border border-error-500/20 text-center">
				<p class="text-2xl font-bold text-error-600 dark:text-error-400">{totais.nao_criada}</p>
				<p class="text-xs text-surface-500 mt-1 font-medium">🔴 Não Criada</p>
			</div>
			<button type="button"
				class="p-4 rounded-2xl bg-surface-500/10 border border-surface-500/20 text-center cursor-pointer hover:bg-surface-500/20 transition-colors"
				onclick={() => {
					mostrarIgnorados = !mostrarIgnorados;
					filtroPendentes = false;
				}}
			>
				<p class="text-2xl font-bold text-surface-500">{totais.ignorados}</p>
				<p class="text-xs text-surface-500 mt-1 font-medium">🔕 Ignorados</p>
			</button>
		</div>
	{/if}

	<!-- Filtros -->
	<div
		class="p-4 sm:p-5 mb-6 rounded-2xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-white/10 shadow-sm flex flex-col gap-4 sm:gap-5"
	>
		<!-- Regime Row -->
		<div class="flex flex-wrap items-center gap-2">
			<span class="text-sm font-bold text-surface-500 mr-1">Regime:</span>
			{#each [['todos', 'Todos'], ['plantao', 'Plantão'], ['expediente', 'Expediente'], ['fds', 'FDS']] as [val, label]}
				<button type="button"
					class="btn btn-sm px-4 rounded-full transition-all text-sm font-medium {filtroRegime ===
					val
						? 'bg-[#00ADC8] text-white shadow-sm'
						: 'text-surface-600 hover:bg-surface-100 dark:hover:bg-surface-800'}"
					onclick={() => {
						filtroRegime = val as typeof filtroRegime;
						mostrarIgnorados = false;
					}}>{label}</button
				>
			{/each}
		</div>

		<!-- Main Filters Row -->
		<div class="flex flex-wrap items-end gap-4 sm:gap-6">
			<label class="flex flex-col gap-1.5 w-full sm:w-60">
				<span class="text-xs font-bold text-surface-700 dark:text-surface-300">Seccional</span>
				<select
					class="select rounded-lg border-surface-200 dark:border-white/10 bg-white dark:bg-surface-800 h-9 px-3 text-sm"
					bind:value={filtroSeccional}
					onchange={mudarSeccional}
				>
					<option value="todas">Todas as seccionais</option>
					{#each seccionais as sec (sec.id)}
						<option value={sec.id}>{sec.nome}</option>
					{/each}
				</select>
			</label>

			<label class="flex flex-col gap-1.5 w-full sm:w-60">
				<span class="text-xs font-bold text-surface-700 dark:text-surface-300">Unidade</span>
				<select
					class="select rounded-lg border-surface-200 dark:border-white/10 bg-white dark:bg-surface-800 h-9 px-3 text-sm"
					bind:value={filtroUnidade}
				>
					<option value="">Todas as unidades</option>
					{#each unidadesDropdown as u}
						<option value={u}>{u}</option>
					{/each}
				</select>
			</label>

			<label class="flex flex-col gap-1.5 w-full sm:w-48">
				<span class="text-xs font-bold text-surface-700 dark:text-surface-300">Agrupar por:</span>
				<select
					class="select rounded-lg border-surface-200 dark:border-white/10 bg-white dark:bg-surface-800 h-9 px-3 text-sm"
					bind:value={filtroAgrupamento}
				>
					<option value="nenhum">Nenhum</option>
					<option value="unidade">Delegacia</option>
					<option value="regime">Regime</option>
					<option value="ambos">Delegacia e Regime</option>
				</select>
			</label>

			<div class="flex flex-wrap items-center gap-x-5 gap-y-2">
				{#if !mostrarIgnorados}
					<label class="flex items-center gap-2 cursor-pointer group">
						<input
							type="checkbox"
							class="checkbox w-4 h-4 rounded border-surface-300 dark:border-surface-600 !bg-[#00ADC8] focus:ring-0 checked:bg-[#00ADC8] border-none"
							bind:checked={filtroPendentes}
						/>
						<span class="text-xs font-bold text-surface-700 dark:text-surface-200 whitespace-nowrap"
							>Apenas pendências</span
						>
					</label>
				{/if}

				<label class="flex items-center gap-2 cursor-pointer group">
					<input
						type="checkbox"
						class="checkbox w-4 h-4 rounded border-surface-300 dark:border-surface-600 !bg-[#00ADC8] focus:ring-0 checked:bg-[#00ADC8] border-none"
						bind:checked={filtreMesCorrente}
						onchange={onMesCorrenteChange}
					/>
					<span class="text-xs font-bold text-surface-700 dark:text-surface-200 whitespace-nowrap"
						>Mês Corrente</span
					>
				</label>
			</div>
		</div>

		{#if mostrarIgnorados}
			<div class="pt-1 border-t border-surface-100 dark:border-white/5">
				<button type="button"
					class="btn btn-sm variant-soft-surface text-xs font-bold"
					onclick={() => {
						mostrarIgnorados = false;
						filtroPendentes = true;
					}}
				>
					← Voltar para pendências
				</button>
			</div>
		{/if}

		<hr class="opacity-50 dark:opacity-10" />
	</div>

	<!-- Modo ignorados: banner informativo -->
	{#if mostrarIgnorados}
		<div
			class="mb-4 p-3 rounded-xl bg-surface-500/10 border border-surface-500/20 text-sm text-surface-600 dark:text-surface-400 flex items-center gap-2"
		>
			<svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"
				><path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
				/></svg
			>
			Exibindo itens ignorados. Para restaurar, clique em <strong>Restaurar</strong> na linha correspondente.
		</div>
	{/if}

	<Dialog open={escalaExcluirOpen} onOpenChange={(e) => (escalaExcluirOpen = e.open)}>
		<Dialog.Content
			class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
		>
			<div
				class="card p-4 sm:p-6 max-w-sm w-full max-h-[calc(100dvh-2rem)] overflow-y-auto bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10"
			>
				<Dialog.Title class="h3 font-bold mb-2">Excluir Escala?</Dialog.Title>
				<Dialog.Description class="text-surface-600 dark:text-surface-400 mb-6">
					Tem certeza que deseja excluir esta escala de <strong
						>{itemParaExcluir?.unidade_nome}</strong
					>? O status voltará a ser "Não Criada".
				</Dialog.Description>
				<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
					<Dialog.CloseTrigger class="btn preset-outlined-surface" disabled={loadingService.active}
						>Cancelar</Dialog.CloseTrigger
					>
					<form method="POST" action="?/excluirEscala" use:enhance={handleExcluirEscala} class="contents">
						<input type="hidden" name="escala_id" value={itemParaExcluir?.escala_id} />
						<button type="submit" class="btn preset-filled-error-500 flex items-center gap-2 active:scale-95 transition-all" disabled={loadingService.active}>
							{loadingService.active ? 'Excluindo...' : 'Confirmar Exclusão'}
						</button>
					</form>
				</div>
			</div>
		</Dialog.Content>
	</Dialog>

	<!-- Tabela -->
	<div
		class="rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20 p-4 sm:p-5"
	>
		{#if loadingService.active}
			<div
				class="flex flex-col items-center justify-center py-16 gap-3 text-surface-400 dark:text-surface-500"
			>
				<span class="text-sm">Carregando...</span>
			</div>
		{:else if dadosFiltrados.length === 0}
			<div class="text-center py-20">
				<p class="text-4xl mb-4">{mostrarIgnorados ? '🔕' : '🎉'}</p>
				<p class="text-surface-600 dark:text-surface-400 text-lg font-semibold">
					{mostrarIgnorados ? 'Nenhum item ignorado' : 'Nenhuma pendência encontrada!'}
				</p>
				<p class="text-surface-500 text-sm mt-1">
					{mostrarIgnorados
						? 'Você não ignorou nenhuma pendência.'
						: 'Todas as escalas estão em dia com os filtros selecionados.'}
				</p>
			</div>
		{:else}
			<!-- Desktop table -->
			<div class="hidden md:block table-wrap overflow-hidden rounded-xl">
				<table class="table">
					<thead>
						<tr>
							<th>Unidade</th>
							<th>Regime</th>
							<th>Período</th>
							<th>Status</th>
							<th class="text-left">Ações</th>
						</tr>
					</thead>
					<tbody>
						{#if navigating?.to && navigating.to.url.pathname === page.url.pathname}
							{#each { length: 8 } as _}
								<tr class="animate-pulse">
									<td class="px-4 py-3"><div class="h-4 w-40 rounded bg-surface-200 dark:bg-surface-700"></div></td>
									<td class="px-4 py-3"><div class="h-6 w-20 rounded-full bg-surface-200 dark:bg-surface-700"></div></td>
									<td class="px-4 py-3"><div class="h-4 w-28 rounded bg-surface-200 dark:bg-surface-700"></div></td>
									<td class="px-4 py-3"><div class="h-6 w-20 rounded-full bg-surface-200 dark:bg-surface-700"></div></td>
									<td class="px-4 py-3"><div class="h-8 w-24 rounded-lg bg-surface-200 dark:bg-surface-700"></div></td>
								</tr>
							{/each}
						{:else}
						{#each dadosAgrupados as grupo}
							{#if grupo.titulo}
								<tr class="bg-surface-200/50 dark:bg-surface-800/50 shadow-inner">
									<td
										colspan="5"
										class="py-1.5 px-4 text-[10px] font-extrabold uppercase tracking-widest text-primary-600 dark:text-primary-400"
									>
										{grupo.titulo}
									</td>
								</tr>
							{/if}
							{#each grupo.itens as item (item.unidade_nome + item.tipo_regime + item.data_inicio)}
								<tr class={ignorados.has(chaveIgnorado(item)) ? 'opacity-50' : ''}>
									<td class="font-medium max-w-[305px] truncate">{item.unidade_nome}</td>
									<td>
										{#if item.tipo_regime === 'plantao'}
											<span
												class="badge preset-filled-tertiary-500/20 text-tertiary-900 dark:text-tertiary-200 border border-tertiary-500/30 text-xs font-bold"
												>Plantão</span
											>
										{:else if item.tipo_regime === 'expediente'}
											<span
												class="badge preset-filled-primary-500/20 text-primary-900 dark:text-primary-200 border border-primary-500/30 text-xs font-bold"
												>Expediente</span
											>
										{:else}
											<span
												class="badge preset-filled-warning-500/20 text-warning-900 dark:text-warning-200 border border-warning-500/30 text-xs font-bold"
												>FDS</span
											>
										{/if}
									</td>
									<td class="text-sm text-surface-600 dark:text-surface-300 whitespace-nowrap font-mono tabular-nums"
										>{item.periodo}</td
									>
									<td>
										{#if item.status === 'ok'}
											<span
												class="badge preset-filled-success-500 text-white text-xs font-bold px-2"
												>✅ Em dia</span
											>
										{:else if item.status === 'nao_assinada' && item.escala_id}
											<div class="flex items-center gap-1.5">
												<a
													href="/escalas/{item.escala_id}"
													class="badge bg-warning-500/15 text-warning-700 dark:text-warning-300 border border-warning-500/30 text-xs font-bold px-2 hover:bg-warning-500/30 transition-colors pointer-events-auto"
													>🟡 Não Assinada</a
												>
												<button type="button"
													class="text-error-500 hover:text-error-600 hover:bg-error-500/10 p-1 rounded-md transition-colors leading-none font-bold"
													title="Excluir escala"
													onclick={(e) => {
														e.preventDefault();
														itemParaExcluir = item;
														escalaExcluirOpen = true;
													}}>✕</button
												>
											</div>
										{:else if item.status === 'nao_assinada'}
											<span
												class="badge bg-warning-500/15 text-warning-700 dark:text-warning-300 border border-warning-500/30 text-xs font-bold px-2"
												>🟡 Não Assinada</span
											>
										{:else}
											<span
												class="badge bg-error-500/15 text-error-700 dark:text-error-300 border border-error-500/30 text-xs font-bold px-2"
												>🔴 Não Criada</span
											>
										{/if}
									</td>
									<td>
										<div class="flex gap-2 justify-start">
											{#if mostrarIgnorados}
												<button type="button"
													class="btn btn-sm preset-outlined-primary-500"
													onclick={() => restaurarItem(item)}>Restaurar</button
												>
											{:else}
												<div class="flex gap-2 items-center">
													<button type="button"
														class="btn btn-sm preset-outlined-surface opacity-60 hover:opacity-100"
														title="Ignorar esta pendência"
														onclick={() => ignorarItem(item)}>🔕</button
													>
												</div>
											{/if}
										</div>
									</td>
								</tr>
							{/each}
						{/each}
						{/if}
					</tbody>
				</table>
			</div>

			<!-- Mobile cards -->
			<div class="md:hidden space-y-2">
				{#if navigating?.to && navigating.to.url.pathname === page.url.pathname}
					{#each { length: 5 } as _}
						<SkeletonCard lines={3} hasFooter={false} />
					{/each}
				{:else}
				{#each dadosAgrupados as grupo}
					{#if grupo.titulo}
						<div
							class="py-2 px-4 bg-surface-100 dark:bg-surface-800/40 text-[10px] font-bold uppercase tracking-widest text-primary-600 dark:text-primary-400 rounded-lg"
						>
							{grupo.titulo}
						</div>
					{/if}

					<div
						class="divide-y divide-surface-200 dark:divide-white/5 bg-white/50 dark:bg-surface-900/30 rounded-xl overflow-hidden border border-surface-200 dark:border-white/5 mb-4"
					>
						{#each grupo.itens as item (item.unidade_nome + item.tipo_regime + item.data_inicio)}
							<div
								class="p-4 flex items-center justify-between gap-3 {ignorados.has(
									chaveIgnorado(item)
								)
									? 'opacity-50'
									: ''}"
							>
								<div class="min-w-0 flex-1">
									<p class="font-bold text-sm truncate">{item.unidade_nome}</p>
									<div class="flex items-center gap-2 mt-1.5 flex-wrap">
										{#if item.tipo_regime === 'plantao'}
											<span
												class="badge preset-filled-tertiary-500/20 text-tertiary-900 dark:text-tertiary-200 border border-tertiary-500/30 text-[9px] font-bold px-1.5 py-0 leading-tight"
												>PLANTÃO</span
											>
										{:else if item.tipo_regime === 'expediente'}
											<span
												class="badge preset-filled-primary-500/20 text-primary-900 dark:text-primary-200 border border-primary-500/30 text-[9px] font-bold px-1.5 py-0 leading-tight"
												>EXPEDIENTE</span
											>
										{:else}
											<span
												class="badge preset-filled-warning-500/20 text-warning-900 dark:text-warning-200 border border-warning-500/30 text-[9px] font-bold px-1.5 py-0 leading-tight"
												>FDS</span
											>
										{/if}
										<span class="text-xs text-surface-500 font-medium font-mono tabular-nums">{item.periodo}</span>
									</div>
									<div class="mt-2">
										{#if item.status === 'ok'}
											<span
												class="text-xs text-success-600 dark:text-success-400 font-bold flex items-center gap-1"
											>
												<svg
													class="w-3.5 h-3.5"
													fill="none"
													viewBox="0 0 24 24"
													stroke="currentColor"
													><path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M5 13l4 4L19 7"
													/></svg
												>
												Em dia
											</span>
										{:else if item.status === 'nao_assinada' && item.escala_id}
											<div class="flex items-center gap-2">
												<a
													href="/escalas/{item.escala_id}"
													class="text-xs text-warning-600 dark:text-warning-400 font-bold hover:underline decoration-warning-500 flex items-center gap-1"
												>
													<div class="w-2 h-2 rounded-full bg-warning-500 animate-pulse"></div>
													Não Assinada
												</a>
												<button type="button"
													class="text-error-500 font-black px-1.5 py-0.5 bg-error-500/10 rounded"
													onclick={(e) => {
														e.preventDefault();
														itemParaExcluir = item;
														escalaExcluirOpen = true;
													}}>✕</button
												>
											</div>
										{:else if item.status === 'nao_assinada'}
											<span
												class="text-xs text-warning-600 dark:text-warning-400 font-bold flex items-center gap-1"
											>
												<div class="w-2 h-2 rounded-full bg-warning-500"></div>
												Não Assinada
											</span>
										{:else}
											<span
												class="text-xs text-error-600 dark:text-error-400 font-bold flex items-center gap-1"
											>
												<div class="w-2 h-2 rounded-full bg-error-500"></div>
												Não Criada
											</span>
										{/if}
									</div>
								</div>

								<div class="shrink-0 flex items-center gap-2">
									{#if mostrarIgnorados}
										<button type="button"
											class="btn btn-sm preset-outlined-primary-500 text-xs font-bold"
											onclick={() => restaurarItem(item)}>Restaurar</button
										>
									{:else}
										<button type="button"
											class="btn btn-sm w-9 h-9 !p-0 preset-outlined-surface flex items-center justify-center rounded-full"
											title="Ignorar"
											onclick={() => ignorarItem(item)}
										>
											<span class="text-sm">🔕</span>
										</button>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/each}
				{/if}
			</div>
		{/if}
	</div>
{/if}
<FloatingRefresh />
