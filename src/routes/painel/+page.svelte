<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import type { ItemCompliance } from '../api/admin/compliance/+server';
	import type { Unidade } from '$lib/types';

	const isAdmin = $derived(page.data.usuario?.tipo === 'admin');

	let dados = $state<ItemCompliance[]>([]);
	let loading = $state(true);

	// Filtros
	let filtroRegime = $state<'todos' | 'plantao' | 'expediente' | 'fds'>('todos');
	let filtroSeccional = $state<number | 'todas'>('todas');
	let filtroUnidade = $state('');
	let filtroPendentes = $state(true);
	let mostrarIgnorados = $state(false);

	let unidadesDB = $state<Unidade[]>([]);

	$effect(() => {
		if (filtroSeccional) {
			filtroUnidade = '';
		}
	});

	const seccionais = $derived(unidadesDB.filter(u => u.tipo === 'seccional'));


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

	const dadosFiltrados = $derived(dados.filter((d) => {
		const ignorado = ignorados.has(chaveIgnorado(d));
		if (!mostrarIgnorados && ignorado) return false;
		if (mostrarIgnorados && !ignorado) return false;
		if (filtroRegime !== 'todos' && d.tipo_regime !== filtroRegime) return false;
		if (filtroPendentes && d.status === 'ok') return false;
		
		if (filtroSeccional !== 'todas') {
			const udb = unidadesDB.find(u => u.nome === d.unidade_nome);
			if (udb) {
				if (udb.tipo === 'seccional' && udb.id !== filtroSeccional) return false;
				if (udb.tipo === 'delegacia' && udb.seccional_id !== filtroSeccional) return false;
			}
		}
		
		if (filtroUnidade && d.unidade_nome !== filtroUnidade) return false;
		return true;
	}));

	const unidadesDropdown = $derived([...new Set(
		dados.filter(d => {
			if (filtroSeccional === 'todas') return true;
			const udb = unidadesDB.find(u => u.nome === d.unidade_nome);
			if (!udb) return true;
			return (udb.tipo === 'seccional' && udb.id === filtroSeccional) ||
			       (udb.tipo === 'delegacia' && udb.seccional_id === filtroSeccional);
		}).map(d => d.unidade_nome)
	)].sort());

	const totais = $derived({
		ok: dados.filter(d => d.status === 'ok' && !ignorados.has(chaveIgnorado(d))).length,
		nao_assinada: dados.filter(d => d.status === 'nao_assinada' && !ignorados.has(chaveIgnorado(d))).length,
		nao_criada: dados.filter(d => d.status === 'nao_criada' && !ignorados.has(chaveIgnorado(d))).length,
		ignorados: ignorados.size,
	});

	async function carregar() {
		loading = true;
		// Carregar ignorados do localStorage
		try {
			const stored = localStorage.getItem('compliance_ignorados');
			if (stored) ignorados = new Set(JSON.parse(stored));
		} catch { /* ignora */ }

		const resDB = await fetch('/api/unidades');
		if (resDB.ok) unidadesDB = await resDB.json();

		const res = await fetch('/api/admin/compliance');
		if (res.ok) dados = await res.json();
		loading = false;
	}


	$effect(() => {
		if (isAdmin) carregar();
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
			<p class="text-sm text-surface-500 mt-0.5">Controle de envio e assinatura de escalas por unidade</p>
		</div>
		<button class="btn preset-outlined-surface btn-sm" onclick={carregar}>
			<svg class="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
			</svg>
			Atualizar
		</button>
	</div>

	<!-- Cards de resumo -->
	{#if !loading}
		<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
			<div class="p-4 rounded-2xl bg-success-500/10 border border-success-500/20 text-center">
				<p class="text-2xl font-bold text-success-600 dark:text-success-400">{totais.ok}</p>
				<p class="text-xs text-surface-500 mt-1 font-medium">✅ Em dia</p>
			</div>
			<div class="p-4 rounded-2xl bg-warning-500/10 border border-warning-500/20 text-center">
				<p class="text-2xl font-bold text-warning-600 dark:text-warning-400">{totais.nao_assinada}</p>
				<p class="text-xs text-surface-500 mt-1 font-medium">🟡 Não Assinada</p>
			</div>
			<div class="p-4 rounded-2xl bg-error-500/10 border border-error-500/20 text-center">
				<p class="text-2xl font-bold text-error-600 dark:text-error-400">{totais.nao_criada}</p>
				<p class="text-xs text-surface-500 mt-1 font-medium">🔴 Não Criada</p>
			</div>
			<button
				class="p-4 rounded-2xl bg-surface-500/10 border border-surface-500/20 text-center cursor-pointer hover:bg-surface-500/20 transition-colors"
				onclick={() => { mostrarIgnorados = !mostrarIgnorados; filtroPendentes = false; }}
			>
				<p class="text-2xl font-bold text-surface-500">{totais.ignorados}</p>
				<p class="text-xs text-surface-500 mt-1 font-medium">🔕 Ignorados</p>
			</button>
		</div>
	{/if}

	<!-- Filtros -->
	<div class="p-4 sm:p-5 mb-4 rounded-2xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20 flex flex-col gap-4">

		<div class="flex flex-wrap gap-2 items-center">
			<span class="text-sm font-semibold text-surface-600 dark:text-surface-300 mr-1">Regime:</span>
			{#each [['todos','Todos'],['plantao','Plantão'],['expediente','Expediente'],['fds','FDS']] as [val, label]}
				<button
					class="btn btn-sm {filtroRegime === val ? 'preset-filled-primary-500' : 'preset-outlined-surface'}"
					onclick={() => { filtroRegime = val as typeof filtroRegime; mostrarIgnorados = false; }}
				>{label}</button>
			{/each}
		</div>

		<div class="flex flex-col sm:flex-row gap-3 items-start sm:items-center w-full">
			<label class="label flex-1">
				<span class="label-text text-sm font-semibold mb-1">Seccional</span>
				<select class="select" bind:value={filtroSeccional}>
					<option value="todas">Todas as seccionais</option>
					{#each seccionais as sec (sec.id)}
						<option value={sec.id}>{sec.nome}</option>
					{/each}
				</select>
			</label>
			
			<label class="label flex-1">
				<span class="label-text text-sm font-semibold mb-1">Unidade</span>
				<select class="select" bind:value={filtroUnidade}>
					<option value="">Todas as unidades</option>
					{#each unidadesDropdown as u}
						<option value={u}>{u}</option>
					{/each}
				</select>
			</label>

			{#if !mostrarIgnorados}
				<label class="flex items-center gap-2 cursor-pointer mt-4 sm:mt-5">
					<input type="checkbox" class="checkbox" bind:checked={filtroPendentes} />
					<span class="text-sm font-medium">Apenas pendências</span>
				</label>
			{/if}

			{#if mostrarIgnorados}
				<button class="btn btn-sm preset-outlined-surface mt-4 sm:mt-5" onclick={() => { mostrarIgnorados = false; filtroPendentes = true; }}>
					← Voltar para pendências
				</button>
			{/if}
		</div>
	</div>

	<!-- Modo ignorados: banner informativo -->
	{#if mostrarIgnorados}
		<div class="mb-4 p-3 rounded-xl bg-surface-500/10 border border-surface-500/20 text-sm text-surface-600 dark:text-surface-400 flex items-center gap-2">
			<svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
			Exibindo itens ignorados. Para restaurar, clique em <strong>Restaurar</strong> na linha correspondente.
		</div>
	{/if}

	<!-- Tabela -->
	<div class="rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20 p-4 sm:p-5">
		{#if loading}
			<p class="text-center py-16 text-surface-500">Carregando...</p>
		{:else if dadosFiltrados.length === 0}
			<div class="text-center py-20">
				<p class="text-4xl mb-4">{mostrarIgnorados ? '🔕' : '🎉'}</p>
				<p class="text-surface-600 dark:text-surface-400 text-lg font-semibold">
					{mostrarIgnorados ? 'Nenhum item ignorado' : 'Nenhuma pendência encontrada!'}
				</p>
				<p class="text-surface-500 text-sm mt-1">
					{mostrarIgnorados ? 'Você não ignorou nenhuma pendência.' : 'Todas as escalas estão em dia com os filtros selecionados.'}
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
							<th class="text-right">Ações</th>
						</tr>
					</thead>
					<tbody>
						{#each dadosFiltrados as item (item.unidade_nome + item.tipo_regime + item.data_inicio)}
							<tr class="{ignorados.has(chaveIgnorado(item)) ? 'opacity-50' : ''}">
								<td class="font-medium max-w-[220px] truncate">{item.unidade_nome}</td>
								<td>
									{#if item.tipo_regime === 'plantao'}
										<span class="badge preset-filled-tertiary-500/20 text-tertiary-900 dark:text-tertiary-200 border border-tertiary-500/30 text-xs font-bold">Plantão</span>
									{:else if item.tipo_regime === 'expediente'}
										<span class="badge preset-filled-primary-500/20 text-primary-900 dark:text-primary-200 border border-primary-500/30 text-xs font-bold">Expediente</span>
									{:else}
										<span class="badge preset-filled-warning-500/20 text-warning-900 dark:text-warning-200 border border-warning-500/30 text-xs font-bold">FDS</span>
									{/if}
								</td>
								<td class="text-sm text-surface-600 dark:text-surface-300 whitespace-nowrap">{item.periodo}</td>
								<td>
									{#if item.status === 'ok'}
										<span class="badge preset-filled-success-500 text-white text-xs font-bold px-2">✅ Em dia</span>
									{:else if item.status === 'nao_assinada'}
										<span class="badge bg-warning-500/15 text-warning-700 dark:text-warning-300 border border-warning-500/30 text-xs font-bold px-2">🟡 Não Assinada</span>
									{:else}
										<span class="badge bg-error-500/15 text-error-700 dark:text-error-300 border border-error-500/30 text-xs font-bold px-2">🔴 Não Criada</span>
									{/if}
								</td>
								<td>
									<div class="flex gap-2 justify-end">
										{#if mostrarIgnorados}
											<button class="btn btn-sm preset-outlined-surface" onclick={() => restaurarItem(item)}>Restaurar</button>
										{:else}
											{#if item.status === 'nao_criada'}
												<span class="text-xs italic text-surface-500">Pendente de criação</span>
											{/if}
											<button
												class="btn btn-sm preset-outlined-surface opacity-60 hover:opacity-100"
												title="Ignorar esta pendência"
												onclick={() => ignorarItem(item)}
											>🔕</button>
										{/if}
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<!-- Mobile cards -->
			<div class="md:hidden divide-y divide-surface-200 dark:divide-white/5">
				{#each dadosFiltrados as item (item.unidade_nome + item.tipo_regime + item.data_inicio)}
					<div class="p-4 flex items-center justify-between gap-3 {ignorados.has(chaveIgnorado(item)) ? 'opacity-50' : ''}">
						<div class="min-w-0">
							<p class="font-semibold text-sm truncate">{item.unidade_nome}</p>
							<div class="flex items-center gap-2 mt-1 flex-wrap">
								{#if item.tipo_regime === 'plantao'}
									<span class="badge preset-filled-tertiary-500/20 text-tertiary-900 dark:text-tertiary-200 border border-tertiary-500/30 text-[10px] font-bold px-1.5">Plantão</span>
								{:else if item.tipo_regime === 'expediente'}
									<span class="badge preset-filled-primary-500/20 text-primary-900 dark:text-primary-200 border border-primary-500/30 text-[10px] font-bold px-1.5">Expediente</span>
								{:else}
									<span class="badge preset-filled-warning-500/20 text-warning-900 dark:text-warning-200 border border-warning-500/30 text-[10px] font-bold px-1.5">FDS</span>
								{/if}
								<span class="text-xs text-surface-500">{item.periodo}</span>
							</div>
							<div class="mt-1.5">
								{#if item.status === 'ok'}
									<span class="text-xs text-success-600 dark:text-success-400 font-bold">✅ Em dia</span>
								{:else if item.status === 'nao_assinada'}
									<span class="text-xs text-warning-600 dark:text-warning-400 font-bold">🟡 Não Assinada</span>
								{:else}
									<span class="text-xs text-error-600 dark:text-error-400 font-bold">🔴 Não Criada</span>
								{/if}
							</div>
						</div>
						<div class="flex flex-col gap-1.5 shrink-0 items-end">
							{#if mostrarIgnorados}
								<button class="btn btn-sm preset-outlined-surface text-xs" onclick={() => restaurarItem(item)}>Restaurar</button>
							{:else}
								{#if item.status === 'nao_criada'}
									<span class="text-[10px] italic text-surface-500">Pendente</span>
								{/if}
								<button class="btn btn-sm preset-outlined-surface text-xs opacity-60" onclick={() => ignorarItem(item)}>🔕 Ignorar</button>
							{/if}
						</div>
					</div>
				{/each}
			</div>

			<p class="pt-3 text-surface-500 text-sm border-t border-surface-200 dark:border-white/5 mt-1">
				{dadosFiltrados.length} item(ns) exibido(s)
			</p>
		{/if}
	</div>
{/if}
