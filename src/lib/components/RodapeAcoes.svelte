<script lang="ts">
	/**
	 * Rodapé FIXO no pé da tela: status à esquerda, ações à direita.
	 *
	 * Existe para telas longas em que a ação principal é frequente e ficava presa
	 * no fim do documento — o wizard do relatório (19 perguntas de nível 0 mais os
	 * filhos condicionais) e o editor do modelo, onde salvar exigia rolar a página
	 * inteira toda vez.
	 *
	 * `sticky` e não `fixed`, e a diferença importa: `fixed` sai do fluxo e passa
	 * por cima do conteúdo, exigindo um `padding-bottom` de reserva que ninguém
	 * lembra de manter quando a altura do rodapé muda. `sticky` continua ocupando o
	 * lugar dele no fluxo — o fim da página é o fim da página, sem nada escondido
	 * embaixo.
	 *
	 * As margens negativas sangram o rodapé até a borda do container: sem elas ele
	 * flutuaria com as laterais recuadas, parecendo um card solto em vez do pé da
	 * tela. Os valores acompanham o padding horizontal padrão das rotas
	 * (`px-2 sm:px-4`).
	 *
	 * NÃO funciona dentro de ancestral com `overflow` — `sticky` gruda no
	 * ancestral que ROLA, e um container com `overflow-hidden` não rola. Os dois
	 * call sites de hoje ficam direto sob o `<main>`, que rola com a viewport.
	 */
	import type { Snippet } from 'svelte';

	const {
		status,
		acoes
	}: {
		/**
		 * O texto de estado. Opcional porque nem toda tela tem o que dizer — mas
		 * quando tem, é aqui que o usuário olha antes de clicar.
		 */
		status?: Snippet;
		/** Os botões, alinhados à direita. */
		acoes: Snippet;
	} = $props();
</script>

<div
	class="sticky bottom-0 z-20 -mx-2 mt-6 border-t border-surface-200 bg-surface-50/95 px-2 py-3 backdrop-blur sm:-mx-4 sm:px-4 dark:border-surface-800 dark:bg-surface-900/95"
>
	<div class="flex flex-wrap items-center justify-between gap-3">
		{#if status}
			<!-- `aria-live`: o estado muda sozinho (salvou, sujou de novo), e leitor
			     de tela não tem como saber disso sem ser avisado. -->
			<p class="text-3xs text-surface-600 dark:text-surface-400" aria-live="polite">
				{@render status()}
			</p>
		{/if}

		<div class="flex flex-1 justify-end gap-2 sm:flex-none">
			{@render acoes()}
		</div>
	</div>
</div>
