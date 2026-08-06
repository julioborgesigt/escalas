<script lang="ts">
	/**
	 * Badge de tipo da escala (Plantão / Expediente / FDS) — desktop e mobile
	 * compartilham a mesma definição; só o tamanho tipográfico muda.
	 */
	const {
		tipo,
		tamanho = 'xs'
	}: {
		/** Schema permite null; null cai no fallback Plantão. */
		tipo: string | null;
		tamanho?: 'xs' | '3xs';
	} = $props();

	const sizeCls = $derived(tamanho === '3xs' ? 'text-3xs' : 'text-xs');
	const layoutCls = $derived(tamanho === '3xs' ? 'mb-0.5 inline-block' : 'w-fit');
	const preset = $derived(
		tipo === 'expediente'
			? 'preset-outlined-secondary-500'
			: tipo === 'fds'
				? 'preset-outlined-tertiary-500'
				: 'preset-outlined-primary-500'
	);
	const label = $derived(tipo === 'expediente' ? 'Expediente' : tipo === 'fds' ? 'FDS' : 'Plantão');
</script>

<span class="badge {preset} font-bold {sizeCls} px-2 py-0.5 {layoutCls}">{label}</span>
