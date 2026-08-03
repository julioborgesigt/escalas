<script lang="ts">
	/**
	 * Tabela da visão `lista` de `/escalas`: uma linha por escala, com o estado
	 * (rascunho, aguardando assinatura, assinada) e as ações disponíveis para o
	 * papel de quem olha.
	 *
	 * É componente de APRESENTAÇÃO — nenhuma mutação acontece aqui. Toda ação
	 * sobe por callback (`onSolicitarEdicao`, `onCancelarSolicitacao`, …) para a
	 * página, que é quem tem os forms e a invalidação. Assim a mesma tabela serve
	 * a admin e a OIP sem carregar as regras dos dois.
	 *
	 * `solicitacoesMap` chega indexado por `escala_id` justamente para o selo de
	 * "aguardando assinatura" não custar uma consulta por linha (N+1).
	 *
	 * Não há estado "escolha uma unidade": o Admin Geral é redirecionado antes de
	 * chegar aqui, então quem abre esta tabela sempre tem lotação definida pelo
	 * papel. Lista vazia é lista vazia.
	 */
	import { Popover, Portal } from '@skeletonlabs/skeleton-svelte';
	import { slide, fly } from 'svelte/transition';
	import { page } from '$app/state';
	import type { EscalaListagem } from '$lib/types';
	import { formatarData, MESES_PT } from '$lib/utils/datas';
	import SkeletonCards from '$lib/components/SkeletonCards.svelte';
	import SkeletonTableRows from '$lib/components/SkeletonTableRows.svelte';
	import { useSamePathNavigating } from '$lib/composables';
	import PaginationControls from '$lib/components/PaginationControls.svelte';
	import IconTooltip from '$lib/components/IconTooltip.svelte';
	import { podeBaixarComManifesto } from '$lib/manifesto';
	import { Clock, Download, SquarePen } from '@lucide/svelte';

	type SolicitacaoInfo = {
		tipo: 'unidade' | 'respondencia';
		destinatario_nome?: string;
		destinatario_id?: number;
	};

	const {
		escalas,
		podeOIPSolicitar,
		solicitacoesMap,
		paginaAtual,
		totalPaginas,
		onSolicitarEdicao,
		onSolicitarExclusao,
		onAbrirDialogSolicitar,
		onCancelarSolicitacao,
		onNovaEscala,
		onPageChange
	}: {
		escalas: EscalaListagem[];
		podeOIPSolicitar: boolean;
		solicitacoesMap: Record<number, SolicitacaoInfo>;
		paginaAtual: number;
		totalPaginas: number;
		onSolicitarEdicao: (esc: EscalaListagem) => void;
		onSolicitarExclusao: (id: number, titulo: string) => void;
		onAbrirDialogSolicitar: (id: number) => void;
		onCancelarSolicitacao: (id: number) => void;
		onNovaEscala: () => void;
		onPageChange: (p: number) => void;
	} = $props();

	let menuExpandidoId = $state<number | null>(null);

	// Só Admin Geral/Super recebe o blob COM manifesto forense (a regra do endpoint
	// de escalas roda sem assinanteId); os demais só baixam a cópia de conferência.
	const podeManifesto = $derived(podeBaixarComManifesto(page.data.usuario));

	const ITEMS_POR_PAGINA = 20;

	const samePathNav = useSamePathNavigating();
</script>

