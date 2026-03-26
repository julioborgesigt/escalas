<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { toaster } from '$lib/toast';
	import { Dialog, Popover, Portal } from '@skeletonlabs/skeleton-svelte';
	import { browser } from '$app/environment';
	import type { EscalaListagem, Unidade } from '$lib/types';


	let escalas = $state<EscalaListagem[]>([]);
	let loading = $state(true);
	let saving = $state(false);
	let unidades = $state<Unidade[]>([]);
	
	// Recuperar filtros do localStorage (apenas no navegador)
	const KEY = 'filtros_escalas';
	const saved = browser ? JSON.parse(localStorage.getItem(KEY) || '{}') : {};

	let filtroLotacao = $state(saved.lotacao || '');
	let filtroMes = $state(saved.mes !== undefined ? saved.mes : new Date().getMonth() + 1);
	let filtroAno = $state(saved.ano || new Date().getFullYear());
	let filtroTipo = $state(saved.tipo || 'todos');
	let filtroSeccional = $state<number | 'todas'>(saved.seccional || 'todas');

	// Salvar filtros no localStorage a cada mudança
	$effect(() => {
		if (browser) {
			localStorage.setItem(KEY, JSON.stringify({
				lotacao: filtroLotacao,
				mes: filtroMes,
				ano: filtroAno,
				tipo: filtroTipo,
				seccional: filtroSeccional
			}));
		}
	});




	const seccionais = $derived(unidades.filter(u => u.tipo === 'seccional'));
	const delegaciasDropdown = $derived(
		filtroSeccional === 'todas'
			? unidades.filter(u => u.tipo === 'delegacia')
			: unidades.filter(u => u.tipo === 'delegacia' && u.seccional_id === filtroSeccional)
	);

	let dialogOpen = $state(false);
	let dialogRevogarOpen = $state(false);
	let escalaParaExcluir = $state<{id: number, titulo: string} | null>(null);
	let escalaParaRevogar = $state<{id: number, titulo: string} | null>(null);

	const isAdmin = $derived(page.data.usuario?.tipo === 'admin');

	const meses = [
		{ value: 0, label: 'Todos' },
		{ value: 1, label: 'Janeiro' }, { value: 2, label: 'Fevereiro' }, { value: 3, label: 'Março' },
		{ value: 4, label: 'Abril' }, { value: 5, label: 'Maio' }, { value: 6, label: 'Junho' },
		{ value: 7, label: 'Julho' }, { value: 8, label: 'Agosto' }, { value: 9, label: 'Setembro' },
		{ value: 10, label: 'Outubro' }, { value: 11, label: 'Novembro' }, { value: 12, label: 'Dezembro' }
	];
	const anos = [0, ...Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 1 + i)];

	function formatarData(dateStr: string): string {
		const [year, month, day] = dateStr.split('-');
		return `${day}/${month}/${year}`;
	}

	async function carregar() {
		if (isAdmin && !filtroLotacao) {
			escalas = [];
			loading = false;
			return;
		}

		loading = true;
		const params = new URLSearchParams();
		if (filtroLotacao && filtroLotacao !== 'todas') {
			params.set('lotacao', filtroLotacao);
		}
		params.set('mes', filtroMes.toString());
		params.set('ano', filtroAno.toString());
		if (filtroTipo !== 'todos') {
			params.set('tipo', filtroTipo);
		}
		
		const res = await fetch(`/api/escalas?${params.toString()}`);
		escalas = await res.json();
		loading = false;
	}

	async function carregarUnidades() {
		const res = await fetch('/api/unidades');
		unidades = await res.json();
	}

	function solicitarExclusao(id: number, titulo: string) {
		escalaParaExcluir = { id, titulo };
		dialogOpen = true;
	}

	async function confirmarExclusao() {
		if (!escalaParaExcluir) return;
		
		const id = escalaParaExcluir.id;
		const titulo = escalaParaExcluir.titulo;
		dialogOpen = false;

		const res = await fetch(`/api/escalas?id=${id}`, { method: 'DELETE' });
		if (res.ok) {
			toaster.create({ title: `Escala de ${titulo} removida`, type: 'success' });
			escalas = escalas.filter(e => e.id !== id);
		} else {
			toaster.create({ title: 'Erro ao remover', type: 'error' });
		}
		escalaParaExcluir = null;
	}

	function limparFiltros() {
		filtroSeccional = 'todas';
		filtroLotacao = 'todas';
		filtroMes = new Date().getMonth() + 1;
		filtroAno = new Date().getFullYear();
		filtroTipo = 'todos';
		carregar();
	}

	function solicitarEdicao(esc: EscalaListagem) {
		if (esc.is_assinada) {
			escalaParaRevogar = { id: esc.id, titulo: esc.titulo };
			dialogRevogarOpen = true;
		} else {
			goto(`/escalas/${esc.id}`);
		}
	}

	async function confirmarRevogacao() {
		if (!escalaParaRevogar) return;
		const id = escalaParaRevogar.id;
		dialogRevogarOpen = false;

		const res = await fetch(`/api/escalas/${id}/documento-assinado`, { method: 'DELETE' });
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
		filtroMes !== (new Date().getMonth() + 1) ||
		filtroAno !== (new Date().getFullYear()) ||
		filtroTipo !== 'todos'
	);

	let paginaAtual = $state(1);
	const itensPorPagina = 10;
	const totalPaginas = $derived(Math.max(1, Math.ceil(escalas.length / itensPorPagina)));
	const escalasPaginadas = $derived(escalas.slice((paginaAtual - 1) * itensPorPagina, paginaAtual * itensPorPagina));

	$effect(() => {
		carregar();
		carregarUnidades();
		// Resetar para página 1 ao mudar filtros
		if (filtroMes || filtroAno || filtroTipo || filtroLotacao) {
			paginaAtual = 1;
		}
	});

