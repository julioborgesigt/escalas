<script lang="ts">
	import { goto } from '$app/navigation';
	import { navigating } from '$app/state';
	import { page } from '$app/state';
	import SkeletonCard from '$lib/components/SkeletonCard.svelte';
	import { apiFetchResponse } from '$lib/api-fetch';
	import { baixarBlob, nomeArquivoContentDisposition } from '$lib/utils/download';
	import { loading } from '$lib/loading.svelte';
	import { toaster } from '$lib/toast';
	import { slide } from 'svelte/transition';
	import { Popover, Portal, Pagination } from '@skeletonlabs/skeleton-svelte';
	import { ChevronLeft, ChevronRight } from 'lucide-svelte';
	import { statusLabel, statusColor, fmtDate, diaSemana } from '$lib/gise/gise-formatters';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { CICLOS, getCicloRange } from '$lib/gise/gise-ciclos';

	/**
	 * Bloco "Histórico" da lista `/gise`: escalas finalizadas, com filtros
	 * (seccional, mês, ciclo ou data exata), paginação e — para o Admin Geral —
	 * exportação em XLSX/PDF do recorte filtrado.
	 */
	const {
		historico,
		seccionaisList,
		isAdminGeral
	}: {
		historico: {
			id: number;
			data_inicio: string;
			status: string;
			hora_entrada?: string;
			hora_saida?: string;
			seccionais?: { id: number; tipos?: string[]; nome?: string }[];
		}[];
		seccionaisList: { id: number; nome: string }[];
		isAdminGeral: boolean;
	} = $props();

	/** "2026-07" — o histórico já abre filtrado pelo mês corrente. */
	function getCurrentMonth() {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
	}

	let filtroSeccional = $state<number | ''>('');
	let filtroMesAno = $state(getCurrentMonth());
	let filtroAnoCiclo = $state<number | ''>('');
	let filtroNumeroCiclo = $state<number | ''>('');
	let filtroData = $state('');
	let mostrarFiltrosHistorico = $state(false);
	let paginaHistorico = $state(1);

	const ITEMS_POR_PAGINA = 5;

	const anosDisponiveisHistorico = $derived(
		([...new Set(historico.map((e) => Number(e.data_inicio.slice(0, 4))))] as number[]).sort(
			(a, b) => b - a
		)
	);

	// Precedência dos filtros de tempo: data exata > mês > ciclo. Os três campos
	// ficam visíveis ao mesmo tempo, então o mais específico é quem manda.
	const historicoFiltrado = $derived(
		historico.filter((e) => {
			if (
				filtroSeccional !== '' &&
				!(e.seccionais ?? []).some((sec) => sec.id === Number(filtroSeccional))
			)
				return false;
			if (filtroData) {
				if ((e.data_inicio as string) !== filtroData) return false;
			} else if (filtroMesAno && !e.data_inicio.startsWith(filtroMesAno)) return false;
			else if (!filtroMesAno && !filtroData && filtroAnoCiclo !== '' && filtroNumeroCiclo !== '') {
				const { inicio, fim } = getCicloRange(Number(filtroAnoCiclo), Number(filtroNumeroCiclo));
				if ((e.data_inicio as string) < inicio || (e.data_inicio as string) > fim) return false;
			}
			return true;
		})
	);

	// Exportar exige um recorte de tempo: sem isso o arquivo traria a base inteira.
	const podeExportarHistorico = $derived(
		isAdminGeral &&
			(!!filtroMesAno || (filtroAnoCiclo !== '' && filtroNumeroCiclo !== '') || !!filtroData)
	);

	const historicoFiltroMesAtivo = $derived(!!filtroMesAno);
	const historicoFiltroCicloAtivo = $derived(filtroAnoCiclo !== '' && filtroNumeroCiclo !== '');
	const historicoFiltroDataAtivo = $derived(!!filtroData);

	const historicoExportSlug = $derived(
		filtroMesAno
			? filtroMesAno.replace('-', '')
			: filtroData
				? `d${filtroData.replace(/-/g, '')}`
				: filtroAnoCiclo !== '' && filtroNumeroCiclo !== ''
					? `c${filtroNumeroCiclo}_a${filtroAnoCiclo}`
					: 'export'
	);

	function buildHistoricoExportHref(format: 'xlsx' | 'pdf'): string {
		const p = new SvelteURLSearchParams();
		p.set('format', format);
		if (filtroSeccional !== '') p.set('seccionalId', String(filtroSeccional));
		if (filtroMesAno) {
			p.set('periodo', 'mes');
			p.set('mesAno', filtroMesAno);
		} else if (filtroAnoCiclo !== '' && filtroNumeroCiclo !== '') {
			p.set('periodo', 'ciclo');
			p.set('ano', String(filtroAnoCiclo));
			p.set('ciclo', String(filtroNumeroCiclo));
		} else if (filtroData) {
			p.set('periodo', 'data');
			p.set('data', filtroData);
		}
		return `/api/gise/historico/export?${p.toString()}`;
	}

	async function baixarHistoricoArquivo(format: 'xlsx' | 'pdf') {
		const fallbackName = `gise_historico_${historicoExportSlug}.${format}`;
		const url = buildHistoricoExportHref(format);
		loading.show('Preparando download…');
		try {
			const res = await apiFetchResponse(url);
			const fileName = nomeArquivoContentDisposition(
				res.headers.get('Content-Disposition'),
				fallbackName
			);
			baixarBlob(await res.blob(), fileName);
			toaster.success({ title: 'Download iniciado' });
		} catch (err) {
			toaster.error({
				title: 'Falha no download',
				description: err instanceof Error ? err.message : String(err)
			});
		} finally {
			loading.hide();
		}
	}

	function onMesAnoHistoricoInput(e: Event & { currentTarget: HTMLInputElement }) {
		filtroMesAno = e.currentTarget.value;
		if (filtroMesAno) {
			filtroAnoCiclo = '';
			filtroNumeroCiclo = '';
			filtroData = '';
		}
	}

	function onAnoCicloHistoricoMudou() {
		if (filtroAnoCiclo === '') {
			filtroNumeroCiclo = '';
			return;
		}
		filtroMesAno = '';
		filtroData = '';
	}

	function onDataEspecificaHistoricoInput(e: Event & { currentTarget: HTMLInputElement }) {
		filtroData = e.currentTarget.value;
		if (filtroData) {
			filtroMesAno = '';
			filtroAnoCiclo = '';
			filtroNumeroCiclo = '';
		}
	}

	function limparFiltrosHistorico() {
		filtroSeccional = '';
		filtroMesAno = '';
		filtroAnoCiclo = '';
		filtroNumeroCiclo = '';
		filtroData = '';
	}

	const totalPaginasHistorico = $derived(
		Math.max(1, Math.ceil(historicoFiltrado.length / ITEMS_POR_PAGINA))
	);
	const historicoPaginado = $derived(
		historicoFiltrado.slice(
			(paginaHistorico - 1) * ITEMS_POR_PAGINA,
			paginaHistorico * ITEMS_POR_PAGINA
		)
	);

	$effect(() => {
		void [filtroSeccional, filtroMesAno, filtroAnoCiclo, filtroNumeroCiclo, filtroData];
		paginaHistorico = 1;
	});
