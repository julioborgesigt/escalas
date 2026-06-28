<script lang="ts">
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { toaster } from '$lib/toast';
	import type { EscalaPolicialComDados } from '$lib/types';
	import type { ActionResult } from '@sveltejs/kit';

	const MESES = [
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
	const DIAS_SEM = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

	let {
		open = $bindable(false),
		ids,
		diasIniciais,
		horaEntradaInicial,
		horaSaidaInicial,
		observacoesIniciais,
		horas,
		minutos,
		onsalvo
	}: {
		open: boolean;
		ids: number[];
		diasIniciais: string[];
		horaEntradaInicial: string;
		horaSaidaInicial: string;
		observacoesIniciais: string;
		horas: string[];
		minutos: string[];
		onsalvo: (policiais: EscalaPolicialComDados[]) => void;
	} = $props();

	let selecionados = $state<string[]>([]);
	let editHoraEntrada = $state('');
	let editMinutoEntrada = $state('');
	let editHoraSaida = $state('');
	let editMinutoSaida = $state('');
	let editObservacoes = $state('');

	let calAno = $state(new Date().getFullYear());
	let calMes = $state(new Date().getMonth());
	let pending = $state(false);

	$effect(() => {
		if (open) {
			selecionados = [...diasIniciais];
			if (diasIniciais.length > 0) {
				const [y, m] = diasIniciais[0].split('-').map(Number);
				calAno = y;
				calMes = m - 1;
			}
			const [he = '08', me = '00'] = horaEntradaInicial.split(':');
			const [hs = '08', ms = '00'] = horaSaidaInicial.split(':');
			editHoraEntrada = he;
			editMinutoEntrada = me;
			editHoraSaida = hs;
			editMinutoSaida = ms;
			editObservacoes = observacoesIniciais;
		}
	});

	const grade = $derived.by(() => {
		const first = new Date(calAno, calMes, 1).getDay();
		const n = new Date(calAno, calMes + 1, 0).getDate();
		const cells: ({ day: number } | null)[] = [];
		for (let i = 0; i < first; i++) cells.push(null);
		for (let d = 1; d <= n; d++) cells.push({ day: d });
		while (cells.length % 7 !== 0) cells.push(null);
		while (cells.length < 42) cells.push(null);
		return cells;
	});

	const ordenados = $derived([...selecionados].sort());
	const diasJson = $derived(JSON.stringify(ordenados));
	const idsJson = $derived(JSON.stringify(ids));

	function isoLocal(y: number, m: number, d: number): string {
		return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
	}

	function fmtDia(iso: string): string {
		const [, m, d] = iso.split('-');
		return `${d}/${m}`;
	}

	function toggle(iso: string) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const set = new Set(selecionados);
		if (set.has(iso)) set.delete(iso);
		else set.add(iso);
		selecionados = [...set];
	}

	function mesAnterior() {
		if (calMes === 0) {
			calMes = 11;
			calAno--;
		} else calMes--;
	}
	function mesProximo() {
		if (calMes === 11) {
			calMes = 0;
			calAno++;
		} else calMes++;
	}

	function handleSalvar({ cancel }: { cancel: () => void }) {
		if (ordenados.length === 0) {
			toaster.create({ title: 'Selecione pelo menos um dia', type: 'error' });
			cancel();
			return;
		}
		pending = true;
		return async ({ result }: { result: ActionResult }) => {
			pending = false;
			if (result.type === 'success') {
				onsalvo(result.data?.policiais);
				open = false;
				toaster.create({ title: 'Alterações salvas!', type: 'success' });

				const conflitantes =
					(result.data?.conflitantes as { data: string; motivo: string }[] | undefined) ?? [];
				if (conflitantes.length > 0) {
					const datas = conflitantes.map((c) => c.data).join(', ');
					toaster.create({
						title: `Adicionado — ${conflitantes.length} dia(s) com choque ignorado(s)`,
						description: `Dias ignorados: ${datas}`,
						type: 'warning'
					});
				}

				await invalidateAll();
			} else if (result.type === 'error') {
				toaster.create({ title: 'Erro de conexão. Tente novamente.', type: 'error' });
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				toaster.create({ title: String(d?.error || 'Erro ao salvar alterações'), type: 'error' });
			}
		};
	}
</script>

