<script lang="ts">
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import { formatarData, calcularDataSaida } from '$lib/utils';
	import type { Escala } from '$lib/server/schema';
	import type { EscalaPolicialComDados } from '$lib/types';
	import { Pagination } from '@skeletonlabs/skeleton-svelte';
	import IconTooltip from '$lib/components/IconTooltip.svelte';
	import { ChevronLeft, ChevronRight } from 'lucide-svelte';

	interface Props {
		policiaisEscalaLocal: EscalaPolicialComDados[];
		isExpediente: boolean;
		isFDS: boolean;
		documentoAssinadoExiste: boolean;
		finalizadaEm: string | null;
		modoSelecao: boolean;
		selecionados: Set<number>;
		escala: Escala;
		horas: string[];
		minutos: string[];
		onSolicitarRemocao: (id: number, nome: string) => void;
		onToggleSelecionar: (id: number) => void;
	}

	let {
		policiaisEscalaLocal = $bindable(),
		isExpediente,
		isFDS,
		documentoAssinadoExiste,
		finalizadaEm,
		modoSelecao,
		selecionados = $bindable(),
		escala,
		horas,
		minutos,
		onSolicitarRemocao,
		onToggleSelecionar
	}: Props = $props();

	// === Edição inline ===
	let editingId = $state<number | null>(null);
	let editDataEntrada = $state('');
	let editDataSaida = $state('');
	let editHoraEntrada = $state('');
	let editMinutoEntrada = $state('');
	let editHoraSaida = $state('');
	let editMinutoSaida = $state('');
	let editObservacoes = $state('');
	let pendingEditar = $state(false);

	// === Paginação ===
	const SERV_POR_PAG = 50;
	let paginaServidor = $state(1);
	const policiaisEscalaPaginados = $derived(
		policiaisEscalaLocal.slice((paginaServidor - 1) * SERV_POR_PAG, paginaServidor * SERV_POR_PAG)
	);
	const totalPaginasServ = $derived(Math.ceil(policiaisEscalaLocal.length / SERV_POR_PAG));

	$effect(() => {
		// Reset page when list changes (add/remove)
		void policiaisEscalaLocal;
		paginaServidor = 1;
	});

	// === Helpers de horário ===
	function getHoraEntrada(p: EscalaPolicialComDados): string {
		return p.hora_entrada || escala?.hora_entrada || '08';
	}

	function getHoraSaida(p: EscalaPolicialComDados): string {
		return p.hora_saida || escala?.hora_saida || '08';
	}

	function getDataSaida(p: EscalaPolicialComDados): string {
		if (p.data_saida) return p.data_saida;
		return calcularDataSaida(p.data_plantao, getHoraEntrada(p), getHoraSaida(p));
	}

	// === Agrupamento ===
	function agruparPorData(items: EscalaPolicialComDados[]): Map<string, EscalaPolicialComDados[]> {
		const map = new Map<string, EscalaPolicialComDados[]>();
		for (const item of items) {
			const list = map.get(item.data_plantao) || [];
			list.push(item);
			map.set(item.data_plantao, list);
		}
		return new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
	}

	// === Formatação ===
	function formatarDataPlantao(p: EscalaPolicialComDados): string {
		const de = formatarData(p.data_plantao);
		const ds = getDataSaida(p);
		if (ds !== p.data_plantao) return `${de} à ${formatarData(ds)}`;
		return de;
	}

	function formatarHorario(p: EscalaPolicialComDados): string {
		return `${getHoraEntrada(p)}H A ${getHoraSaida(p)}H`;
	}

	function diaSemanaLabel(iso: string): string {
		return ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][new Date(iso + 'T12:00:00').getDay()];
	}

	// === Edição ===
	function startEdit(p: EscalaPolicialComDados) {
		editingId = p.id;
		editDataEntrada = p.data_plantao;
		editDataSaida = getDataSaida(p);
		const [he, me = '00'] = getHoraEntrada(p).split(':');
		editHoraEntrada = he;
		editMinutoEntrada = me;
		const [hs, ms = '00'] = getHoraSaida(p).split(':');
		editHoraSaida = hs;
		editMinutoSaida = ms;
		editObservacoes = p.observacoes || '';
	}

	function handleEditar() {
		pendingEditar = true;
		return async ({ result }: any) => {
			pendingEditar = false;
			if (result.type === 'success') {
				policiaisEscalaLocal = result.data.policiais;
				editingId = null;
				toaster.create({ title: 'Dados salvos', type: 'success' });
			} else if (result.type === 'error') {
				toaster.create({ title: 'Erro de conexão. Tente novamente.', type: 'error' });
			} else {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error || 'Erro ao salvar'), type: 'error' });
			}
		};
	}
