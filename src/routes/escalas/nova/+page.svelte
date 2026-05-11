<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import { loading } from '$lib/loading.svelte';

	interface UnidadeRegime {
		nome: string;
		tem_plantao: boolean;
		tem_expediente: boolean;
		tem_fds: boolean;
		cidade: string;
	}

	let { data, form } = $props();

	function handleForm({ formData }: { formData: FormData }) {
		loading.show('Criando nova escala...');
		return async ({ result }: { result: any }) => {
			loading.hide();
			const d = result.data as Record<string, unknown> | undefined;
			if (result.type === 'success' && d?.id) {
				toaster.create({ title: 'Escala criada com sucesso', type: 'success' });
				goto(`/escalas/${d.id}`);
			} else if (result.type === 'failure' && d?.error) {
				toaster.create({ title: String(d.error), type: 'error' });
			}
		};
	}

	const isAdmin = $derived(data.isAdmin as boolean);
	const unidadesComRegime: UnidadeRegime[] = $derived(data.unidadesComRegime);
	const lotacoes: string[] = $derived(data.lotacoes);

	const horas = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
	const minutos = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

	// === Estado do seletor de regime ===
	let selecionando = $state(true);
	let tipoEscolhido = $state<'plantao' | 'expediente' | 'fds' | null>(null);
	let unidadeEscolhida = $state<UnidadeRegime | null>(null);

	// === Estado do formulário (plantao/expediente) ===
	let titulo = $state('');
	let cidade = $state('');
	let dataInicio = $state('');
	let dataFim = $state('');
	let horaEntrada = $state('08');
	let minutoEntrada = $state('00');
	let horaSaida = $state('08');
	let minutoSaida = $state('00');
	let lotacaoEscala = $state('');

	const MESES_PT = [
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

	function toISO(y: number, m: number, d: number) {
		return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
	}

	function diasNoMes(y: number, m: number) {
		return new Date(y, m, 0).getDate();
	}

	function sabadoDaSemana(): Date {
		const hoje = new Date();
		const dow = hoje.getDay();
		const offset = dow === 0 ? -1 : 6 - dow;
		const sab = new Date(hoje);
		sab.setDate(hoje.getDate() + offset);
		return sab;
	}

	function preencherMensal(tipo: 'plantao' | 'expediente', unidade: UnidadeRegime) {
		const hoje = new Date();
		const ano = hoje.getFullYear();
		const mes = hoje.getMonth() + 1;
		const proxMes = mes === 12 ? 1 : mes + 1;
		const proxAno = mes === 12 ? ano + 1 : ano;
		dataInicio = toISO(proxAno, proxMes, 1);
		dataFim = toISO(proxAno, proxMes, diasNoMes(proxAno, proxMes));
		horaEntrada = '00';
		minutoEntrada = '00';
		horaSaida = '23';
		minutoSaida = '59';
		const tipoLabel = tipo === 'plantao' ? 'PLANTÃO' : 'EXPEDIENTE';
		titulo = `ESCALA DE ${tipoLabel} DA ${unidade.nome.toUpperCase()} – ${MESES_PT[proxMes - 1].toUpperCase()} ${proxAno}`;
		cidade = unidade.cidade || '';
		lotacaoEscala = unidade.nome;
	}

	function escolherTipo(tipo: 'plantao' | 'expediente' | 'fds') {
		tipoEscolhido = tipo;
		if (unidadeEscolhida) {
			if (tipo === 'fds') {
				abrirFdsModal(unidadeEscolhida);
			} else {
				preencherMensal(tipo, unidadeEscolhida);
				selecionando = false;
			}
		}
	}

	function escolherUnidade(u: UnidadeRegime) {
		unidadeEscolhida = u;
		const regimes = tiposDisponiveis(u);
		if (regimes.length === 1) {
			escolherTipo(regimes[0].tipo);
		}
	}

	function tiposDisponiveis(
		u: UnidadeRegime
	): Array<{ tipo: 'plantao' | 'expediente' | 'fds'; label: string; desc: string; icon: string }> {
		const tipos = [];
		if (u.tem_plantao)
			tipos.push({
				tipo: 'plantao' as const,
				label: 'Plantão Mensal',
				desc: `${MESES_PT[nextMes() - 1]} ${nextAno()}`,
				icon: '🌙'
			});
		if (u.tem_expediente)
			tipos.push({
				tipo: 'expediente' as const,
				label: 'Expediente Mensal',
				desc: `${MESES_PT[nextMes() - 1]} ${nextAno()}`,
				icon: '☀️'
			});
		if (u.tem_fds) {
			const sab = sabadoDaSemana();
			const dS = String(sab.getDate()).padStart(2, '0');
			const mS = String(sab.getMonth() + 1).padStart(2, '0');
			tipos.push({
				tipo: 'fds' as const,
				label: 'Final de Semana',
				desc: `FDS ${dS}/${mS}`,
				icon: '📅'
			});
		}
		return tipos;
	}

	function nextMes(): number {
		const m = new Date().getMonth() + 1;
		return m === 12 ? 1 : m + 1;
	}
	function nextAno(): number {
		const h = new Date();
		return h.getMonth() + 1 === 12 ? h.getFullYear() + 1 : h.getFullYear();
	}

	const temVariasUnidades = $derived(unidadesComRegime.length > 1);
	const precisaEscolherTipo = $derived(
		unidadeEscolhida !== null &&
			tipoEscolhido === null &&
			tiposDisponiveis(unidadeEscolhida).length > 1
	);
	const isMensal = $derived(tipoEscolhido === 'plantao' || tipoEscolhido === 'expediente');

	// Auto-selecionar para policial com única unidade (não dispara para FDS para evitar loop)
	$effect(() => {
		if (!isAdmin && unidadesComRegime.length === 1 && selecionando) {
			untrack(() => {
				if (unidadeEscolhida !== unidadesComRegime[0]) {
					unidadeEscolhida = unidadesComRegime[0];
				}
				const tipos = tiposDisponiveis(unidadesComRegime[0]);
				if (tipos.length === 1 && !tipoEscolhido && tipos[0].tipo !== 'fds') {
					tipoEscolhido = tipos[0].tipo;
					preencherMensal(tipos[0].tipo as 'plantao' | 'expediente', unidadesComRegime[0]);
					selecionando = false;
				} else if (tipos.length === 1 && !tipoEscolhido && tipos[0].tipo === 'fds') {
					// Para FDS único, seleciona a unidade mas exibe o card para o usuário clicar
					tipoEscolhido = null;
				}
			});
		}
	});

	function horarioLabel(): string {
		return `${horaEntrada}:${minutoEntrada}H A ${horaSaida}:${minutoSaida}H`;
	}

	// ============================
	// === Modal de criação FDS ===
	// ============================
	let showFdsModal = $state(false);
	let fdsDiasSelecionados = $state<string[]>([]);
	let calAno = $state(new Date().getFullYear());
	let calMes = $state(new Date().getMonth());
	let fdsHoraEntrada = $state('08');
	let fdsMinutoEntrada = $state('00');
	let fdsHoraSaida = $state('08');
	let fdsMinutoSaida = $state('00');

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

	const fdsDiasOrdenados = $derived([...fdsDiasSelecionados].sort());
	const fdsDataInicioModal = $derived(fdsDiasOrdenados[0] ?? '');
	const fdsDataFimModal = $derived(fdsDiasOrdenados.at(-1) ?? '');

	const calTitulo = $derived(`${MESES_CAL[calMes]} de ${calAno}`);
	const gradeCalendario = $derived.by(() => {
		const first = new Date(calAno, calMes, 1).getDay();
		const n = new Date(calAno, calMes + 1, 0).getDate();
		const cells: ({ day: number } | null)[] = [];
		for (let i = 0; i < first; i++) cells.push(null);
		for (let d = 1; d <= n; d++) cells.push({ day: d });
		while (cells.length % 7 !== 0) cells.push(null);
		while (cells.length < 42) cells.push(null);
		return cells;
	});

	const fdsTituloAuto = $derived.by(() => {
		if (!unidadeEscolhida || fdsDiasOrdenados.length === 0) return '';
		const inicio = new Date(fdsDiasOrdenados[0] + 'T00:00:00');
		const fim = new Date(fdsDiasOrdenados.at(-1)! + 'T00:00:00');
		const dS = String(inicio.getDate()).padStart(2, '0');
		const mS = String(inicio.getMonth() + 1).padStart(2, '0');
		const dF = String(fim.getDate()).padStart(2, '0');
		const mF = String(fim.getMonth() + 1).padStart(2, '0');
		return `ESCALA DE PLANTÃO DO FINAL DE SEMANA - ${unidadeEscolhida.nome.toUpperCase()} - ${dS}/${mS} a ${dF}/${mF}`;
	});

	const fdsHorarioLabel = $derived(
		`${fdsHoraEntrada}:${fdsMinutoEntrada}H A ${fdsHoraSaida}:${fdsMinutoSaida}H`
	);

	function isoDiaLocal(year: number, month: number, day: number): string {
		return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
	}

	function fmtDia(iso: string): string {
		const [, m, d] = iso.split('-');
		return `${d}/${m}`;
	}

	function calToggleDia(iso: string) {
		if (fdsDiasSelecionados.includes(iso)) {
			fdsDiasSelecionados = fdsDiasSelecionados.filter((d) => d !== iso);
		} else {
			fdsDiasSelecionados = [...fdsDiasSelecionados, iso];
		}
	}

	function calRemoverDia(iso: string) {
		fdsDiasSelecionados = fdsDiasSelecionados.filter((d) => d !== iso);
	}

	function calMesAnterior() {
		if (calMes === 0) {
			calMes = 11;
			calAno--;
		} else calMes--;
	}

	function calMesProximo() {
		if (calMes === 11) {
			calMes = 0;
			calAno++;
		} else calMes++;
	}

	function abrirFdsModal(unidade: UnidadeRegime) {
		const sab = sabadoDaSemana();
		const dom = new Date(sab);
		dom.setDate(sab.getDate() + 1);
		const fmt = (d: Date) =>
			`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		fdsDiasSelecionados = [fmt(sab), fmt(dom)];
		calAno = sab.getFullYear();
		calMes = sab.getMonth();
		fdsHoraEntrada = '08';
		fdsMinutoEntrada = '00';
		fdsHoraSaida = '08';
		fdsMinutoSaida = '00';
		cidade = unidade.cidade || '';
		lotacaoEscala = unidade.nome;
		showFdsModal = true;
	}

	function fecharFdsModal() {
		showFdsModal = false;
		tipoEscolhido = null;
	}

	function handleFdsCriar({ cancel }: any) {
		if (fdsDiasOrdenados.length === 0) {
			toaster.create({ title: 'Selecione pelo menos um dia', type: 'error' });
			cancel();
			return;
		}
		loading.show('Criando escala FDS...');
		return async ({ result }: any) => {
			loading.hide();
			const d = result.data as Record<string, unknown> | undefined;
			if (result.type === 'success' && d?.id) {
				toaster.create({ title: 'Escala criada com sucesso', type: 'success' });
				goto(`/escalas/${d.id}`);
			} else if (result.type === 'failure' && d?.error) {
				toaster.create({ title: String(d.error), type: 'error' });
			}
		};
	}
</script>

<div class="flex items-center justify-between mb-6">
	<h1 class="h1 text-xl font-bold">Nova Escala</h1>
	<a href="/escalas" class="btn preset-outlined-primary-500">Voltar</a>
</div>

<!-- =========== SELETOR DE REGIME =========== -->
{#if selecionando}
	<div
		class="p-4 sm:p-6 rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20"
	>
		{#if unidadesComRegime.length === 0}
			<div
				class="flex flex-col items-center justify-center py-16 gap-3 text-surface-400 dark:text-surface-500"
			>
				<span class="text-sm">Carregando tipos de escala...</span>
			</div>
		{:else if temVariasUnidades && !unidadeEscolhida}
			<h2 class="font-bold text-lg mb-5">Qual unidade é a escala?</h2>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
				{#each unidadesComRegime as u (u.nome)}
					{@const tipos = tiposDisponiveis(u)}
					{#if tipos.length > 0}
						<button
							type="button"
							class="p-4 rounded-2xl border border-surface-200 dark:border-white/10 bg-surface-100/60 dark:bg-surface-800/60 hover:border-primary-500/50 hover:bg-primary-500/5 transition-all text-left group"
							onclick={() => escolherUnidade(u)}
						>
							<p class="font-semibold text-sm group-hover:text-primary-500 transition-colors">
								{u.nome}
							</p>
							<div class="flex gap-1.5 mt-2 flex-wrap">
								{#each tipos as t}
									<span
										class="text-[10px] font-bold badge bg-surface-200/80 dark:bg-surface-700/80 px-1.5"
										>{t.icon} {t.label}</span
									>
								{/each}
							</div>
						</button>
					{/if}
				{/each}
			</div>
		{:else if unidadeEscolhida && precisaEscolherTipo}
			<div class="flex items-center gap-3 mb-5">
				{#if temVariasUnidades}
					<button
						type="button"
						class="btn btn-sm preset-outlined-surface"
						onclick={() => {
							unidadeEscolhida = null;
							tipoEscolhido = null;
						}}>← Voltar</button
					>
				{/if}
				<h2 class="font-bold text-lg">
					Qual tipo de escala para <span class="text-primary-500">{unidadeEscolhida.nome}</span>?
				</h2>
			</div>
			<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
				{#each tiposDisponiveis(unidadeEscolhida) as t}
					<button
						type="button"
						class="p-5 rounded-2xl border-2 border-surface-200 dark:border-white/10 bg-surface-100/60 dark:bg-surface-800/60 hover:border-primary-500 hover:bg-primary-500/10 transition-all text-center group"
						onclick={() => escolherTipo(t.tipo)}
					>
						<p class="text-3xl mb-2">{t.icon}</p>
						<p class="font-bold text-sm group-hover:text-primary-500 transition-colors">
							{t.label}
						</p>
						<p class="text-xs text-surface-500 mt-1">{t.desc}</p>
					</button>
				{/each}
			</div>
		{:else if unidadeEscolhida && tiposDisponiveis(unidadeEscolhida).length === 1 && tiposDisponiveis(unidadeEscolhida)[0].tipo === 'fds'}
			<!-- Unidade com apenas FDS disponível -->
			<div class="flex items-center gap-3 mb-5">
				{#if temVariasUnidades}
					<button
						type="button"
						class="btn btn-sm preset-outlined-surface"
						onclick={() => {
							unidadeEscolhida = null;
							tipoEscolhido = null;
						}}>← Voltar</button
					>
				{/if}
				<h2 class="font-bold text-lg">
					Nova escala para <span class="text-primary-500">{unidadeEscolhida.nome}</span>
				</h2>
			</div>
			<div class="flex justify-center">
				<button
					type="button"
					class="p-5 rounded-2xl border-2 border-surface-200 dark:border-white/10 bg-surface-100/60 dark:bg-surface-800/60 hover:border-warning-500 hover:bg-warning-500/10 transition-all text-center group w-full max-w-xs"
					onclick={() => escolherTipo('fds')}
				>
					<p class="text-3xl mb-2">📅</p>
					<p class="font-bold text-sm group-hover:text-warning-600 transition-colors">
						Final de Semana
					</p>
					<p class="text-xs text-surface-500 mt-1">
						{#if tiposDisponiveis(unidadeEscolhida)[0]}
							{tiposDisponiveis(unidadeEscolhida)[0].desc}
						{/if}
					</p>
				</button>
			</div>
		{:else if unidadesComRegime.length > 0 && unidadesComRegime.every((u) => !u.tem_plantao && !u.tem_expediente && !u.tem_fds)}
			<p class="text-center py-6 text-surface-500">
				Nenhuma unidade tem regime configurado.
				<a href="/unidades" class="text-primary-500 underline">Configure em Unidades</a> ou crie manualmente
				abaixo.
			</p>
			<div class="flex justify-center mt-2">
				<button
					type="button"
					class="btn preset-filled-primary-500"
					onclick={() => (selecionando = false)}
				>
					Criar manualmente
				</button>
			</div>
		{/if}
	</div>

	<!-- =========== FORMULÁRIO (plantao/expediente) =========== -->
{:else}
	<div class="mb-4 flex items-center gap-2">
		<button
			type="button"
			class="btn btn-sm preset-outlined-surface"
			onclick={() => {
				selecionando = true;
				tipoEscolhido = null;
			}}>← Mudar tipo de escala</button
		>
		{#if tipoEscolhido === 'plantao'}
			<span class="badge preset-filled-tertiary-500 font-bold">🌙 Plantão Mensal</span>
		{:else if tipoEscolhido === 'expediente'}
			<span class="badge preset-filled-primary-500 font-bold">☀️ Expediente Mensal</span>
		{/if}
	</div>

	<div
		class="p-4 sm:p-6 rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20"
	>
		<form method="POST" action="?/criar" use:enhance={handleForm} class="space-y-4">
			<input type="hidden" name="data_inicio" value={dataInicio} />
			<input type="hidden" name="data_fim" value={dataFim} />
			<input type="hidden" name="hora_entrada" value={`${horaEntrada}:${minutoEntrada}`} />
			<input type="hidden" name="hora_saida" value={`${horaSaida}:${minutoSaida}`} />
			<input type="hidden" name="tipo" value={tipoEscolhido ?? ''} />
			<input type="hidden" name="cidade" value={cidade} />
			<input
				type="hidden"
				name="lotacao"
				value={isAdmin ? lotacaoEscala : (unidadeEscolhida?.nome ?? '')}
			/>

			{#if isAdmin}
				<label class="label">
					<span class="label-text">Unidade / Cidade</span>
					<select
						class="select"
						bind:value={lotacaoEscala}
						onchange={() => {
							const u = unidadesComRegime.find((x) => x.nome === lotacaoEscala);
							if (u) {
								unidadeEscolhida = u;
								if (tipoEscolhido && tipoEscolhido !== 'fds') preencherMensal(tipoEscolhido, u);
							}
						}}
						required
					>
						<option value="" disabled>Selecione...</option>
						{#each lotacoes as lot (lot)}<option value={lot}>{lot}</option>{/each}
					</select>
				</label>
			{:else}
				<p class="text-sm font-medium text-surface-500">
					Unidade: <span class="text-surface-900 dark:text-surface-100 font-bold"
						>{lotacaoEscala}</span
					>
				</p>
			{/if}

			{#if isMensal}
				<div
					class="rounded-xl bg-surface-100 dark:bg-surface-800/60 px-4 py-3 text-sm text-surface-600 dark:text-surface-400"
				>
					Período: <strong class="text-surface-900 dark:text-surface-100"
						>{dataInicio
							? new Date(dataInicio + 'T00:00:00').toLocaleDateString('pt-BR')
							: '—'}</strong
					>
					até
					<strong class="text-surface-900 dark:text-surface-100"
						>{dataFim ? new Date(dataFim + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}</strong
					>
					· Horário:
					<strong class="text-surface-900 dark:text-surface-100">{horarioLabel()}</strong>
				</div>
			{/if}

			<label class="label">
				<span class="label-text">Título da Escala</span>
				<input class="input" type="text" name="titulo" bind:value={titulo} required />
			</label>

			<div class="flex flex-col sm:flex-row gap-3 pt-2">
				<button
					type="submit"
					class="btn preset-filled-primary-500 flex items-center gap-2 w-full sm:w-auto"
					disabled={loading.active}
				>
					{loading.active ? 'Criando...' : 'Criar Escala'}
				</button>
				<a href="/escalas" class="btn preset-outlined-primary-500 w-full sm:w-auto text-center"
					>Cancelar</a
				>
			</div>
		</form>
	</div>
{/if}

<!-- =========== MODAL FDS =========== -->
{#if showFdsModal}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/50 backdrop-blur-sm"
	>
		<div
			class="bg-surface-50 dark:bg-surface-900 rounded-2xl shadow-2xl w-full max-w-lg p-3 sm:p-4 space-y-2.5 max-h-[calc(100vh-1rem)] sm:max-h-[calc(100vh-2rem)] overflow-y-auto"
		>
			<div>
				<h2
					class="text-base sm:text-lg font-bold text-surface-900 dark:text-surface-50 leading-tight"
				>
					Nova Escala — Final de Semana
				</h2>
				{#if unidadeEscolhida}
					<p class="text-xs text-surface-500 mt-0.5">{unidadeEscolhida.nome}</p>
				{/if}
			</div>

			<!-- Calendário -->
			<div
				class="rounded-xl border border-surface-200 dark:border-surface-700 p-2 sm:p-2.5 space-y-1 bg-white dark:bg-surface-800/40"
			>
				<div class="flex items-center justify-between gap-1.5">
					<button
						type="button"
						class="btn preset-outlined-surface-500 p-1.5 rounded-lg shrink-0"
						aria-label="Mês anterior"
						onclick={calMesAnterior}
					>
						<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M15 19l-7-7 7-7"
							/></svg
						>
					</button>
					<p
						class="text-xs sm:text-sm font-semibold text-surface-800 dark:text-surface-100 text-center min-w-0 flex-1"
					>
						{calTitulo}
					</p>
					<button
						type="button"
						class="btn preset-outlined-surface-500 p-1.5 rounded-lg shrink-0"
						aria-label="Próximo mês"
						onclick={calMesProximo}
					>
						<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 5l7 7-7 7"
							/></svg
						>
					</button>
				</div>
				<div
					class="grid grid-cols-7 gap-px text-center text-[0.55rem] sm:text-[0.6rem] font-semibold uppercase tracking-wide text-surface-400 py-0.5"
				>
					{#each DIAS_SEM_CAL as ds}
						<span>{ds}</span>
					{/each}
				</div>
				<div class="grid grid-cols-7 gap-0.5">
					{#each gradeCalendario as cell}
						{#if cell}
							{@const iso = isoDiaLocal(calAno, calMes, cell.day)}
							{@const sel = fdsDiasSelecionados.includes(iso)}
							<button
								type="button"
								onclick={() => calToggleDia(iso)}
								class="h-9 rounded-md text-xs font-medium transition-colors border flex items-center justify-center touch-manipulation
									{sel
									? 'border-warning-500 bg-warning-500/15 text-warning-900 dark:text-warning-100'
									: 'border-transparent bg-surface-100/80 dark:bg-surface-700/50 text-surface-700 dark:text-surface-200 hover:bg-surface-200/80 dark:hover:bg-surface-600'}"
								aria-pressed={sel}
								aria-label="Dia {cell.day} de {MESES_CAL[calMes]}"
							>
								{cell.day}
							</button>
						{:else}
							<div class="h-9"></div>
						{/if}
					{/each}
				</div>
			</div>

			<!-- Dias selecionados -->
			{#if fdsDiasOrdenados.length > 0}
				<div class="min-w-0 space-y-0.5">
					<span class="text-[0.65rem] font-semibold text-surface-500"
						>Dias selecionados ({fdsDiasOrdenados.length})</span
					>
					<div
						class="flex flex-nowrap items-stretch gap-1.5 overflow-x-auto max-w-full pb-0.5 [scrollbar-width:thin]"
					>
						{#each fdsDiasOrdenados as iso}
							<span
								class="inline-flex items-center gap-0.5 pl-1.5 pr-0.5 py-0.5 rounded-md text-[0.65rem] font-medium border shrink-0 border-warning-400/80 bg-warning-500/10 text-warning-900 dark:text-warning-100"
							>
								{fmtDia(iso)}
								<button
									type="button"
									class="p-0.5 rounded text-surface-400 hover:text-error-600 dark:hover:text-error-400 shrink-0"
									aria-label="Remover {fmtDia(iso)}"
									onclick={() => calRemoverDia(iso)}
								>
									<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"
										><path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M6 18L18 6M6 6l12 12"
										/></svg
									>
								</button>
							</span>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Horários -->
			<div class="rounded-xl border border-surface-200 dark:border-surface-700 p-2.5 space-y-1.5">
				<p class="text-[0.65rem] sm:text-xs font-semibold text-surface-600 dark:text-surface-400">
					Horário
				</p>
				<div class="grid grid-cols-2 gap-2">
					<div>
						<span class="text-[0.65rem] text-surface-500 block mb-0.5">Hora entrada</span>
						<div class="flex gap-1">
							<select class="select text-xs flex-1" bind:value={fdsHoraEntrada}>
								{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
							</select>
							<select class="select text-xs flex-1" bind:value={fdsMinutoEntrada}>
								{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}
							</select>
						</div>
					</div>
					<div>
						<span class="text-[0.65rem] text-surface-500 block mb-0.5">Hora saída</span>
						<div class="flex gap-1">
							<select class="select text-xs flex-1" bind:value={fdsHoraSaida}>
								{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
							</select>
							<select class="select text-xs flex-1" bind:value={fdsMinutoSaida}>
								{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}
							</select>
						</div>
					</div>
				</div>
				<p class="text-[0.65rem] text-primary-600 dark:text-primary-400 font-medium">
					{fdsHorarioLabel}
				</p>
			</div>

			<!-- Título gerado automaticamente -->
			{#if fdsTituloAuto}
				<div class="rounded-lg bg-surface-100 dark:bg-surface-800/50 px-3 py-2">
					<p class="text-[0.6rem] text-surface-400 mb-0.5">Título gerado</p>
					<p class="text-xs text-surface-700 dark:text-surface-200 font-medium leading-snug">
						{fdsTituloAuto}
					</p>
				</div>
			{/if}

			<!-- Ações -->
			<div class="flex justify-end gap-2 pt-1">
				<button
					type="button"
					class="btn preset-outlined-surface text-xs sm:text-sm px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg sm:rounded-xl"
					onclick={fecharFdsModal}
				>
					Cancelar
				</button>
				<form method="POST" action="?/criar" use:enhance={handleFdsCriar} class="contents">
					<input type="hidden" name="data_inicio" value={fdsDataInicioModal} />
					<input type="hidden" name="data_fim" value={fdsDataFimModal} />
					<input
						type="hidden"
						name="hora_entrada"
						value={`${fdsHoraEntrada}:${fdsMinutoEntrada}`}
					/>
					<input type="hidden" name="hora_saida" value={`${fdsHoraSaida}:${fdsMinutoSaida}`} />
					<input type="hidden" name="tipo" value="fds" />
					<input type="hidden" name="cidade" value={cidade} />
					<input type="hidden" name="lotacao" value={lotacaoEscala} />
					<input type="hidden" name="titulo" value={fdsTituloAuto} />
					<button
						type="submit"
						class="btn preset-filled-warning-500 border-2 border-warning-600/30 hover:border-warning-600 text-xs sm:text-sm px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg sm:rounded-xl transition-all"
						disabled={loading.active || fdsDiasOrdenados.length === 0}
					>
						{loading.active ? 'Criando...' : 'Criar Escala'}
					</button>
				</form>
			</div>
		</div>
	</div>
{/if}