<Dialog {open} onOpenChange={(e) => (open = e.open)}>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="card w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-primary-500/20 p-4 sm:p-5 space-y-4"
		>
			<div>
				<Dialog.Title class="font-bold text-base">Editar Escala de Plantão</Dialog.Title>
				<Dialog.Description class="text-xs text-surface-500 mt-0.5">
					Selecione os dias, ajuste o horário e preencha a observação.
				</Dialog.Description>
			</div>

			<!-- Calendário -->
			<div class="rounded-xl border border-surface-200 dark:border-surface-700 p-3 space-y-2">
				<div class="flex items-center justify-between">
					<button
						type="button"
						onclick={mesAnterior}
						class="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-200 dark:hover:bg-surface-700 text-surface-600 dark:text-surface-300 transition-colors text-sm font-bold"
						>‹</button
					>
					<span class="text-xs font-semibold text-surface-700 dark:text-surface-200">
						{MESES[calMes]}
						{calAno}
					</span>
					<button
						type="button"
						onclick={mesProximo}
						class="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-200 dark:hover:bg-surface-700 text-surface-600 dark:text-surface-300 transition-colors text-sm font-bold"
						>›</button
					>
				</div>
				<div
					class="grid grid-cols-7 gap-px text-center text-[0.55rem] font-semibold uppercase tracking-wide text-surface-400 py-0.5"
				>
					{#each DIAS_SEM as ds (ds)}<span>{ds}</span>{/each}
				</div>
				<div class="grid grid-cols-7 gap-0.5">
					{#each grade as cell, i (i)}
						{#if cell}
							{@const iso = isoLocal(calAno, calMes, cell.day)}
							{@const sel = selecionados.includes(iso)}
							<button
								type="button"
								onclick={() => toggle(iso)}
								class="h-9 rounded-md text-xs font-medium transition-colors border flex items-center justify-center touch-manipulation
									{sel
									? 'border-primary-500 bg-primary-500/15 text-primary-900 dark:text-primary-100'
									: 'border-transparent bg-surface-100/80 dark:bg-surface-700/50 text-surface-700 dark:text-surface-200 hover:bg-surface-200/80 dark:hover:bg-surface-600'}"
								aria-pressed={sel}
							>
								{cell.day}
							</button>
						{:else}
							<div class="h-9"></div>
						{/if}
					{/each}
				</div>
			</div>

			<!-- Horários e Obs -->
			<div class="space-y-3">
				<div class="flex gap-4">
					<label class="flex-1 min-w-0">
						<span class="label-text text-[0.7rem] mb-1 block">Entrada</span>
						<div class="flex gap-1">
							<select
								class="select text-xs h-8 py-0 rounded-lg px-1 flex-1"
								bind:value={editHoraEntrada}
							>
								{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
							</select>
							<select
								class="select text-xs h-8 py-0 rounded-lg px-1 flex-1"
								bind:value={editMinutoEntrada}
							>
								{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}
							</select>
						</div>
					</label>
					<label class="flex-1 min-w-0">
						<span class="label-text text-[0.7rem] mb-1 block">Saída</span>
						<div class="flex gap-1">
							<select
								class="select text-xs h-8 py-0 rounded-lg px-1 flex-1"
								bind:value={editHoraSaida}
							>
								{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
							</select>
							<select
								class="select text-xs h-8 py-0 rounded-lg px-1 flex-1"
								bind:value={editMinutoSaida}
							>
								{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}
							</select>
						</div>
					</label>
				</div>
				<label class="block">
					<span class="label-text text-[0.7rem] mb-1 block">Observações</span>
					<input
						type="text"
						class="input text-xs h-8 px-2 rounded-lg w-full"
						bind:value={editObservacoes}
						maxlength="500"
						placeholder="Informações complementares..."
					/>
				</label>
			</div>

			<!-- Ações -->
			<div class="flex justify-end gap-2 pt-1">
				<button
					type="button"
					class="btn text-xs px-3 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
					onclick={() => (open = false)}
				>
					Cancelar
				</button>
				<form
					method="POST"
					action="?/editarPlantaoAgrupado"
					use:enhance={handleSalvar}
					class="contents"
				>
					<input type="hidden" name="ids" value={idsJson} />
					<input type="hidden" name="datas" value={diasJson} />
					<input type="hidden" name="hora_entrada" value="{editHoraEntrada}:{editMinutoEntrada}" />
					<input type="hidden" name="hora_saida" value="{editHoraSaida}:{editMinutoSaida}" />
					<input type="hidden" name="observacoes" value={editObservacoes} />
					<button
						type="submit"
						class="btn text-xs font-bold px-4 py-1.5 rounded-lg preset-filled-primary-500"
						disabled={pending || ordenados.length === 0}
					>
						{pending ? 'Salvando...' : 'Salvar Alterações'}
					</button>
				</form>
			</div>
		</div>
	</Dialog.Content>
</Dialog>
