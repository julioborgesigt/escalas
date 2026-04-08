<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import { browser } from '$app/environment';
	import { Popover, Portal, Dialog } from '@skeletonlabs/skeleton-svelte';
	import type { EscalaListagem, Unidade } from '$lib/types';
	import Spinner from '$lib/components/Spinner.svelte';
	import PaginationControls from '$lib/components/PaginationControls.svelte';
	import { useAutorizacao, getSavedFilters } from '$lib/composables';

	let { data } = $props();

	const { isAdmin } = useAutorizacao();

	let escalas = $derived(data.escalas as EscalaListagem[]);
	let unidades = $derived(data.unidades as Unidade[]);

	// Filtros com persistência
	const KEY = 'filtros_recebidos';
	const defaults = {
		timeRange: 'todos' as const,
		seccional: '',
		unidade: '',
		data: '',
		naoLidos: true
	};
	const saved = getSavedFilters(KEY, defaults);

	let filtroTimeRange = $state<'24h' | '48h' | 'semana' | 'mes' | 'todos'>(saved.timeRange);
	let filtroSeccional = $state(saved.seccional);
	let filtroUnidade = $state(saved.unidade);
	let filtroData = $state(saved.data);
	let mostrarApenasNaoVistos = $state(saved.naoLidos);

	// Salvar a cada mudança
	$effect(() => {
		if (browser) {
			localStorage.setItem(
				KEY,
				JSON.stringify({
					timeRange: filtroTimeRange,
					seccional: filtroSeccional,
					unidade: filtroUnidade,
					data: filtroData,
					naoLidos: mostrarApenasNaoVistos
				})
			);
		}
	});

	const unidadesArray = $derived(Array.isArray(unidades) ? unidades : []);
	const unidadeParaSeccionalId = $derived(
		new Map(unidadesArray.map((u) => [u.nome, u.seccional_id]))
	);
	const seccionais = $derived(unidadesArray.filter((u) => u.tipo === 'seccional'));

	const escalasFiltradas = $derived(
		(Array.isArray(escalas) ? escalas : []).filter((e) => {
			if (filtroSeccional) {
				const sId = unidadeParaSeccionalId.get(e.lotacao);
				if (sId !== Number(filtroSeccional)) return false;
			}
			if (filtroUnidade && !e.lotacao.toLowerCase().includes(filtroUnidade.toLowerCase()))
				return false;
			if (filtroData && !e.data_inicio.includes(filtroData)) return false;
			if (mostrarApenasNaoVistos && e.visto_por_admin) return false;
			return true;
		})
	);

	async function recarregar() {
		await invalidateAll();
	}

	let togglingId = $state<number | null>(null);

	function handleToggleVisto(escala: EscalaListagem) {
		return function({ formData, cancel }: any) {
			if (togglingId === escala.id) { cancel(); return; }
			const novoStatus = !escala.visto_por_admin;
			formData.set('visto', String(novoStatus));
			escala.visto_por_admin = novoStatus ? 1 : 0;
			togglingId = escala.id;
			return async ({ result, update }: any) => {
				togglingId = null;
				if (result.type === 'success') {
					await update({ reset: false });
				} else {
					escala.visto_por_admin = novoStatus ? 0 : 1;
					toaster.create({ title: 'Erro ao atualizar status', type: 'error' });
				}
			};
		};
	}

	let paginaAtual = $state(1);
	const itensPorPagina = 10;
	const totalPaginas = $derived(Math.max(1, Math.ceil(escalasFiltradas.length / itensPorPagina)));
	const escalasRecebidasPaginadas = $derived(
		escalasFiltradas.slice((paginaAtual - 1) * itensPorPagina, paginaAtual * itensPorPagina)
	);

	$effect(() => {
		if (filtroTimeRange || filtroUnidade || filtroData || mostrarApenasNaoVistos) {
			paginaAtual = 1;
		}
	});

	// Helper para formatar data de criação
	function formatRelativeTime(dateStr: string) {
		const date = new Date(dateStr.replace(' ', 'T'));
		return date.toLocaleString('pt-BR', {
			day: '2-digit',
			month: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function getMesExtenso(dataStr: string) {
		const data = new Date(dataStr + 'T00:00:00');
		return data.toLocaleString('pt-BR', { month: 'long' }).toUpperCase();
	}

	let dialogOpen = $state(false);
	let escalaParaExcluir = $state<{ id: number; lotacao: string } | null>(null);
	let excluindo = $state(false);

	function solicitarExclusao(id: number, lotacao: string) {
		escalaParaExcluir = { id, lotacao };
		dialogOpen = true;
	}

	function limparFiltros() {
		filtroSeccional = '';
		filtroUnidade = '';
		filtroData = '';
		filtroTimeRange = 'todos';
		mostrarApenasNaoVistos = true;
		recarregar();
	}

	const temFiltros = $derived(
		filtroSeccional !== '' ||
			filtroUnidade !== '' ||
			filtroData !== '' ||
			filtroTimeRange !== 'todos' ||
			mostrarApenasNaoVistos !== true
	);

	function handleExcluir() {
		excluindo = true;
		return async ({ result }: { result: any }) => {
			excluindo = false;
			if (result.type === 'success') {
				toaster.create({ title: 'Escala removida com sucesso', type: 'success' });
				await invalidateAll();
				dialogOpen = false;
				escalaParaExcluir = null;
			} else {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error || 'Erro ao remover escala'), type: 'error' });
			}
		};
	}