{#if escalas.length === 0}
	<div class="text-center py-12 text-surface-600 dark:text-surface-400">
		<p class="mb-4">Nenhuma escala criada para os filtros selecionados.</p>
		<button
			type="button"
			class="btn preset-filled-primary-500 transition-all"
			onclick={onNovaEscala}>Criar Escala</button
		>
	</div>
{:else}
	<div class="hidden lg:block table-wrap">
		<table class="table">
			<thead>
				<tr>
					<!-- Larguras proporcionais para espaçar as colunas de forma uniforme e
					     evitar que a folga vire um vão único (ex.: entre Status e Ações).
					     Ações mantém ~28% para caber a fileira de botões sem quebrar. -->
					<th class="w-[30%]">Título</th>
					<th class="w-[12%] whitespace-nowrap">Cidade</th>
					<th class="w-[14%] whitespace-nowrap">Período</th>
					<th class="w-[16%] whitespace-nowrap">Status</th>
					<th class="w-[28%] whitespace-nowrap">Ações</th>
				</tr>
			</thead>
			<tbody>
				{#if samePathNav.current}
					<SkeletonTableRows
						cols={[
							'h-4 w-36',
							'h-4 w-20',
							'h-4 w-32',
							'h-6 w-24 rounded-full',
							'h-8 w-32 rounded-lg'
						]}
					/>
				{:else}
					{#each escalas as esc (esc.id)}
						{@const dRow = new Date(esc.data_inicio + 'T00:00:00')}
						<tr>
							<td>
								<div class="flex flex-col gap-0.5">
									{#if esc.tipo === 'expediente'}
										<span
											class="badge preset-outlined-secondary-500 font-bold text-xs px-2 py-0.5 w-fit"
											>Expediente</span
										>
									{:else if esc.tipo === 'fds'}
										<span
											class="badge preset-outlined-tertiary-500 font-bold text-xs px-2 py-0.5 w-fit"
											>FDS</span
										>
									{:else}
										<span
											class="badge preset-outlined-primary-500 font-bold text-xs px-2 py-0.5 w-fit"
											>Plantão</span
										>
									{/if}
									<a href="/escalas/{esc.id}" class="anchor text-sm font-semibold">
										{esc.tipo !== 'fds'
											? `${MESES_PT[dRow.getMonth()]} ${dRow.getFullYear()}`
											: `${formatarData(esc.data_inicio)} a ${formatarData(esc.data_fim)}`}
									</a>
									<span class="text-xs text-surface-600 dark:text-surface-400 truncate"
										>{esc.lotacao}</span
									>
								</div>
							</td>
							<td>{esc.cidade}</td>
							<td class="font-mono tabular-nums text-sm">
								<div class="flex flex-col leading-snug">
									<span>{formatarData(esc.data_inicio)}</span>
									<span class="text-surface-400 dark:text-surface-500 text-xs">a</span>
									<span>{formatarData(esc.data_fim)}</span>
								</div>
							</td>
							<td>
								{#if esc.is_assinada}
									<span
										class="badge preset-filled-success-500 font-bold px-2 py-1 flex items-center gap-1 w-max shadow-sm"
									>
										<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"
											><path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M5 13l4 4L19 7"
											/></svg
										>
										Assinada
									</span>
								{:else if esc.tipo === 'fds' && esc.finalizada_em}
									<span
										class="badge preset-filled-success-500 font-bold px-2 py-1 flex items-center gap-1 w-max shadow-sm"
									>
										<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"
											><path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M5 13l4 4L19 7"
											/></svg
										>
										Enviada
									</span>
								{:else if (esc.tipo === 'plantao' || esc.tipo === 'expediente') && solicitacoesMap[esc.id]}
									<span
										class="badge preset-tonal-warning font-bold px-2 py-1 flex items-center gap-1 w-max shadow-sm"
									>
										<Clock class="w-4 h-4" aria-hidden="true" />
										Ass. Pendente
									</span>
								{:else}
									<span
										class="badge preset-tonal-surface font-bold px-2 py-1 flex items-center gap-1 w-max shadow-sm"
									>
										<SquarePen class="w-4 h-4" aria-hidden="true" />
										{esc.tipo === 'fds' ? 'Pendente' : 'Em preenchimento'}
									</span>
								{/if}
							</td>
							<td>
								<div class="flex gap-2 justify-end">
									<button
										type="button"
										class="btn btn-sm {esc.is_assinada
											? 'preset-filled-warning-500'
											: 'preset-outlined-primary-500'}"
										onclick={() => onSolicitarEdicao(esc)}
									>
										{esc.is_assinada ? 'Editar' : 'Abrir'}
									</button>
									<Popover positioning={{ placement: 'bottom-end', offset: { mainAxis: 4 } }}>
										<Popover.Trigger class="btn btn-sm preset-outlined-primary-500"
											>Exportar ▾</Popover.Trigger
										>
										<Portal>
											<Popover.Positioner class="z-50">
												<Popover.Content
													class="card p-1 bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-white/10 shadow-xl flex flex-col min-w-[160px] max-w-[calc(100vw-1rem)]"
												>
													{#if esc.is_assinada}
														<a
															class="w-full text-left px-4 py-2 text-sm font-bold text-success-600 dark:text-success-400 rounded hover:bg-success-500/10 transition-colors flex items-center gap-2 no-underline"
															href={`/api/escalas/${esc.id}/documento-assinado`}
															target="_blank"
															title={podeManifesto
																? 'PDF para impressão e distribuição (sem folha de auditoria)'
																: 'PDF assinado para impressão e distribuição'}
														>
															<Download class="w-4 h-4" aria-hidden="true" />
															{podeManifesto ? 'PDF Oficial (s/ manifesto)' : 'PDF Oficial'}
														</a>
														{#if podeManifesto}
															<a
																class="w-full text-left px-4 py-2 text-sm font-bold text-tertiary-600 dark:text-tertiary-400 rounded hover:bg-tertiary-500/10 transition-colors flex items-center gap-2 no-underline"
																href={`/api/escalas/${esc.id}/documento-assinado?manifesto=true`}
																target="_blank"
																title="PDF com folha de auditoria (evidências da assinatura)"
															>
																<svg
																	class="w-4 h-4"
																	fill="none"
																	viewBox="0 0 24 24"
																	stroke="currentColor"
																	><path
																		stroke-linecap="round"
																		stroke-linejoin="round"
																		stroke-width="2"
																		d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
																	/></svg
																>
																PDF Oficial (c/ manifesto)
															</a>
														{/if}
														<hr class="opacity-10 my-1" />
													{/if}
													<a
														class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
														href={`/api/escalas/${esc.id}/download?format=docx`}
														target="_blank">Word (.docx)</a
													>
													<a
														class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
														href={`/api/escalas/${esc.id}/download?format=excel`}
														target="_blank">Excel (.xlsx)</a
													>
													<a
														class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
														href={`/api/escalas/${esc.id}/download?format=pdf`}
														target="_blank">PDF (.pdf)</a
													>
												</Popover.Content>
											</Popover.Positioner>
										</Portal>
									</Popover>
									{#if podeOIPSolicitar && (esc.tipo === 'plantao' || esc.tipo === 'expediente') && !esc.is_assinada}
										{#if solicitacoesMap[esc.id]}
											<button
												type="button"
												class="btn btn-sm preset-outlined-error-500"
												onclick={() => onCancelarSolicitacao(esc.id)}>Cancelar Ass.</button
											>
										{:else}
											<button
												type="button"
												class="btn btn-sm preset-filled-success-500 transition-all"
												onclick={() => onAbrirDialogSolicitar(esc.id)}>Solicitar Ass.</button
											>
										{/if}
									{:else if podeOIPSolicitar && esc.tipo === 'fds'}
										<!-- FDS não passa por assinatura digital (é finalizada e enviada por
										     e-mail). Mantemos o botão no lugar, desabilitado, para o layout
										     ficar consistente e explicar o porquê no hover. -->
										<IconTooltip label="Escalas de FDS não necessitam de assinatura.">
											<button
												type="button"
												class="btn btn-sm preset-outlined-surface-500 opacity-50 cursor-not-allowed"
												aria-disabled="true"
												tabindex={-1}
												onclick={(e) => e.preventDefault()}>Solicitar Ass.</button
											>
										</IconTooltip>
									{/if}
									<button
										type="button"
										class="btn btn-sm preset-filled-error-500 transition-all"
										onclick={() => onSolicitarExclusao(esc.id, esc.titulo)}>Excluir</button
									>
								</div>
							</td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>

	<div class="lg:hidden space-y-3">
		{#if samePathNav.current}
			<SkeletonCards />
		{:else}
			{#each escalas as esc, i (esc.id)}
				{@const d = new Date(esc.data_inicio + 'T00:00:00')}
				<div
					transition:fly={{ y: 8, delay: i * 30, duration: 200 }}
					class="p-4 rounded-2xl bg-surface-100/50 dark:bg-surface-800/50 border border-surface-200 dark:border-white/10 hover:border-primary-500/30 transition-colors"
				>
					<div class="flex justify-between items-start mb-3 gap-2">
						<div class="min-w-0 flex-1">
							{#if esc.tipo === 'expediente'}
								<span
									class="badge preset-outlined-secondary-500 font-bold text-3xs px-2 py-0.5 mb-0.5 inline-block"
									>Expediente</span
								>
							{:else if esc.tipo === 'fds'}
								<span
									class="badge preset-outlined-tertiary-500 font-bold text-3xs px-2 py-0.5 mb-0.5 inline-block"
									>FDS</span
								>
							{:else}
								<span
									class="badge preset-outlined-primary-500 font-bold text-3xs px-2 py-0.5 mb-0.5 inline-block"
									>Plantão</span
								>
							{/if}
							<a
								href="/escalas/{esc.id}"
								class="font-bold text-sm text-surface-900 dark:text-surface-50 no-underline hover:text-primary-500 dark:hover:text-primary-400 leading-tight block"
							>
								{esc.tipo !== 'fds'
									? `${MESES_PT[d.getMonth()]} ${d.getFullYear()}`
									: `${formatarData(esc.data_inicio)} a ${formatarData(esc.data_fim)}`}
							</a>
							<p class="text-xs text-surface-600 dark:text-surface-400 truncate">{esc.lotacao}</p>
						</div>
						{#if esc.is_assinada}
							<span
								class="badge preset-filled-success-500 font-bold px-1.5 py-0.5 text-3xs rounded-full flex items-center gap-1 shadow-sm"
							>
								<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M5 13l4 4L19 7"
									/></svg
								>
								Assinada
							</span>
						{:else if esc.tipo === 'fds' && esc.finalizada_em}
							<span
								class="badge preset-filled-success-500 font-bold px-1.5 py-0.5 text-3xs rounded-full flex items-center gap-1 shadow-sm"
							>
								<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M5 13l4 4L19 7"
									/></svg
								>
								Enviada
							</span>
						{:else if (esc.tipo === 'plantao' || esc.tipo === 'expediente') && solicitacoesMap[esc.id]}
							<span
								class="badge preset-tonal-warning font-bold px-1.5 py-0.5 text-3xs rounded-full flex items-center gap-1 shadow-sm"
							>
								<Clock class="w-3 h-3" aria-hidden="true" />
								Ass. Pendente
							</span>
						{:else}
							<span
								class="badge preset-tonal-surface font-bold px-1.5 py-0.5 text-3xs rounded-full flex items-center gap-1 shadow-sm"
							>
								<SquarePen class="w-3 h-3" aria-hidden="true" />
								{esc.tipo === 'fds' ? 'Pendente' : 'Em preenchimento'}
							</span>
						{/if}
					</div>
					<div class="space-y-1 mb-3 text-sm">
						<div class="flex justify-between">
							<span class="text-surface-600 dark:text-surface-400 font-medium">Cidade</span>
							<span class="text-surface-900 dark:text-surface-100">{esc.cidade}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-surface-600 dark:text-surface-400 font-medium">Período</span>
							<span class="text-surface-900 dark:text-surface-100 font-mono tabular-nums text-xs"
								>{formatarData(esc.data_inicio)} a {formatarData(esc.data_fim)}</span
							>
						</div>
						{#if esc.tipo === 'fds'}
							<div class="flex justify-between">
								<span class="text-surface-600 dark:text-surface-400 font-medium">Horário</span>
								<span class="text-surface-900 dark:text-surface-100 font-mono tabular-nums"
									>{esc.horario}</span
								>
							</div>
						{/if}
					</div>
					<div class="pt-3 border-t border-surface-200/60 dark:border-surface-700/50 space-y-2">
						<div class="flex items-center gap-2">
							<button
								type="button"
								class="btn btn-sm flex-1 {esc.is_assinada
									? 'preset-filled-warning-500'
									: 'preset-outlined-primary-500'} font-bold"
								onclick={() => onSolicitarEdicao(esc)}
							>
								{esc.is_assinada ? 'Editar' : 'Abrir'}
							</button>
							<button
								type="button"
								class="btn btn-sm shrink-0 {menuExpandidoId === esc.id
									? 'preset-filled-surface-500 text-white'
									: 'preset-outlined-surface-500'} text-xs px-3 py-1.5 transition-all font-bold"
								onclick={() => (menuExpandidoId = menuExpandidoId === esc.id ? null : esc.id)}
							>
								{menuExpandidoId === esc.id ? 'Ocultar' : 'PDF(s)'}
							</button>
						</div>
						{#if menuExpandidoId === esc.id}
							<div class="flex flex-row gap-2 w-full" transition:slide={{ duration: 200 }}>
								{#if esc.is_assinada}
									<a
										class="btn flex-1 justify-center preset-filled-surface-100 dark:preset-filled-surface-800 text-3xs sm:text-2xs py-2 px-1 border border-surface-200 dark:border-surface-700 hover:preset-filled-success-500 hover:text-white transition-all no-underline font-bold uppercase tracking-tight whitespace-nowrap shadow-sm"
										href={`/api/escalas/${esc.id}/documento-assinado`}
										target="_blank"
										title={podeManifesto ? 'PDF assinado sem folha de auditoria' : 'PDF assinado'}
										>{podeManifesto ? 'Oficial' : 'PDF Oficial'}</a
									>
									{#if podeManifesto}
										<a
											class="btn flex-1 justify-center preset-filled-surface-100 dark:preset-filled-surface-800 text-3xs sm:text-2xs py-2 px-1 border border-surface-200 dark:border-surface-700 hover:preset-filled-tertiary-500 hover:text-white transition-all no-underline font-bold uppercase tracking-tight whitespace-nowrap shadow-sm"
											href={`/api/escalas/${esc.id}/documento-assinado?manifesto=true`}
											target="_blank"
											title="PDF com folha de auditoria (evidências da assinatura)">Manif.</a
										>
									{/if}
								{/if}
								<a
									class="btn flex-1 justify-center preset-filled-surface-100 dark:preset-filled-surface-800 text-3xs sm:text-2xs py-2 px-1 border border-surface-200 dark:border-surface-700 hover:preset-filled-primary-500 hover:text-white transition-all no-underline font-bold uppercase tracking-tight whitespace-nowrap shadow-sm"
									href={`/api/escalas/${esc.id}/download?format=pdf`}
									target="_blank">PDF</a
								>
								<a
									class="btn flex-1 justify-center preset-filled-surface-100 dark:preset-filled-surface-800 text-3xs sm:text-2xs py-2 px-1 border border-surface-200 dark:border-surface-700 hover:preset-filled-primary-500 hover:text-white transition-all no-underline font-bold uppercase tracking-tight whitespace-nowrap shadow-sm"
									href={`/api/escalas/${esc.id}/download?format=docx`}
									target="_blank">Word</a
								>
								<a
									class="btn flex-1 justify-center preset-filled-surface-100 dark:preset-filled-surface-800 text-3xs sm:text-2xs py-2 px-1 border border-surface-200 dark:border-surface-700 hover:preset-filled-primary-500 hover:text-white transition-all no-underline font-bold uppercase tracking-tight whitespace-nowrap shadow-sm"
									href={`/api/escalas/${esc.id}/download?format=excel`}
									target="_blank">Excel</a
								>
								<button
									type="button"
									class="btn flex-1 justify-center preset-filled-surface-100 dark:preset-filled-surface-800 text-3xs sm:text-2xs py-2 px-1 border border-error-500/40 hover:preset-filled-error-500 hover:text-white transition-all font-bold uppercase tracking-tight whitespace-nowrap shadow-sm text-error-600 dark:text-error-400"
									onclick={() => {
										menuExpandidoId = null;
										onSolicitarExclusao(esc.id, esc.titulo);
									}}>Excluir</button
								>
							</div>
						{/if}
						{#if podeOIPSolicitar && (esc.tipo === 'plantao' || esc.tipo === 'expediente') && !esc.is_assinada}
							{#if solicitacoesMap[esc.id]}
								<button
									type="button"
									class="btn btn-sm preset-outlined-error-500 text-xs w-full"
									onclick={() => onCancelarSolicitacao(esc.id)}>Cancelar Solicitação</button
								>
							{:else}
								<button
									type="button"
									class="btn btn-sm preset-filled-success-500 w-full transition-all"
									onclick={() => onAbrirDialogSolicitar(esc.id)}>Solicitar Assinatura</button
								>
							{/if}
						{/if}
					</div>
				</div>
			{/each}
		{/if}
	</div>

	<PaginationControls
		{paginaAtual}
		{totalPaginas}
		totalItens={escalas.length}
		itensPorPagina={ITEMS_POR_PAGINA}
		labelSingular="escala"
		labelPlural="escala(s)"
		{onPageChange}
	/>
{/if}
