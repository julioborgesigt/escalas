<script lang="ts">
	/**
	 * A moldura de arraste de UM card do painel, no modo "Organizar".
	 *
	 * Envolve o card real sem o alterar: quem entra por `children` é o mesmo
	 * `RankingCard`, `DetailCard`, gráfico de colunas ou card de indicador que a
	 * tela mostra fora do modo. Era esse o pedido — organizar na PRÓPRIA aba de
	 * produtividade, e não numa lista de nomes em outra tela, porque o que se
	 * arruma é a leitura e a leitura é visual.
	 *
	 * Três decisões que não são estilo:
	 *
	 * - **o conteúdo fica inerte** (`pointer-events-none`). Sem isso, o gesto de
	 *   arrastar passa por cima da caixinha de seleção que todo card tem no canto,
	 *   e organizar o painel marcaria cards para exportação sem querer;
	 * - **`draggable` no card inteiro**, e não numa alça que o liga no `mousedown`
	 *   (que é como o editor do formulário faz). Lá o card tem campos de texto e
	 *   `draggable` fixo impediria selecioná-los; aqui o conteúdo já é inerte, e
	 *   pegar o card por qualquer ponto é o gesto que se espera de um painel;
	 * - **as setas ↑/↓ fazem a mesma coisa** e são o único caminho no celular e no
	 *   teclado — `dragstart` não existe em toque. Mesma razão de existirem no
	 *   editor do formulário.
	 *
	 * A faixa de controles fica ACIMA do card, e não sobreposta a ele. Sobreposta
	 * ela cobria o título do card no canto esquerdo e a caixinha de exportação no
	 * direito — os dois cantos que todo card do painel já usa.
	 */
	import type { Snippet } from 'svelte';
	import GripVertical from '@lucide/svelte/icons/grip-vertical';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import type { SecaoPainel } from './useProdutividade.svelte';
	import type { OrganizacaoPainel } from './useOrganizacaoPainel.svelte';

	const {
		organizacao,
		secao,
		indice,
		total,
		rotulo,
		children
	}: {
		organizacao: OrganizacaoPainel;
		secao: SecaoPainel;
		indice: number;
		/** Quantos cards há nesta faixa — desabilita a seta do primeiro e do último. */
		total: number;
		/** O título do card, para o `aria-label` das setas dizer o que se move. */
		rotulo: string;
		children: Snippet;
	} = $props();

	const arrastando = $derived(
		organizacao.arrastando?.secao === secao && organizacao.arrastando.indice === indice
	);
	const alvo = $derived(
		!arrastando && organizacao.alvo?.secao === secao && organizacao.alvo.indice === indice
	);
</script>

<!-- `role="listitem"` porque é o que a tela é neste modo: uma lista ORDENADA em
     que a posição é a informação. O contêiner de cada faixa recebe `role="list"`
     junto. Mesma escolha do editor do formulário. -->
<div
	class="flex h-full flex-col gap-2 rounded-3xl transition-all {arrastando
		? 'opacity-40'
		: ''} {alvo
		? 'ring-4 ring-primary-500/60 ring-offset-4 ring-offset-surface-50 dark:ring-offset-surface-950'
		: ''}"
	role="listitem"
	draggable="true"
	ondragstart={() => organizacao.iniciarArraste(secao, indice)}
	ondragover={(e) => {
		if (organizacao.aceita(secao)) e.preventDefault();
	}}
	ondragenter={() => organizacao.entrarEm(secao, indice)}
	ondrop={(e) => {
		e.preventDefault();
		organizacao.soltarEm(secao, indice);
	}}
	ondragend={() => organizacao.limpar()}
>
	<!-- `print:hidden` porque o modo é de tela: se alguém imprimir com ele ligado,
	     o papel não leva alça nem seta. -->
	<div
		class="flex cursor-grab items-center justify-between gap-2 rounded-xl bg-surface-200/70 px-2 py-1 active:cursor-grabbing dark:bg-surface-800/70 print:hidden"
	>
		<span
			class="inline-flex min-w-0 items-center gap-1.5 text-3xs font-black uppercase tracking-widest text-surface-600 dark:text-surface-300"
		>
			<GripVertical size={14} class="shrink-0" aria-hidden="true" />
			<span class="shrink-0">{indice + 1}º</span>
			<span class="truncate opacity-70">{rotulo}</span>
		</span>
		<span class="flex shrink-0 items-center gap-1">
			<button
				type="button"
				class="rounded-lg bg-white p-1 text-surface-700 shadow-sm transition-colors hover:bg-primary-500 hover:text-white disabled:opacity-30 disabled:hover:bg-white disabled:hover:text-surface-700 dark:bg-surface-900 dark:text-surface-200 dark:disabled:hover:bg-surface-900"
				disabled={indice <= 0}
				aria-label="Mover {rotulo} para cima"
				onclick={() => organizacao.mover(secao, indice, indice - 1)}
			>
				<ChevronUp size={16} />
			</button>
			<button
				type="button"
				class="rounded-lg bg-white p-1 text-surface-700 shadow-sm transition-colors hover:bg-primary-500 hover:text-white disabled:opacity-30 disabled:hover:bg-white disabled:hover:text-surface-700 dark:bg-surface-900 dark:text-surface-200 dark:disabled:hover:bg-surface-900"
				disabled={indice >= total - 1}
				aria-label="Mover {rotulo} para baixo"
				onclick={() => organizacao.mover(secao, indice, indice + 1)}
			>
				<ChevronDown size={16} />
			</button>
		</span>
	</div>

	<!-- Inerte: o gesto é do card inteiro, e nenhum controle de dentro dele deve
	     reagir enquanto se organiza. -->
	<div class="pointer-events-none flex-1 cursor-grab select-none active:cursor-grabbing">
		{@render children()}
	</div>
</div>
