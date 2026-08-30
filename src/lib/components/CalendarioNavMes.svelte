<script lang="ts">
	/**
	 * A faixa de navegação de mês de um calendário: ‹ · "Setembro de 2026" · ›
	 *
	 * Extraído porque os dois calendários do sistema desenham exatamente esta
	 * faixa — `ModalCriarGise` (escolhe VÁRIOS dias, para criar escalas extras em
	 * lote) e `CalendarioDia` (escolhe UM, para o plano operacional). As grades
	 * abaixo dela diferem de verdade: uma tem chips e remoção de dia, a outra não.
	 * A faixa, não.
	 *
	 * É uma peça pequena, e a tentação é deixar as duas cópias. O `guard:duplicacao`
	 * reprovou — e nesse caso ele está certo: aqui não há o "extrair deixaria pior"
	 * do corolário do `CLAUDE.md`, porque o componente não precisa de prop nenhuma
	 * além do título e dos dois callbacks. Manter duas cópias significaria que
	 * ajustar o tamanho do chevron numa delas deixaria a outra desalinhada, e
	 * ninguém notaria até abrir as duas telas lado a lado.
	 */
	const {
		titulo,
		onAnterior,
		onProximo
	}: {
		/** "Setembro de 2026" — quem monta é o calendário, que conhece o mês. */
		titulo: string;
		onAnterior: () => void;
		onProximo: () => void;
	} = $props();
</script>

<div class="flex items-center justify-between gap-1.5">
	<button
		type="button"
		class="btn preset-outlined-surface-500 p-1.5 rounded-lg shrink-0"
		aria-label="Mês anterior"
		onclick={onAnterior}
	>
		<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
		</svg>
	</button>
	<p
		class="text-xs sm:text-sm font-semibold text-surface-800 dark:text-surface-100 text-center min-w-0 flex-1"
	>
		{titulo}
	</p>
	<button
		type="button"
		class="btn preset-outlined-surface-500 p-1.5 rounded-lg shrink-0"
		aria-label="Próximo mês"
		onclick={onProximo}
	>
		<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
		</svg>
	</button>
</div>
