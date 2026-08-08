<script lang="ts">
	/**
	 * Tabela da escala de PLANTÃO mensal — uma linha por policial, com todos os
	 * dias em que ele serve agrupados nela.
	 *
	 * O agrupamento é o ponto: o banco guarda uma linha por (policial, dia), e
	 * mostrar assim daria oito linhas para o mesmo plantonista. A tabela colapsa
	 * essas linhas e trata o conjunto como uma escalação — por isso
	 * `onSolicitarRemocao` aceita um ARRAY de ids: remover um plantonista é
	 * remover todos os dias dele de uma vez.
	 *
	 * Editar um plantão específico abre o `ModalEditarPlantao` (data e horário
	 * daquele dia), e o OIP pode ser acrescentado direto na linha
	 * (`FormInlineAdicionarOip`), que é o caso frequente de última hora.
	 *
	 * As outras visões da mesma escala são `TabelaServidores` (expediente) e
	 * `ListaFds` (fim de semana).
	 */
	import type { Escala } from '$lib/server/schema';
	import type { EscalaPolicialComDados } from '$lib/types';
	import IconTooltip from '$lib/components/IconTooltip.svelte';
	import EstadoVazio from '$lib/components/EstadoVazio.svelte';
	import ModalEditarPlantao from './ModalEditarPlantao.svelte';
	import FormInlineAdicionarOip from './FormInlineAdicionarOip.svelte';
	import PenLine from '@lucide/svelte/icons/pen-line';

	interface Props {
		policiaisEscalaLocal: EscalaPolicialComDados[];
		podeEditarEscala: boolean;
		documentoAssinadoExiste: boolean;
		finalizadaEm: string | null;
		modoSelecao: boolean;
		selecionados: Set<number>;
		escala: Escala;
		onSolicitarRemocao: (ids: number | number[], nome: string) => void;
	}

	let {
		policiaisEscalaLocal = $bindable(),
		podeEditarEscala,
		documentoAssinadoExiste,
		finalizadaEm,
		modoSelecao,
		selecionados = $bindable(),
		escala,
		onSolicitarRemocao
	}: Props = $props();

	let modalEditarOpen = $state(false);
	let addingOipEquipe = $state<string | null>(null);
	let editIds = $state<number[]>([]);
	let editDiasIniciais = $state<string[]>([]);
	let editHoraEntradaInicial = $state('08:00');
	let editHoraSaidaInicial = $state('08:00');
	let editObservacoesIniciais = $state('');

	interface PolicialPlantaoAgrupado {
		policial_id: number;
		equipe: string;
		nome: string;
		matricula: string;
		cargo: string;
		telefone: string;
		lotacao: string;
		dias: string[];
		observacoes: string;
		hora_entrada: string;
		hora_saida: string;
		ids: number[];
	}

	function getHoraEntrada(p: EscalaPolicialComDados): string {
		return p.hora_entrada || escala?.hora_entrada || '08:00';
	}
	function getHoraSaida(p: EscalaPolicialComDados): string {
		return p.hora_saida || escala?.hora_saida || '08:00';
	}

	const equipesAgrupadas = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const map = new Map<string, PolicialPlantaoAgrupado>();
		for (const p of policiaisEscalaLocal) {
			const key = `${p.policial_id}_${p.equipe || ''}`;
			if (!map.has(key)) {
				map.set(key, {
					policial_id: p.policial_id,
					equipe: p.equipe || '',
					nome: p.nome,
					matricula: p.matricula,
					cargo: p.cargo,
					telefone: p.telefone || '',
					lotacao: p.lotacao || '',
					dias: [],
					observacoes: p.observacoes || '',
					hora_entrada: getHoraEntrada(p),
					hora_saida: getHoraSaida(p),
					ids: []
				});
			}
			const entry = map.get(key)!;
			if (!entry.dias.includes(p.data_plantao)) entry.dias.push(p.data_plantao);
			if (!entry.ids.includes(p.id)) entry.ids.push(p.id);
		}

		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const equipes = new Map<string, PolicialPlantaoAgrupado[]>();
		for (const p of map.values()) {
			p.dias.sort();
			const list = equipes.get(p.equipe) || [];
			list.push(p);
			equipes.set(p.equipe, list);
		}

		for (const list of equipes.values()) {
			list.sort((a, b) => {
				if (a.cargo !== b.cargo) return a.cargo === 'DPC' ? -1 : 1;
				return a.nome.localeCompare(b.nome);
			});
		}

		return new Map(
			[...equipes.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
		);
	});

	function startEdit(p: PolicialPlantaoAgrupado) {
		editIds = p.ids;
		editDiasIniciais = [...p.dias];
		editHoraEntradaInicial = p.hora_entrada;
		editHoraSaidaInicial = p.hora_saida;
		editObservacoesIniciais = p.observacoes;
		modalEditarOpen = true;
	}

	function fmtDia(iso: string): string {
		const [, m, d] = iso.split('-');
		return `${d}/${m}`;
	}
