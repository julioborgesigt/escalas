<script lang="ts">
	/**
	 * Badge de tipo da escala (Plantão / Expediente / FDS) — fonte ÚNICA do par
	 * rótulo × cor, para desktop e mobile.
	 *
	 * O mapa de cor é decisão de produto, não de estilo local: até ago/2026
	 * existiam DOIS. Este componente pintava Plantão de `primary` e FDS de
	 * `tertiary`, em presets `outlined`, enquanto painel, Cx. de Entrada e
	 * unidades reimplementavam o mesmo badge inline com Plantão em `tertiary`,
	 * Expediente em `primary` e FDS em `warning`, em presets `filled` a 20%. O
	 * mesmo tipo de escala tinha duas cores conforme a tela. O mapa das três
	 * telas venceu por maioria e é o que está aqui — mexer nele muda TODAS as
	 * listagens de uma vez, que é exatamente o ponto.
	 *
	 * O rótulo também divergia: o painel escrevia "PLANTÃO" no card mobile e
	 * "Plantão" na tabela desktop, na mesma página. Aqui é title case sempre.
	 *
	 * Layout (margem, `inline-block`, `w-fit`) fica FORA: cada listagem passa o
	 * seu pelo `class`, senão o badge carrega o espaçamento de uma tabela para
	 * dentro de um card.
	 */
	import type { ClassValue } from 'svelte/elements';

	const {
		tipo,
		tamanho = 'xs',
		class: className = ''
	}: {
		/** Schema permite null; null cai no fallback Plantão. */
		tipo: string | null;
		tamanho?: 'xs' | '3xs';
		class?: ClassValue;
	} = $props();

	const sizeCls = $derived(
		tamanho === '3xs' ? 'text-3xs px-1.5 py-0 leading-tight' : 'text-xs px-2 py-0.5'
	);

	const preset = $derived(
		tipo === 'expediente'
			? 'preset-filled-primary-500/20 text-primary-900 dark:text-primary-200 border border-primary-500/30'
			: tipo === 'fds'
				? 'preset-filled-warning-500/20 text-warning-900 dark:text-warning-200 border border-warning-500/30'
				: 'preset-filled-tertiary-500/20 text-tertiary-900 dark:text-tertiary-200 border border-tertiary-500/30'
	);

	const label = $derived(tipo === 'expediente' ? 'Expediente' : tipo === 'fds' ? 'FDS' : 'Plantão');
</script>

<span class={['badge font-bold', preset, sizeCls, className]}>{label}</span>
