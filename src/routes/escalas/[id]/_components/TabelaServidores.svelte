<script lang="ts">
	/**
	 * Tabela de escalados da escala de EXPEDIENTE — uma linha por policial, sem
	 * dias de plantão (é o que `isExpediente` controla).
	 *
	 * As outras duas visões da mesma escala são `TabelaPlantao` (plantão, com os
	 * dias de cada um) e `ListaFds` (fim de semana, agrupada por dia). As três
	 * dividem os helpers de horário e a edição inline (`criarHelpersHorario`,
	 * `useEdicaoInlineServidor`): calcular data de saída de turno que vira o dia é
	 * regra do domínio, não de cada tela.
	 *
	 * Paginação em 50 é do CLIENTE — a escala inteira já veio no `load`, e
	 * paginar aqui é só para o DOM não montar centenas de linhas editáveis de uma
	 * vez.
	 *
	 * A edição só existe quando `podeEditarEscala`; escala com documento assinado
	 * ou finalizada fica somente-leitura, porque alterar depois invalidaria a
	 * assinatura que já está no PDF.
	 */
	import { enhance } from '$app/forms';
	import { formatarData } from '$lib/utils/datas';
	import type { Escala } from '$lib/server/schema';
	import type { EscalaPolicialComDados } from '$lib/types';
	import IconTooltip from '$lib/components/IconTooltip.svelte';
	import EstadoVazio from '$lib/components/EstadoVazio.svelte';
	import Paginador from '$lib/components/Paginador.svelte';
	import SeletorHoraMinuto from '$lib/components/SeletorHoraMinuto.svelte';
	import { criarHelpersHorario, diaSemanaLabel } from './escala-horarios';
	import { useEdicaoInlineServidor } from './useEdicaoInlineServidor.svelte';
	import PenLine from '@lucide/svelte/icons/pen-line';

	interface Props {
		policiaisEscalaLocal: EscalaPolicialComDados[];
		isExpediente: boolean;
		isFDS: boolean;
		podeEditarEscala: boolean;
		documentoAssinadoExiste: boolean;
		finalizadaEm: string | null;
		modoSelecao: boolean;
		selecionados: Set<number>;
		escala: Escala;
		onSolicitarRemocao: (id: number, nome: string) => void;
		onToggleSelecionar: (id: number) => void;
	}

	let {
		policiaisEscalaLocal = $bindable(),
		isExpediente,
		isFDS,
		podeEditarEscala,
		documentoAssinadoExiste,
		finalizadaEm,
		modoSelecao,
		selecionados = $bindable(),
		escala,
		onSolicitarRemocao,
		onToggleSelecionar
	}: Props = $props();

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

	// === Helpers de horário (compartilhados com ListaFds) ===
	const { getHoraEntrada, getHoraSaida, getDataSaida, formatarHorario, formatarDataPlantao } =
		criarHelpersHorario(() => escala);

	// === Agrupamento ===
	function agruparPorData(items: EscalaPolicialComDados[]): Map<string, EscalaPolicialComDados[]> {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const map = new Map<string, EscalaPolicialComDados[]>();
		for (const item of items) {
			const list = map.get(item.data_plantao) || [];
			list.push(item);
			map.set(item.data_plantao, list);
		}

		return new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
	}

	// === Edição inline (compartilhada com ListaFds) ===
	const edicao = useEdicaoInlineServidor({
		helpers: { getDataSaida, getHoraEntrada, getHoraSaida },
		aplicarPoliciais: (p) => (policiaisEscalaLocal = p)
	});
</script>

