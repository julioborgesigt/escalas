<script lang="ts">
	import type { PageProps } from './$types';
	import { Lock, Inbox } from 'lucide-svelte';
	import { untrack } from 'svelte';
	import { page, navigating } from '$app/state';
	import SkeletonCard from '$lib/components/SkeletonCard.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import { goto, invalidate } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import { browser } from '$app/environment';
	import { Popover, Portal, Dialog } from '@skeletonlabs/skeleton-svelte';
	import type { EscalaListagem, Unidade } from '$lib/types';
	import PaginationControls from '$lib/components/PaginationControls.svelte';
	import { useAutorizacao, getSavedFilters } from '$lib/composables';
	import type { ActionResult } from '@sveltejs/kit';
	import { loading as loadingService } from '$lib/loading.svelte';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';

	const { data }: PageProps = $props();

	const auth = useAutorizacao();
	const isAdmin = $derived(auth.isAdmin);

	const escalas = $derived(data.escalas as EscalaListagem[]);
	const unidades = $derived(data.unidades as Unidade[]);

	// Filtros server-side via URL (?seccional=&unidade=&ano=&mes=&vistos=&page=).
	// A URL é a fonte de verdade — o load pagina e filtra no banco em vez de
	// trafegar todas as escalas assinadas para filtrar no cliente (auditoria de
	// performance, B-2). O localStorage continua persistindo a última escolha e
	// é reaplicado (via replaceState) quando a página abre sem parâmetros.
	const KEY = 'filtros_recebidos';
	const defaults = {
		seccional: '' as number | '',
		unidade: '',
		naoLidos: true,
		ano: 0,
		mes: 0
	};
	const saved = getSavedFilters(KEY, defaults);

	let filtroSeccional = $state<number | ''>(
		untrack(() => Number(page.url.searchParams.get('seccional')) || '')
	);
	let filtroUnidade = $state(untrack(() => page.url.searchParams.get('unidade') ?? ''));
	let filtroAno = $state<number>(untrack(() => Number(page.url.searchParams.get('ano')) || 0));
	let filtroMes = $state<number>(untrack(() => Number(page.url.searchParams.get('mes')) || 0));
	let mostrarApenasNaoVistos = $state(
		untrack(() => page.url.searchParams.get('vistos') !== 'todos')
	);

	// Salvar a cada mudança
	$effect(() => {
		if (browser) {
			localStorage.setItem(
				KEY,
				JSON.stringify({
					seccional: filtroSeccional,
					unidade: filtroUnidade,
					naoLidos: mostrarApenasNaoVistos,
					ano: filtroAno,
					mes: filtroMes
				})
			);
		}
	});

	const unidadesArray = $derived(Array.isArray(unidades) ? unidades : []);
	const seccionais = $derived(unidadesArray.filter((u) => u.tipo === 'seccional'));
	const seccionaisOptions = $derived(seccionais.map((s) => ({ value: s.id, label: s.nome })));

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

	const mesesOptions = meses;
	const anosOptions = $derived(
		anos.map((ano) => ({ value: ano, label: ano === 0 ? 'Todos' : String(ano) }))
	);

	function buildQueryParams(p: number) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const params = new URLSearchParams();
		if (filtroSeccional !== '' && filtroSeccional !== null) {
			params.set('seccional', String(filtroSeccional));
		}
		if (filtroUnidade.trim()) params.set('unidade', filtroUnidade.trim());
		if (filtroAno) params.set('ano', String(filtroAno));
		if (filtroMes) params.set('mes', String(filtroMes));
		if (!mostrarApenasNaoVistos) params.set('vistos', 'todos');
		if (p > 1) params.set('page', String(p));
		return params.toString();
	}

	function navegarComFiltros(p = 1, opts: { replace?: boolean } = {}) {
		const qs = buildQueryParams(p);
		goto(qs ? `?${qs}` : page.url.pathname, {
			keepFocus: true,
			noScroll: true,
			replaceState: opts.replace ?? false
		});
	}

	let mounted = false;
	// svelte-ignore state_referenced_locally
	let prevSeccional = $state(filtroSeccional);
	// svelte-ignore state_referenced_locally
	let prevUnidade = $state(filtroUnidade);
	// svelte-ignore state_referenced_locally
	let prevAno = $state(filtroAno);
	// svelte-ignore state_referenced_locally
	let prevMes = $state(filtroMes);
	// svelte-ignore state_referenced_locally
	let prevNaoVistos = $state(mostrarApenasNaoVistos);
	let unidadeDebounce: ReturnType<typeof setTimeout> | undefined;

	function sincronizarPrev() {
		prevSeccional = filtroSeccional;
		prevUnidade = filtroUnidade;
		prevAno = filtroAno;
		prevMes = filtroMes;
		prevNaoVistos = mostrarApenasNaoVistos;
	}

	$effect(() => {
		// Normaliza null vindo do clear do SearchableSelect
		if (filtroAno === null) filtroAno = 0;
		if (filtroMes === null) filtroMes = 0;
		if (filtroSeccional === null) filtroSeccional = '';

		if (!mounted) {
			mounted = true;
			// Primeira visita sem parâmetros: reaplica os filtros persistidos
			// (comportamento da versão client-side), trocando a URL in-place.
			const savedSeccional = Number(saved.seccional) || '';
			const savedTemFiltros =
				savedSeccional !== '' ||
				saved.unidade !== '' ||
				saved.ano !== 0 ||
				saved.mes !== 0 ||
				saved.naoLidos !== true;
			if (page.url.search === '' && savedTemFiltros) {
				filtroSeccional = savedSeccional;
				filtroUnidade = saved.unidade;
				filtroAno = saved.ano;
				filtroMes = saved.mes;
				mostrarApenasNaoVistos = saved.naoLidos;
				sincronizarPrev();
				untrack(() => navegarComFiltros(1, { replace: true }));
				return;
			}
			sincronizarPrev();
			return;
		}

		const unidadeMudou = filtroUnidade !== prevUnidade;
		const outrosMudaram =
			filtroSeccional !== prevSeccional ||
			filtroAno !== prevAno ||
			filtroMes !== prevMes ||
			mostrarApenasNaoVistos !== prevNaoVistos;
		if (!unidadeMudou && !outrosMudaram) return;

		sincronizarPrev();
		clearTimeout(unidadeDebounce);
		if (unidadeMudou && !outrosMudaram) {
			// Texto livre: espera o usuário parar de digitar antes de ir ao servidor
			unidadeDebounce = setTimeout(() => untrack(() => navegarComFiltros(1)), 350);
		} else {
			untrack(() => navegarComFiltros(1));
		}
	});

	async function recarregar() {
		loadingService.show('Atualizando caixa de entrada...');
		try {
			// Predicado por pathname: o load agora depende da URL COM search params
			// (filtros/página), então o match exato por string não bastaria.
			await invalidate((url) => url.pathname === page.url.pathname);
		} finally {
			loadingService.hide();
		}
	}

	let togglingId = $state<number | null>(null);

	function handleToggleVisto(escala: EscalaListagem) {
		return function ({ formData, cancel }: { formData: FormData; cancel: () => void }) {
			if (togglingId === escala.id) {
				cancel();
				return;
			}
			const novoStatus = !escala.visto_por_admin;
			formData.set('visto', String(novoStatus));
			escala.visto_por_admin = novoStatus ? 1 : 0;
			togglingId = escala.id;
			return async ({
				result,
				update
			}: {
				result: ActionResult;
				update: (opts?: { reset?: boolean }) => Promise<void>;
			}) => {
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

	function solicitarExclusao(id: number, lotacao: string) {
		escalaParaExcluir = { id, lotacao };
		dialogOpen = true;
	}

	function limparFiltros() {
		filtroSeccional = '';
		filtroUnidade = '';
		filtroAno = 0;
		filtroMes = 0;
		mostrarApenasNaoVistos = true;
		// O $effect de filtros detecta a mudança e navega para a URL limpa.
	}

	const temFiltros = $derived(
		filtroSeccional !== '' ||
			filtroUnidade !== '' ||
			filtroAno !== 0 ||
			filtroMes !== 0 ||
			mostrarApenasNaoVistos !== true
	);

	function handleExcluir() {
		loadingService.show('Removendo escala...');
		return async ({ result }: { result: ActionResult }) => {
			loadingService.hide();
			if (result.type === 'success') {
				toaster.create({ title: 'Escala removida com sucesso', type: 'success' });
				await invalidate(page.url.pathname);
				dialogOpen = false;
				escalaParaExcluir = null;
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
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
		<Lock class="w-8 h-8 mx-auto mb-2" aria-hidden="true" />
		<p>Acesso restrito a administradores.</p>
	</div>
{:else}
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
		<div>
			<h1 class="h1 text-2xl font-bold">Cx. de Entrada</h1>
			<p class="text-sm text-surface-500 mt-0.5">Acompanhamento de novos envios em tempo real</p>
		</div>
		<div class="flex gap-2 justify-end w-full sm:w-auto">
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
			<button
				type="button"
				class="btn preset-outlined-primary-500 btn-sm flex items-center gap-1.5"
				onclick={recarregar}
				disabled={loadingService.active}
			>
				{#if loadingService.active}
					Atualizando...
				{:else}
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
						/>
					</svg>
				{/if}
				{loadingService.active ? 'Atualizando...' : 'Atualizar'}
			</button>
		</div>
	</div>

	<!-- Filtros Rápidos -->
	<div class="p-4 sm:p-5 mb-4 rounded-2xl card-glass flex flex-col gap-4">
		<div class="flex flex-col lg:flex-row gap-3 items-stretch lg:items-end w-full">
			<div class="flex flex-col gap-1 w-full lg:w-48">
				<span class="label-text text-sm font-semibold">Seccional</span>
				<SearchableSelect
					options={seccionaisOptions}
					bind:value={filtroSeccional}
					placeholder="Todas"
				/>
			</div>

			<label class="label w-full lg:w-64">
				<span class="label-text text-sm font-semibold mb-1">Unidade</span>
				<div class="relative w-full">
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
						class="input pl-10 w-full"
						bind:value={filtroUnidade}
						placeholder="Buscar por unidade..."
					/>
				</div>
			</label>

			<div class="flex flex-col gap-1 w-full lg:w-28">
				<span class="label-text text-sm font-semibold">Ano</span>
				<SearchableSelect options={anosOptions} bind:value={filtroAno} placeholder="Todos" />
			</div>

			<div class="flex flex-col gap-1 w-full lg:w-36">
				<span class="label-text text-sm font-semibold">Mês</span>
				<SearchableSelect options={mesesOptions} bind:value={filtroMes} placeholder="Todos" />
			</div>

			<div class="flex items-center justify-between sm:justify-start gap-4 pb-2 lg:pb-3 lg:pl-2">
				<label class="flex items-center gap-2 cursor-pointer select-none">
					<input
						type="checkbox"
						class="checkbox"
						checked={!mostrarApenasNaoVistos}
						onchange={() => (mostrarApenasNaoVistos = false)}
					/>
					<span
						class="text-sm font-semibold whitespace-nowrap text-surface-600 dark:text-surface-300"
						>Todas</span
					>
				</label>

				<label class="flex items-center gap-2 cursor-pointer select-none">
					<input
						type="checkbox"
						class="checkbox"
						checked={mostrarApenasNaoVistos}
						onchange={() => (mostrarApenasNaoVistos = true)}
					/>
					<span
						class="text-sm font-semibold whitespace-nowrap text-surface-600 dark:text-surface-300"
						>Não lidas</span
					>
				</label>
			</div>
		</div>
	</div>

	<!-- Tabela de Cx. de Entrada -->
	<div class="rounded-3xl card-glass p-4 sm:p-5">
		{#if escalas.length === 0}
			<div class="text-center py-20 px-4">
				<Inbox class="w-10 h-10 mx-auto mb-4 text-surface-400" aria-hidden="true" />
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
						{#if navigating?.to && navigating.to.url.pathname === page.url.pathname}
							{#each { length: 8 } as _, i (i)}
								<tr class="animate-pulse">
									<td class="px-4 py-3"
										><div
											class="h-4 w-6 rounded bg-surface-200 dark:bg-surface-700 mx-auto"
										></div></td
									>
									<td class="px-4 py-3"
										><div
											class="h-4 w-32 rounded bg-surface-200 dark:bg-surface-700 mx-auto"
										></div></td
									>
									<td class="px-4 py-3"
										><div
											class="h-4 w-24 rounded bg-surface-200 dark:bg-surface-700 mx-auto"
										></div></td
									>
									<td class="px-4 py-3"
										><div
											class="h-6 w-20 rounded-full bg-surface-200 dark:bg-surface-700 mx-auto"
										></div></td
									>
									<td class="px-4 py-3"
										><div
											class="h-4 w-28 rounded bg-surface-200 dark:bg-surface-700 mx-auto"
										></div></td
									>
									<td class="px-4 py-3"
										><div class="flex gap-2 justify-center">
											<div class="h-8 w-16 rounded-lg bg-surface-200 dark:bg-surface-700"></div>
										</div></td
									>
								</tr>
							{/each}
						{:else}
							{#each escalas as escala (escala.id)}
								<tr
									class={escala.visto_por_admin ? 'opacity-60 grayscale-[0.5]' : 'bg-primary-500/5'}
								>
									<td class="text-center">
										<form
											method="POST"
											action="?/toggleVisto"
											use:enhance={handleToggleVisto(escala)}
											class="contents"
										>
											<input type="hidden" name="escala_id" value={escala.id} />
											{#if togglingId === escala.id}
												<Spinner size="sm" class="mx-auto text-primary-500" />
											{:else}
												<input
													type="checkbox"
													class="checkbox mx-auto"
													checked={!!escala.visto_por_admin}
													onchange={(e) => e.currentTarget.closest('form')?.requestSubmit()}
												/>
											{/if}
										</form>
									</td>
									<td class="font-bold text-sm text-center">{escala.lotacao}</td>
									<td class="text-center">
										<span class="text-sm font-medium">{getMesExtenso(escala.data_inicio)}</span>
									</td>
									<td class="text-center">
										{#if escala.tipo === 'plantao'}
											<span
												class="badge preset-filled-tertiary-500/20 text-tertiary-900 dark:text-tertiary-200 border border-tertiary-500/30 text-3xs font-bold"
												>Plantão</span
											>
										{:else if escala.tipo === 'expediente'}
											<span
												class="badge preset-filled-primary-500/20 text-primary-900 dark:text-primary-200 border border-primary-500/30 text-3xs font-bold"
												>Expediente</span
											>
										{:else if escala.tipo === 'fds'}
											<span
												class="badge preset-filled-warning-500/20 text-warning-900 dark:text-warning-200 border border-warning-500/30 text-3xs font-bold"
												>FDS</span
											>
										{/if}
									</td>
									<td
										class="text-xs text-surface-500 whitespace-nowrap text-center font-mono tabular-nums"
									>
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
													class="btn btn-sm preset-filled-success-500 text-xs font-bold transition-all"
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
															class="card p-1 bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-white/10 shadow-xl flex flex-col min-w-[160px] max-w-[calc(100vw-1rem)]"
														>
															<a
																class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
																href={`/api/escalas/${escala.id}/download?format=docx`}
																target="_blank">Word (.docx)</a
															>
															<a
																class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
																href={`/api/escalas/${escala.id}/download?format=xlsx`}
																target="_blank">Excel (.xlsx)</a
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
												type="button"
												class="btn btn-sm preset-filled-error-500 text-xs transition-all"
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
					{#each escalas as escala (escala.id)}
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
									<span class="text-3xs uppercase font-bold text-surface-500">Lida</span>
									<form
										method="POST"
										action="?/toggleVisto"
										use:enhance={handleToggleVisto(escala)}
										class="contents"
									>
										<input type="hidden" name="escala_id" value={escala.id} />
										{#if togglingId === escala.id}
											<Spinner size="xs" class="text-primary-500" />
										{:else}
											<input
												type="checkbox"
												class="checkbox checkbox-sm"
												checked={!!escala.visto_por_admin}
												onchange={(e) => e.currentTarget.closest('form')?.requestSubmit()}
											/>
										{/if}
									</form>
								</label>
							</div>

							<div class="flex items-center gap-2 mb-3">
								{#if escala.tipo === 'plantao'}
									<span
										class="badge preset-filled-tertiary-500/20 text-tertiary-900 dark:text-tertiary-200 border border-tertiary-500/30 text-3xs font-bold px-1.5"
										>Plantão</span
									>
								{:else if escala.tipo === 'expediente'}
									<span
										class="badge preset-filled-primary-500/20 text-primary-900 dark:text-primary-200 border border-primary-500/30 text-3xs font-bold px-1.5"
										>Expediente</span
									>
								{:else if escala.tipo === 'fds'}
									<span
										class="badge preset-filled-warning-500/20 text-warning-900 dark:text-warning-200 border border-warning-500/30 text-3xs font-bold px-1.5"
										>FDS</span
									>
								{/if}
								<span class="text-2xs text-surface-500"
									>{formatRelativeTime(escala.created_at)}</span
								>
							</div>

							<div
								class="flex flex-wrap gap-2 pt-3 border-t border-surface-200 dark:border-white/5"
							>
								<a
									href="/escalas/{escala.id}"
									class="btn btn-sm preset-outlined-primary-500 flex-1 text-xs">Detalhes</a
								>

								{#if escala.is_assinada}
									<a
										href="/api/escalas/{escala.id}/documento-assinado"
										class="btn btn-sm preset-filled-success-500 flex-1 text-xs transition-all"
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
												class="card p-1 bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-white/10 shadow-xl flex flex-col min-w-[200px] max-w-[calc(100vw-1rem)]"
											>
												<a
													class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
													href={`/api/escalas/${escala.id}/download?format=docx`}
													target="_blank">Word (.docx)</a
												>
												<a
													class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
													href={`/api/escalas/${escala.id}/download?format=xlsx`}
													target="_blank">Excel (.xlsx)</a
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
									type="button"
									class="btn btn-sm preset-filled-error-500 flex-1 text-xs font-bold transition-all"
									onclick={() => solicitarExclusao(escala.id, escala.lotacao)}>Excluir</button
								>
							</div>
						</div>
					{/each}
				{/if}
			</div>

			<PaginationControls
				paginaAtual={data.page}
				totalPaginas={data.totalPages}
				totalItens={data.total}
				itensPorPagina={data.limit}
				labelSingular="escala recebida"
				labelPlural="escala(s) recebida(s)"
				onPageChange={(p) => navegarComFiltros(p)}
			/>
		{/if}
	</div>
{/if}

<Dialog open={dialogOpen} onOpenChange={(e) => (dialogOpen = e.open)}>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="card p-4 sm:p-6 max-w-sm w-full max-h-[calc(100dvh-2rem)] overflow-y-auto card-elevated shadow-2xl rounded-2xl"
		>
			<Dialog.Title class="h3 font-bold mb-2">Excluir Escala?</Dialog.Title>
			<Dialog.Description class="text-surface-600 dark:text-surface-400 mb-6">
				Tem certeza que deseja excluir esta escala de <strong>{escalaParaExcluir?.lotacao}</strong>?
				Esta ação não pode ser desfeita e removerá permanentemente o registro e o arquivo assinado.
			</Dialog.Description>
			<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
				<Dialog.CloseTrigger
					class="btn preset-outlined-surface-500"
					disabled={loadingService.active}>Cancelar</Dialog.CloseTrigger
				>
				<form method="POST" action="?/excluir" use:enhance={handleExcluir} class="contents">
					<input type="hidden" name="escala_id" value={escalaParaExcluir?.id} />
					<button
						type="submit"
						class="btn preset-filled-error-500 flex items-center gap-2 transition-all"
						disabled={loadingService.active}
					>
						{loadingService.active ? 'Excluindo...' : 'Excluir'}
					</button>
				</form>
			</div>
		</div>
	</Dialog.Content>
</Dialog>

<style>
	/* Hide scrollbar for Chrome, Safari and Opera */
	:global(.scrollbar-none::-webkit-scrollbar) {
		display: none;
	}
	/* Hide scrollbar for IE, Edge and Firefox */
	:global(.scrollbar-none) {
		-ms-overflow-style: none; /* IE and Edge */
		scrollbar-width: none; /* Firefox */
	}
</style>