</script>

{#if policiaisEscalaLocal.length === 0}
	<div class="text-center py-12 text-surface-500"><p>Nenhum policial nesta escala ainda.</p></div>
{:else}
	<!-- Agrupado por data (plantao/expediente) -->
	<div class="space-y-12">
		{#each agruparPorData(policiaisEscalaPaginados) as [dataGrupo, items]}
			<div
				class="card p-0 bg-white dark:bg-surface-900 border border-surface-200 dark:border-white/10 rounded-2xl shadow-xl overflow-visible"
			>
				<!-- Cabeçalho do grupo de data -->
				<div
					class="px-4 py-3 flex items-center gap-3 border-b border-surface-100 dark:border-white/5 bg-surface-50/50 dark:bg-surface-800/30 rounded-t-2xl"
				>
					<span class="font-bold text-sm text-surface-800 dark:text-surface-100">
						{isExpediente
							? 'Expediente do Mês'
							: `${diaSemanaLabel(dataGrupo)}, ${formatarData(dataGrupo)}`}
					</span>
					<span class="text-xs text-surface-400"
						>{items.length} servidor{items.length !== 1 ? 'es' : ''}</span
					>
				</div>

				<!-- Cards mobile (ocultos em sm+) -->
				<div class="sm:hidden divide-y divide-surface-100 dark:divide-white/5">
					{#each items as p (p.id)}
						{#if editingId === p.id}
							<div class="px-4 py-3 bg-primary-500/5 dark:bg-primary-500/8">
								<p
									class="text-[0.6rem] font-semibold text-primary-600 dark:text-primary-400 mb-2 uppercase tracking-wide"
								>
									Editando: {p.nome}
								</p>
								<form
									method="POST"
									action="?/editar"
									use:enhance={handleEditar}
									class="flex flex-wrap items-end gap-2"
								>
									<input type="hidden" name="item_id" value={editingId} />
									{#if isExpediente}
										<input type="hidden" name="hora_entrada" value="00:00" />
										<input type="hidden" name="hora_saida" value="23:59" />
										<input type="hidden" name="data_plantao" value={editDataEntrada} />
										<input type="hidden" name="data_saida" value={editDataSaida} />
										<div class="basis-[calc(50%-0.25rem)] min-w-0 flex-grow">
											<span class="label-text text-[0.6rem] block mb-0.5">Data Início</span>
											<input
												type="date"
												class="input text-xs h-8 px-2 rounded-lg w-full"
												bind:value={editDataEntrada}
											/>
										</div>
										<div class="basis-[calc(50%-0.25rem)] min-w-0 flex-grow">
											<span class="label-text text-[0.6rem] block mb-0.5">Data Fim</span>
											<input
												type="date"
												class="input text-xs h-8 px-2 rounded-lg w-full"
												bind:value={editDataSaida}
											/>
										</div>
										<div class="w-full">
											<span class="label-text text-[0.6rem] block mb-0.5">Observações</span>
											<input
												type="text"
												name="observacoes"
												class="input text-xs h-8 px-2 rounded-lg w-full"
												bind:value={editObservacoes}
												maxlength="500"
												placeholder="Informações complementares"
											/>
										</div>
									{:else}
										<div class="basis-[calc(50%-0.25rem)] min-w-0 flex-grow">
											<span class="label-text text-[0.6rem] block mb-0.5">Data Início</span>
											<input
												type="date"
												class="input text-xs h-8 px-2 rounded-lg w-full"
												bind:value={editDataEntrada}
											/>
										</div>
										<div class="basis-[calc(50%-0.25rem)] min-w-0 flex-grow">
											<span class="label-text text-[0.6rem] block mb-0.5">Data Saída</span>
											<input
												type="date"
												class="input text-xs h-8 px-2 rounded-lg w-full"
												bind:value={editDataSaida}
											/>
										</div>
										<div class="flex gap-2 w-full">
											<div class="flex-1">
												<span class="label-text text-[0.6rem] block mb-0.5">Entrada</span>
												<div class="flex gap-1">
													<select
														class="select text-xs h-8 py-0 rounded-lg flex-1 px-1"
														bind:value={editHoraEntrada}
														>{#each horas as h (h)}<option value={h}>{h}h</option>{/each}</select
													>
													<select
														class="select text-xs h-8 py-0 rounded-lg flex-1 px-1"
														bind:value={editMinutoEntrada}
														>{#each minutos as m (m)}<option value={m}>{m}m</option
															>{/each}</select
													>
												</div>
											</div>
											<div class="flex-1">
												<span class="label-text text-[0.6rem] block mb-0.5">Saída</span>
												<div class="flex gap-1">
													<select
														class="select text-xs h-8 py-0 rounded-lg flex-1 px-1"
														bind:value={editHoraSaida}
														>{#each horas as h (h)}<option value={h}>{h}h</option>{/each}</select
													>
													<select
														class="select text-xs h-8 py-0 rounded-lg flex-1 px-1"
														bind:value={editMinutoSaida}
														>{#each minutos as m (m)}<option value={m}>{m}m</option
															>{/each}</select
													>
												</div>
											</div>
										</div>
										<input
											type="hidden"
											name="hora_entrada"
											value="{editHoraEntrada}:{editMinutoEntrada}"
										/>
										<input
											type="hidden"
											name="hora_saida"
											value="{editHoraSaida}:{editMinutoSaida}"
										/>
										<input type="hidden" name="data_plantao" value={editDataEntrada} />
										<input type="hidden" name="data_saida" value={editDataSaida} />
										<input type="hidden" name="observacoes" value={editObservacoes} />
									{/if}
									<div class="flex gap-2 w-full mt-1">
										<button
											type="submit"
											class="btn btn-sm h-9 preset-filled-primary-500 rounded-lg px-4 font-bold flex-1"
											disabled={pendingEditar}>{pendingEditar ? 'Salvando...' : 'Salvar'}</button
										>
										<button
											type="button"
											class="h-9 px-4 flex items-center justify-center rounded-lg border border-surface-300 dark:border-surface-600 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-sm font-bold"
											onclick={() => (editingId = null)}>Cancelar</button
										>
									</div>
								</form>
							</div>
						{:else}
							<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
							<div
								class="flex items-start gap-3 px-4 py-3 hover:bg-surface-50/50 dark:hover:bg-surface-800/20 transition-colors {modoSelecao &&
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
											checked={selecionados.has(p.id)}
											onclick={(e) => e.stopPropagation()}
											onchange={() => onToggleSelecionar(p.id)}
										/>
									</div>
								{/if}
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2 flex-wrap mb-1">
										<span
											class="font-bold text-sm text-surface-900 dark:text-surface-100 uppercase leading-tight"
											>{p.nome}</span
										>
										<span
											class="badge px-1.5 py-0.5 rounded font-bold text-[0.55rem] uppercase {p.cargo ===
											'DPC'
												? 'bg-primary-500/20 text-primary-700 dark:text-primary-400 border border-primary-500/20'
												: 'bg-warning-500/20 text-warning-700 dark:text-warning-400 border border-warning-500/20'}"
											>{p.cargo}</span
										>
										{#if p.equipe && !isExpediente}
											<span
												class="text-[0.6rem] text-primary-600 dark:text-primary-400 font-bold uppercase"
												>Eq.{p.equipe}</span
											>
										{/if}
									</div>
									<div class="text-xs text-surface-500 space-y-0.5">
										<div class="font-mono tabular-nums">
											{p.matricula}{p.lotacao ? ' · ' + p.lotacao : ''}
										</div>
										<div class="flex gap-2 flex-wrap">
											{#if !isExpediente}<span>{formatarDataPlantao(p)}</span>{/if}
											{#if !isExpediente}<span
													class="font-medium text-surface-600 dark:text-surface-400"
													>{formatarHorario(p)}</span
												>{/if}
											{#if isExpediente && p.observacoes}<span class="italic"
													>{p.observacoes}</span
												>{/if}
										</div>
									</div>
								</div>
								{#if !documentoAssinadoExiste && !finalizadaEm && !modoSelecao}
									<div class="flex items-center gap-1 shrink-0 mt-0.5">
										<IconTooltip label="Editar">
											<button
												type="button"
												aria-label="Editar"
												class="p-1.5 rounded transition-colors text-surface-400 hover:text-primary-500 hover:bg-primary-500/10"
												onclick={() => startEdit(p)}
											>
												<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"
													><path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
													/></svg
												>
											</button>
										</IconTooltip>
										<button
											type="button"
											class="btn btn-sm preset-filled-error-500 rounded font-bold text-[0.65rem] uppercase px-2 py-0.5 active:scale-95 transition-all"
											onclick={() => onSolicitarRemocao(p.id, p.nome)}>Rem.</button
										>
									</div>
								{/if}
							</div>
						{/if}
					{/each}
				</div>

				<!-- Tabela desktop (oculta em mobile) -->
				<div class="table-container p-2 hidden sm:block">
					<table class="table w-full text-[0.7rem] sm:text-xs !bg-transparent">
						<thead>
							<tr class="!bg-transparent border-b border-surface-100 dark:border-white/5">
								{#if modoSelecao}
									{@const todosChecked =
										policiaisEscalaLocal.length > 0 &&
										policiaisEscalaLocal.every((p) => selecionados.has(p.id))}
									{@const algumChecked = selecionados.size > 0 && !todosChecked}
									<th class="!py-4 !px-4 text-surface-500 font-medium">
										<input
											type="checkbox"
											class="checkbox"
											checked={todosChecked}
											indeterminate={algumChecked}
											onchange={(e) => {
												if ((e.target as HTMLInputElement).checked) {
													selecionados = new Set(policiaisEscalaLocal.map((p) => p.id));
												} else {
													selecionados = new Set();
												}
											}}
										/>
									</th>
								{/if}
								<th class="!py-4 !px-4 text-surface-500 font-medium uppercase tracking-tight"
									>Nome</th
								>
								<th
									class="!py-4 text-center text-surface-500 font-medium uppercase tracking-tight"
									>Matricula</th
								>
								<th
									class="!py-4 text-center text-surface-500 font-medium uppercase tracking-tight"
									>Cargo</th
								>
								<th
									class="!py-4 text-center text-surface-500 font-medium uppercase tracking-tight"
									>Telefone</th
								>
								<th class="!py-4 text-surface-500 font-medium uppercase tracking-tight"
									>Lotação</th
								>
								<th
									class="!py-4 text-center text-surface-500 font-medium uppercase tracking-tight"
									>Data</th
								>
								<th
									class="!py-4 text-center text-surface-500 font-medium uppercase tracking-tight"
									>{isExpediente ? 'Observações' : 'Horário'}</th
								>
								{#if !modoSelecao}
									<th
										class="!py-4 !px-4 text-right text-surface-500 font-medium uppercase tracking-tight"
										>Ações</th
									>
								{/if}
							</tr>
						</thead>
						<tbody class="divide-y divide-surface-100 dark:divide-white/5">
							{#each items as p (p.id)}
								{#if editingId === p.id}
									<tr class="!bg-primary-500/5">
										<td colspan={modoSelecao ? 9 : 8} class="!py-4 !px-4">
											<form
												method="POST"
												action="?/editar"
												use:enhance={handleEditar}
												class="flex flex-wrap items-end gap-3"
											>
												<input type="hidden" name="item_id" value={editingId} />
												{#if isExpediente}
													<!-- Expediente: editar datas e observações (sem horário) -->
													<input type="hidden" name="hora_entrada" value="00:00" />
													<input type="hidden" name="hora_saida" value="23:59" />
													<input type="hidden" name="data_plantao" value={editDataEntrada} />
													<input type="hidden" name="data_saida" value={editDataSaida} />
													<div class="flex-1 min-w-0 sm:flex-none sm:min-w-[120px]">
														<label class="label mb-1">
															<span class="label-text text-[0.6rem]">Data Início</span>
															<input
																type="date"
																class="input text-xs h-8 px-2 rounded-lg w-full"
																bind:value={editDataEntrada}
															/>
														</label>
													</div>
													<div class="flex-1 min-w-0 sm:flex-none sm:min-w-[120px]">
														<label class="label mb-1">
															<span class="label-text text-[0.6rem]">Data Fim</span>
															<input
																type="date"
																class="input text-xs h-8 px-2 rounded-lg w-full"
																bind:value={editDataSaida}
															/>
														</label>
													</div>
													<div class="flex-1 min-w-0 basis-full sm:basis-auto sm:min-w-[200px]">
														<label class="label mb-1">
															<span class="label-text text-[0.6rem]">Observações</span>
															<input
																type="text"
																name="observacoes"
																class="input text-xs h-8 px-2 rounded-lg w-full"
																bind:value={editObservacoes}
																maxlength="500"
																placeholder="Informações complementares"
															/>
														</label>
													</div>
												{:else}
													<!-- Plantão: editar datas, horas e observações -->
													<div class="flex-1 min-w-0 sm:min-w-[120px]">
														<label class="label mb-1">
															<span class="label-text text-[0.6rem]">Data Início</span>
															<input
																type="date"
																class="input text-xs h-8 px-2 rounded-lg w-full"
																bind:value={editDataEntrada}
															/>
														</label>
													</div>
													<div class="flex-1 min-w-0 sm:min-w-[120px]">
														<label class="label mb-1">
															<span class="label-text text-[0.6rem]">Data Saída</span>
															<input
																type="date"
																class="input text-xs h-8 px-2 rounded-lg w-full"
																bind:value={editDataSaida}
															/>
														</label>
													</div>
													<div class="w-28">
														<label class="label mb-1">
															<span class="label-text text-[0.6rem]">Entrada</span>
															<div class="flex gap-1">
																<select
																	class="select text-xs h-8 py-0 rounded-lg flex-1 px-1"
																	bind:value={editHoraEntrada}
																	aria-label="Hora de Entrada"
																>
																	{#each horas as h (h)}<option value={h}>{h}</option>{/each}
																</select>
																<select
																	class="select text-xs h-8 py-0 rounded-lg flex-1 px-1"
																	bind:value={editMinutoEntrada}
																	aria-label="Minuto de Entrada"
																>
																	{#each minutos as m (m)}<option value={m}>{m}</option>{/each}
																</select>
															</div>
														</label>
													</div>
													<div class="w-28">
														<label class="label mb-1">
															<span class="label-text text-[0.6rem]">Saída</span>
															<div class="flex gap-1">
																<select
																	class="select text-xs h-8 py-0 rounded-lg flex-1 px-1"
																	bind:value={editHoraSaida}
																	aria-label="Hora de Saída"
																>
																	{#each horas as h (h)}<option value={h}>{h}</option>{/each}
																</select>
																<select
																	class="select text-xs h-8 py-0 rounded-lg flex-1 px-1"
																	bind:value={editMinutoSaida}
																	aria-label="Minuto de Saída"
																>
																	{#each minutos as m (m)}<option value={m}>{m}</option>{/each}
																</select>
															</div>
														</label>
													</div>
													<input
														type="hidden"
														name="hora_entrada"
														value="{editHoraEntrada}:{editMinutoEntrada}"
													/>
													<input
														type="hidden"
														name="hora_saida"
														value="{editHoraSaida}:{editMinutoSaida}"
													/>
													<input type="hidden" name="data_plantao" value={editDataEntrada} />
													<input type="hidden" name="data_saida" value={editDataSaida} />
													<input type="hidden" name="observacoes" value={editObservacoes} />
												{/if}
												<div class="flex gap-1 mt-1">
													<button
														type="submit"
														class="btn btn-sm h-8 preset-filled-primary-500 rounded-lg px-3 font-bold"
														disabled={pendingEditar}
													>
														{pendingEditar ? 'Salvando...' : 'Salvar'}
													</button>
													<button
														type="button"
														class="w-8 h-8 flex items-center justify-center rounded-lg border border-surface-300 dark:border-surface-600 text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-sm font-bold"
														onclick={() => (editingId = null)}>×</button
													>
												</div>
											</form>
										</td>
									</tr>
								{:else}
									<tr
										class="!bg-transparent hover:!bg-surface-100/50 dark:hover:!bg-surface-800/20 transition-colors {modoSelecao &&
										selecionados.has(p.id)
											? '!bg-error-500/5 dark:!bg-error-500/8'
											: ''}"
										role={modoSelecao ? 'button' : undefined}
										onclick={modoSelecao ? () => onToggleSelecionar(p.id) : undefined}
									>
										{#if modoSelecao}
											<td class="!py-4 !px-4 align-middle">
												<input
													type="checkbox"
													class="checkbox"
													checked={selecionados.has(p.id)}
													onclick={(e) => e.stopPropagation()}
													onchange={() => onToggleSelecionar(p.id)}
												/>
											</td>
										{/if}
										<td class="!py-4 !px-4 align-middle">
											<span
												class="font-bold text-surface-900 dark:text-surface-100 uppercase block leading-tight"
											>
												{p.nome}
											</span>
											{#if p.equipe && !isFDS && !isExpediente}
												<span
													class="text-[0.6rem] text-primary-600 dark:text-primary-400 font-bold uppercase"
												>
													Equipe {p.equipe}
												</span>
											{/if}
										</td>
										<td class="!py-4 text-center align-middle opacity-80 font-mono tabular-nums"
											>{p.matricula}</td
										>
										<td class="!py-4 text-center align-middle">
											<span
												class="badge px-1.5 py-0.5 rounded font-bold text-[0.55rem] uppercase {p.cargo ===
												'DPC'
													? 'bg-primary-500/20 text-primary-700 dark:text-primary-400 border border-primary-500/20'
													: 'bg-warning-500/20 text-warning-700 dark:text-warning-400 border border-warning-500/20'}"
											>
												{p.cargo}
											</span>
										</td>
										<td class="!py-4 text-center align-middle text-surface-500 whitespace-nowrap"
											>{p.telefone || '-'}</td
										>
										<td class="!py-4 align-middle text-surface-500 leading-tight max-w-[150px]"
											>{p.lotacao || '-'}</td
										>
										<td class="!py-4 text-center align-middle">
											<div
												class="inline-block px-2 py-1 rounded border border-dashed border-surface-200 dark:border-surface-700 bg-surface-50/50 dark:bg-surface-800/30 text-[0.6rem] whitespace-nowrap font-mono tabular-nums"
											>
												{formatarDataPlantao(p)}
											</div>
										</td>
										<td class="!py-4 text-center align-middle max-w-[200px]">
											{#if isExpediente}
												<span
													class="text-[0.65rem] text-surface-600 dark:text-surface-400 italic"
												>
													{p.observacoes || '—'}
												</span>
											{:else}
												<div
													class="inline-block px-2 py-1 rounded border border-dashed border-surface-200 dark:border-surface-700 bg-surface-50/50 dark:bg-surface-800/30 text-[0.6rem] font-bold uppercase whitespace-nowrap font-mono tabular-nums"
												>
													{formatarHorario(p)}
												</div>
											{/if}
										</td>
										{#if !modoSelecao}
											<td class="!py-4 !px-4 text-right align-middle">
												<div class="flex items-center justify-end gap-1">
													{#if !documentoAssinadoExiste && !finalizadaEm}
														<IconTooltip label="Editar">
															<button
																type="button"
																aria-label="Editar"
																class="p-1.5 rounded transition-colors text-surface-400 hover:text-primary-500 hover:bg-primary-500/10"
																onclick={() => startEdit(p)}
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
																		d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
																	/>
																</svg>
															</button>
														</IconTooltip>
														<button
															type="button"
															class="btn btn-sm preset-filled-error-500 rounded font-bold text-[0.65rem] uppercase px-2 py-0.5 active:scale-95 transition-all"
															onclick={() => onSolicitarRemocao(p.id, p.nome)}
														>
															Remover
														</button>
													{/if}
												</div>
											</td>
										{/if}
									</tr>
								{/if}
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/each}
	</div>
	{#if totalPaginasServ > 1}
		<div class="mt-5 pt-4 border-t border-surface-200 dark:border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3 px-1">
			<span class="text-xs text-surface-500">
				Exibindo {(paginaServidor - 1) * SERV_POR_PAG + 1}–{Math.min(
					paginaServidor * SERV_POR_PAG,
					policiaisEscalaLocal.length
				)} de {policiaisEscalaLocal.length} servidores
			</span>
			<Pagination
				count={policiaisEscalaLocal.length}
				pageSize={SERV_POR_PAG}
				page={paginaServidor}
				onPageChange={(e) => (paginaServidor = e.page)}
				siblingCount={1}
			>
				<Pagination.PrevTrigger class="btn btn-sm preset-outlined-surface-500" aria-label="Página anterior">
					<ChevronLeft size={16} />
				</Pagination.PrevTrigger>
				<Pagination.Context>
					{#snippet children(pagination)}
						{#each pagination().pages as p, index (p)}
							{#if p.type === 'page'}
								<Pagination.Item
									{...p}
									class="btn btn-sm min-w-[32px] {p.value === paginaServidor
										? 'preset-filled-primary-500'
										: 'preset-outlined-surface-500'}"
								>{p.value}</Pagination.Item>
							{:else}
								<Pagination.Ellipsis {index} class="px-1 opacity-50">&#8230;</Pagination.Ellipsis>
							{/if}
						{/each}
					{/snippet}
				</Pagination.Context>
				<Pagination.NextTrigger class="btn btn-sm preset-outlined-surface-500" aria-label="Próxima página">
					<ChevronRight size={16} />
				</Pagination.NextTrigger>
			</Pagination>
		</div>
	{/if}
{/if}
