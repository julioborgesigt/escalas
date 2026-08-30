<script lang="ts">
	/**
	 * Lista da escala de FIM DE SEMANA — a visão por DIA.
	 *
	 * É a diferença estrutural em relação a `TabelaPlantao` (mensal): a escala de
	 * FDS cobre poucos dias e cada dia tem sua própria composição, então a tela é
	 * uma seção por dia do intervalo, com adição de DPC e OIP dentro do dia. Na
	 * mensal, cada policial é uma linha com seus vários dias.
	 *
	 * Os dias vêm de `getDaysInRange`, isto é, do intervalo da escala — não das
	 * linhas existentes. Dia sem ninguém escalado precisa aparecer vazio, senão o
	 * buraco na cobertura fica invisível, que é justamente o que a tela existe
	 * para mostrar.
	 *
	 * A edição inline e os helpers de horário são COMPARTILHADOS com as tabelas
	 * mensais (`useEdicaoInlineServidor`, `criarHelpersHorario`): todas gravam nos
	 * mesmos campos e precisam calcular data de saída do mesmo jeito — plantão que
	 * vira o dia é regra do domínio, não de cada tela.
	 *
	 * Ao abrir o formulário de adição, os horários são pré-preenchidos com os da
	 * escala e o bloco recebe `scrollIntoView` depois de `tick()`: em fim de
	 * semana com muitos dias, o campo abriria fora da área visível.
	 */
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import { mostrarErroDeResultado } from '$lib/enhance-handler';
	import { formatarData, intervaloDeDatas } from '$lib/utils/datas';
	import { buscarPoliciaisOptions } from '$lib/busca-policiais';
	import { criarHelpersHorario, diaSemanaLabel } from './escala-horarios';
	import { tratarResultadoAdicionarPlantao } from './plantao-datas';
	import { useEdicaoInlineServidor } from './useEdicaoInlineServidor.svelte';
	import type { ActionResult } from '@sveltejs/kit';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import SeletorHoraMinuto from '$lib/components/SeletorHoraMinuto.svelte';
	import IconTooltip from '$lib/components/IconTooltip.svelte';
	import ModalEditarDias from './ModalEditarDias.svelte';
	import type { Escala } from '$lib/server/schema';
	import type { EscalaPolicialComDados } from '$lib/types';
	import PenLine from '@lucide/svelte/icons/pen-line';

	let {
		policiaisEscalaLocal = $bindable(),
		modoEdicao,
		podeEditarEscala,
		documentoAssinadoExiste,
		finalizadaEm,
		solicitacaoAtual,
		modoSelecao,
		selecionados = $bindable(),
		escala,
		onToggleSelecionar,
		onSolicitarRemocao,
		onDatasAtualizadas
	}: {
		policiaisEscalaLocal: EscalaPolicialComDados[];
		modoEdicao: boolean;
		podeEditarEscala: boolean;
		documentoAssinadoExiste: boolean;
		finalizadaEm: string | null;
		solicitacaoAtual: { tipo: string } | null;
		modoSelecao: boolean;
		selecionados: Set<number>;
		escala: Escala;
		onToggleSelecionar: (id: number) => void;
		onSolicitarRemocao: (id: number, nome: string) => void;
		onDatasAtualizadas?: () => void;
	} = $props();

	// === Helpers de formatação ===

	function getDaysInRange(start: string, end: string) {
		if (!start || !end) return [];
		return intervaloDeDatas(start, end);
	}

	// Helpers de horário/data compartilhados com TabelaServidores
	const { getHoraEntrada, getHoraSaida, getDataSaida, formatarHorario } = criarHelpersHorario(
		() => escala
	);

	// === Edição inline (compartilhada com TabelaServidores) ===
	const edicao = useEdicaoInlineServidor({
		helpers: { getDataSaida, getHoraEntrada, getHoraSaida },
		aplicarPoliciais: (p) => (policiaisEscalaLocal = p)
	});

	// === FDS: add per-day ===
	let fdsAddingDia = $state<string | null>(null);
	let fdsAddingCargo = $state<'DPC' | 'OIP' | null>(null);
	let fdsPolicialId = $state('');
	let fdsAddHoraEntrada = $state('08');
	let fdsAddMinutoEntrada = $state('00');
	let fdsAddHoraSaida = $state('08');
	let fdsAddMinutoSaida = $state('00');
	let pendingAdd = $state(false);

	const buscarPoliciaisFds = buscarPoliciaisOptions({ cargo: () => fdsAddingCargo ?? '' });

	async function openFdsAdd(dia: string, cargo: 'DPC' | 'OIP') {
		if (fdsAddingDia === dia && fdsAddingCargo === cargo) {
			fdsAddingDia = null;
			fdsAddingCargo = null;
			fdsPolicialId = '';
			return;
		}
		fdsAddingDia = dia;
		fdsAddingCargo = cargo;
		fdsPolicialId = '';
		const [hEnt = '08', mEnt = '00'] = (escala?.hora_entrada ?? '08:00').split(':');
		const [hSai = '08', mSai = '00'] = (escala?.hora_saida ?? '08:00').split(':');
		fdsAddHoraEntrada = hEnt;
		fdsAddMinutoEntrada = mEnt;
		fdsAddHoraSaida = hSai;
		fdsAddMinutoSaida = mSai;
		await tick();
		document
			.getElementById(`fds-add-${dia}`)
			?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	}

	function cancelFdsAdd() {
		fdsAddingDia = null;
		fdsAddingCargo = null;
		fdsPolicialId = '';
	}

	function handleFdsAdd({ cancel }: { cancel: () => void }) {
		if (!fdsPolicialId) {
			cancel();
			return;
		}
		pendingAdd = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingAdd = false;
			if (result.type === 'success') {
				policiaisEscalaLocal = result.data?.policiais;
				toaster.create({ title: 'Policial adicionado à escala', type: 'success' });
				fdsAddingDia = null;
				fdsAddingCargo = null;
				fdsPolicialId = '';
			} else {
				mostrarErroDeResultado(result, 'Erro ao adicionar');
			}
		};
	}

	// === Gerenciar dias da escala (FDS) ===
	let localDataInicio = $state('');
	let localDataFim = $state('');

	$effect(() => {
		localDataInicio = escala?.data_inicio ?? '';
		localDataFim = escala?.data_fim ?? '';
	});

	const diasEscalaLocal = $derived(
		localDataInicio && localDataFim ? getDaysInRange(localDataInicio, localDataFim) : []
	);

	let showEditarDiasModal = $state(false);

	// === Copiar para WhatsApp ===
	function copiarParaWhatsApp() {
		if (!escala) return;
		const linhas: string[] = [];
		linhas.push(`*${escala.titulo}*`);
		linhas.push('');
		for (const dia of diasEscalaLocal) {
			const itens = policiaisEscalaLocal.filter((p) => p.data_plantao === dia);
			if (itens.length === 0) continue;
			linhas.push(`*${diaSemanaLabel(dia)}, ${formatarData(dia)}:*`);
			for (const p of itens) {
				const partes = p.nome.split(' ');
				const nomeResumido = partes.length >= 2 ? `${partes[0]} ${partes[1]}` : partes[0];
				linhas.push(`• ${nomeResumido} (${p.cargo})`);
			}
			linhas.push('');
		}
		navigator.clipboard
			.writeText(linhas.join('\n').trimEnd())
			.then(() =>
				toaster.create({ title: 'Escala copiada para a área de transferência!', type: 'success' })
			)
			.catch(() => toaster.create({ title: 'Erro ao copiar', type: 'error' }));
	}

	// === Repetir policial em outros dias ===
	let repetindoId = $state<number | null>(null);
	let repeticaoDatas = $state<string[]>([]);
	let pendingRepetir = $state(false);

	function openRepetir(p: EscalaPolicialComDados) {
		if (repetindoId === p.id) {
			repetindoId = null;
			repeticaoDatas = [];
			return;
		}
		edicao.editingId = null;
		repetindoId = p.id;
		repeticaoDatas = [];
	}

	function toggleRepeticaoData(dia: string) {
		if (repeticaoDatas.includes(dia)) {
			repeticaoDatas = repeticaoDatas.filter((d) => d !== dia);
		} else {
			repeticaoDatas = [...repeticaoDatas, dia];
		}
	}

	function diasJaAdicionadosPolicial(policialId: number): Set<string> {
		return new Set(
			policiaisEscalaLocal.filter((p) => p.policial_id === policialId).map((p) => p.data_plantao)
		);
	}

	const repeticaoDatasJson = $derived(JSON.stringify(repeticaoDatas));

	function handleRepetir({ cancel }: { cancel: () => void }) {
		if (repeticaoDatas.length === 0) {
			cancel();
			return;
		}
		pendingRepetir = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingRepetir = false;
			tratarResultadoAdicionarPlantao(
				result,
				(p) => (policiaisEscalaLocal = p),
				() => {
					repetindoId = null;
					repeticaoDatas = [];
				},
				{
					sucesso: `Servidor adicionado em ${repeticaoDatas.length} dia(s)`,
					erroPadrao: 'Erro ao repetir'
				}
			);
		};
	}
