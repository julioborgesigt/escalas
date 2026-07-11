<script lang="ts">
	/**
	 * Calendário mensal de seleção de dias, compartilhado por
	 * `ModalEditarDias` (modo 'intervalo': selecionar 2 dias preenche o meio)
	 * e `ModalEditarPlantao` (modo 'avulso': dias independentes).
	 * `cor` controla o tema do dia selecionado/chips (warning × primary).
	 */
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
		selecionados = $bindable<string[]>([]),
		ano = $bindable(new Date().getFullYear()),
		mes = $bindable(new Date().getMonth()),
		modo = 'avulso',
		cor = 'primary',
		mostrarChips = false
	}: {
		/** Dias selecionados em ISO (YYYY-MM-DD). */
		selecionados?: string[];
		ano?: number;
		/** Mês 0-11 (mesma convenção de `Date`). */
		mes?: number;
		modo?: 'avulso' | 'intervalo';
		cor?: 'primary' | 'warning';
		/** Exibe os chips dos dias selecionados com botão de remover. */
		mostrarChips?: boolean;
	} = $props();

	const ordenados = $derived([...selecionados].sort());

	const grade = $derived.by(() => {
		const first = new Date(ano, mes, 1).getDay();
		const n = new Date(ano, mes + 1, 0).getDate();
		const cells: ({ day: number } | null)[] = [];
		for (let i = 0; i < first; i++) cells.push(null);
		for (let d = 1; d <= n; d++) cells.push({ day: d });
		while (cells.length % 7 !== 0) cells.push(null);
		while (cells.length < 42) cells.push(null);
		return cells;
	});

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
		if (modo === 'intervalo' && set.size > 1) {
			const sorted = [...set].sort();
			selecionados = getDaysInRange(sorted[0], sorted[sorted.length - 1]);
		} else {
			selecionados = [...set];
		}
	}

	function mesAnterior() {
		if (mes === 0) {
			mes = 11;
			ano--;
		} else mes--;
	}
	function mesProximo() {
		if (mes === 11) {
			mes = 0;
			ano++;
		} else mes++;
	}
</script>

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
			{MESES[mes]}
			{ano}
		</span>
		<button
			type="button"
			onclick={mesProximo}
			class="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-200 dark:hover:bg-surface-700 text-surface-600 dark:text-surface-300 transition-colors text-sm font-bold"
			>›</button
		>
	</div>
	<div
		class="grid grid-cols-7 gap-px text-center text-[0.6rem] font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 py-0.5"
	>
		{#each DIAS_SEM as ds (ds)}<span>{ds}</span>{/each}
	</div>
	<div class="grid grid-cols-7 gap-0.5">
		{#each grade as cell, i (i)}
			{#if cell}
				{@const iso = isoLocal(ano, mes, cell.day)}
				{@const sel = selecionados.includes(iso)}
				<button
					type="button"
					onclick={() => toggle(iso)}
					class="h-9 rounded-md text-xs font-medium transition-colors border flex items-center justify-center touch-manipulation
						{sel
						? cor === 'warning'
							? 'border-warning-500 bg-warning-500/15 text-warning-900 dark:text-warning-100'
							: 'border-primary-500 bg-primary-500/15 text-primary-900 dark:text-primary-100'
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
{#if mostrarChips && ordenados.length > 0}
	<div class="space-y-0.5">
		<span class="text-[0.65rem] font-semibold text-surface-500">
			Dias selecionados ({ordenados.length}){modo === 'intervalo'
				? ' — todos os dias entre o primeiro e o último são incluídos'
				: ''}
		</span>
		<div class="flex flex-wrap gap-1.5">
			{#each ordenados as iso (iso)}
				<span
					class="inline-flex items-center gap-0.5 pl-1.5 pr-0.5 py-0.5 rounded-md text-[0.65rem] font-medium border shrink-0 {cor ===
					'warning'
						? 'border-warning-400/80 bg-warning-500/10 text-warning-900 dark:text-warning-100'
						: 'border-primary-400/80 bg-primary-500/10 text-primary-900 dark:text-primary-100'}"
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