</script>

{#if policiaisEscalaLocal.length === 0}
	<EstadoVazio mensagem="Nenhum policial nesta escala ainda." />
{:else}
	<div class="space-y-8">
		{#each equipesAgrupadas as [equipe, items] (equipe)}
			<div
				class="card p-0 bg-white dark:bg-surface-900 border border-surface-200 dark:border-white/10 rounded-2xl shadow-xl overflow-visible"
			>
				<div
					class="px-4 py-3 flex items-center gap-3 border-b border-surface-100 dark:border-white/5 bg-surface-50/50 dark:bg-surface-800/30 rounded-t-2xl"
				>
					<span class="font-bold text-sm text-surface-800 dark:text-surface-100 uppercase">
						{equipe ? `EQUIPE ${equipe}` : 'SEM EQUIPE'}
					</span>
					<span class="text-xs text-surface-600 dark:text-surface-400"
						>{items.length} servidor{items.length !== 1 ? 'es' : ''}</span
					>
				</div>

				<div class="table-wrap p-2 overflow-x-auto">
					<table class="table w-full text-xs !bg-transparent min-w-[800px]">
						<thead>
							<tr class="!bg-transparent border-b border-surface-100 dark:border-white/5">
								{#if modoSelecao}
									<th class="!py-4 !px-4 w-10"></th>
								{/if}
								<th
									class="!py-4 !px-4 text-surface-600 dark:text-surface-400 font-medium uppercase tracking-tight text-left"
									>Nome</th
								>
								<th
									class="!py-4 text-center text-surface-600 dark:text-surface-400 font-medium uppercase tracking-tight"
									>Matrícula</th
								>
								<th
									class="!py-4 text-center text-surface-600 dark:text-surface-400 font-medium uppercase tracking-tight"
									>Cargo</th
								>
								<th
									class="!py-4 text-center text-surface-600 dark:text-surface-400 font-medium uppercase tracking-tight"
									>Telefone</th
								>
								<th
									class="!py-4 text-left text-surface-600 dark:text-surface-400 font-medium uppercase tracking-tight"
									>Lotação</th
								>
								<th
									class="!py-4 text-left text-surface-600 dark:text-surface-400 font-medium uppercase tracking-tight"
									>Dias</th
								>
								<th
									class="!py-4 text-left text-surface-600 dark:text-surface-400 font-medium uppercase tracking-tight"
									>Observações</th
								>
								{#if podeEditarEscala && !modoSelecao && !documentoAssinadoExiste && !finalizadaEm}
									<th
										class="!py-4 !px-4 text-right text-surface-600 dark:text-surface-400 font-medium uppercase tracking-tight w-24"
										>Ações</th
									>
								{/if}
							</tr>
						</thead>
						<tbody class="divide-y divide-surface-100 dark:divide-white/5">
							{#each items as p (p.policial_id)}
								<tr
									class="!bg-transparent hover:!bg-surface-100/50 dark:hover:!bg-surface-800/20 transition-colors"
								>
									{#if modoSelecao}
										<td class="!py-4 !px-4 align-middle">
											<input
												type="checkbox"
												class="checkbox"
												aria-label={`Selecionar ${p.nome}`}
												checked={p.ids.every((id) => selecionados.has(id))}
												onchange={(e) => {
													if ((e.target as HTMLInputElement).checked) {
														p.ids.forEach((id) => selecionados.add(id));
													} else {
														p.ids.forEach((id) => selecionados.delete(id));
													}
												}}
											/>
										</td>
									{/if}
									<td class="!py-4 !px-4 align-middle">
										<span
											class="font-bold text-surface-900 dark:text-surface-100 uppercase block leading-tight"
											>{p.nome}</span
										>
									</td>
									<td class="!py-4 text-center align-middle font-mono">{p.matricula}</td>
									<td class="!py-4 text-center align-middle">
										<span
											class="badge px-1.5 py-0.5 rounded font-bold text-3xs uppercase {p.cargo ===
											'DPC'
												? 'bg-primary-500/20 text-primary-700'
												: 'bg-warning-500/20 text-warning-700'}"
										>
											{p.cargo}
										</span>
									</td>
									<td class="!py-4 text-center align-middle tabular-nums">{p.telefone}</td>
									<td class="!py-4 align-middle text-surface-600 dark:text-surface-300"
										>{p.lotacao}</td
									>
									<td class="!py-4 align-middle font-medium text-surface-700 dark:text-surface-200">
										<div class="flex flex-wrap gap-1 max-w-[200px]">
											{#each p.dias as dia (dia)}
												<span
													class="badge bg-surface-200 dark:bg-surface-700 px-1.5 py-0.5 rounded text-3xs font-bold tracking-wider"
													>{fmtDia(dia)}</span
												>
											{/each}
										</div>
									</td>
									<td class="!py-4 align-middle italic text-surface-600 dark:text-surface-400">
										{p.observacoes}
										<div
											class="text-3xs not-italic text-surface-600 dark:text-surface-400 mt-1 font-mono"
										>
											{p.hora_entrada} - {p.hora_saida}
										</div>
									</td>
									{#if podeEditarEscala && !modoSelecao && !documentoAssinadoExiste && !finalizadaEm}
										<td class="!py-4 !px-4 align-middle text-right">
											<div class="flex items-center justify-end gap-1">
												<IconTooltip label="Editar">
													<button
														type="button"
														aria-label="Editar"
														class="p-1.5 rounded transition-colors text-surface-400 hover:text-primary-500 hover:bg-primary-500/10"
														onclick={() => startEdit(p)}
													>
														<PenLine class="w-4 h-4" aria-hidden="true" />
													</button>
												</IconTooltip>
												<button
													type="button"
													class="btn btn-sm preset-filled-error-500 rounded font-bold text-3xs uppercase px-2 py-0.5 transition-all"
													onclick={() => onSolicitarRemocao(p.ids, p.nome)}>Rem.</button
												>
											</div>
										</td>
									{/if}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				{#if podeEditarEscala && !modoSelecao && !documentoAssinadoExiste && !finalizadaEm}
					{#if addingOipEquipe === equipe}
						<FormInlineAdicionarOip
							{escala}
							{equipe}
							onCancel={() => (addingOipEquipe = null)}
							onSuccess={(policiais) => {
								policiaisEscalaLocal = policiais;
								addingOipEquipe = null;
							}}
						/>
					{:else}
						<div
							class="px-4 py-3 bg-surface-50/50 dark:bg-surface-800/30 rounded-b-2xl border-t border-surface-100 dark:border-white/5 flex justify-end"
						>
							<button
								type="button"
								class="btn btn-sm preset-outlined-primary-500"
								onclick={() => (addingOipEquipe = equipe)}
							>
								+ Adicionar OIP à Equipe {equipe}
							</button>
						</div>
					{/if}
				{/if}
			</div>
		{/each}
	</div>
{/if}

<ModalEditarPlantao
	bind:open={modalEditarOpen}
	escalaId={escala.id}
	ids={editIds}
	diasIniciais={editDiasIniciais}
	horaEntradaInicial={editHoraEntradaInicial}
	horaSaidaInicial={editHoraSaidaInicial}
	observacoesIniciais={editObservacoesIniciais}
	onsalvo={(policiais) => {
		policiaisEscalaLocal = policiais;
	}}
/>
