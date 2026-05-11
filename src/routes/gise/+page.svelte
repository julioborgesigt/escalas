<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import { loading } from '$lib/loading.svelte';
	import { useScrollLock } from '$lib/composables';

	let { data } = $props();

	const escalas = $derived(data.escalas ?? []);
	const ativas = $derived(escalas.filter((e: any) => e.status !== 'finalizada'));
	const historico = $derived(escalas.filter((e: any) => e.status === 'finalizada'));
	const papelGise = $derived(data.papelGise);
	const isAdminGeral = $derived(papelGise === 'admin_geral');
	const isSeccional = $derived(papelGise === 'admin_seccional');
	const isSupervisor = $derived(papelGise === 'supervisor');
	const isMembro = $derived(papelGise === 'membro');
	const seccionaisList = $derived(data.seccionaisList ?? []);

	// Paginação Escalas Ativas
	const ITEMS_ATIVAS = 4;
	const ITEMS_POR_PAGINA = 5;
	let paginaAtivas = $state(1);
	const totalPaginasAtivas = $derived(Math.max(1, Math.ceil(ativas.length / ITEMS_ATIVAS)));
	const ativasPaginadas = $derived(ativas.slice((paginaAtivas - 1) * ITEMS_ATIVAS, paginaAtivas * ITEMS_ATIVAS));

	// Filtros Histórico — passo 1: seccional; passo 2: mês/ano, ano/ciclo ou data (exclusivos entre si)
	let filtroSeccional = $state<number | ''>('');
	let filtroMesAno = $state('');
	let filtroAnoCiclo = $state<number | ''>('');
	let filtroNumeroCiclo = $state<number | ''>('');
	let filtroData = $state('');

	const CICLOS = [
		{ n: 1,  label: 'Ciclo 1  (21/Dez – 20/Jan)' },
		{ n: 2,  label: 'Ciclo 2  (21/Jan – 20/Fev)' },
		{ n: 3,  label: 'Ciclo 3  (21/Fev – 20/Mar)' },
		{ n: 4,  label: 'Ciclo 4  (21/Mar – 20/Abr)' },
		{ n: 5,  label: 'Ciclo 5  (21/Abr – 20/Mai)' },
		{ n: 6,  label: 'Ciclo 6  (21/Mai – 20/Jun)' },
		{ n: 7,  label: 'Ciclo 7  (21/Jun – 20/Jul)' },
		{ n: 8,  label: 'Ciclo 8  (21/Jul – 20/Ago)' },
		{ n: 9,  label: 'Ciclo 9  (21/Ago – 20/Set)' },
		{ n: 10, label: 'Ciclo 10 (21/Set – 20/Out)' },
		{ n: 11, label: 'Ciclo 11 (21/Out – 20/Nov)' },
		{ n: 12, label: 'Ciclo 12 (21/Nov – 20/Dez)' }
	];

	const anosDisponiveisHistorico = $derived(
		[...new Set(historico.map((e: any) => Number((e.data_inicio as string).slice(0, 4))))]
			.sort((a, b) => b - a)
	);

	function getCicloRange(ano: number, ciclo: number): { inicio: string; fim: string } {
		if (ciclo === 1) return { inicio: `${ano - 1}-12-21`, fim: `${ano}-01-20` };
		const mI = String(ciclo - 1).padStart(2, '0');
		const mF = String(ciclo).padStart(2, '0');
		return { inicio: `${ano}-${mI}-21`, fim: `${ano}-${mF}-20` };
	}

	const historicoFiltrado = $derived(
		historico.filter((e: any) => {
			if (filtroSeccional !== '' && !(e.seccionais ?? []).some((sec: any) => sec.id === Number(filtroSeccional))) return false;
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

	const podeExportarHistorico = $derived(
		isAdminGeral &&
			(!!filtroMesAno ||
				(filtroAnoCiclo !== '' && filtroNumeroCiclo !== '') ||
				!!filtroData)
	);

	const historicoFiltroMesAtivo = $derived(!!filtroMesAno);
	const historicoFiltroCicloAtivo = $derived(
		filtroAnoCiclo !== '' && filtroNumeroCiclo !== ''
	);
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
		const p = new URLSearchParams();
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

	function nomeArquivoContentDisposition(cd: string | null, fallback: string): string {
		if (!cd) return fallback;
		const mStar = /filename\*=UTF-8''([^;\s]+)/i.exec(cd);
		if (mStar) {
			try {
				return decodeURIComponent(mStar[1].replace(/\+/g, ' '));
			} catch {
				return fallback;
			}
		}
		const m = /filename="([^"]+)"/i.exec(cd);
		if (m?.[1]) return m[1];
		return fallback;
	}

	async function baixarHistoricoArquivo(format: 'xlsx' | 'pdf') {
		baixarHistoricoAberto = false;
		const fallbackName = `gise_historico_${historicoExportSlug}.${format}`;
		const url = buildHistoricoExportHref(format);
		loading.show('Preparando download…');
		try {
			const res = await fetch(url, { credentials: 'same-origin' });
			const fileName = nomeArquivoContentDisposition(res.headers.get('Content-Disposition'), fallbackName);
			if (!res.ok) {
				let msg = `Não foi possível baixar (${res.status})`;
				try {
					const j = (await res.json()) as { error?: string };
					if (j?.error) msg = j.error;
				} catch {
					/* corpo não é JSON */
				}
				toaster.error({ title: msg });
				return;
			}
			const blob = await res.blob();
			const href = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = href;
			a.download = fileName;
			a.rel = 'noopener';
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(href);
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

	let baixarHistoricoAberto = $state(false);

	function limparFiltrosHistorico() {
		filtroSeccional = '';
		filtroMesAno = '';
		filtroAnoCiclo = '';
		filtroNumeroCiclo = '';
		filtroData = '';
		baixarHistoricoAberto = false;
	}

	// Paginação Histórico
	let paginaHistorico = $state(1);
	const totalPaginasHistorico = $derived(Math.max(1, Math.ceil(historicoFiltrado.length / ITEMS_POR_PAGINA)));
	const historicoPaginado = $derived(historicoFiltrado.slice((paginaHistorico - 1) * ITEMS_POR_PAGINA, paginaHistorico * ITEMS_POR_PAGINA));

	$effect(() => {
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		filtroSeccional;
		filtroMesAno;
		filtroAnoCiclo;
		filtroNumeroCiclo;
		filtroData;
		paginaHistorico = 1;
	});

	// Dropdowns de download do histórico
	let dropdownAberto = $state<{ escalaId: number; tipo: 'prod' | 'extra' } | null>(null);

	function toggleDropdown(escalaId: number, tipo: 'prod' | 'extra', ev: MouseEvent) {
		ev.stopPropagation();
		if (dropdownAberto?.escalaId === escalaId && dropdownAberto.tipo === tipo) {
			dropdownAberto = null;
		} else {
			dropdownAberto = { escalaId, tipo };
		}
	}

	// Modal de criação (Admin Geral)
	let showCriarModal = $state(false);
	useScrollLock(() => showCriarModal);
	/** dias selecionados: chave YYYY-MM-DD → feriado */
	let diasModal = $state<Record<string, { f: boolean }>>({});
	let calAno = $state(2026);
	let calMes = $state(0); // 0–11
	let novaHoraEntrada = $state('08:00');
	let novaHoraSaida = $state('16:00');
	let modoCriacao = $state<'completa' | 'clonada' | 'branco'>('completa');
	let clonarDeId = $state<number | ''>('');

	const MESES_CAL = [
		'Janeiro',
		'Fevereiro',
		'Março',
		'Abril',
		'Maio',
		'Junho',
		'Julho',
		'Agosto',
		'Setembro',
		'Outubro',
		'Novembro',
		'Dezembro'
	];
	const DIAS_SEM_CAL = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

	const diasModalOrdenados = $derived(
		Object.keys(diasModal)
			.sort()
			.map((iso) => ({ iso, feriado: diasModal[iso].f }))
	);
	const datasJsonHidden = $derived(
		JSON.stringify(diasModalOrdenados.map(({ iso, feriado }) => ({ data: iso, feriado })))
	);
	const calTitulo = $derived(`${MESES_CAL[calMes]} de ${calAno}`);
	const gradeCalendario = $derived.by(() => {
		const year = calAno;
		const month = calMes;
		const first = new Date(year, month, 1).getDay();
		const n = new Date(year, month + 1, 0).getDate();
		const cells: ({ day: number } | null)[] = [];
		for (let i = 0; i < first; i++) cells.push(null);
		for (let d = 1; d <= n; d++) cells.push({ day: d });
		while (cells.length % 7 !== 0) cells.push(null);
		while (cells.length < 42) cells.push(null);
		return cells;
	});

	function isoDiaLocal(year: number, month: number, day: number): string {
		return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
	}

	/** 1º clique: dia normal (azul). 2º: feriado (vermelho). 3º: remove. */
	function calCicloDia(iso: string) {
		const next = { ...diasModal };
		if (!(iso in next)) {
			next[iso] = { f: false };
		} else if (!next[iso].f) {
			next[iso] = { f: true };
		} else {
			delete next[iso];
		}
		diasModal = next;
	}

	function calRemoverDia(iso: string) {
		if (!(iso in diasModal)) return;
		const next = { ...diasModal };
		delete next[iso];
		diasModal = next;
	}

	function calMesAnterior() {
		if (calMes === 0) {
			calMes = 11;
			calAno--;
		} else {
			calMes--;
		}
	}

	function calMesProximo() {
		if (calMes === 11) {
			calMes = 0;
			calAno++;
		} else {
			calMes++;
		}
	}

	function validarHora(v: string): boolean {
		if (!v) return true;
		return /^\d{1,2}:\d{2}$/.test(v);
	}

	function hoje(): string {
		return new Date().toISOString().slice(0, 10);
	}

	function abrirCriarModal() {
		const h = hoje();
		diasModal = { [h]: { f: false } };
		const [y, m] = h.split('-').map(Number);
		calAno = y;
		calMes = m - 1;
		modoCriacao = 'completa';
		if (escalas.length > 0) {
			clonarDeId = escalas[0].id;
		} else {
			clonarDeId = '';
		}
		showCriarModal = true;
	}

	function handleCriarGise({ cancel }: any) {
		if (diasModalOrdenados.length === 0) {
			toaster.error({ title: 'Selecione pelo menos um dia' });
			cancel();
			return;
		}
		if (!novaHoraEntrada || !novaHoraSaida) {
			toaster.error({ title: 'Preencha os horários' });
			cancel();
			return;
		}
		if (!validarHora(novaHoraEntrada) || !validarHora(novaHoraSaida)) {
			toaster.error({ title: 'Formato inválido', description: 'Use o formato HH:MM, ex: 08:00' });
			cancel();
			return;
		}
		loading.show('Criando escala(s) GISE...');
		return async ({ result }: any) => {
			loading.hide();
			if (result.type === 'success') {
				const d = result.data as Record<string, unknown>;
				const count = (d.count as number) ?? 1;
				const primeiroId = (d.ids as number[])?.[0] ?? (d.id as number);
				toaster.success({ title: `${count} escala(s) GISE criada(s)` });
				showCriarModal = false;
				await invalidate(page.url.pathname);
				if (primeiroId) goto(`/gise/${primeiroId}?edit=true`);
			} else {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.error({ title: (d?.error as string) || 'Erro ao criar GISE' });
			}
		};
	}

	function statusLabel(status: string): string {
		const labels: Record<string, string> = {
			em_definicao_supervisor: 'Em definição do supervisor',
			em_preenchimento: 'Preenchendo escalados',
			aguardando_assinatura: 'Aguardando assinatura do supervisor',
			em_andamento: 'GISE em operação',
			aguardando_relatorios: 'Aguardando entradas',
			aguardando_assinatura_relat: 'Aguardando assinatura dos Rel. de Extra',
			pronta_para_finalizar: 'Pronta para finalizar',
			finalizada: 'Concluída'
		};
		return labels[status] ?? status;
	}

	function statusColor(status: string): string {
		const colors: Record<string, string> = {
			em_definicao_supervisor: 'bg-surface-500/15 text-surface-600 dark:text-surface-300',
			em_preenchimento: 'bg-warning-500/15 text-warning-700 dark:text-warning-400',
			aguardando_assinatura: 'bg-primary-500/15 text-primary-700 dark:text-primary-400',
			em_andamento: 'bg-success-500/15 text-success-700 dark:text-success-400',
			aguardando_relatorios: 'bg-warning-500/15 text-warning-700 dark:text-warning-400',
			aguardando_assinatura_relat: 'bg-tertiary-500/15 text-tertiary-700 dark:text-tertiary-400',
			pronta_para_finalizar: 'bg-success-500/20 text-success-800 dark:text-success-300',
			finalizada: 'bg-surface-500/15 text-surface-600 dark:text-surface-400'
		};
		return colors[status] ?? '';
	}

	function fmtDate(iso: string): string {
		if (!iso) return '';
		const [y, m, d] = iso.split('-');
		return `${d}/${m}/${y}`;
	}

	function diaSemana(iso: string): string {
		if (!iso) return '';
		const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
		return dias[new Date(iso + 'T12:00:00').getDay()];
	}
</script>
<svelte:head>
	<title>Escalas GISE - Portal de Escalas</title>
</svelte:head>
<svelte:window
	onclick={() => { baixarHistoricoAberto = false; dropdownAberto = null; }}
	onkeydown={(e) => { if (e.key === 'Escape' && showCriarModal && !loading.active) showCriarModal = false; }}
/>

<div class="min-w-0 space-y-6">
	<!-- Cabeçalho: coluna no mobile (título + botão largura total); linha a partir de sm -->
	<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
		<div class="min-w-0">
			<h1 class="text-xl font-bold text-surface-900 dark:text-surface-50 sm:text-2xl">Escala GISE</h1>
			<p class="mt-0.5 text-sm text-surface-500 dark:text-surface-400">
				{#if isAdminGeral}
					Gerenciamento completo das escalas GISE
				{:else if isSeccional}
					Preenchimento da sua seccional
				{:else if isSupervisor}
					Assinatura digital da escala
				{:else}
					Formulários de produtividade
				{/if}
			</p>
		</div>

		{#if isAdminGeral}
			<button type="button"
				class="btn w-full shrink-0 preset-filled-tertiary-500 border-2 border-tertiary-600/30 hover:border-tertiary-600 px-4 py-2.5 text-sm font-medium transition-all sm:w-auto sm:py-2 rounded-xl"
				onclick={abrirCriarModal}
			>
				+ Nova Escala GISE
			</button>
		{/if}
	</div>

	<!-- Card informativo para membros comuns -->
	{#if isMembro}
		<div
			class="rounded-2xl border border-primary-500/20 bg-primary-500/5 dark:bg-primary-500/10 p-4 sm:p-6 text-center space-y-2"
		>
			<p class="text-base font-semibold text-surface-900 dark:text-surface-100">
				Você está escalado na GISE
			</p>
			<p class="text-sm text-surface-500 dark:text-surface-400">
				Os formulários de produtividade estarão disponíveis nesta área.
			</p>
			{#if ativas.length > 0}
				<div class="mt-2 space-y-1">
					{#each ativas as ativa}
						<p class="text-xs text-surface-400">
							Escala vigente: <span class="font-medium"
								>{diaSemana(ativa.data_inicio)}
								{fmtDate(ativa.data_inicio)}</span
							>
						</p>
					{/each}
					</div>
				{/if}
			</div>
	{/if}

	<!-- Escala Ativa -->
	{#if ativas.length > 0 && !isMembro}
		<h2 class="text-base font-semibold text-surface-700 dark:text-surface-300 mb-2">
			Escalas Ativas
		</h2>
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			{#each ativasPaginadas as ativa}
				<div
					class="rounded-2xl border border-primary-500/30 bg-primary-500/5 dark:bg-primary-500/10 p-4 sm:p-5"
				>
					<!-- Mobile: conteúdo empilhado + botão largura total; sm+: linha com botão à direita -->
					<div
						class="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
					>
						<div class="min-w-0 flex-1 space-y-1">
							<div class="flex items-center gap-2">
								<span class="h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary-500"></span>
								<span class="text-sm font-semibold text-primary-700 dark:text-primary-400"
									>Escala Ativa #{ativa.id}</span
								>
							</div>
							<p class="text-lg font-bold text-surface-900 dark:text-surface-50 sm:text-xl">
								{diaSemana(ativa.data_inicio)}, {fmtDate(ativa.data_inicio)}
							</p>
							<div
								class="mt-2 flex flex-col items-start gap-1.5 min-[400px]:flex-row min-[400px]:flex-wrap min-[400px]:items-center min-[400px]:gap-x-2 min-[400px]:gap-y-1"
							>
								<span
									class="max-w-full text-xs font-semibold leading-snug px-2 py-0.5 rounded-full {statusColor(
										ativa.status
									)}"
								>
									{statusLabel(ativa.status)}
								</span>
								<span class="shrink-0 text-xs whitespace-nowrap text-surface-500 dark:text-surface-400"
									>{ativa.hora_entrada} às {ativa.hora_saida}</span
								>
							</div>
						</div>

						<div class="flex w-full shrink-0 sm:w-auto sm:justify-end">
							{#if isSupervisor && ativa.status === 'aguardando_assinatura'}
								<button type="button"
									class="btn w-full preset-filled-success-500 border-2 border-success-600/30 hover:border-success-600 px-4 py-2.5 text-sm font-bold transition-all sm:w-auto sm:py-2 rounded-xl"
									onclick={() => goto(`/gise/${ativa.id}`)}
								>
									{ativa.temSaidaConfirmada ? 'Assinar Rel. extra' : 'Assinar Escala'}
								</button>
							{:else}
								<button type="button"
									class="btn w-full preset-filled-primary-500 border-2 border-primary-600/30 hover:border-primary-600 px-4 py-2.5 text-sm transition-all sm:w-auto sm:py-2 rounded-xl"
									onclick={() => goto(`/gise/${ativa.id}`)}
								>
									Acessar
								</button>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>
		<div class="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
			<button type="button"
				class="btn preset-outlined-surface-500 shrink-0 text-xs px-3 py-1.5 rounded-lg disabled:opacity-40"
				disabled={paginaAtivas === 1}
				onclick={() => paginaAtivas--}
			>← Anterior</button>
			<span class="min-w-0 flex-1 px-1 text-center text-xs text-surface-500"
				>Página {paginaAtivas} de {totalPaginasAtivas}</span
			>
			<button type="button"
				class="btn preset-outlined-surface-500 shrink-0 text-xs px-3 py-1.5 rounded-lg disabled:opacity-40"
				disabled={paginaAtivas === totalPaginasAtivas}
				onclick={() => paginaAtivas++}
			>Próxima →</button>
		</div>
	{:else if !isMembro}
		<div
			class="rounded-2xl border border-dashed border-surface-300 dark:border-surface-700 p-4 sm:p-6 text-center"
		>
			<p class="text-surface-500 dark:text-surface-400">Nenhuma escala GISE ativa no momento.</p>
		</div>
	{/if}

	<!-- Histórico -->
	{#if historico.length > 0 && !isMembro && !isSupervisor}
		<div class="mt-8">
			<h2 class="text-base font-semibold text-surface-700 dark:text-surface-300 mb-3">Histórico</h2>

			<!-- Filtros histórico -->
			<div
				class="mb-4 overflow-hidden rounded-2xl border border-surface-200/90 dark:border-surface-700/90 bg-gradient-to-b from-white to-surface-50/95 dark:from-surface-900 dark:to-surface-950 shadow-sm shadow-surface-900/[0.04] dark:shadow-black/25"
			>
				<div class="grid grid-cols-1 gap-6 p-4 sm:p-5 lg:grid-cols-12 lg:gap-0 lg:items-stretch lg:p-0">
					<!-- 1 · Seccional -->
					<div
						class="lg:col-span-3 flex flex-col gap-3 border-b border-surface-200/80 pb-6 dark:border-surface-800 lg:border-b-0 lg:border-r lg:pb-0 lg:pl-5 lg:pr-5 lg:py-6"
					>
						<div class="flex items-start gap-3">
							<span
								class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary-500 text-xs font-black text-white shadow-sm shadow-primary-600/25"
								aria-hidden="true">1</span>
							<div class="min-w-0 pt-0.5">
								<p
									class="text-[0.68rem] font-black uppercase tracking-[0.14em] text-primary-600 dark:text-primary-400 leading-tight"
								>
									Seccional
								</p>
								<p class="mt-0.5 text-[0.72rem] leading-snug text-surface-500 dark:text-surface-400">
									Escolha uma unidade ou todas
								</p>
							</div>
						</div>
						<div class="space-y-1.5">
							<label for="filtro-seccional" class="sr-only">Seccional</label>
							<select
								id="filtro-seccional"
								bind:value={filtroSeccional}
								class="w-full cursor-pointer rounded-xl border border-surface-300 bg-white px-3.5 py-2.5 text-sm font-medium text-surface-800 shadow-sm transition-colors hover:border-primary-400/50 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/25 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-100 dark:hover:border-primary-500/40"
							>
								<option value="">Todas as seccionais</option>
								{#each seccionaisList as sec}
									<option value={sec.id}>{sec.nome}</option>
								{/each}
							</select>
						</div>
					</div>

					<!-- 2 · Período -->
					<div class="lg:col-span-9 flex min-w-0 flex-col gap-4 lg:py-6 lg:pr-5 lg:pl-6">
						<div class="flex items-start gap-3">
							<span
								class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary-500 text-xs font-black text-white shadow-sm shadow-primary-600/25"
								aria-hidden="true">2</span>
							<div class="min-w-0 flex-1 pt-0.5">
								<p
									class="text-[0.68rem] font-black uppercase tracking-[0.14em] text-primary-600 dark:text-primary-400 leading-tight"
								>
									Período
								</p>
								<p class="mt-0.5 text-[0.72rem] leading-snug text-surface-500 dark:text-surface-400">
									<span class="font-semibold text-surface-600 dark:text-surface-300">Mês/ano</span>,
									<span class="font-semibold text-surface-600 dark:text-surface-300">ano/ciclo</span> ou
									<span class="font-semibold text-surface-600 dark:text-surface-300">data específica</span>
									— preencher um limpa os outros
								</p>
							</div>
						</div>

						<div
							class="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.28fr)_minmax(0,1fr)]"
						>
							<div
								class="flex min-h-0 flex-col gap-2 rounded-xl border p-3.5 shadow-sm transition-all sm:p-4 {historicoFiltroMesAtivo
									? 'border-primary-500/45 bg-primary-500/[0.07] ring-1 ring-primary-500/20 dark:bg-primary-500/10'
									: 'border-surface-200/90 bg-white/90 dark:border-surface-700 dark:bg-surface-900/50'}"
							>
								<label
									for="filtro-mes-ano"
									class="text-xs font-bold uppercase tracking-wide text-surface-600 dark:text-surface-300"
								>Mês / ano</label>
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
								>Ano / ciclo</span>
								<div class="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[5.5rem_1fr]">
									<select
										id="filtro-ano-ciclo"
										bind:value={filtroAnoCiclo}
										onchange={onAnoCicloHistoricoMudou}
										class="min-h-[2.75rem] w-full cursor-pointer rounded-xl border border-surface-300 bg-white px-2.5 py-2 text-sm font-medium text-surface-800 shadow-sm transition-colors hover:border-primary-400/55 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/25 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-100 sm:w-[5.5rem]"
									>
										<option value="">Ano</option>
										{#each anosDisponiveisHistorico as ano}
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
										{#each CICLOS as c}
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
								>Data específica</label>
								<input
									id="filtro-data-especifica"
									type="date"
									value={filtroData}
									oninput={onDataEspecificaHistoricoInput}
									class="w-full min-h-[2.75rem] cursor-pointer rounded-xl border border-surface-300 bg-white px-3 py-2.5 text-sm font-medium text-surface-800 transition-colors hover:border-primary-400/55 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/25 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-100"
								/>
							</div>
						</div>
					</div>
				</div>

				<div
					class="flex flex-wrap items-center justify-between gap-3 border-t border-surface-200/90 bg-surface-100/70 px-4 py-3.5 dark:border-surface-800 dark:bg-surface-950/50 sm:px-5"
				>
					<p
						class="inline-flex items-center gap-2 rounded-lg border border-surface-200/90 bg-white px-2.5 py-1.5 text-xs font-semibold text-surface-600 shadow-sm dark:border-surface-700 dark:bg-surface-900 dark:text-surface-300"
					>
						<span class="font-black tabular-nums text-primary-600 dark:text-primary-400">{historicoFiltrado.length}</span>
						<span class="text-surface-500 dark:text-surface-400">resultado(s)</span>
					</p>
					<div class="flex flex-wrap items-center gap-2 sm:gap-3">
						{#if isAdminGeral}
							<div class="relative">
								<button
									type="button"
									class="inline-flex items-center gap-1.5 rounded-xl border-2 border-primary-500 bg-primary-500/10 px-3.5 py-2 text-xs font-bold text-primary-700 shadow-sm transition-all hover:bg-primary-500/18 dark:border-primary-400 dark:bg-primary-500/15 dark:text-primary-200 dark:hover:bg-primary-500/25 disabled:cursor-not-allowed disabled:border-surface-300 disabled:bg-surface-100 disabled:text-surface-400 disabled:shadow-none dark:disabled:border-surface-600 dark:disabled:bg-surface-800 dark:disabled:text-surface-500"
									disabled={!podeExportarHistorico}
									aria-expanded={baixarHistoricoAberto}
									aria-haspopup="true"
									title={podeExportarHistorico
										? 'Exportar lista filtrada'
										: 'Selecione mês/ano, ano/ciclo ou data específica para habilitar'}
									onclick={(e) => {
										e.stopPropagation();
										if (!podeExportarHistorico) return;
										baixarHistoricoAberto = !baixarHistoricoAberto;
									}}
								>
									Baixar
									<svg class="h-3.5 w-3.5 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
								</button>
								{#if baixarHistoricoAberto && podeExportarHistorico}
									<div
										class="absolute right-0 bottom-full z-30 mb-1.5 min-w-[11rem] overflow-hidden rounded-xl border border-surface-200 bg-white py-1 shadow-xl dark:border-surface-600 dark:bg-surface-800"
									>
										<button
											type="button"
											class="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold text-surface-800 hover:bg-surface-100 dark:text-surface-100 dark:hover:bg-surface-700"
											onclick={() => baixarHistoricoArquivo('xlsx')}
										>
											<span class="rounded bg-success-500/15 px-1.5 py-0.5 text-[0.6rem] font-black text-success-700 dark:text-success-400">XLSX</span>
											Planilha
										</button>
										<button
											type="button"
											class="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold text-surface-800 hover:bg-surface-100 dark:text-surface-100 dark:hover:bg-surface-700"
											onclick={() => baixarHistoricoArquivo('pdf')}
										>
											<span class="rounded bg-error-500/15 px-1.5 py-0.5 text-[0.6rem] font-black text-error-700 dark:text-error-400">PDF</span>
											Documento
										</button>
									</div>
								{/if}
							</div>
						{/if}
						{#if filtroSeccional !== '' || filtroMesAno || filtroAnoCiclo !== '' || filtroNumeroCiclo !== '' || filtroData}
							<button
								type="button"
								class="text-xs font-semibold text-primary-600 underline-offset-2 hover:underline dark:text-primary-400"
								onclick={limparFiltrosHistorico}
							>Limpar filtros</button>
						{/if}
					</div>
				</div>
			</div>

			<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
				{#if historicoPaginado.length === 0}
					<p class="text-sm text-surface-400 text-center py-6">Nenhum resultado para os filtros aplicados.</p>
				{:else}
				{#each historicoPaginado as escala}
					<div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900 hover:border-primary-500/30 transition-all">
						<!-- Linha principal: em mobile muito estreito os botões de download ficam em linha separada -->
						<div class="flex flex-col gap-2 px-3 py-3 min-[400px]:flex-row min-[400px]:items-center min-[400px]:gap-2 sm:px-4">
							<!-- Área clicável -->
							<button type="button"
								class="flex-1 min-w-0 flex items-center justify-between gap-2 sm:gap-3 text-left"
								onclick={() => { dropdownAberto = null; goto(`/gise/${escala.id}`); }}
							>
								<div class="min-w-0">
									<p class="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">
										{diaSemana(escala.data_inicio)}, {fmtDate(escala.data_inicio)}
										<span class="ml-1 opacity-50 font-normal">#{escala.id}</span>
									</p>
									<p class="text-xs text-surface-500 mt-0.5">{escala.hora_entrada} às {escala.hora_saida}</p>
								</div>
								<span class="text-[0.65rem] sm:text-xs px-2 py-0.5 rounded-full font-semibold shrink-0 text-center leading-tight {statusColor(escala.status)}">
									{statusLabel(escala.status)}
								</span>
							</button>

							<!-- Botões de download -->
							<div class="flex items-center gap-1 shrink-0 border-t pt-2 border-surface-200 dark:border-surface-700 min-[400px]:border-t-0 min-[400px]:border-l min-[400px]:pt-0 min-[400px]:pl-2 min-[400px]:ml-1 justify-end">
								<!-- Escala assinada (PDF) -->
								<a
									href="/api/gise/{escala.id}/download?format=pdf"
									download
									title="Baixar escala assinada (PDF)"
									aria-label="Baixar escala assinada (PDF)"
									class="inline-flex items-center justify-center w-9 h-9 sm:w-8 sm:h-8 rounded-lg text-surface-500 hover:bg-primary-500/10 hover:text-primary-600 transition-colors touch-manipulation"
									onclick={(e) => e.stopPropagation()}
								>
									<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
								</a>

								<!-- Relatório de Produtividade -->
								<div class="relative">
									<button type="button"
										title="Baixar relatório de produtividade"
										aria-label="Baixar relatório de produtividade"
										class="inline-flex items-center justify-center w-9 h-9 sm:w-8 sm:h-8 rounded-lg text-surface-500 hover:bg-success-500/10 hover:text-success-600 transition-colors touch-manipulation"
										onclick={(e) => toggleDropdown(escala.id, 'prod', e)}
									>
										<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
									</button>
									{#if dropdownAberto?.escalaId === escala.id && dropdownAberto.tipo === 'prod'}
										<div class="absolute right-0 top-full mt-1 z-30 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl shadow-xl p-1.5 w-56 max-w-[calc(100vw-1.5rem)] sm:min-w-[200px] sm:w-auto">
											<p class="text-[0.6rem] font-bold uppercase text-surface-400 px-2 pt-1 pb-1.5 tracking-wider">Produtividade por seccional</p>
											{#each (escala.seccionais ?? []) as sec}
												{#each (sec.tipos ?? ['operacional']) as tipo}
													<a
														href="/api/gise/{escala.id}/download?format=produtividade&seccionalId={sec.id}&equipeType={tipo}"
														download
														class="flex items-center gap-2 px-2 py-2 rounded-lg text-xs text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors touch-manipulation"
														onclick={() => dropdownAberto = null}
													>
														<svg class="w-3 h-3 shrink-0 text-success-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
														<span class="truncate">{sec.nome} — {tipo === 'seint' ? 'SEINT' : 'Operacional'}</span>
													</a>
												{/each}
											{/each}
										</div>
									{/if}
								</div>

								<!-- Relatório de Extra Assinado -->
								<div class="relative">
									<button type="button"
										title="Baixar relatório de extra assinado"
										aria-label="Baixar relatório de extra assinado"
										class="inline-flex items-center justify-center w-9 h-9 sm:w-8 sm:h-8 rounded-lg text-surface-500 hover:bg-warning-500/10 hover:text-warning-600 transition-colors touch-manipulation"
										onclick={(e) => toggleDropdown(escala.id, 'extra', e)}
									>
										<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
									</button>
									{#if dropdownAberto?.escalaId === escala.id && dropdownAberto.tipo === 'extra'}
										<div class="absolute right-0 top-full mt-1 z-30 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl shadow-xl p-1.5 w-56 max-w-[calc(100vw-1.5rem)] sm:min-w-[200px] sm:w-auto">
											<p class="text-[0.6rem] font-bold uppercase text-surface-400 px-2 pt-1 pb-1.5 tracking-wider">Extra por seccional</p>
											{#each (escala.seccionais ?? []) as sec}
												<a
													href="/api/gise/{escala.id}/download?format=extraordinario&seccionalId={sec.id}"
													download
													class="flex items-center gap-2 px-2 py-2 rounded-lg text-xs text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors touch-manipulation"
													onclick={() => dropdownAberto = null}
												>
													<svg class="w-3 h-3 shrink-0 text-warning-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
													<span class="truncate">{sec.nome}</span>
												</a>
											{/each}
										</div>
									{/if}
								</div>
							</div>
						</div>
					</div>
				{/each}
				{/if}
			</div>

			<div class="flex items-center justify-between gap-2 mt-3">
					<button type="button"
						class="btn preset-outlined-surface-500 text-xs px-3 py-1.5 rounded-lg disabled:opacity-40"
						disabled={paginaHistorico === 1}
						onclick={() => paginaHistorico--}
					>← Anterior</button>
					<span class="text-xs text-surface-500">{paginaHistorico} / {totalPaginasHistorico}</span>
					<button type="button"
						class="btn preset-outlined-surface-500 text-xs px-3 py-1.5 rounded-lg disabled:opacity-40"
						disabled={paginaHistorico === totalPaginasHistorico}
						onclick={() => paginaHistorico++}
					>Próxima →</button>
				</div>
		</div>
	{/if}
</div>

<!-- Modal Criar GISE -->
{#if showCriarModal}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/50 backdrop-blur-sm overflow-y-auto"
		role="presentation"
		onclick={(e) => e.target === e.currentTarget && !loading.active && (showCriarModal = false)}
	>
		<div
			class="bg-surface-50 dark:bg-surface-900 rounded-2xl shadow-2xl w-full max-w-lg p-3 sm:p-4 space-y-2.5 max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto"
			role="dialog"
			aria-modal="true"
		>
			<h2 class="text-base sm:text-lg font-bold text-surface-900 dark:text-surface-50 leading-tight">Nova Escala GISE</h2>
			<p class="text-[0.65rem] sm:text-xs text-surface-500 leading-snug">
				Uma escala por dia. No calendário: <span class="text-primary-600 dark:text-primary-400 font-medium">1º clique</span> seleciona
				(azul), <span class="text-error-600 dark:text-error-400 font-medium">2º</span> marca feriado (vermelho),
				<span class="font-medium text-surface-600 dark:text-surface-400">3º</span> remove o dia.
			</p>

			<!-- Calendário -->
			<div class="rounded-xl border border-surface-200 dark:border-surface-700 p-2 sm:p-2.5 space-y-1 bg-white dark:bg-surface-800/40">
				<div class="flex items-center justify-between gap-1.5">
					<button
						type="button"
						class="btn preset-outlined-surface-500 p-1.5 rounded-lg shrink-0"
						aria-label="Mês anterior"
						onclick={calMesAnterior}
					>
						<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
					</button>
					<p class="text-xs sm:text-sm font-semibold text-surface-800 dark:text-surface-100 text-center min-w-0 flex-1">
						{calTitulo}
					</p>
					<button
						type="button"
						class="btn preset-outlined-surface-500 p-1.5 rounded-lg shrink-0"
						aria-label="Próximo mês"
						onclick={calMesProximo}
					>
						<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
					</button>
				</div>
				<div class="grid grid-cols-7 gap-px text-center text-[0.55rem] sm:text-[0.6rem] font-semibold uppercase tracking-wide text-surface-400 py-0.5">
					{#each DIAS_SEM_CAL as ds}
						<span>{ds}</span>
					{/each}
				</div>
				<div class="grid grid-cols-7 gap-0.5">
					{#each gradeCalendario as cell}
						{#if cell}
							{@const iso = isoDiaLocal(calAno, calMes, cell.day)}
							{@const sel = iso in diasModal}
							{@const fer = sel && diasModal[iso].f}
							{@const ehHoje = iso === hoje()}
							<button
								type="button"
								onclick={() => calCicloDia(iso)}
								class="relative h-9 sm:h-9 rounded-md text-xs font-medium transition-colors border flex items-center justify-center touch-manipulation
									{sel
									? fer
										? 'border-error-500 bg-error-500/15 text-error-900 dark:text-error-100'
										: 'border-primary-500 bg-primary-500/10 text-primary-800 dark:text-primary-100'
									: 'border-transparent bg-surface-100/80 dark:bg-surface-700/50 text-surface-700 dark:text-surface-200 hover:bg-surface-200/80 dark:hover:bg-surface-600'}
									{ehHoje && !sel ? 'ring-1 ring-surface-400 dark:ring-surface-500' : ''}"
								aria-pressed={sel}
								aria-label="Dia {cell.day} de {MESES_CAL[calMes]}, {sel ? (fer ? 'feriado' : 'selecionado') : 'não selecionado'}"
							>
								{cell.day}
								{#if fer}
									<span class="absolute bottom-0 left-1/2 -translate-x-1/2 text-[0.45rem] font-bold uppercase text-error-700 dark:text-error-300 leading-none">F</span>
								{/if}
							</button>
						{:else}
							<div class="h-9 sm:h-9"></div>
						{/if}
					{/each}
				</div>
			</div>

			{#if diasModalOrdenados.length > 0}
				<div class="min-w-0 space-y-0.5">
					<span class="text-[0.65rem] font-semibold text-surface-500">Dias ({diasModalOrdenados.length})</span>
					<div
						class="flex flex-nowrap items-stretch gap-1.5 overflow-x-auto max-w-full pb-0.5 [scrollbar-width:thin]"
					>
					{#each diasModalOrdenados as { iso, feriado }}
						<span
							class="inline-flex items-center gap-0.5 pl-1.5 pr-0.5 py-0.5 rounded-md text-[0.65rem] font-medium border shrink-0
								{feriado
								? 'border-error-400/80 bg-error-500/10 text-error-900 dark:text-error-100'
								: 'border-primary-400/80 bg-primary-500/10 text-primary-900 dark:text-primary-100'}"
						>
							{fmtDate(iso)}
							{#if feriado}<span class="text-[0.55rem] font-bold text-error-600 dark:text-error-400">F</span>{/if}
							<button
								type="button"
								class="p-0.5 rounded text-surface-400 hover:text-error-600 dark:hover:text-error-400 shrink-0"
								aria-label="Remover {fmtDate(iso)}"
								onclick={() => calRemoverDia(iso)}
							>
								<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
							</button>
						</span>
					{/each}
					</div>
				</div>
			{/if}

			<!-- Horários -->
			<div class="rounded-xl border border-surface-200 dark:border-surface-700 p-2.5 space-y-1.5">
				<p class="text-[0.65rem] sm:text-xs font-semibold text-surface-600 dark:text-surface-400">
					Horário padrão (todos os dias)
				</p>
				<div class="grid grid-cols-2 gap-2">
					<div>
						<label for="novaHoraEntrada" class="text-[0.65rem] text-surface-500 block mb-0.5">Entrada</label>
						<input
							id="novaHoraEntrada"
							type="text"
							placeholder="Ex: 08:00"
							bind:value={novaHoraEntrada}
							class="w-full px-2.5 py-1.5 rounded-lg border bg-white dark:bg-surface-800 text-sm {novaHoraEntrada &&
							!validarHora(novaHoraEntrada)
								? 'border-error-500'
								: 'border-surface-300 dark:border-surface-700'}"
						/>
					</div>
					<div>
						<label for="novaHoraSaida" class="text-[0.65rem] text-surface-500 block mb-0.5">Saída</label>
						<input
							id="novaHoraSaida"
							type="text"
							placeholder="Ex: 16:00"
							bind:value={novaHoraSaida}
							class="w-full px-2.5 py-1.5 rounded-lg border bg-white dark:bg-surface-800 text-sm {novaHoraSaida &&
							!validarHora(novaHoraSaida)
								? 'border-error-500'
								: 'border-surface-300 dark:border-surface-700'}"
						/>
					</div>
				</div>
			</div>

			<!-- Tipo de Criação -->
			<div class="space-y-2">
				<p class="text-[0.65rem] sm:text-xs font-semibold text-surface-600 dark:text-surface-400">Tipo de Escala</p>
				<div class="grid grid-cols-3 gap-1 sm:gap-2">
					<button type="button"
						class="btn py-2 rounded-lg flex flex-col items-center gap-0.5 border transition-all min-h-0 {modoCriacao ===
						'completa'
							? 'border-primary-500 bg-primary-500/10 text-primary-600'
							: 'border-surface-200 dark:border-surface-700 text-surface-500'}"
						onclick={() => (modoCriacao = 'completa')}
					>
						<span class="font-bold text-[0.65rem] sm:text-xs leading-tight text-center">Completa</span>
						<span class="text-[0.55rem] opacity-70 leading-tight text-center hidden sm:block">Seccionais</span>
					</button>
					<button type="button"
						class="btn py-2 rounded-lg flex flex-col items-center gap-0.5 border transition-all min-h-0 {modoCriacao ===
						'branco'
							? 'border-primary-500 bg-primary-500/10 text-primary-600'
							: 'border-surface-200 dark:border-surface-700 text-surface-500'}"
						onclick={() => (modoCriacao = 'branco')}
					>
						<span class="font-bold text-[0.65rem] sm:text-xs leading-tight text-center">Em branco</span>
						<span class="text-[0.55rem] opacity-70 leading-tight text-center hidden sm:block">Sem equipes</span>
					</button>
					<button type="button"
						class="btn py-2 rounded-lg flex flex-col items-center gap-0.5 border transition-all min-h-0 {modoCriacao ===
						'clonada'
							? 'border-primary-500 bg-primary-500/10 text-primary-600'
							: 'border-surface-200 dark:border-surface-700 text-surface-500'}"
						onclick={() => (modoCriacao = 'clonada')}
						disabled={escalas.length === 0}
					>
						<span class="font-bold text-[0.65rem] sm:text-xs leading-tight text-center">Copiar</span>
						<span class="text-[0.55rem] opacity-70 leading-tight text-center hidden sm:block">De outra</span>
					</button>
				</div>

				{#if modoCriacao === 'clonada'}
					<div class="mt-1 animate-in fade-in slide-in-from-top-1 duration-300">
						<label
							for="clonarDe"
							class="text-[0.6rem] font-medium text-surface-500 dark:text-surface-400 block mb-0.5"
							>Escolha a escala de origem</label
						>
						<select
							id="clonarDe"
							bind:value={clonarDeId}
							class="w-full px-2.5 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-xs sm:text-sm"
						>
							{#each escalas.slice(0, 10) as esc}
								<option value={esc.id}>
									GISE — {diaSemana(esc.data_inicio)}
									{fmtDate(esc.data_inicio)} ({esc.status})
								</option>
							{/each}
						</select>
					</div>
				{/if}
			</div>

			<div class="flex justify-end gap-2 pt-1">
				<button type="button"
					class="btn preset-outlined-surface text-xs sm:text-sm px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg sm:rounded-xl"
					onclick={() => (showCriarModal = false)}
				>
					Cancelar
				</button>
				<form method="POST" action="?/criar" use:enhance={handleCriarGise} class="contents">
					<input type="hidden" name="datas_json" value={datasJsonHidden} />
					<input type="hidden" name="hora_entrada" value={novaHoraEntrada} />
					<input type="hidden" name="hora_saida" value={novaHoraSaida} />
					<input type="hidden" name="modo" value={modoCriacao} />
					{#if modoCriacao === 'clonada' && clonarDeId}
						<input type="hidden" name="clonar_de" value={clonarDeId} />
					{/if}
					<button
						type="submit"
						class="btn preset-filled-tertiary-500 border-2 border-tertiary-600/30 hover:border-tertiary-600 text-xs sm:text-sm px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg sm:rounded-xl transition-all"
						disabled={loading.active || diasModalOrdenados.length === 0 || (modoCriacao === 'clonada' && !clonarDeId)}
					>
						{loading.active ? 'Criando...' : 'Criar Escala'}
					</button>
				</form>
			</div>
		</div>
	</div>
{/if}
