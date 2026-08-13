<script lang="ts">
	/**
	 * Card de navegação da home de escalas — ícone/título/contador + descrição,
	 * na moldura `card-elevated`.
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
		/** Cor do hover do título e do badge do contador. */
		realce?: 'primary' | 'tertiary';
		/** Borda permanente (o card "Nova Escala" é a ação primária da tela). */
		destacado?: boolean;
		/** Ausente = card informativo, sem interação. */
		onclick?: () => void;
	} = $props();

	const molduraBase =
		'card-elevated rounded-2xl p-5 sm:p-6 flex flex-col items-start gap-1.5 text-left';
	const moldura = $derived([
		molduraBase,
		onclick && 'cursor-pointer transition-colors hover:border-primary-500/40 group',
		destacado && 'border-primary-500'
	]);

	const tituloRealce = $derived(
		realce === 'tertiary'
			? 'group-hover:text-tertiary-600 dark:group-hover:text-tertiary-400'
			: 'group-hover:text-primary-600 dark:group-hover:text-primary-400'
	);
	const badgeRealce = $derived(realce === 'tertiary' ? 'bg-tertiary-500' : 'bg-primary-500');
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