</script>

{#if isAdminGeral && historico.length > 0}
	<div class="space-y-2">
		<div class="flex items-center justify-between gap-2">
			<h2 class="text-base font-semibold text-surface-700 dark:text-surface-300">Histórico</h2>
			<button
				type="button"
				class="inline-flex items-center gap-1.5 rounded-xl border border-surface-300/80 bg-white px-3 py-1.5 text-xs font-semibold text-surface-700 shadow-sm transition-all hover:border-primary-400/50 hover:bg-primary-500/5 dark:border-surface-600/80 dark:bg-surface-800 dark:text-surface-200 dark:hover:bg-surface-700/80 {mostrarFiltrosHistorico
					? 'border-primary-500/50 bg-primary-500/5 dark:border-primary-500/40 dark:bg-primary-500/10'
					: ''}"
				onclick={() => (mostrarFiltrosHistorico = !mostrarFiltrosHistorico)}
				aria-expanded={mostrarFiltrosHistorico}
			>
				<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
					/>
				</svg>
				Filtros
				{#if filtroSeccional !== '' || filtroMesAno || filtroAnoCiclo !== '' || filtroNumeroCiclo !== '' || filtroData}
					<span class="h-1.5 w-1.5 rounded-full bg-primary-500"></span>
				{/if}
			</button>
		</div>

		{#if mostrarFiltrosHistorico}
			<div class="card-glass overflow-hidden rounded-2xl" transition:slide={{ duration: 250 }}>
				<div
					class="border-b border-surface-200/90 bg-white/60 px-4 py-3 dark:border-surface-800 dark:bg-surface-950/40 sm:px-5"
				>
					<p
						class="text-xs font-bold uppercase tracking-wide text-surface-600 dark:text-surface-400"
					>
						Filtrar histórico
					</p>
				</div>

				<div class="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3 sm:p-5">
					<div
						class="flex min-h-0 flex-col gap-2 rounded-xl border p-3.5 shadow-sm transition-all sm:p-4 {filtroSeccional !==
						''
							? 'border-primary-500/45 bg-primary-500/[0.07] ring-1 ring-primary-500/20 dark:bg-primary-500/10'
							: 'border-surface-200/90 bg-white/90 dark:border-surface-700 dark:bg-surface-900/50'}"
					>
						<label
							for="filtro-seccional"
							class="text-xs font-bold uppercase tracking-wide text-surface-600 dark:text-surface-300"
							>Seccional</label
						>
						<select
							id="filtro-seccional"
							bind:value={filtroSeccional}
							class="min-h-[2.75rem] w-full cursor-pointer rounded-xl border border-surface-300 bg-white px-2.5 py-2 text-sm font-medium text-surface-800 shadow-sm transition-colors hover:border-primary-400/55 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/25 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-100"
						>
							<option value="">Todas</option>
							{#each seccionaisList as sec (sec.id)}
								<option value={sec.id}>{sec.nome}</option>
							{/each}
						</select>
					</div>

					<div
						class="flex min-h-0 flex-col gap-2 rounded-xl border p-3.5 shadow-sm transition-all sm:p-4 {historicoFiltroMesAtivo
							? 'border-primary-500/45 bg-primary-500/[0.07] ring-1 ring-primary-500/20 dark:bg-primary-500/10'
							: 'border-surface-200/90 bg-white/90 dark:border-surface-700 dark:bg-surface-900/50'}"
					>
						<label
							for="filtro-mes-ano"
							class="text-xs font-bold uppercase tracking-wide text-surface-600 dark:text-surface-300"
							>Mês / ano</label
						>
						<input
							id="filtro-mes-ano"
							type="month"
							value={filtroMesAno}
							oninput={onMesAnoHistoricoInput}
							class="w-full min-h-[2.75rem] cursor-pointer rounded-xl border border-surface-300 bg-white px-3 py-2.5 text-sm font-medium text-surface-800 transition-colors hover:border-primary-400/55 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/25 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-100"
						/>
					</div>

					<div
						class="flex min-h-0 min-w-0 flex-col gap-2 rounded-xl border p-3.5 shadow-sm transition-all sm:p-4 {historicoFiltroCicloAtivo
							? 'border-primary-500/45 bg-primary-500/[0.07] ring-1 ring-primary-500/20 dark:bg-primary-500/10'
							: 'border-surface-200/90 bg-white/90 dark:border-surface-700 dark:bg-surface-900/50'}"
					>
						<span
							class="text-xs font-bold uppercase tracking-wide text-surface-600 dark:text-surface-300"
							>Ano / ciclo</span
						>
						<div class="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[5.5rem_1fr]">
							<select
								id="filtro-ano-ciclo"
								bind:value={filtroAnoCiclo}
								onchange={onAnoCicloHistoricoMudou}
								class="min-h-[2.75rem] w-full cursor-pointer rounded-xl border border-surface-300 bg-white px-2.5 py-2 text-sm font-medium text-surface-800 shadow-sm transition-colors hover:border-primary-400/55 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/25 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-100 sm:w-[5.5rem]"
							>
								<option value="">Ano</option>
								{#each anosDisponiveisHistorico as ano (ano)}
									<option value={ano}>{ano}</option>
								{/each}
							</select>
							<select
								bind:value={filtroNumeroCiclo}
								disabled={filtroAnoCiclo === ''}
								onchange={onAnoCicloHistoricoMudou}
								class="min-h-[2.75rem] min-w-0 w-full cursor-pointer rounded-xl border border-surface-300 bg-white px-2.5 py-2 text-sm font-medium text-surface-800 shadow-sm transition-colors hover:border-primary-400/55 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/25 disabled:cursor-not-allowed disabled:opacity-45 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-100"
							>
								<option value="">Ciclo</option>
								{#each CICLOS as c (c.n)}
									<option value={c.n}>{c.label}</option>
								{/each}
							</select>
						</div>
					</div>

					<div
						class="flex min-h-0 flex-col gap-2 rounded-xl border p-3.5 shadow-sm transition-all sm:p-4 {historicoFiltroDataAtivo
							? 'border-primary-500/45 bg-primary-500/[0.07] ring-1 ring-primary-500/20 dark:bg-primary-500/10'
							: 'border-surface-200/90 bg-white/90 dark:border-surface-700 dark:bg-surface-900/50'}"
					>
						<label
							for="filtro-data-especifica"
							class="text-xs font-bold uppercase tracking-wide text-surface-600 dark:text-surface-300"
							>Data específica</label
						>
						<input
							id="filtro-data-especifica"
							type="date"
							value={filtroData}
							oninput={onDataEspecificaHistoricoInput}
							class="w-full min-h-[2.75rem] cursor-pointer rounded-xl border border-surface-300 bg-white px-3 py-2.5 text-sm font-medium text-surface-800 transition-colors hover:border-primary-400/55 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/25 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-100"
						/>
					</div>
				</div>

				<div
					class="flex flex-wrap items-center justify-between gap-3 border-t border-surface-200/90 bg-surface-100/70 px-4 py-3.5 dark:border-surface-800 dark:bg-surface-950/50 sm:px-5"
				>
					<p
						class="inline-flex items-center gap-2 rounded-lg border border-surface-200/90 bg-white px-2.5 py-1.5 text-xs font-semibold text-surface-600 shadow-sm dark:border-surface-700 dark:bg-surface-900 dark:text-surface-300"
					>
						<span class="font-black tabular-nums text-primary-600 dark:text-primary-400"
							>{historicoFiltrado.length}</span
						>
						<span class="text-surface-500 dark:text-surface-400">resultado(s)</span>
					</p>
					<div class="flex flex-wrap items-center gap-2 sm:gap-3">
						{#if isAdminGeral}
							<Popover positioning={{ placement: 'top-end' }}>
								<Popover.Trigger
									class="inline-flex items-center gap-1.5 rounded-xl border-2 border-primary-500 bg-primary-500/10 px-3.5 py-2 text-xs font-bold text-primary-700 shadow-sm transition-all hover:bg-primary-500/18 dark:border-primary-400 dark:bg-primary-500/15 dark:text-primary-200 dark:hover:bg-primary-500/25 disabled:cursor-not-allowed disabled:border-surface-300 disabled:bg-surface-100 disabled:text-surface-400 disabled:shadow-none dark:disabled:border-surface-600 dark:disabled:bg-surface-800 dark:disabled:text-surface-500"
									disabled={!podeExportarHistorico}
									title={podeExportarHistorico
										? 'Exportar lista filtrada'
										: 'Selecione mês/ano, ano/ciclo ou data específica para habilitar'}
								>
									Baixar
									<svg
										class="h-3.5 w-3.5 opacity-80"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
										aria-hidden="true"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M19 9l-7 7-7-7"
										/>
									</svg>
								</Popover.Trigger>
								<Portal>
									<Popover.Positioner>
										<Popover.Content
											class="z-30 min-w-[11rem] overflow-hidden rounded-xl border border-surface-200 bg-white py-1 shadow-xl dark:border-surface-600 dark:bg-surface-800"
										>
											<button
												type="button"
												class="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold text-surface-800 hover:bg-surface-100 dark:text-surface-100 dark:hover:bg-surface-700"
												onclick={() => baixarHistoricoArquivo('xlsx')}
											>
												<span
													class="rounded bg-success-500/15 px-1.5 py-0.5 text-3xs font-black text-success-700 dark:text-success-400"
													>XLSX</span
												>
												Planilha
											</button>
											<button
												type="button"
												class="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold text-surface-800 hover:bg-surface-100 dark:text-surface-100 dark:hover:bg-surface-700"
												onclick={() => baixarHistoricoArquivo('pdf')}
											>
												<span
													class="rounded bg-error-500/15 px-1.5 py-0.5 text-3xs font-black text-error-700 dark:text-error-400"
													>PDF</span
												>
												Documento
											</button>
										</Popover.Content>
									</Popover.Positioner>
								</Portal>
							</Popover>
						{/if}
						{#if filtroSeccional !== '' || filtroMesAno || filtroAnoCiclo !== '' || filtroNumeroCiclo !== '' || filtroData}
							<button
								type="button"
								class="text-xs font-semibold text-primary-600 underline-offset-2 hover:underline dark:text-primary-400"
								onclick={limparFiltrosHistorico}
							>
								Limpar filtros
							</button>
						{/if}
					</div>
				</div>
			</div>
		{/if}

		<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
			{#if navigating?.to && navigating.to.url.pathname === page.url.pathname}
				{#each { length: 6 } as _, i (i)}
					<SkeletonCard lines={2} hasFooter={false} />
				{/each}
			{:else if historicoPaginado.length === 0}
				<div
					class="col-span-full rounded-2xl border border-dashed border-surface-300 dark:border-surface-700 bg-surface-50/50 dark:bg-surface-900/50 p-8 text-center flex flex-col items-center justify-center gap-3"
				>
					<div
						class="w-12 h-12 rounded-full bg-surface-200/50 dark:bg-surface-800/50 flex items-center justify-center mb-1"
					>
						<svg
							class="w-6 h-6 text-surface-400 dark:text-surface-500"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.5"
								d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
							/>
						</svg>
					</div>
					<p class="text-sm font-semibold text-surface-700 dark:text-surface-300">
						Nenhum resultado encontrado
					</p>
					<p
						class="text-xs text-surface-500 dark:text-surface-400 max-w-xs mx-auto leading-relaxed"
					>
						Não encontramos escalas para os filtros aplicados. Tente alterar o mês, ano ou
						seccional.
					</p>
					{#if filtroSeccional !== '' || filtroMesAno || filtroAnoCiclo !== '' || filtroNumeroCiclo !== '' || filtroData}
						<button
							type="button"
							class="mt-2 text-xs font-semibold text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 hover:underline transition-colors"
							onclick={limparFiltrosHistorico}
						>
							Limpar todos os filtros
						</button>
					{/if}
				</div>
			{:else}
				{#each historicoPaginado as escala (escala.id)}
					<!-- Mesmo fundo/borda/sombra do CardGiseAtiva: o histórico usava
					     bg-surface-50 e ficava acinzentado ao lado dos cards ativos. -->
					<div
						class="rounded-2xl border border-surface-200 dark:border-white/5 bg-white/80 dark:bg-surface-900/60 backdrop-blur-md shadow-sm transition-all duration-200 hover:border-primary-500/40 hover:shadow-md dark:hover:border-primary-400/20"
					>
						<div class="flex flex-col gap-2 px-3 py-3 xs:flex-row xs:items-center xs:gap-2 sm:px-4">
							<button
								type="button"
								class="flex-1 min-w-0 flex items-center justify-between gap-2 sm:gap-3 text-left"
								onclick={() => goto(`/gise/${escala.id}`)}
							>
								<div class="min-w-0">
									<p class="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">
										{diaSemana(escala.data_inicio)}, {fmtDate(escala.data_inicio)}
										<span class="ml-1 opacity-50 font-normal">#{escala.id}</span>
									</p>
									<p class="text-xs text-surface-500 mt-0.5">
										{escala.hora_entrada} às {escala.hora_saida}
									</p>
								</div>
								<span
									class="text-3xs sm:text-xs px-2 py-0.5 rounded-full font-semibold shrink-0 text-center leading-tight {statusColor(
										escala.status
									)}"
								>
									{statusLabel(escala.status)}
								</span>
							</button>

							<div
								class="flex items-center gap-1 shrink-0 border-t pt-2 border-surface-200 dark:border-surface-700 xs:border-t-0 xs:border-l xs:pt-0 xs:pl-2 xs:ml-1 justify-end"
							>
								<a
									href="/api/gise/{escala.id}/download?format=pdf"
									download
									title="Baixar escala assinada (PDF)"
									aria-label="Baixar escala assinada (PDF)"
									class="inline-flex items-center justify-center w-9 h-9 sm:w-8 sm:h-8 rounded-lg text-surface-500 hover:bg-primary-500/10 hover:text-primary-600 transition-colors touch-manipulation"
									onclick={(e) => e.stopPropagation()}
								>
									<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
										/>
									</svg>
								</a>

								<Popover positioning={{ placement: 'bottom-end' }}>
									<Popover.Trigger
										class="inline-flex items-center justify-center w-9 h-9 sm:w-8 sm:h-8 rounded-lg text-surface-500 hover:bg-success-500/10 hover:text-success-600 transition-colors touch-manipulation"
										title="Baixar relatório de produtividade"
										aria-label="Baixar relatório de produtividade"
									>
										<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
											/>
										</svg>
									</Popover.Trigger>
									<Portal>
										<Popover.Positioner>
											<Popover.Content
												class="z-30 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl shadow-xl p-1.5 w-56 max-w-[calc(100vw-1.5rem)] sm:min-w-[200px] sm:w-auto"
											>
												<p
													class="text-3xs font-bold uppercase text-surface-500 dark:text-surface-400 px-2 pt-1 pb-1.5 tracking-wider"
												>
													Produtividade por seccional
												</p>
												{#each escala.seccionais ?? [] as sec (sec.id)}
													{#each sec.tipos ?? ['operacional'] as tipo (tipo)}
														<a
															href="/api/gise/{escala.id}/download?format=produtividade&seccionalId={sec.id}&equipeType={tipo}"
															download
															class="flex items-center gap-2 px-2 py-2 rounded-lg text-xs text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors touch-manipulation"
														>
															<svg
																class="w-3 h-3 shrink-0 text-success-500"
																fill="none"
																viewBox="0 0 24 24"
																stroke="currentColor"
															>
																<path
																	stroke-linecap="round"
																	stroke-linejoin="round"
																	stroke-width="2"
																	d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
																/>
															</svg>
															<span class="truncate"
																>{sec.nome} — {tipo === 'seint' ? 'SEINT' : 'Operacional'}</span
															>
														</a>
													{/each}
												{/each}
											</Popover.Content>
										</Popover.Positioner>
									</Portal>
								</Popover>

								<Popover positioning={{ placement: 'bottom-end' }}>
									<Popover.Trigger
										class="inline-flex items-center justify-center w-9 h-9 sm:w-8 sm:h-8 rounded-lg text-surface-500 hover:bg-warning-500/10 hover:text-warning-600 transition-colors touch-manipulation"
										title="Baixar relatório de extra assinado"
										aria-label="Baixar relatório de extra assinado"
									>
										<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
											/>
										</svg>
									</Popover.Trigger>
									<Portal>
										<Popover.Positioner>
											<Popover.Content
												class="z-30 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl shadow-xl p-1.5 w-56 max-w-[calc(100vw-1.5rem)] sm:min-w-[200px] sm:w-auto"
											>
												<p
													class="text-3xs font-bold uppercase text-surface-500 dark:text-surface-400 px-2 pt-1 pb-1.5 tracking-wider"
												>
													Extra por seccional
												</p>
												{#each escala.seccionais ?? [] as sec (sec.id)}
													<a
														href="/api/gise/{escala.id}/download?format=extraordinario&seccionalId={sec.id}"
														download
														class="flex items-center gap-2 px-2 py-2 rounded-lg text-xs text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors touch-manipulation"
													>
														<svg
															class="w-3 h-3 shrink-0 text-warning-500"
															fill="none"
															viewBox="0 0 24 24"
															stroke="currentColor"
														>
															<path
																stroke-linecap="round"
																stroke-linejoin="round"
																stroke-width="2"
																d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
															/>
														</svg>
														<span class="truncate">{sec.nome}</span>
													</a>
												{/each}
											</Popover.Content>
										</Popover.Positioner>
									</Portal>
								</Popover>
							</div>
						</div>
					</div>
				{/each}
			{/if}
		</div>

		{#if totalPaginasHistorico > 1}
			<div
				class="mt-3 pt-3 border-t border-surface-200 dark:border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3"
			>
				<span class="text-xs text-surface-500">
					{historicoFiltrado.length} resultado(s) — página {paginaHistorico} de {totalPaginasHistorico}
				</span>
				<Pagination
					count={historicoFiltrado.length}
					pageSize={ITEMS_POR_PAGINA}
					page={paginaHistorico}
					onPageChange={(e) => (paginaHistorico = e.page)}
					siblingCount={1}
				>
					<Pagination.PrevTrigger
						class="btn btn-sm preset-outlined-surface-500"
						aria-label="Página anterior"><ChevronLeft size={16} /></Pagination.PrevTrigger
					>
					<Pagination.Context>
						{#snippet children(pagination)}
							{#each pagination().pages as p, index (p)}
								{#if p.type === 'page'}
									<Pagination.Item
										{...p}
										class="btn btn-sm min-w-[32px] {p.value === paginaHistorico
											? 'preset-filled-primary-500'
											: 'preset-outlined-surface-500'}">{p.value}</Pagination.Item
									>
								{:else}
									<Pagination.Ellipsis {index} class="px-1 opacity-50">&#8230;</Pagination.Ellipsis>
								{/if}
							{/each}
						{/snippet}
					</Pagination.Context>
					<Pagination.NextTrigger
						class="btn btn-sm preset-outlined-surface-500"
						aria-label="Próxima página"><ChevronRight size={16} /></Pagination.NextTrigger
					>
				</Pagination>
			</div>
		{/if}
	</div>
{/if}
