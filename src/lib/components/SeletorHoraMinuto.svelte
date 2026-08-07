<!--
	Par de selects hora/minuto (00–23 / 00–59) compartilhado pelas telas de
	escalas. Antes: `Array.from({ length: 24|60 })` + `{#each}` copiados em
	ModalNovaEscala, FormAdicionarServidores, ListaFds, TabelaServidores e
	ModalEditarPlantao — drift de rótulo (`{h}h` vs `{h}`) era latente.
-->
<script lang="ts" module>
	/** Constantes únicas — importe daqui se precisar do array sem o componente. */
	export const HORAS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
	export const MINUTOS = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
</script>

<script lang="ts">
	let {
		hora = $bindable('08'),
		minuto = $bindable('00'),
		disabled = false,
		/** Sufixo no rótulo da hora (`08h`). */
		sufixoHora = 'h',
		/** Sufixo no rótulo do minuto (`00m`); string vazia omite. */
		sufixoMinuto = 'm',
		nameHora,
		nameMinuto,
		ariaLabelHora = 'Hora',
		ariaLabelMinuto = 'Minuto',
		selectClass = 'select text-sm flex-1'
	}: {
		hora?: string;
		minuto?: string;
		disabled?: boolean;
		sufixoHora?: string;
		sufixoMinuto?: string;
		nameHora?: string;
		nameMinuto?: string;
		ariaLabelHora?: string;
		ariaLabelMinuto?: string;
		selectClass?: string;
	} = $props();
</script>

<div class="flex gap-1 items-center min-w-0">
	<select
		class={selectClass}
		bind:value={hora}
		{disabled}
		name={nameHora}
		aria-label={ariaLabelHora}
	>
		{#each HORAS as h (h)}
			<option value={h}>{sufixoHora ? `${h}${sufixoHora}` : h}</option>
		{/each}
	</select>
	<select
		class={selectClass}
		bind:value={minuto}
		{disabled}
		name={nameMinuto}
		aria-label={ariaLabelMinuto}
	>
		{#each MINUTOS as m (m)}
			<option value={m}>{sufixoMinuto ? `${m}${sufixoMinuto}` : m}</option>
		{/each}
	</select>
</div>