</script>

<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
	<h1 class="h1 text-xl font-bold">Arquivo</h1>
	<div class="flex items-center gap-2">
		<button 
			class="btn btn-sm {temFiltros ? 'preset-filled-warning-500' : 'preset-outlined-primary-500 opacity-40'}" 
			onclick={limparFiltros}
			disabled={!temFiltros && !loading}
		>
			Limpar filtros
		</button>
		<a href="/escalas/nova" class="btn btn-sm preset-filled-primary-500">Nova Escala</a>
	</div>
</div>


<Dialog open={dialogOpen} onOpenChange={(e) => dialogOpen = e.open}>
	<Dialog.Content class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm">
		<div class="card p-6 max-w-sm w-full bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10">
			<Dialog.Title class="h3 font-bold mb-2">Excluir Escala?</Dialog.Title>
			<Dialog.Description class="text-surface-600 dark:text-surface-400 mb-6">
				Tem certeza que deseja excluir a escala "{escalaParaExcluir?.titulo}"? Esta ação não pode ser desfeita.
			</Dialog.Description>
			<div class="flex justify-end gap-3">
				<Dialog.CloseTrigger class="btn preset-outlined-surface">Cancelar</Dialog.CloseTrigger>
				<button class="btn preset-filled-error-500" onclick={confirmarExclusao}>Excluir</button>
			</div>
		</div>
	</Dialog.Content>
</Dialog>

<Dialog open={dialogRevogarOpen} onOpenChange={(e) => dialogRevogarOpen = e.open}>
	<Dialog.Content class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm">
		<div class="card p-6 max-w-md w-full bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10">
			<Dialog.Title class="h3 font-bold mb-2">Editar Escala Assinada?</Dialog.Title>
			<Dialog.Description class="space-y-4 mb-6">
				<p class="text-surface-600 dark:text-surface-400">
					Esta escala já possui uma <strong>assinatura digital</strong> válida. Ao editá-la, a assinatura atual será <span class="text-error-500 font-bold underline">revogada</span> (removida).
				</p>
				<p class="text-surface-500 text-sm">
					Se você deseja apenas visualizar a escala oficial, utilize a opção <strong>Exportar</strong> ou clique no título da escala.
				</p>
			</Dialog.Description>
			<div class="flex justify-end gap-3">
				<Dialog.CloseTrigger class="btn preset-outlined-surface">Voltar</Dialog.CloseTrigger>
				<button class="btn preset-filled-error-500" onclick={confirmarRevogacao}>Revogar e Editar</button>
			</div>
		</div>
	</Dialog.Content>
