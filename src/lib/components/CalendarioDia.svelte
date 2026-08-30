<script lang="ts">
	/**
	 * Calendário de UM dia, com marcação de feriado.
	 *
	 * Extraído da grade de `ModalCriarGise.svelte`, que seleciona VÁRIOS dias. O
	 * que os dois compartilham é a grade do mês, a navegação e o ciclo de clique
	 * com o estado de feriado — o feriado muda o efetivo esperado na escala extra
	 * e muda a classificação da hora extra no plano operacional, então nos dois
	 * casos ele é do DIA, não do lote.
	 *
	 * A diferença é a cardinalidade, e ela é o motivo de este componente existir
	 * separado em vez de o outro ganhar um modo: com seleção única não há lista de
	 * chips, não há JSON de datas e o terceiro clique não "remove o dia" (removê-lo
	 * deixaria o plano sem data, que não é estado válido). Um `multiplo?: boolean`
	 * teria de esconder metade do markup nos dois sentidos.
	 *
	 * Ciclo de clique: 1º seleciona · 2º marca feriado · 3º desmarca o feriado
	 * (mas mantém o dia).
	 */
	import { MESES_PT, DIAS_SEMANA_CURTO, isoData, hojeLocalISO } from '$lib/utils/datas';
	import CalendarioNavMes from '$lib/components/CalendarioNavMes.svelte';

	let {
		valor = $bindable(),
		feriado = $bindable(false),
		id
	}: {
		/** Data selecionada em `YYYY-MM-DD`. */
		valor: string;
		/** O dia selecionado é feriado. */
		feriado?: boolean;
		/** `id` do container, para o `aria-labelledby` de quem rotula o campo. */
		id?: string;
	} = $props();

	// Mês em exibição. Deriva da data escolhida só na PRIMEIRA renderização e
	// passa a ser do usuário: folhear até outubro e clicar num dia não pode
	// jogar a grade de volta para o mês da data anterior.
	let calAno = $state(Number(valor?.slice(0, 4)) || new Date().getFullYear());
	let calMes = $state((Number(valor?.slice(5, 7)) || new Date().getMonth() + 1) - 1);

	const calTitulo = $derived(`${MESES_PT[calMes]} de ${calAno}`);

	const gradeCalendario = $derived.by(() => {
		const primeiro = new Date(calAno, calMes, 1).getDay();
		const n = new Date(calAno, calMes + 1, 0).getDate();
		const cells: ({ day: number } | null)[] = [];
		for (let i = 0; i < primeiro; i++) cells.push(null);
		for (let d = 1; d <= n; d++) cells.push({ day: d });
		while (cells.length % 7 !== 0) cells.push(null);
		return cells;
	});

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

	/**
	 * Clicar num dia: seleciona, depois marca feriado, depois desmarca o feriado.
	 *
	 * O dia NÃO é removido no terceiro clique (ao contrário do calendário de lote):
	 * plano sem data não é estado válido, e deixar o campo vazio por acidente é
	 * pior do que exigir a escolha de outro dia.
	 */
	function clicar(iso: string) {
		if (valor !== iso) {
			valor = iso;
			feriado = false;
			return;
		}
		feriado = !feriado;
	}

	const hoje = hojeLocalISO();
</script>

<div
	{id}
	class="rounded-xl border border-surface-200 dark:border-surface-700 p-2 sm:p-2.5 space-y-1 bg-white dark:bg-surface-800/40"
>
	<CalendarioNavMes titulo={calTitulo} onAnterior={mesAnterior} onProximo={mesProximo} />

	<div
		class="grid grid-cols-7 gap-px text-center text-3xs font-semibold uppercase tracking-wide text-surface-600 dark:text-surface-400 py-0.5"
	>
		{#each DIAS_SEMANA_CURTO as ds (ds)}
			<span>{ds}</span>
		{/each}
	</div>

	<div class="grid grid-cols-7 gap-0.5">
		{#each gradeCalendario as cell, i (i)}
			{#if cell}
				{@const iso = isoData(calAno, calMes + 1, cell.day)}
				{@const sel = iso === valor}
				{@const fer = sel && feriado}
				<button
					type="button"
					onclick={() => clicar(iso)}
					class="relative h-9 rounded-md text-xs font-medium transition-colors border flex items-center justify-center touch-manipulation
						{sel
						? fer
							? 'border-error-500 bg-error-500/15 text-error-900 dark:text-error-100'
							: 'border-primary-500 bg-primary-500/10 text-primary-800 dark:text-primary-100'
						: 'border-transparent bg-surface-100/80 dark:bg-surface-700/50 text-surface-700 dark:text-surface-200 hover:bg-surface-200/80 dark:hover:bg-surface-600'}
						{iso === hoje && !sel ? 'ring-1 ring-surface-400 dark:ring-surface-500' : ''}"
					aria-pressed={sel}
					aria-label="Dia {cell.day} de {MESES_PT[calMes]}, {sel
						? fer
							? 'feriado'
							: 'selecionado'
						: 'não selecionado'}"
				>
					{cell.day}
					{#if fer}
						<span
							class="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-error-500"
							title="Feriado"
						></span>
					{/if}
				</button>
			{:else}
				<div class="h-9"></div>
			{/if}
		{/each}
	</div>

	<p class="text-3xs text-surface-600 dark:text-surface-400 leading-snug pt-0.5">
		<span class="text-primary-600 dark:text-primary-400 font-medium">1º clique</span> escolhe o dia,
		<span class="text-error-600 dark:text-error-400 font-medium">2º</span> marca como feriado.
		{#if feriado}
			<strong class="text-error-600 dark:text-error-400"
				>Feriado: toda hora do dia é paga com acréscimo.</strong
			>
		{/if}
	</p>
</div>
