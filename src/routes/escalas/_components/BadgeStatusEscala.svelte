<script lang="ts">
	/**
	 * Badge de status da escala na listagem — Assinada / Enviada / Ass. Pendente /
	 * Pendente / Em preenchimento. Desktop e mobile compartilham a lógica; o
	 * `tamanho` ajusta tipografia, padding e ícones.
	 */
	import { Clock, SquarePen } from '@lucide/svelte';

	const {
		isAssinada,
		tipo,
		finalizadaEm,
		assPendente,
		tamanho = 'xs'
	}: {
		isAssinada: boolean;
		/** Schema permite null; null cai no fallback "Em preenchimento". */
		tipo: string | null;
		finalizadaEm: string | null | undefined;
		assPendente: boolean;
		tamanho?: 'xs' | '3xs';
	} = $props();

	const compact = $derived(tamanho === '3xs');
	const sizeCls = $derived(compact ? 'text-3xs px-1.5 py-0.5 rounded-full' : 'px-2 py-1');
	const iconCls = $derived(compact ? 'w-3 h-3' : 'w-4 h-4');
</script>

{#if isAssinada}
	<span
		class="badge preset-filled-success-500 font-bold {sizeCls} flex items-center gap-1 w-max shadow-sm"
	>
		<svg class={iconCls} fill="none" viewBox="0 0 24 24" stroke="currentColor"
			><path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M5 13l4 4L19 7"
			/></svg
		>
		Assinada
	</span>
{:else if tipo === 'fds' && finalizadaEm}
	<span
		class="badge preset-filled-success-500 font-bold {sizeCls} flex items-center gap-1 w-max shadow-sm"
	>
		<svg class={iconCls} fill="none" viewBox="0 0 24 24" stroke="currentColor"
			><path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M5 13l4 4L19 7"
			/></svg
		>
		Enviada
	</span>
{:else if (tipo === 'plantao' || tipo === 'expediente') && assPendente}
	<span
		class="badge preset-tonal-warning font-bold {sizeCls} flex items-center gap-1 w-max shadow-sm"
	>
		<Clock class={iconCls} aria-hidden="true" />
		Ass. Pendente
	</span>
{:else}
	<span
		class="badge preset-tonal-surface font-bold {sizeCls} flex items-center gap-1 w-max shadow-sm"
	>
		<SquarePen class={iconCls} aria-hidden="true" />
		{tipo === 'fds' ? 'Pendente' : 'Em preenchimento'}
	</span>
{/if}
