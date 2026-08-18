<!-- A grade de cards das QUATRO telas de boas-vindas (`/bem-vindo`,
     `/super-admin`, `/escalas/bem-vindo`, `/gise/bem-vindo`).

     As quatro repetiam o mesmo `<section>` — o `<h2>` com a mesma escala
     tipográfica, a mesma classe de grade condicional e o mesmo `{#each}`. A
     duplicação foi achada pelo `guard:duplicacao` (foi um dos dois verdadeiros
     positivos que calibraram a janela do guard, em ago/2026).

     A grade colapsa para UMA coluna larga quando há um card só: `horizontal`
     existe porque um card sozinho numa grade de três colunas fica órfão à
     esquerda. `/super-admin` sempre traz cinco cards fixos, então a condição
     nunca muda o resultado dele — unificar não alterou aquela tela.

     O que NÃO subiu para cá é a `descricao` de cada página: ela depende do
     papel e é texto de negócio (DPC confere e assina, OIP cria e solicita), não
     apresentação. Cada rota continua dona da sua. -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { CardBemVindo } from '../../../routes/_components/bem-vindo-cards';
	import BemVindoCardAcao from './BemVindoCardAcao.svelte';

	interface Props {
		acoes: CardBemVindo[];
		accent?: 'primary' | 'secondary';
		/** `/super-admin` chama de "Áreas de gestão"; as demais, "Acesso rápido". */
		titulo?: string;
		/** Faixa acima da grade — hoje só o aviso de "nenhuma convocação ativa". */
		aviso?: Snippet;
	}

	const { acoes, accent = 'primary', titulo = 'Acesso rápido', aviso }: Props = $props();
</script>

<section class="mt-6 sm:mt-8">
	<h2
		class="mb-4 text-2xs font-semibold tracking-[0.18em] text-surface-600 uppercase dark:text-surface-400"
	>
		{titulo}
	</h2>
	{@render aviso?.()}
	<div class="grid grid-cols-1 gap-4 {acoes.length > 1 ? 'sm:grid-cols-2 lg:grid-cols-3' : ''}">
		{#each acoes as acao (acao.href)}
			<BemVindoCardAcao {...acao} {accent} horizontal={acoes.length === 1} />
		{/each}
	</div>
</section>