{#if policiaisEscalaLocal.length === 0}
	<EstadoVazio tom="muted" mensagem="Nenhum policial nesta escala ainda." />
{:else}
	<!-- Agrupado por data (plantao/expediente) -->
	<div class="space-y-12">
		{#each agruparPorData(policiaisEscalaPaginados) as [dataGrupo, items] (dataGrupo)}
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
					<span class="text-xs text-surface-500 dark:text-surface-400"
						>{items.length} servidor{items.length !== 1 ? 'es' : ''}</span
					>
				</div>

				<!-- Cards mobile (ocultos em sm+) -->
				<div class="sm:hidden divide-y divide-surface-100 dark:divide-white/5">
					{#each items as p (p.id)}
						{#if edicao.editingId === p.id}
							<div class="px-4 py-3 bg-primary-500/5 dark:bg-primary-500/8">
								<p
									class="text-2xs font-semibold text-primary-600 dark:text-primary-400 mb-2 uppercase tracking-wide"
								>
									Editando: {p.nome}
								</p>
								<form
									method="POST"
									action="?/editar"
									use:enhance={edicao.handleEditar}
									class="flex flex-wrap items-end gap-2"
								>
									<input type="hidden" name="item_id" value={edicao.editingId} />
									{#if isExpediente}
										<input type="hidden" name="hora_entrada" value="00:00" />
										<input type="hidden" name="hora_saida" value="23:59" />
										<input type="hidden" name="data_plantao" value={edicao.dataEntrada} />
										<input type="hidden" name="data_saida" value={edicao.dataSaida} />
										<div class="basis-full min-w-0">
											<span class="label-text text-2xs block mb-0.5">Observações</span>
											<input
												type="text"
												name="observacoes"
												class="input text-xs h-8 px-2 rounded-lg w-full"
												bind:value={edicao.observacoes}
												maxlength="500"
												placeholder="Informações complementares"
											/>
										</div>
									{:else}
										<div class="basis-[calc(50%-0.25rem)] min-w-0 flex-grow">
											<span class="label-text text-2xs block mb-0.5">Data Início</span>
											<input
												type="date"
												class="input text-xs h-8 px-2 rounded-lg w-full"
												bind:value={edicao.dataEntrada}
											/>
										</div>
										<div class="basis-[calc(50%-0.25rem)] min-w-0 flex-grow">
											<span class="label-text text-2xs block mb-0.5">Data Saída</span>
											<input
												type="date"
												class="input text-xs h-8 px-2 rounded-lg w-full"
												bind:value={edicao.dataSaida}
											/>
										</div>
										<div class="flex gap-2 w-full">
											<div class="flex-1">
												<span class="label-text text-2xs block mb-0.5">Entrada</span>
												<SeletorHoraMinuto
													bind:hora={edicao.horaEntrada}
													bind:minuto={edicao.minutoEntrada}
													selectClass="select text-xs h-8 py-0 rounded-lg flex-1 px-1"
												/>
											</div>
											<div class="flex-1">
												<span class="label-text text-2xs block mb-0.5">Saída</span>
												<SeletorHoraMinuto
													bind:hora={edicao.horaSaida}
													bind:minuto={edicao.minutoSaida}
													selectClass="select text-xs h-8 py-0 rounded-lg flex-1 px-1"
												/>
											</div>
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
									{/if}
									<div class="flex gap-2 w-full mt-1">
										<button
											type="submit"
											class="btn btn-sm preset-filled-primary-500 rounded-lg px-4 font-bold flex-1"
											disabled={edicao.pending}>{edicao.pending ? 'Salvando...' : 'Salvar'}</button
										>
										<button
											type="button"
											class="h-9 px-4 flex items-center justify-center rounded-lg border border-surface-300 dark:border-surface-600 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-sm font-bold"
											onclick={() => (edicao.editingId = null)}>Cancelar</button
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
											class="badge px-1.5 py-0.5 rounded font-bold text-3xs uppercase {p.cargo ===
											'DPC'
												? 'bg-primary-500/20 text-primary-700 dark:text-primary-400 border border-primary-500/20'
												: 'bg-warning-500/20 text-warning-700 dark:text-warning-400 border border-warning-500/20'}"
											>{p.cargo}</span
										>
										{#if p.equipe && !isExpediente}
											<span
												class="text-2xs text-primary-600 dark:text-primary-400 font-bold uppercase"
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
											{#if isExpediente && p.observacoes}<span class="italic">{p.observacoes}</span
												>{/if}
										</div>
									</div>
								</div>
								{#if podeEditarEscala && !documentoAssinadoExiste && !finalizadaEm && !modoSelecao}
									<div class="flex items-center gap-1 shrink-0 mt-0.5">
										<IconTooltip label="Editar">
											<button
												type="button"
												aria-label="Editar"
												class="p-1.5 rounded transition-colors text-surface-400 hover:text-primary-500 hover:bg-primary-500/10"
												onclick={() => edicao.startEdit(p)}
											>
												<PenLine class="w-4 h-4" aria-hidden="true" />
											</button>
										</IconTooltip>
										<button
											type="button"
											class="btn btn-sm preset-filled-error-500 rounded font-bold text-3xs uppercase px-2 transition-all"
											onclick={() => onSolicitarRemocao(p.id, p.nome)}>Rem.</button
										>
									</div>
								{/if}
							</div>
						{/if}
					{/each}
				</div>

				<!-- Tabela desktop (oculta em mobile) -->
				<div class="table-wrap p-2 hidden sm:block">
					<table class="table w-full text-xs !bg-transparent">
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
								<th class="!py-4 text-center text-surface-500 font-medium uppercase tracking-tight"
									>Matricula</th
								>
								<th class="!py-4 text-center text-surface-500 font-medium uppercase tracking-tight"
									>Cargo</th
								>
								<th class="!py-4 text-center text-surface-500 font-medium uppercase tracking-tight"
									>Telefone</th
								>
								{#if isExpediente}
									<th
										class="!py-4 text-center text-surface-500 font-medium uppercase tracking-tight"
										>Classe</th
									>
								{/if}
								<th class="!py-4 text-surface-500 font-medium uppercase tracking-tight">Lotação</th>
								{#if isExpediente}
									<th
										class="!py-4 text-center text-surface-500 font-medium uppercase tracking-tight"
										>Regime</th
									>
								{/if}
								{#if !isExpediente}
									<th
										class="!py-4 text-center text-surface-500 font-medium uppercase tracking-tight"
										>Data</th
									>
								{/if}
								<th class="!py-4 text-center text-surface-500 font-medium uppercase tracking-tight"
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
								{#if edicao.editingId === p.id}
									<tr class="!bg-primary-500/5">
										<td colspan={modoSelecao ? 9 : 8} class="!py-4 !px-4">
											<form
												method="POST"
												action="?/editar"
												use:enhance={edicao.handleEditar}
												class="flex flex-wrap items-end gap-3"
											>
												<input type="hidden" name="item_id" value={edicao.editingId} />
												{#if isExpediente}
													<!-- Expediente: editar apenas observações -->
													<input type="hidden" name="hora_entrada" value="00:00" />
													<input type="hidden" name="hora_saida" value="23:59" />
													<input type="hidden" name="data_plantao" value={edicao.dataEntrada} />
													<input type="hidden" name="data_saida" value={edicao.dataSaida} />
													<div class="flex-1 min-w-0 basis-full sm:basis-auto sm:min-w-[200px]">
														<label class="label mb-1">
															<span class="label-text text-2xs">Observações</span>
															<input
																type="text"
																name="observacoes"
																class="input text-xs h-8 px-2 rounded-lg w-full"
																bind:value={edicao.observacoes}
																maxlength="500"
																placeholder="Informações complementares"
															/>
														</label>
													</div>
												{:else}
													<!-- Plantão: editar datas, horas e observações -->
													<div class="flex-1 min-w-0 sm:min-w-[120px]">
														<label class="label mb-1">
															<span class="label-text text-2xs">Data Início</span>
															<input
																type="date"
																class="input text-xs h-8 px-2 rounded-lg w-full"
																bind:value={edicao.dataEntrada}
															/>
														</label>
													</div>
													<div class="flex-1 min-w-0 sm:min-w-[120px]">
														<label class="label mb-1">
															<span class="label-text text-2xs">Data Saída</span>
															<input
																type="date"
																class="input text-xs h-8 px-2 rounded-lg w-full"
																bind:value={edicao.dataSaida}
															/>
														</label>
													</div>
													<div class="w-28">
														<label class="label mb-1">
															<span class="label-text text-2xs">Entrada</span>
															<SeletorHoraMinuto
																bind:hora={edicao.horaEntrada}
																bind:minuto={edicao.minutoEntrada}
																sufixoHora=""
																sufixoMinuto=""
																ariaLabelHora="Hora de Entrada"
																ariaLabelMinuto="Minuto de Entrada"
																selectClass="select text-xs h-8 py-0 rounded-lg flex-1 px-1"
															/>
														</label>
													</div>
													<div class="w-28">
														<label class="label mb-1">
															<span class="label-text text-2xs">Saída</span>
															<SeletorHoraMinuto
																bind:hora={edicao.horaSaida}
																bind:minuto={edicao.minutoSaida}
																sufixoHora=""
																sufixoMinuto=""
																ariaLabelHora="Hora de Saída"
																ariaLabelMinuto="Minuto de Saída"
																selectClass="select text-xs h-8 py-0 rounded-lg flex-1 px-1"
															/>
														</label>
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
												{/if}
												<div class="flex gap-1 mt-1">
													<button
														type="submit"
														class="btn btn-sm preset-filled-primary-500 rounded-lg px-3 font-bold"
														disabled={edicao.pending}
													>
														{edicao.pending ? 'Salvando...' : 'Salvar'}
													</button>
													<button
														type="button"
														class="w-8 h-8 flex items-center justify-center rounded-lg border border-surface-300 dark:border-surface-600 text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-sm font-bold"
														onclick={() => (edicao.editingId = null)}>×</button
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
													class="text-2xs text-primary-600 dark:text-primary-400 font-bold uppercase"
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
												class="badge px-1.5 py-0.5 rounded font-bold text-3xs uppercase {p.cargo ===
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
										{#if isExpediente}
											<td class="!py-4 text-center align-middle text-surface-500 whitespace-nowrap"
												>{p.classe || '-'}</td
											>
										{/if}
										<td class="!py-4 align-middle text-surface-500 leading-tight max-w-[150px]"
											>{p.lotacao || '-'}</td
										>
										{#if isExpediente}
											<td class="!py-4 text-center align-middle text-surface-500 whitespace-nowrap"
												>{p.regime || '-'}</td
											>
										{/if}
										{#if !isExpediente}
											<td class="!py-4 text-center align-middle">
												<div
													class="inline-block px-2 py-1 rounded border border-dashed border-surface-200 dark:border-surface-700 bg-surface-50/50 dark:bg-surface-800/30 text-2xs whitespace-nowrap font-mono tabular-nums"
												>
													{formatarDataPlantao(p)}
												</div>
											</td>
										{/if}
										<td class="!py-4 text-center align-middle max-w-[200px]">
											{#if isExpediente}
												<span class="text-3xs text-surface-600 dark:text-surface-400 italic">
													{p.observacoes || '—'}
												</span>
											{:else}
												<div
													class="inline-block px-2 py-1 rounded border border-dashed border-surface-200 dark:border-surface-700 bg-surface-50/50 dark:bg-surface-800/30 text-2xs font-bold uppercase whitespace-nowrap font-mono tabular-nums"
												>
													{formatarHorario(p)}
												</div>
											{/if}
										</td>
										{#if !modoSelecao}
											<td class="!py-4 !px-4 text-right align-middle">
												<div class="flex items-center justify-end gap-1">
													{#if podeEditarEscala && !documentoAssinadoExiste && !finalizadaEm}
														<IconTooltip label="Editar">
															<button
																type="button"
																aria-label="Editar"
																class="p-1.5 rounded transition-colors text-surface-400 hover:text-primary-500 hover:bg-primary-500/10"
																onclick={() => edicao.startEdit(p)}
															>
																<PenLine class="w-3.5 h-3.5" aria-hidden="true" />
															</button>
														</IconTooltip>
														<button
															type="button"
															class="btn btn-sm preset-filled-error-500 rounded font-bold text-3xs uppercase px-2 transition-all"
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
		<div
			class="mt-5 pt-4 border-t border-surface-200 dark:border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3 px-1"
		>
			<span class="text-xs text-surface-500">
				Exibindo {(paginaServidor - 1) * SERV_POR_PAG + 1}–{Math.min(
					paginaServidor * SERV_POR_PAG,
					policiaisEscalaLocal.length
				)} de {policiaisEscalaLocal.length} servidores
			</span>
			<Paginador
				count={policiaisEscalaLocal.length}
				pageSize={SERV_POR_PAG}
				page={paginaServidor}
				onPageChange={(p) => (paginaServidor = p)}
			/>
		</div>
	{/if}
{/if}
