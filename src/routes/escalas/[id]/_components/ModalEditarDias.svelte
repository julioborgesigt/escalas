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
		diasIniciais,
		onsalvo
	}: {
		open: boolean;
		diasIniciais: string[];
		onsalvo: (result: {
			data_inicio: string;
			data_fim: string;
			policiais: EscalaPolicialComDados[];
		}) => void;
	} = $props();

	let selecionados = $state<string[]>([]);
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

	function isoLocal(y: number, m: number, d: number): string {
		return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
	}

	function fmtDia(iso: string): string {
		const [, m, d] = iso.split('-');
		return `${d}/${m}`;
	}

	function getDaysInRange(start: string, end: string): string[] {
		const days: string[] = [];
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const current = new Date(start + 'T00:00:00');

		const last = new Date(end + 'T00:00:00');
		while (current <= last) {
			days.push(new Date(current).toISOString().split('T')[0]);
			current.setDate(current.getDate() + 1);
		}
		return days;
	}

	function toggle(iso: string) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const set = new Set(selecionados);
		if (set.has(iso)) set.delete(iso);
		else set.add(iso);
		if (set.size > 1) {
			const sorted = [...set].sort();
			selecionados = getDaysInRange(sorted[0], sorted[sorted.length - 1]);
		} else {
			selecionados = [...set];
		}
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
				onsalvo({
					data_inicio: result.data?.data_inicio,
					data_fim: result.data?.data_fim,
					policiais: result.data?.policiais
				});
				open = false;
				toaster.create({ title: 'Dias da escala atualizados!', type: 'success' });
				await invalidateAll();
			} else if (result.type === 'error') {
				toaster.create({ title: 'Erro de conexão. Tente novamente.', type: 'error' });
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				toaster.create({ title: String(d?.error || 'Erro ao atualizar dias'), type: 'error' });
			}
		};
	}
</script>

<Dialog {open} onOpenChange={(e) => (open = e.open)}>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="card w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-warning-500/20 p-4 sm:p-5 space-y-4"
		>
			<div>
				<Dialog.Title class="font-bold text-base">Editar Qtd. dias da escala</Dialog.Title>
				<Dialog.Description class="text-xs text-surface-500 mt-0.5">
					Selecione os dias. Dias com policiais escalados não podem ser removidos.
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
									? 'border-warning-500 bg-warning-500/15 text-warning-900 dark:text-warning-100'
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

			<!-- Dias selecionados -->
			{#if ordenados.length > 0}
				<div class="space-y-0.5">
					<span class="text-[0.65rem] font-semibold text-surface-500">
						Dias selecionados ({ordenados.length}) — todos os dias entre o primeiro e o último são
						incluídos
					</span>
					<div class="flex flex-wrap gap-1.5">
						{#each ordenados as iso (iso)}
							<span
								class="inline-flex items-center gap-0.5 pl-1.5 pr-0.5 py-0.5 rounded-md text-[0.65rem] font-medium border shrink-0 border-warning-400/80 bg-warning-500/10 text-warning-900 dark:text-warning-100"
							>
								{fmtDia(iso)}
								<button
									type="button"
									aria-label="Remover dia {fmtDia(iso)}"
									class="p-0.5 rounded text-surface-400 hover:text-error-600 dark:hover:text-error-400"
									onclick={() => toggle(iso)}
								>
									<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M6 18L18 6M6 6l12 12"
										/>
									</svg>
								</button>
							</span>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Ações -->
			<div class="flex justify-end gap-2 pt-1">
				<button
					type="button"
					class="btn text-xs px-3 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
					onclick={() => (open = false)}
				>
					Cancelar
				</button>
				<form method="POST" action="?/editarDiasEscala" use:enhance={handleSalvar} class="contents">
					<input type="hidden" name="datas" value={diasJson} />
					<button
						type="submit"
						class="btn text-xs font-bold px-4 py-1.5 rounded-lg preset-filled-warning-500"
						disabled={pending || ordenados.length === 0}
					>
						{pending ? 'Salvando...' : 'Salvar dias'}
					</button>
				</form>
			</div>
		</div>
	</Dialog.Content>
</Dialog>
