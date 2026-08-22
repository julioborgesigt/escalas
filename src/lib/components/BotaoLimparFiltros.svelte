<script lang="ts">
	/**
	 * Botão "Limpar filtros" das listagens — warning preenchido quando há
	 * filtro ativo, outlined esmaecido quando não há.
	 *
	 * Extraído porque o mesmo par de classes + `disabled={!temFiltros}` estava
	 * copiado em cinco rotas (e o histórico GISE usava link solto). Drift
	 * típico: uma tela muda `tonal`↔`filled` ou `surface`↔`primary` e as outras
	 * ficam para trás.
	 *
	 * `disabledExtra` cobre o caso do painel (desabilitar também enquanto
	 * carrega). O botão fica desabilitado quando `!temFiltros || disabledExtra`.
	 */
	const {
		temFiltros,
		onclick,
		disabledExtra = false,
		label = 'Limpar filtros',
		classes = ''
	}: {
		temFiltros: boolean;
		onclick: () => void;
		/** Extra disable (ex.: enquanto loading). */
		disabledExtra?: boolean;
		label?: string;
		classes?: string;
	} = $props();

	const disabled = $derived(!temFiltros || disabledExtra);
</script>

<button
	type="button"
	class="btn btn-sm {temFiltros
		? 'preset-filled-warning-500'
		: 'preset-outlined-primary-500 opacity-40'} {classes}"
	{onclick}
	{disabled}
>
	{label}
</button>