</script>

<!-- =========== FDS: Toolbar (copiar + gerenciar dias) =========== -->
<div class="flex flex-wrap items-center justify-between gap-2 mb-3">
	<button
		type="button"
		onclick={copiarParaWhatsApp}
		class="btn text-xs font-semibold px-3 py-2 rounded-xl border border-success-500/40 bg-success-500/10 text-success-700 dark:text-success-400 hover:bg-success-500/20 transition-colors flex items-center gap-2"
	>
		<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
			<path
				d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"
			/>
			<path
				d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.123 1.535 5.849L.057 23.571a.75.75 0 00.921.921l5.783-1.478A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.89 0-3.663-.524-5.18-1.435l-.37-.221-3.836.981.998-3.748-.242-.386A9.96 9.96 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"
			/>
		</svg>
		Copiar Escala
	</button>

	{#if podeEditarEscala && !documentoAssinadoExiste && !finalizadaEm}
		<button
			type="button"
			onclick={() => (showEditarDiasModal = true)}
			class="btn text-xs font-semibold px-3 py-2 rounded-xl border border-warning-500/40 bg-warning-500/10 text-warning-700 dark:text-warning-400 hover:bg-warning-500/20 transition-colors flex items-center gap-2"
		>
			<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
				/>
			</svg>
			Editar Datas ({diasEscalaLocal.length})
		</button>
	{/if}
</div>

<!-- =========== FDS: Containers por dia =========== -->
<div class="space-y-4">
	{#each diasEscalaLocal as dia (dia)}
		{@const diaItems = policiaisEscalaLocal
			.filter((p) => p.data_plantao === dia)
			.sort((a, b) => {
				if (a.cargo !== b.cargo) return a.cargo === 'DPC' ? -1 : 1;
				return a.nome.localeCompare(b.nome);
			})}
		{@const dpcs = diaItems.filter((p) => p.cargo === 'DPC').length}
		{@const oips = diaItems.filter((p) => p.cargo === 'OIP').length}
		{@const addHere = fdsAddingDia === dia}

		<div
			class="rounded-2xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-white/10 shadow-md overflow-visible"
		>
			<!-- Header do dia -->
			<div
				class="flex items-center justify-between gap-3 px-4 py-3 bg-surface-50 dark:bg-surface-800/50 border-b border-surface-100 dark:border-white/5 rounded-t-2xl"
			>
				<div class="flex flex-col gap-1 min-w-0">
					<span class="font-bold text-sm text-surface-900 dark:text-surface-50">
						{diaSemanaLabel(dia)}, {formatarData(dia)}
					</span>
					{#if dpcs > 0 || oips > 0}
						<div class="flex gap-1.5">
							{#if dpcs > 0}
								<span
									class="badge text-3xs font-bold px-1.5 py-0.5 bg-primary-500/15 text-primary-700 dark:text-primary-300 border border-primary-500/20 rounded"
								>
									{dpcs} DPC
								</span>
							{/if}
							{#if oips > 0}
								<span
									class="badge text-3xs font-bold px-1.5 py-0.5 bg-warning-500/15 text-warning-700 dark:text-warning-300 border border-warning-500/20 rounded"
								>
									{oips} OIP
								</span>
							{/if}
						</div>
					{/if}
				</div>
				{#if podeEditarEscala && modoEdicao && !documentoAssinadoExiste && !finalizadaEm && !solicitacaoAtual}
					<div class="flex gap-1.5 shrink-0">
						<button
							type="button"
							class="btn text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors
								{addHere && fdsAddingCargo === 'DPC'
								? 'border-primary-500 bg-primary-500/20 text-primary-700 dark:text-primary-300'
								: 'border-primary-500/30 bg-primary-500/10 text-primary-700 dark:text-primary-300 hover:bg-primary-500/20'}"
							onclick={() => openFdsAdd(dia, 'DPC')}
						>
							+ DPC
						</button>
						<button
							type="button"
							class="btn text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors
								{addHere && fdsAddingCargo === 'OIP'
								? 'border-warning-500 bg-warning-500/20 text-warning-700 dark:text-warning-300'
								: 'border-warning-500/30 bg-warning-500/10 text-warning-700 dark:text-warning-300 hover:bg-warning-500/20'}"
							onclick={() => openFdsAdd(dia, 'OIP')}
						>
							+ OIP
						</button>
					</div>
				{/if}
			</div>

			<!-- Lista de servidores do dia -->
			{#if diaItems.length > 0}
				<div class="divide-y divide-surface-100 dark:divide-white/5">
					{#each diaItems as p (p.id)}
						{#if edicao.editingId === p.id}
							<!-- Formulário de edição inline -->
							<div class="px-4 py-3 bg-primary-500/5 dark:bg-primary-500/8">
								<p
									class="text-3xs font-semibold text-primary-600 dark:text-primary-400 mb-2 uppercase tracking-wide"
								>
									Editando: {p.nome}
								</p>
								<form
									method="POST"
									action="?/editar"
									use:enhance={edicao.handleEditar}
									class="flex items-end gap-1.5 flex-wrap"
								>
									<input type="hidden" name="item_id" value={edicao.editingId} />
									<div class="shrink-0">
										<span class="label-text text-3xs block mb-0.5">Início</span>
										<input
											type="date"
											class="input text-xs h-8 px-1 rounded-lg w-[7.5rem]"
											bind:value={edicao.dataEntrada}
										/>
									</div>
									<div class="shrink-0">
										<span class="label-text text-3xs block mb-0.5">Saída</span>
										<input
											type="date"
											class="input text-xs h-8 px-1 rounded-lg w-[7.5rem]"
											bind:value={edicao.dataSaida}
										/>
									</div>
									<div class="shrink-0">
										<span class="label-text text-3xs block mb-0.5">Entrada</span>
										<SeletorHoraMinuto
											bind:hora={edicao.horaEntrada}
											bind:minuto={edicao.minutoEntrada}
											selectClass="select text-xs h-8 py-0 rounded-lg px-1 w-12"
										/>
									</div>
									<div class="shrink-0">
										<span class="label-text text-3xs block mb-0.5">Saída hr</span>
										<SeletorHoraMinuto
											bind:hora={edicao.horaSaida}
											bind:minuto={edicao.minutoSaida}
											selectClass="select text-xs h-8 py-0 rounded-lg px-1 w-12"
										/>
									</div>
									<div class="flex gap-1 ml-auto shrink-0">
										<button
											type="submit"
											class="btn btn-sm h-8 preset-filled-primary-500 rounded-lg px-3 font-bold"
											disabled={edicao.pending}
										>
											{edicao.pending ? '...' : 'Salvar'}
										</button>
										<button
											type="button"
											class="w-8 h-8 flex items-center justify-center rounded-lg border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-sm font-bold"
											onclick={() => (edicao.editingId = null)}>×</button
										>
									</div>
									<input
										type="hidden"
										name="hora_entrada"
										value="{edicao.horaEntrada}:{edicao.minutoEntrada}"
									/>
									<input
										type="hidden"
										name="hora_saida"
										value="{edicao.horaSaida}:{edicao.minutoSaida}"
									/>
									<input type="hidden" name="data_plantao" value={edicao.dataEntrada} />
									<input type="hidden" name="data_saida" value={edicao.dataSaida} />
									<input type="hidden" name="observacoes" value={edicao.observacoes} />
								</form>
							</div>
						{:else}
							<!-- Card do servidor (responsivo mobile) -->
							<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
							<div
								class="flex items-start justify-between gap-3 px-4 py-3 hover:bg-surface-50/50 dark:hover:bg-surface-800/20 transition-colors {modoSelecao &&
								selecionados.has(p.id)
									? 'bg-error-500/5 dark:bg-error-500/8'
									: ''}"
								role={modoSelecao ? 'button' : undefined}
								tabindex={modoSelecao ? 0 : undefined}
								onclick={modoSelecao ? () => onToggleSelecionar(p.id) : undefined}
								onkeydown={modoSelecao
									? (e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												onToggleSelecionar(p.id);
											}
										}
									: undefined}
							>
								{#if modoSelecao}
									<div class="flex items-center shrink-0 pt-0.5">
										<input
											type="checkbox"
											class="checkbox"
											aria-label={`Selecionar ${p.nome}`}
											checked={selecionados.has(p.id)}
											onclick={(e) => e.stopPropagation()}
											onchange={() => onToggleSelecionar(p.id)}
										/>
									</div>
								{/if}
								<div class="flex-1 min-w-0">
									<div class="flex items-center flex-wrap gap-1.5 mb-0.5">
										<span
											class="font-semibold text-sm text-surface-900 dark:text-surface-100 uppercase leading-tight"
										>
											{p.nome}
										</span>
										<span
											class="badge px-1.5 py-0.5 rounded text-3xs font-bold uppercase shrink-0
											{p.cargo === 'DPC'
												? 'bg-primary-500/15 text-primary-700 dark:text-primary-400 border border-primary-500/20'
												: 'bg-warning-500/15 text-warning-700 dark:text-warning-400 border border-warning-500/20'}"
										>
											{p.cargo}
										</span>
									</div>
									<div
										class="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-surface-600 dark:text-surface-400"
									>
										<span>{p.matricula}</span>
										{#if p.telefone}<span>{p.telefone}</span>{/if}
										<span class="max-w-[200px] truncate">{p.lotacao || '-'}</span>
										<span
											class="font-medium text-surface-600 dark:text-surface-400 whitespace-nowrap"
											>{formatarHorario(p)}</span
										>
									</div>
								</div>
								{#if podeEditarEscala && !documentoAssinadoExiste && !finalizadaEm}
									<div class="flex items-center gap-1 shrink-0 mt-0.5">
										<IconTooltip label="Editar">
											<button
												type="button"
												aria-label="Editar"
												class="p-1.5 rounded transition-colors text-surface-400 hover:text-primary-500 hover:bg-primary-500/10"
												onclick={() => {
													edicao.editingId = null;
													edicao.startEdit(p);
													repetindoId = null;
													repeticaoDatas = [];
												}}
											>
												<PenLine class="w-3.5 h-3.5" aria-hidden="true" />
											</button>
										</IconTooltip>
										<IconTooltip label="Repetir em outros dias">
											<button
												type="button"
												aria-label="Repetir em outros dias"
												class="p-1.5 rounded transition-colors {repetindoId === p.id
													? 'text-success-600 dark:text-success-400 bg-success-500/10'
													: 'text-surface-400 hover:text-success-600 hover:bg-success-500/10'}"
												onclick={() => {
													edicao.editingId = null;
													openRepetir(p);
												}}
											>
												<svg
													class="w-3.5 h-3.5"
													fill="none"
													viewBox="0 0 24 24"
													stroke="currentColor"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
													/>
												</svg>
											</button>
										</IconTooltip>
										<button
											type="button"
											class="btn btn-sm preset-filled-error-500 rounded font-bold text-3xs uppercase px-2 py-0.5 transition-all"
											onclick={() => onSolicitarRemocao(p.id, p.nome)}
										>
											Rem.
										</button>
									</div>
								{/if}
							</div>
						{/if}
						{#if repetindoId === p.id}
							{@const jaAdicionados = diasJaAdicionadosPolicial(p.policial_id)}
							<div
								class="border-t border-success-200 dark:border-success-500/15 px-4 py-3 bg-success-500/5 dark:bg-success-500/8"
							>
								<p class="text-3xs font-semibold text-success-700 dark:text-success-400 mb-2">
									Adicionar <span class="uppercase">{p.nome}</span> em outros dias:
								</p>
								<form method="POST" action="?/repetir" use:enhance={handleRepetir}>
									<input type="hidden" name="policial_id" value={p.policial_id} />
									<input type="hidden" name="hora_entrada" value={getHoraEntrada(p)} />
									<input type="hidden" name="hora_saida" value={getHoraSaida(p)} />
									<input type="hidden" name="equipe" value={p.equipe || '1'} />
									<input type="hidden" name="datas" value={repeticaoDatasJson} />
									<div class="flex flex-wrap gap-1.5 mb-3">
										{#each diasEscalaLocal as d (d)}
											{@const jaAdicionado = jaAdicionados.has(d)}
											<button
												type="button"
												disabled={jaAdicionado}
												class="px-2 py-1 text-3xs font-bold rounded-md border transition-all {jaAdicionado
													? 'bg-surface-100 dark:bg-surface-800 text-surface-300 dark:text-surface-600 border-surface-200 dark:border-white/5 cursor-not-allowed line-through'
													: repeticaoDatas.includes(d)
														? 'bg-success-500 text-white border-success-500'
														: 'bg-surface-50 dark:bg-surface-800/50 text-surface-600 dark:text-surface-400 border-surface-200 dark:border-white/10 hover:border-success-500/50'}"
												onclick={() => {
													if (!jaAdicionado) toggleRepeticaoData(d);
												}}
											>
												{diaSemanaLabel(d)}
												{formatarData(d)}
											</button>
										{/each}
									</div>
									<div class="flex gap-1.5 flex-wrap">
										<button
											type="submit"
											class="btn text-xs font-bold h-8 px-4 rounded-lg bg-success-600 text-white hover:bg-success-700 disabled:opacity-50"
											disabled={pendingRepetir || repeticaoDatas.length === 0}
										>
											{pendingRepetir
												? 'Adicionando...'
												: `Adicionar em ${repeticaoDatas.length || '–'} dia(s)`}
										</button>
										<button
											type="button"
											class="h-8 px-3 rounded-lg text-xs border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
											onclick={() => openRepetir(p)}
										>
											Cancelar
										</button>
									</div>
								</form>
							</div>
						{/if}
					{/each}
				</div>
			{:else if !addHere}
				<div class="px-4 py-8 text-center text-xs text-surface-400 dark:text-surface-500">
					Nenhum servidor adicionado neste dia
				</div>
			{/if}

			<!-- Formulário de adição inline (aparece ao clicar +DPC ou +OIP) -->
			{#if addHere}
				<div
					id="fds-add-{dia}"
					class="border-t border-surface-100 dark:border-white/5 px-4 py-3
					{fdsAddingCargo === 'DPC'
						? 'bg-primary-500/5 dark:bg-primary-500/8'
						: 'bg-warning-500/5 dark:bg-warning-500/8'}"
				>
					<p
						class="text-3xs font-semibold mb-2
						{fdsAddingCargo === 'DPC'
							? 'text-primary-600 dark:text-primary-400'
							: 'text-warning-600 dark:text-warning-400'}"
					>
						Adicionar {fdsAddingCargo} — {diaSemanaLabel(dia)}, {formatarData(dia)}
					</p>
					<form method="POST" action="?/adicionar" use:enhance={handleFdsAdd}>
						<input type="hidden" name="data_plantao" value={dia} />
						<input type="hidden" name="equipe" value="1" />
						<div class="flex flex-wrap items-end gap-2">
							<div class="flex-1 min-w-0 sm:min-w-[200px] max-w-sm basis-full sm:basis-auto">
								{#key (fdsAddingDia ?? '') + (fdsAddingCargo ?? '')}
									<SearchableSelect
										name="policial_id"
										bind:value={fdsPolicialId}
										loadOptions={buscarPoliciaisFds}
										ariaLabel={`Selecionar ${fdsAddingCargo} para ${diaSemanaLabel(dia)}, ${formatarData(dia)}`}
										placeholder="Digite para buscar servidor..."
										class="w-full"
									/>
								{/key}
							</div>
							<div class="shrink-0">
								<span class="label-text text-3xs block mb-0.5">Entrada</span>
								<SeletorHoraMinuto
									bind:hora={fdsAddHoraEntrada}
									bind:minuto={fdsAddMinutoEntrada}
									nameHora="hora_entrada"
									nameMinuto="minuto_entrada"
									selectClass="select text-xs h-9 py-0 px-2"
								/>
							</div>
							<div class="shrink-0">
								<span class="label-text text-3xs block mb-0.5">Saída</span>
								<SeletorHoraMinuto
									bind:hora={fdsAddHoraSaida}
									bind:minuto={fdsAddMinutoSaida}
									nameHora="hora_saida"
									nameMinuto="minuto_saida"
									selectClass="select text-xs h-9 py-0 px-2"
								/>
							</div>
							<div class="flex gap-1.5 shrink-0">
								<button
									type="submit"
									class="btn text-xs font-bold h-9 px-4 rounded-lg
										{fdsAddingCargo === 'DPC' ? 'preset-filled-primary-500' : 'preset-filled-warning-500'}"
									disabled={pendingAdd || !fdsPolicialId}
								>
									{pendingAdd ? '...' : 'Adicionar'}
								</button>
								<button
									type="button"
									class="h-9 px-3 rounded-lg text-xs border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
									onclick={cancelFdsAdd}
								>
									Cancelar
								</button>
							</div>
						</div>
					</form>
				</div>
			{/if}
		</div>
	{/each}
</div>

<ModalEditarDias
	bind:open={showEditarDiasModal}
	escalaId={escala.id}
	diasIniciais={diasEscalaLocal}
	onsalvo={(r) => {
		localDataInicio = r.data_inicio;
		localDataFim = r.data_fim;
		policiaisEscalaLocal = r.policiais;
		onDatasAtualizadas?.();
	}}
/>