</Dialog>

<div class="p-6 rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20 overflow-hidden mt-6">
	<div class="flex flex-col md:flex-row md:items-end gap-4 mb-8 p-6 rounded-2xl bg-surface-100/30 dark:bg-surface-800/20 border border-surface-200 dark:border-white/5">
		{#if isAdmin}
			<label class="label flex-1 max-w-sm">
				<span class="label-text font-semibold mb-1">Seccional</span>
				<select class="select" bind:value={filtroSeccional} onchange={() => { filtroLotacao = ''; carregar(); }}>
					<option value="todas">Todas as Seccionais</option>
					{#each seccionais as sec (sec.id)}
						<option value={sec.id}>{sec.nome}</option>
					{/each}
				</select>
			</label>

			<label class="label flex-1 max-w-sm">
				<span class="label-text font-semibold mb-1">Unidade de Lotação</span>
				<select class="select" bind:value={filtroLotacao} onchange={carregar}>
					<option value="">Selecione uma unidade...</option>
					<option value="todas">Todas as unidades</option>
					{#each delegaciasDropdown as del (del.id)}
						<option value={del.nome}>{del.nome}</option>
					{/each}
				</select>
			</label>
		{/if}

		<div class="flex flex-[2] gap-4">
			<label class="label flex-1">
				<span class="label-text font-semibold mb-1">Tipo</span>
				<select class="select" bind:value={filtroTipo} onchange={carregar}>
					<option value="todos">Todos</option>
					<option value="plantao">Plantão</option>
					<option value="expediente">Expediente</option>
					<option value="fds">Final de Semana</option>
				</select>
			</label>

			<label class="label flex-1">
				<span class="label-text font-semibold mb-1">Mês</span>
				<select class="select" bind:value={filtroMes} onchange={carregar}>
					{#each meses as mes}
						<option value={mes.value}>{mes.label}</option>
					{/each}
				</select>
			</label>

			<label class="label flex-1">
				<span class="label-text font-semibold mb-1">Ano</span>
				<select class="select" bind:value={filtroAno} onchange={carregar}>
					{#each anos as ano}
						<option value={ano}>{ano === 0 ? 'Todos' : ano}</option>
					{/each}
				</select>
			</label>
		</div>
	</div>

	{#if loading}
		<p class="text-center py-12 text-surface-500">Carregando...</p>
	{:else if isAdmin && !filtroLotacao}
		<div class="text-center py-20">
			<div class="bg-surface-200/50 dark:bg-surface-800/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 grayscale opacity-50">
				<svg class="w-8 h-8 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
			</div>
			<p class="text-surface-600 dark:text-surface-400 text-lg">Escolha uma unidade para exibir os dados.</p>
		</div>
	{:else if escalas.length === 0}
		<div class="text-center py-12 text-surface-500">
			<p class="mb-4">Nenhuma escala criada para os filtros selecionados.</p>
			<a href="/escalas/nova" class="btn preset-filled-primary-500">Criar Escala</a>
		</div>
	{:else}
		<!-- Desktop: tabela -->
		<div class="hidden md:block table-wrap">
			<table class="table">
				<thead>
					<tr>
						<th>Título</th>
						<th>Cidade</th>
						<th>Período</th>
						<th>Horário</th>
						<th>Status</th>
						<th>Ações</th>
					</tr>
				</thead>
				<tbody>
					{#each escalasPaginadas as esc (esc.id)}
						<tr>

							<td><a href="/escalas/{esc.id}" class="anchor">{esc.titulo}</a></td>
							<td>{esc.cidade}</td>
							<td class="whitespace-nowrap">{formatarData(esc.data_inicio)} a {formatarData(esc.data_fim)}</td>
							<td>{esc.horario}</td>
							<td>
								{#if esc.is_assinada}
									<span class="badge preset-filled-success-500 font-bold px-2 py-1 flex items-center gap-1 w-max shadow-sm">
										<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
										Assinada
									</span>
								{:else}
									<span class="badge preset-tonal-warning font-bold px-2 py-1 flex items-center gap-1 w-max shadow-sm">
										<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
										Pendente
									</span>
								{/if}
							</td>
							<td>
								<div class="flex gap-2 justify-end">
									<button 
										class="btn btn-sm {esc.is_assinada ? 'preset-filled-warning-500' : 'preset-outlined-primary-500'}"
										onclick={() => solicitarEdicao(esc)}
									>
										{esc.is_assinada ? 'Editar' : 'Abrir'}
									</button>
									<Popover positioning={{ placement: "bottom-end", offset: { mainAxis: 4 } }}>
										<Popover.Trigger class="btn btn-sm preset-outlined-primary-500">Exportar ▾</Popover.Trigger>
										<Portal>
											<Popover.Positioner class="z-50">
												<Popover.Content class="card p-1 bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-white/10 shadow-xl flex flex-col min-w-[160px]">
													{#if esc.is_assinada}
														<button class="w-full text-left px-4 py-2 text-sm font-bold text-success-600 dark:text-success-400 rounded hover:bg-success-500/10 transition-colors flex items-center gap-2" onclick={() => window.open(`/api/escalas/${esc.id}/documento-assinado`, '_blank')}>
															<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
															PDF Oficial
														</button>
														<hr class="opacity-10 my-1" />
													{/if}
													<button class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors" onclick={() => window.open(`/api/escalas/${esc.id}/download?format=docx`, '_blank')}>Word (.docx)</button>
													<button class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors" onclick={() => window.open(`/api/escalas/${esc.id}/download?format=odt`, '_blank')}>ODT (.odt)</button>
													<button class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors" onclick={() => window.open(`/api/escalas/${esc.id}/download?format=excel`, '_blank')}>Excel (.xlsx)</button>
													<button class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors" onclick={() => window.open(`/api/escalas/${esc.id}/download?format=ods`, '_blank')}>ODS (.ods)</button>
													<button class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors" onclick={() => window.open(`/api/escalas/${esc.id}/download?format=pdf`, '_blank')}>PDF (.pdf)</button>
												</Popover.Content>
											</Popover.Positioner>
										</Portal>
									</Popover>
									<button class="btn btn-sm preset-filled-error-500" onclick={() => solicitarExclusao(esc.id, esc.titulo)}>Excluir</button>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Mobile: cards -->
		<div class="md:hidden space-y-3">
			{#each escalasPaginadas as esc (esc.id)}
				<div class="p-4 rounded-2xl bg-surface-100/50 dark:bg-surface-800/50 border border-surface-200 dark:border-white/10 hover:border-primary-500/30 transition-colors">

					<div class="flex justify-between items-start mb-3 gap-2">
						<a href="/escalas/{esc.id}" class="anchor font-semibold text-sm block text-primary-600 dark:text-primary-400 no-underline hover:text-primary-500 dark:hover:text-primary-300">{esc.titulo}</a>
						{#if esc.is_assinada}
							<span class="badge preset-filled-success-500 font-bold px-1.5 py-0.5 text-[0.65rem] rounded flex items-center gap-1 shadow-sm"><svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg> Assinada</span>
						{:else}
							<span class="badge preset-tonal-warning font-bold px-1.5 py-0.5 text-[0.65rem] rounded flex items-center gap-1 shadow-sm"><svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> Pendente</span>
						{/if}
					</div>
					<div class="space-y-1 mb-3 text-sm">
						<div class="flex justify-between">
							<span class="text-surface-500 font-medium">Cidade</span>
							<span class="text-surface-900 dark:text-surface-100">{esc.cidade}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-surface-500 font-medium">Período</span>
							<span class="text-surface-900 dark:text-surface-100">{formatarData(esc.data_inicio)} a {formatarData(esc.data_fim)}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-surface-500 font-medium">Horário</span>
							<span class="text-surface-900 dark:text-surface-100">{esc.horario}</span>
						</div>
					</div>
					<div class="flex gap-2 pt-3 border-t border-white/5">
						<button 
							class="btn btn-sm {esc.is_assinada ? 'preset-filled-warning-500' : 'preset-outlined-primary-500'} flex-1"
							onclick={() => solicitarEdicao(esc)}
						>
							{esc.is_assinada ? 'Editar' : 'Abrir'}
						</button>
						<Popover positioning={{ placement: "bottom-end", offset: { mainAxis: 4 } }}>
							<Popover.Trigger class="btn btn-sm preset-outlined-primary-500 hover:bg-primary-500/10">Exportar ▾</Popover.Trigger>
							<Portal>
								<Popover.Positioner class="z-50">
									<Popover.Content class="card p-1 bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-white/10 shadow-xl flex flex-col min-w-[160px]">
										{#if esc.is_assinada}
											<button class="w-full text-left px-4 py-2 text-sm font-bold text-success-600 dark:text-success-400 rounded hover:bg-success-500/10 transition-colors flex items-center gap-2" onclick={() => window.open(`/api/escalas/${esc.id}/documento-assinado`, '_blank')}>
												<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
												PDF Oficial
											</button>
											<hr class="opacity-10 my-1" />
										{/if}
										<button class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors" onclick={() => window.open(`/api/escalas/${esc.id}/download?format=docx`, '_blank')}>Word (.docx)</button>
										<button class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors" onclick={() => window.open(`/api/escalas/${esc.id}/download?format=odt`, '_blank')}>ODT (.odt)</button>
										<button class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors" onclick={() => window.open(`/api/escalas/${esc.id}/download?format=excel`, '_blank')}>Excel (.xlsx)</button>
										<button class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors" onclick={() => window.open(`/api/escalas/${esc.id}/download?format=ods`, '_blank')}>ODS (.ods)</button>
										<button class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors" onclick={() => window.open(`/api/escalas/${esc.id}/download?format=pdf`, '_blank')}>PDF (.pdf)</button>
									</Popover.Content>
								</Popover.Positioner>
							</Portal>
						</Popover>
						<button class="btn btn-sm preset-filled-error-500 hover:-translate-y-0.5 transition-all" onclick={() => solicitarExclusao(esc.id, esc.titulo)}>Excluir</button>
					</div>
				</div>
			{/each}
		</div>
		<div class="mt-6 pt-6 border-t border-surface-200 dark:border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4">
			<p class="text-surface-500 text-sm">
				Mostrando <strong>{(paginaAtual - 1) * itensPorPagina + 1}-{Math.min(paginaAtual * itensPorPagina, escalas.length)}</strong> de <strong>{escalas.length}</strong> escala(s)
			</p>
			
			{#if totalPaginas > 1}
				<div class="flex items-center gap-2">
					<button 
						class="btn btn-sm preset-outlined-surface" 
						onclick={() => { paginaAtual--; window.scrollTo({top: 0, behavior: 'smooth'}); }} 
						disabled={paginaAtual === 1}
					>
						Anterior
					</button>
					
					<div class="flex items-center gap-1">
						{#each Array.from({length: totalPaginas}, (_, i) => i + 1) as p}
							{#if totalPaginas <= 5 || p === 1 || p === totalPaginas || (p >= paginaAtual - 1 && p <= paginaAtual + 1)}
								<button 
									class="btn btn-sm {paginaAtual === p ? 'preset-filled-primary-500' : 'preset-outlined-surface'} min-w-[32px]"
									onclick={() => { paginaAtual = p; window.scrollTo({top: 0, behavior: 'smooth'}); }}
								>
									{p}
								</button>
							{:else if (p === 2 && paginaAtual > 3) || (p === totalPaginas - 1 && paginaAtual < totalPaginas - 2)}
								<span class="px-1 opacity-50">...</span>
							{/if}
						{/each}
					</div>

					<button 
						class="btn btn-sm preset-outlined-surface" 
						onclick={() => { paginaAtual++; window.scrollTo({top: 0, behavior: 'smooth'}); }} 
						disabled={paginaAtual >= totalPaginas}
					>
						Próxima
					</button>
				</div>
			{/if}
		</div>

	{/if}
</div>