</script>

<svelte:head>
	<title>Cx. de Entrada | Admin</title>
</svelte:head>

{#if !isAdmin}
	<div class="text-center py-32 text-surface-500">
		<p class="text-2xl mb-2">🔒</p>
		<p>Acesso restrito a administradores.</p>
	</div>
{:else}
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
		<div>
			<h1 class="h1 text-xl font-bold">Cx. de Entrada</h1>
			<p class="text-sm text-surface-500 mt-0.5">Acompanhamento de novos envios em tempo real</p>
		</div>
		<div class="flex gap-2">
			<button
				class="btn btn-sm {temFiltros
					? 'preset-filled-warning-500'
					: 'preset-outlined-primary-500 opacity-40'}"
				onclick={limparFiltros}
				disabled={!temFiltros}
			>
				Limpar filtros
			</button>
			<button class="btn preset-outlined-primary-500 btn-sm" onclick={recarregar}>
				<svg class="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
					/>
				</svg>
				Atualizar
			</button>
		</div>
	</div>

	<!-- Filtros Rápidos -->
	<div
		class="p-4 sm:p-5 mb-4 rounded-2xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20 flex flex-col gap-4"
	>
		<div class="flex flex-wrap gap-2 items-center">
			<span class="text-sm font-semibold text-surface-600 dark:text-surface-300 mr-1"
				>Período de Recebimento:</span
			>
			{#each [['todos', 'Tudo'], ['24h', 'Últimas 24h'], ['48h', 'Últimas 48h'], ['semana', 'Última Semana'], ['mes', 'Último Mês']] as [val, label]}
				<button
					class="btn btn-sm {filtroTimeRange === val
						? 'preset-filled-primary-500'
						: 'preset-tonal-surface ring-1 ring-surface-300 dark:ring-surface-600'}"
					onclick={() => {
						filtroTimeRange = val as typeof filtroTimeRange;
						recarregar();
					}}>{label}</button
				>
			{/each}
		</div>

		<div class="flex flex-col sm:flex-row gap-4 items-end w-full">
			<label class="label sm:w-60">
				<span class="label-text text-sm font-semibold mb-1">Seccional</span>
				<select class="select" bind:value={filtroSeccional}>
					<option value="">Todas</option>
					{#each seccionais as s (s.id)}
						<option value={s.id}>{s.nome}</option>
					{/each}
				</select>
			</label>

			<label class="label flex-1 min-w-0 sm:min-w-[400px]">
				<span class="label-text text-sm font-semibold mb-1">Unidade</span>
				<div class="relative">
					<svg
						class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-surface-400"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
						/></svg
					>
					<input
						type="text"
						class="input pl-10"
						bind:value={filtroUnidade}
						placeholder="Buscar por unidade..."
					/>
				</div>
			</label>

			<div class="flex items-center gap-4 pb-3 sm:pl-3">
				<label class="flex items-center gap-2 cursor-pointer">
					<input
						type="checkbox"
						class="checkbox"
						checked={!filtroUnidade}
						onchange={(e) => {
							if (e.currentTarget.checked) filtroUnidade = '';
						}}
					/>
					<span class="text-sm font-medium whitespace-nowrap">Todas</span>
				</label>

				<label class="flex items-center gap-2 cursor-pointer">
					<input type="checkbox" class="checkbox" bind:checked={mostrarApenasNaoVistos} />
					<span class="text-sm font-medium whitespace-nowrap">Não lidas</span>
				</label>
			</div>
		</div>
	</div>

	<!-- Tabela de Cx. de Entrada -->
	<div
		class="rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20 p-4 sm:p-5"
	>
		{#if escalasFiltradas.length === 0}
			<div class="text-center py-20 px-4">
				<p class="text-4xl mb-4">📥</p>
				<p class="text-surface-600 dark:text-surface-400 text-lg font-semibold">
					Nenhum recebimento encontrado
				</p>
				<p class="text-surface-500 text-sm mt-1">
					Tente ajustar os filtros acima para visualizar mais escalas.
				</p>
			</div>
		{:else}
			<!-- Desktop table -->
			<div class="hidden md:block table-wrap overflow-hidden rounded-xl">
				<table class="table">
					<thead>
						<tr>
							<th class="w-10 !text-center">Visto</th>
							<th class="!text-center">Unidade</th>
							<th class="!text-center">Mês</th>
							<th class="!text-center">Tipo</th>
							<th class="!text-center">Recebido em</th>
							<th class="!text-center">Ações</th>
						</tr>
					</thead>
					<tbody>
						{#each escalasRecebidasPaginadas as escala (escala.id)}
							<tr
								class={escala.visto_por_admin ? 'opacity-60 grayscale-[0.5]' : 'bg-primary-500/5'}
							>
								<td class="text-center">
									<form method="POST" action="?/toggleVisto" use:enhance={handleToggleVisto(escala)} class="contents">
										<input type="hidden" name="escala_id" value={escala.id} />
										<input
											type="checkbox"
											class="checkbox mx-auto"
											disabled={togglingId === escala.id}
											checked={!!escala.visto_por_admin}
											onchange={(e) => e.currentTarget.closest('form')?.requestSubmit()}
										/>
									</form>
								</td>
								<td class="font-bold text-sm text-center">{escala.lotacao}</td>
								<td class="text-center">
									<span class="text-sm font-medium">{getMesExtenso(escala.data_inicio)}</span>
								</td>
								<td class="text-center">
									{#if escala.tipo === 'plantao'}
										<span
											class="badge preset-filled-tertiary-500/20 text-tertiary-900 dark:text-tertiary-200 border border-tertiary-500/30 text-[10px] font-bold"
											>Plantão</span
										>
									{:else if escala.tipo === 'expediente'}
										<span
											class="badge preset-filled-primary-500/20 text-primary-900 dark:text-primary-200 border border-primary-500/30 text-[10px] font-bold"
											>Expediente</span
										>
									{:else if escala.tipo === 'fds'}
										<span
											class="badge preset-filled-warning-500/20 text-warning-900 dark:text-warning-200 border border-warning-500/30 text-[10px] font-bold"
											>FDS</span
										>
									{/if}
								</td>
								<td class="text-xs text-surface-500 whitespace-nowrap text-center">
									{formatRelativeTime(escala.created_at)}
								</td>
								<td>
									<div class="flex gap-2 justify-center items-center">
										<a
											href="/escalas/{escala.id}"
											class="btn btn-sm preset-outlined-primary-500 text-xs"
											title="Ver Detalhes"
										>
											<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"
												><path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
												/><path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
												/></svg
											>
										</a>

										{#if escala.is_assinada}
											<a
												href="/api/escalas/{escala.id}/documento-assinado"
												class="btn btn-sm preset-filled-success-500 text-xs font-bold"
												target="_blank"
											>
												<svg
													class="w-4 h-4 mr-1"
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
												Baixar
											</a>
										{/if}

										<Popover positioning={{ placement: 'bottom-end', offset: { mainAxis: 4 } }}>
											<Popover.Trigger
												class="btn btn-sm preset-outlined-primary-500 text-xs font-bold"
												>Exportar ▾</Popover.Trigger
											>
											<Portal>
												<Popover.Positioner class="z-50">
													<Popover.Content
														class="card p-1 bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-white/10 shadow-xl flex flex-col min-w-[160px]"
													>
														<a
															class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
															href={`/api/escalas/${escala.id}/download?format=docx`}
															target="_blank">Word (.docx)</a
														>
														<a
															class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
															href={`/api/escalas/${escala.id}/download?format=odt`}
															target="_blank">ODT (.odt)</a
														>
														<a
															class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
															href={`/api/escalas/${escala.id}/download?format=xlsx`}
															target="_blank">Excel (.xlsx)</a
														>
														<a
															class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
															href={`/api/escalas/${escala.id}/download?format=ods`}
															target="_blank">ODS (.ods)</a
														>
														<a
															class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
															href={`/api/escalas/${escala.id}/download?format=pdf`}
															target="_blank">PDF (.pdf)</a
														>
													</Popover.Content>
												</Popover.Positioner>
											</Portal>
										</Popover>

										<button
											class="btn btn-sm preset-filled-error-500 text-xs"
											title="Excluir"
											onclick={() => solicitarExclusao(escala.id, escala.lotacao)}
										>
											<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"
												><path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
												/></svg
											>
										</button>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<!-- Mobile cards -->
			<div class="md:hidden space-y-3">
				{#each escalasRecebidasPaginadas as escala (escala.id)}
					<div
						class="p-4 rounded-2xl bg-surface-100/50 dark:bg-surface-800/50 border {escala.visto_por_admin
							? 'border-surface-200 dark:border-white/5 opacity-70'
							: 'border-primary-500/30 bg-primary-500/5'} transition-all"
					>
						<div class="flex items-start justify-between gap-3 mb-2">
							<div class="min-w-0">
								<p class="font-bold text-sm truncate">{escala.lotacao}</p>
								<p class="text-xs text-surface-500 font-medium">
									{getMesExtenso(escala.data_inicio)}
								</p>
							</div>
							<label class="flex flex-col items-center gap-1 shrink-0">
								<span class="text-[10px] uppercase font-bold text-surface-500">Lida</span>
								<form method="POST" action="?/toggleVisto" use:enhance={handleToggleVisto(escala)} class="contents">
									<input type="hidden" name="escala_id" value={escala.id} />
									<input
										type="checkbox"
										class="checkbox checkbox-sm"
										disabled={togglingId === escala.id}
										checked={!!escala.visto_por_admin}
										onchange={(e) => e.currentTarget.closest('form')?.requestSubmit()}
									/>
								</form>
							</label>
						</div>

						<div class="flex items-center gap-2 mb-3">
							{#if escala.tipo === 'plantao'}
								<span
									class="badge preset-filled-tertiary-500/20 text-tertiary-900 dark:text-tertiary-200 border border-tertiary-500/30 text-[10px] font-bold px-1.5"
									>Plantão</span
								>
							{:else if escala.tipo === 'expediente'}
								<span
									class="badge preset-filled-primary-500/20 text-primary-900 dark:text-primary-200 border border-primary-500/30 text-[10px] font-bold px-1.5"
									>Expediente</span
								>
							{:else if escala.tipo === 'fds'}
								<span
									class="badge preset-filled-warning-500/20 text-warning-900 dark:text-warning-200 border border-warning-500/30 text-[10px] font-bold px-1.5"
									>FDS</span
								>
							{/if}
							<span class="text-[11px] text-surface-500"
								>{formatRelativeTime(escala.created_at)}</span
							>
						</div>

						<div class="flex flex-wrap gap-2 pt-3 border-t border-surface-200 dark:border-white/5">
							<a
								href="/escalas/{escala.id}"
								class="btn btn-sm preset-outlined-primary-500 flex-1 text-xs">Detalhes</a
							>

							{#if escala.is_assinada}
								<a
									href="/api/escalas/{escala.id}/documento-assinado"
									class="btn btn-sm preset-filled-success-500 flex-1 text-xs"
									target="_blank">Baixar</a
								>
							{/if}

							<Popover positioning={{ placement: 'bottom', offset: { mainAxis: 4 } }}>
								<Popover.Trigger
									class="btn btn-sm preset-outlined-primary-500 w-full text-xs font-bold"
									>Exportar ▾</Popover.Trigger
								>
								<Portal>
									<Popover.Positioner class="z-50">
										<Popover.Content
											class="card p-1 bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-white/10 shadow-xl flex flex-col min-w-[200px]"
										>
											<a
												class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
												href={`/api/escalas/${escala.id}/download?format=docx`}
												target="_blank">Word (.docx)</a
											>
											<a
												class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
												href={`/api/escalas/${escala.id}/download?format=odt`}
												target="_blank">ODT (.odt)</a
											>
											<a
												class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
												href={`/api/escalas/${escala.id}/download?format=xlsx`}
												target="_blank">Excel (.xlsx)</a
											>
											<a
												class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
												href={`/api/escalas/${escala.id}/download?format=ods`}
												target="_blank">ODS (.ods)</a
											>
											<a
												class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
												href={`/api/escalas/${escala.id}/download?format=pdf`}
												target="_blank">PDF (.pdf)</a
											>
										</Popover.Content>
									</Popover.Positioner>
								</Portal>
							</Popover>

							<button
								class="btn btn-sm preset-filled-error-500 flex-1 text-xs font-bold"
								onclick={() => solicitarExclusao(escala.id, escala.lotacao)}>Excluir</button
							>
						</div>
					</div>
				{/each}
			</div>

			<PaginationControls
				{paginaAtual}
				{totalPaginas}
				totalItens={escalasFiltradas.length}
				{itensPorPagina}
				labelSingular="escala recebida"
				labelPlural="escala(s) recebida(s)"
				onPageChange={(p) => (paginaAtual = p)}
			/>
		{/if}
	</div>
{/if}

<Dialog open={dialogOpen} onOpenChange={(e) => (dialogOpen = e.open)}>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm"
	>
		<div
			class="card p-6 max-w-sm w-full bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10"
		>
			<Dialog.Title class="h3 font-bold mb-2">Excluir Escala?</Dialog.Title>
			<Dialog.Description class="text-surface-600 dark:text-surface-400 mb-6">
				Tem certeza que deseja excluir esta escala de <strong>{escalaParaExcluir?.lotacao}</strong>?
				Esta ação não pode ser desfeita e removerá permanentemente o registro e o arquivo assinado.
			</Dialog.Description>
			<div class="flex justify-end gap-3">
				<Dialog.CloseTrigger class="btn preset-outlined-surface" disabled={excluindo}
					>Cancelar</Dialog.CloseTrigger
				>
				<form method="POST" action="?/excluir" use:enhance={handleExcluir} class="contents">
					<input type="hidden" name="escala_id" value={escalaParaExcluir?.id} />
					<button type="submit" class="btn preset-filled-error-500 flex items-center gap-2" disabled={excluindo}>
						{#if excluindo}<Spinner size="sm" />{/if}
						{excluindo ? 'Excluindo...' : 'Excluir'}
					</button>
				</form>
			</div>
		</div>
	</Dialog.Content>
</Dialog>
