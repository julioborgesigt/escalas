<script lang="ts">
	import { slide } from 'svelte/transition';
	import type { Snippet } from 'svelte';
	import { ShieldCheck, CheckCircle2, Clock } from 'lucide-svelte';

	/**
	 * Moldura dos cards de documento do quadro de supervisão (escala GISE e
	 * relatório de extra). Unifica as quatro variantes que se repetiam no
	 * template de GiseSupervisao: mobile (card expansível com título externo)
	 * × desktop (linha horizontal em três partes), para cada documento.
	 *
	 * O conteúdo específico entra pelos snippets `detalhes` e `acoes`, que
	 * recebem `mobile: boolean` para as diferenças pontuais entre variantes
	 * (classes `mt-0.5`/hover e o par de botões Tela × Token).
	 */
	let {
		isMobile,
		tituloExternoMobile,
		tituloMobile,
		tituloDesktop,
		badgeEstado,
		badgeLabel,
		expandido = $bindable(false),
		detalhes,
		acoes
	}: {
		isMobile: boolean;
		/** Rótulo (<p>) acima do card, só no mobile. */
		tituloExternoMobile: string;
		tituloMobile: string;
		tituloDesktop: string;
		badgeEstado: 'sucesso' | 'alerta' | 'neutro';
		badgeLabel: string;
		/** Corpo expandido/recolhido do card mobile (bindable). */
		expandido?: boolean;
		detalhes: Snippet<[boolean]>;
		acoes: Snippet<[boolean]>;
	} = $props();
</script>

{#snippet badge()}
	{#if badgeEstado === 'sucesso'}
		<span
			class="inline-flex items-center gap-1 rounded-full bg-success-500/15 px-1.5 py-0.5 text-3xs font-bold uppercase text-success-700 dark:text-success-400"
		>
			<CheckCircle2 size={9} />{badgeLabel}
		</span>
	{:else if badgeEstado === 'alerta'}
		<span
			class="inline-flex items-center gap-1 rounded-full bg-warning-500/15 px-1.5 py-0.5 text-3xs font-bold uppercase text-warning-700 dark:text-warning-400"
		>
			<Clock size={9} />{badgeLabel}
		</span>
	{:else}
		<span
			class="inline-flex items-center gap-1 rounded-full bg-surface-500/15 px-1.5 py-0.5 text-3xs font-bold uppercase text-surface-700 dark:text-surface-400"
		>
			<Clock size={9} />{badgeLabel}
		</span>
	{/if}
{/snippet}

{#if isMobile}
	<!-- Mobile: card normal com título externo -->
	<p class="text-3xs font-bold uppercase tracking-wider text-surface-400 dark:text-surface-500">
		{tituloExternoMobile}
	</p>
	<div
		class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden flex flex-col shadow-sm hover:shadow-md transition-shadow duration-300"
	>
		<!-- Header: sempre visível, clicável no mobile -->
		<button
			type="button"
			class="flex w-full items-center gap-2 p-3 text-left cursor-pointer active:bg-surface-100/60 dark:active:bg-surface-700/40"
			onclick={() => {
				expandido = !expandido;
			}}
		>
			<div
				class="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg bg-surface-100 dark:bg-surface-700"
			>
				<ShieldCheck size={14} />
			</div>
			<div class="min-w-0 flex-1">
				{@render badge()}
				<p class="text-xs font-semibold text-surface-700 dark:text-surface-200 mt-0.5">
					{tituloMobile}
				</p>
			</div>
			<svg
				class="h-4 w-4 shrink-0 text-surface-400 transition-transform duration-200 {expandido
					? 'rotate-180'
					: ''}"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
			>
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
			</svg>
		</button>
		<!-- Body: expansível no mobile -->
		{#if expandido}
			<div
				transition:slide={{ duration: 200 }}
				class="px-3 pb-3 pt-2.5 border-t border-surface-200/50 dark:border-surface-700/50 flex-1 flex flex-col justify-between gap-2.5"
			>
				<div class="space-y-2">
					{@render detalhes(true)}
				</div>
				<div class="flex items-center gap-1.5 flex-wrap justify-end">
					{@render acoes(true)}
				</div>
			</div>
		{/if}
	</div>
{:else}
	<!-- Desktop: Premium horizontal row layout -->
	<div
		class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-300 flex items-center justify-between gap-4 p-3.5 px-4"
	>
		<!-- Parte 1: Status e Título -->
		<div class="flex items-center gap-3 min-w-[250px] shrink-0">
			<div
				class="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg bg-surface-100 dark:bg-surface-700"
			>
				<ShieldCheck size={14} />
			</div>
			<div class="min-w-0">
				{@render badge()}
				<p class="text-xs font-semibold text-surface-700 dark:text-surface-200 mt-0.5">
					{tituloDesktop}
				</p>
			</div>
		</div>

		<!-- Parte 2: Informações/Detalhes -->
		<div
			class="flex-1 min-w-0 text-left border-l border-surface-200/40 dark:border-surface-800/80 pl-4 py-0.5"
		>
			{@render detalhes(false)}
		</div>

		<!-- Parte 3: Ações -->
		<div
			class="flex items-center gap-1.5 shrink-0 justify-end border-l border-surface-200/40 dark:border-surface-800/80 pl-4 py-0.5"
		>
			{@render acoes(false)}
		</div>
	</div>
{/if}
