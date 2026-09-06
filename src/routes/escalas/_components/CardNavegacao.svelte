<script lang="ts">
	/**
	 * Card de navegação da home de escalas — ícone/título/contador + descrição,
	 * na moldura `card-quadro`.
	 *
	 * Seis blocos repetiam a mesma classe à mão, e dois deles ("Assinaturas
	 * Pendentes") eram cópias literais um do outro em ramos diferentes do
	 * `{#if isAdminDPC}`.
	 *
	 * Fica LOCAL, em `escalas/_components/`, e não sobe para `$lib`: as
	 * ocorrências de `card-elevated` em `dados-base/` usam a mesma classe como
	 * `<section>`, o que é semântica diferente (C-MANTER da auditoria).
	 *
	 * Sem `onclick` o card vira `<div>` informativo — é o estado "Nenhuma
	 * pendência", que tem a moldura mas não leva a lugar nenhum.
	 *
	 * `card-quadro` (borda 2px), e não `card-elevated`: estes cards sentam
	 * vizinhos na folha do layout, e a borda 1px da elevated some contra ela —
	 * só o "Nova Escala" (`destacado`) ficava visível. O `realce` pinta o
	 * contorno na cor do ícone (warning no relógio, tertiary nas assinaturas);
	 * o arquivo fica no cinza do quadro.
	 *
	 * As classes de realce são escritas por extenso nos dois ramos porque o
	 * Tailwind varre o fonte: `text-${cor}-600` não gera CSS nenhum.
	 */
	import type { Snippet } from 'svelte';

	const {
		titulo,
		descricao,
		icone,
		contador,
		realce = 'primary',
		destacado = false,
		onclick
	}: {
		titulo: string;
		descricao: string;
		icone?: Snippet;
		/** Badge numérico ao lado do título. */
		contador?: number;
		/** Cor do contorno, do hover do título e do badge do contador. */
		realce?: 'primary' | 'tertiary' | 'warning';
		/** Borda permanente teal — o card "Nova Escala" é a ação primária da tela. */
		destacado?: boolean;
		/** Ausente = card informativo, sem interação. */
		onclick?: () => void;
	} = $props();

	const molduraBase =
		'card-quadro rounded-2xl p-5 sm:p-6 flex flex-col items-start gap-1.5 text-left';
	const moldura = $derived([
		molduraBase,
		onclick && 'cursor-pointer transition-colors group',
		destacado && 'border-primary-500',
		!destacado && realce === 'warning' && 'border-warning-500/60',
		!destacado && realce === 'tertiary' && 'border-tertiary-500/60',
		onclick && !destacado && realce === 'primary' && 'hover:border-primary-500/70',
		onclick && realce === 'warning' && 'hover:border-warning-500',
		onclick && realce === 'tertiary' && 'hover:border-tertiary-500'
	]);

	const tituloRealce = $derived(
		realce === 'tertiary'
			? 'group-hover:text-tertiary-600 dark:group-hover:text-tertiary-400'
			: realce === 'warning'
				? 'group-hover:text-warning-600 dark:group-hover:text-warning-400'
				: 'group-hover:text-primary-600 dark:group-hover:text-primary-400'
	);
	const badgeRealce = $derived(
		realce === 'tertiary'
			? 'bg-tertiary-500'
			: realce === 'warning'
				? 'bg-warning-500'
				: 'bg-primary-500'
	);
</script>


{#snippet conteudo()}
	<span
		class={[
			'inline-flex items-center gap-2 text-base font-semibold text-surface-900 dark:text-surface-50',
			onclick && 'transition-colors',
			onclick && tituloRealce
		]}
	>
		{@render icone?.()}
		{titulo}
		{#if contador != null}
			<span
				class="min-w-[1.4rem] h-[1.4rem] flex items-center justify-center rounded-full {badgeRealce} text-white text-xs font-bold px-1"
			>
				{contador}
			</span>
		{/if}
	</span>
	<span class="text-sm text-surface-600 dark:text-surface-400">{descricao}</span>
{/snippet}

{#if onclick}
	<button type="button" {onclick} class={moldura}>
		{@render conteudo()}
	</button>
{:else}
	<div class={moldura}>
		{@render conteudo()}
	</div>
{/if}
