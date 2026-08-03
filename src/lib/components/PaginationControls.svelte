<script lang="ts">
	import Paginador from './Paginador.svelte';

	interface Props {
		paginaAtual: number;
		totalPaginas: number;
		totalItens: number;
		itensPorPagina?: number;
		labelSingular?: string;
		labelPlural?: string;
		onPageChange?: (pagina: number) => void;
	}

	const {
		paginaAtual,
		totalPaginas,
		totalItens,
		itensPorPagina = 10,
		labelSingular = 'escala',
		labelPlural = 'escala(s)',
		onPageChange
	}: Props = $props();

	const itensInicio = $derived((paginaAtual - 1) * itensPorPagina + 1);
	const itensFim = $derived(Math.min(paginaAtual * itensPorPagina, totalItens));

	function handlePageChange(pagina: number) {
		onPageChange?.(pagina);
		// Listas de página inteira: trocar de página sem voltar ao topo deixaria
		// o usuário no meio do conteúdo novo.
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}
</script>

<div
	class="mt-6 pt-6 border-t border-surface-200 dark:border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4"
>
	<p class="text-surface-600 dark:text-surface-400 text-xs px-1">
		Mostrando <strong>{totalItens > 0 ? itensInicio : 0}</strong>–<strong>{itensFim}</strong>
		de <strong>{totalItens}</strong>
		{totalItens === 1 ? labelSingular : labelPlural}
	</p>

	{#if totalPaginas > 1}
		<Paginador
			count={totalItens}
			pageSize={itensPorPagina}
			page={paginaAtual}
			onPageChange={handlePageChange}
		/>
	{/if}
</div>
