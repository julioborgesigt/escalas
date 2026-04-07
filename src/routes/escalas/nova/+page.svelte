<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import Spinner from '$lib/components/Spinner.svelte';

	interface UnidadeRegime {
		nome: string;
		tem_plantao: boolean;
		tem_expediente: boolean;
		tem_fds: boolean;
		cidade: string;
	}

	let { data, form } = $props();

	// Track pending state locally
	let enviando = $state(false);
	const handleForm: any = () => ({
		onSubmit: () => {
			enviando = true;
		},
		onUpdate({ result }: { result: any }) {
			enviando = false;
			const d = result.data as Record<string, unknown> | undefined;
			if (result.type === 'success' && d?.id) {
				toaster.create({ title: 'Escala criada com sucesso', type: 'success' });
				goto(`/escalas/${d.id}`);
			} else if (result.type === 'failure' && d?.error) {
				toaster.create({ title: String(d.error), type: 'error' });
			}
		}
	});

	const isAdmin: boolean = data.isAdmin;
	const unidadesComRegime: UnidadeRegime[] = data.unidadesComRegime;
	const lotacoes: string[] = data.lotacoes;

	const horas = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
	const minutos = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

	// === Estado do seletor de regime ===
	let selecionando = $state(true);
	let tipoEscolhido = $state<'plantao' | 'expediente' | 'fds' | null>(null);
	let unidadeEscolhida = $state<UnidadeRegime | null>(null);

	// === Estado do formulário ===
	let titulo = $state('');
	let cidade = $state('');
	let dataInicio = $state('');
	let dataFim = $state('');
	let horaEntrada = $state('08');
	let minutoEntrada = $state('00');
	let horaSaida = $state('08');
	let minutoSaida = $state('00');
	let lotacaoEscala = $state('');

	// Se true, o form de FDS mostra o seletor de data do fim de semana
	let fdsDataInicio = $state('');

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

	function preencherDadosPorTipo(tipo: 'plantao' | 'expediente' | 'fds', unidade: UnidadeRegime) {
		const hoje = new Date();
		const ano = hoje.getFullYear();
		const mes = hoje.getMonth() + 1;
		const proxMes = mes === 12 ? 1 : mes + 1;
		const proxAno = mes === 12 ? ano + 1 : ano;

		if (tipo === 'plantao' || tipo === 'expediente') {
			dataInicio = toISO(proxAno, proxMes, 1);
			dataFim = toISO(proxAno, proxMes, diasNoMes(proxAno, proxMes));
			horaEntrada = '00';
			minutoEntrada = '00';
			horaSaida = '23';
			minutoSaida = '59';
			const tipoLabel = tipo === 'plantao' ? 'PLANTÃO' : 'EXPEDIENTE';
			titulo = `ESCALA DE ${tipoLabel} DA ${unidade.nome.toUpperCase()} – ${MESES_PT[proxMes - 1].toUpperCase()} ${proxAno}`;
		} else if (tipo === 'fds') {
			const sab = sabadoDaSemana();
			const seg = new Date(sab);
			seg.setDate(sab.getDate() + 2);
			dataInicio = toISO(sab.getFullYear(), sab.getMonth() + 1, sab.getDate());
			fdsDataInicio = dataInicio;
			dataFim = toISO(seg.getFullYear(), seg.getMonth() + 1, seg.getDate());
			horaEntrada = '08';
			minutoEntrada = '00';
			horaSaida = '08';
			minutoSaida = '00';
			atualizarTituloFds();
		}

		cidade = unidade.cidade || '';
		lotacaoEscala = unidade.nome;
	}

	function atualizarTituloFds() {
		if (!unidadeEscolhida || !fdsDataInicio) return;
		const sab = new Date(fdsDataInicio + 'T00:00:00');
		const dom = new Date(sab);
		dom.setDate(sab.getDate() + 1);
		const dS = String(sab.getDate()).padStart(2, '0');
		const mS = String(sab.getMonth() + 1).padStart(2, '0');
		const dD = String(dom.getDate()).padStart(2, '0');
		const mD = String(dom.getMonth() + 1).padStart(2, '0');
		titulo = `ESCALA DE PLANTÃO DO FINAL DE SEMANA - ${unidadeEscolhida.nome.toUpperCase()} - ${dS}/${mS} E ${dD}/${mD}`;
		dataInicio = fdsDataInicio;
		const seg = new Date(sab);
		seg.setDate(sab.getDate() + 2);
		dataFim = toISO(seg.getFullYear(), seg.getMonth() + 1, seg.getDate());
	}

	function escolherTipo(tipo: 'plantao' | 'expediente' | 'fds') {
		tipoEscolhido = tipo;
		if (unidadeEscolhida) {
			preencherDadosPorTipo(tipo, unidadeEscolhida);
			selecionando = false;
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

	// Auto-selecionar para policial com única unidade
	$effect(() => {
		if (!isAdmin && unidadesComRegime.length === 1) {
			unidadeEscolhida = unidadesComRegime[0];
			const tipos = tiposDisponiveis(unidadesComRegime[0]);
			if (tipos.length === 1) {
				escolherTipo(tipos[0].tipo);
			}
		}
	});

	function horarioLabel(): string {
		return `${horaEntrada}:${minutoEntrada}H A ${horaSaida}:${minutoSaida}H`;
	}
</script>

<div class="flex items-center justify-between mb-6">
	<h1 class="h1 text-xl font-bold">Nova Escala</h1>
	<a href="/escalas" class="btn preset-outlined-primary-500">Voltar</a>
</div>

<!-- =========== SELETOR DE REGIME =========== -->
{#if selecionando}
	<div
		class="p-6 rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20"
	>
		{#if unidadesComRegime.length === 0}
			<div
				class="flex flex-col items-center justify-center py-16 gap-3 text-surface-400 dark:text-surface-500"
			>
				<Spinner size="xl" />
				<span class="text-sm">Carregando tipos de escala...</span>
			</div>
		{:else if temVariasUnidades && !unidadeEscolhida}
			<h2 class="font-bold text-lg mb-5">Qual unidade é a escala?</h2>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
				{#each unidadesComRegime as u (u.nome)}
					{@const tipos = tiposDisponiveis(u)}
					{#if tipos.length > 0}
						<button
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
						class="btn btn-sm preset-outlined-surface"
						onclick={() => {
							unidadeEscolhida = null;
							tipoEscolhido = null;
						}}
					>
						← Voltar
					</button>
				{/if}
				<h2 class="font-bold text-lg">
					Qual tipo de escala para <span class="text-primary-500">{unidadeEscolhida.nome}</span>?
				</h2>
			</div>
			<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
				{#each tiposDisponiveis(unidadeEscolhida) as t}
					<button
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
		{:else if unidadesComRegime.length > 0 && unidadesComRegime.every((u) => !u.tem_plantao && !u.tem_expediente && !u.tem_fds)}
			<p class="text-center py-6 text-surface-500">
				Nenhuma unidade tem regime configurado.
				<a href="/unidades" class="text-primary-500 underline">Configure em Unidades</a> ou crie manualmente
				abaixo.
			</p>
			<div class="flex justify-center mt-2">
				<button class="btn preset-filled-primary-500" onclick={() => (selecionando = false)}>
					Criar manualmente
				</button>
			</div>
		{/if}
	</div>

	<!-- =========== FORMULÁRIO =========== -->
{:else}
	<div class="mb-4 flex items-center gap-2">
		<button
			class="btn btn-sm preset-outlined-surface"
			onclick={() => {
				selecionando = true;
				tipoEscolhido = null;
			}}
		>
			← Mudar tipo de escala
		</button>
		{#if tipoEscolhido === 'plantao'}
			<span class="badge preset-filled-tertiary-500 font-bold">🌙 Plantão Mensal</span>
		{:else if tipoEscolhido === 'expediente'}
			<span class="badge preset-filled-primary-500 font-bold">☀️ Expediente Mensal</span>
		{:else if tipoEscolhido === 'fds'}
			<span class="badge preset-filled-warning-500 font-bold">📅 Final de Semana</span>
		{/if}
	</div>

	<div
		class="p-6 rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20"
	>
		<form method="POST" action="?/criar" use:enhance={handleForm} class="space-y-4">
			<!-- Campos hidden para o server -->
			<input type="hidden" name="data_inicio" value={dataInicio} />
			<input type="hidden" name="data_fim" value={dataFim} />
			<input type="hidden" name="hora_entrada" value={horaEntrada} />
			<input type="hidden" name="hora_saida" value={horaSaida} />
			<input type="hidden" name="tipo" value={tipoEscolhido ?? ''} />
			{#if isAdmin}
				<input type="hidden" name="lotacao" value={lotacaoEscala} />
			{:else}
				<input type="hidden" name="lotacao" value={unidadeEscolhida?.nome ?? ''} />
			{/if}

			<!-- Unidade (admin) -->
			{#if isAdmin}
				<label class="label">
					<span class="label-text">Unidade / Cidade</span>
					<select
						class="select"
						bind:value={cidade}
						onchange={() => {
							lotacaoEscala = cidade;
							if (tipoEscolhido && unidadeEscolhida)
								preencherDadosPorTipo(tipoEscolhido, unidadeEscolhida);
						}}
						required
					>
						<option value="" disabled>Selecione...</option>
						{#each lotacoes as lot (lot)}
							<option value={lot}>{lot}</option>
						{/each}
					</select>
				</label>
			{:else}
				<p class="text-sm font-medium text-surface-500">
					Unidade: <span class="text-surface-900 dark:text-surface-100 font-bold">{cidade}</span>
				</p>
			{/if}

			<!-- Para plantão/expediente: período implícito mostrado como info -->
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

				<!-- Para FDS: seletor de data do sábado -->
			{:else if tipoEscolhido === 'fds'}
				<label class="label">
					<span class="label-text">Data do Sábado</span>
					<input
						class="input"
						type="date"
						bind:value={fdsDataInicio}
						onchange={atualizarTituloFds}
						required
					/>
				</label>
				<div class="flex flex-col sm:flex-row gap-3">
					<div class="flex flex-col gap-2 flex-1">
						<span class="label-text">Hora entrada</span>
						<div class="flex gap-1">
							<select class="select flex-1" bind:value={horaEntrada}>
								{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
							</select>
							<select class="select flex-1" bind:value={minutoEntrada}>
								{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}
							</select>
						</div>
					</div>
					<div class="flex flex-col gap-2 flex-1">
						<span class="label-text">Hora saída</span>
						<div class="flex gap-1">
							<select class="select flex-1" bind:value={horaSaida}>
								{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
							</select>
							<select class="select flex-1" bind:value={minutoSaida}>
								{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}
							</select>
						</div>
					</div>
				</div>
				<p class="text-sm text-primary-600 dark:text-primary-400">
					Horário: <strong>{horarioLabel()}</strong>
					{#if Number(horaSaida) <= Number(horaEntrada) && horaEntrada !== horaSaida}
						<span class="italic text-surface-500"> (cruza para o dia seguinte)</span>
					{/if}
				</p>
			{/if}

			<!-- Título (sempre visível e editável) -->
			<label class="label">
				<span class="label-text">Título da Escala</span>
				<input class="input" type="text" bind:value={titulo} required />
			</label>

			<div class="flex flex-col sm:flex-row gap-3 pt-2">
				<button
					type="submit"
					class="btn preset-filled-primary-500 flex items-center gap-2 w-full sm:w-auto"
					disabled={enviando}
				>
					{#if enviando}<Spinner size="md" />{/if}
					{enviando ? 'Criando...' : 'Criar Escala'}
				</button>
				<a href="/escalas" class="btn preset-outlined-primary-500 w-full sm:w-auto text-center"
					>Cancelar</a
				>
			</div>
		</form>
	</div>
{/if}
