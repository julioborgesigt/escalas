<script lang="ts">
	/**
	 * Empty state padrão de listagens. Duas formas, e a escolha é automática:
	 *
	 * - **linha** (só `mensagem`): um parágrafo, para o vazio DENTRO de uma
	 *   tabela ou card já titulado — é o caso de escalas e policiais;
	 * - **página** (`icone` e/ou `descricao`): ícone → título destacado →
	 *   subtítulo, para o vazio que OCUPA a área de conteúdo.
	 *
	 * A forma de página é a que quatro listagens montavam à mão, com três
	 * paddings e três tratamentos tipográficos diferentes. Quem precisa de
	 * padding maior passa `class="py-20"` — o default fica em `py-12` porque é
	 * o que os adotantes de dentro de tabela já usavam.
	 *
	 * `icone` é snippet, e não um componente Lucide como prop, porque a COR
	 * carrega sentido: surface para "não há nada", success para "está tudo em
	 * dia". Quem passa o ícone escolhe a classe.
	 *
	 * `children` continua para o caso com CTA ou markup extra.
	 */
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';

	const {
		mensagem,
		descricao,
		icone,
		tom = 'default',
		class: className = '',
		children
	}: {
		/** Título do estado vazio. */
		mensagem?: string;
		/** Subtítulo — o que o usuário pode fazer a respeito. */
		descricao?: string;
		icone?: Snippet;
		/** `muted` = `text-surface-500` (ex.: TabelaServidores); default = 600/400. */
		tom?: 'muted' | 'default';
		class?: ClassValue;
		children?: Snippet;
	} = $props();

	const tomCls = $derived(
		tom === 'muted' ? 'text-surface-500' : 'text-surface-600 dark:text-surface-400'
	);

	const formaPagina = $derived(!!icone || !!descricao);
</script>

<div class={['text-center py-12', tomCls, className]}>
	{#if children}
		{@render children()}
	{:else if formaPagina}
		{#if icone}
			<div class="mb-4 flex justify-center">{@render icone()}</div>
		{/if}
		{#if mensagem}
			<p class="text-lg font-semibold">{mensagem}</p>
		{/if}
		{#if descricao}
			<p class="text-sm mt-1">{descricao}</p>
		{/if}
	{:else if mensagem}
		<p>{mensagem}</p>
	{/if}
</div>
