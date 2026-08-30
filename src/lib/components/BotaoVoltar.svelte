<script lang="ts">
	/**
	 * Botão "← VOLTAR" do topo de tela de detalhe — acima do `<h1>`, nunca no
	 * rodapé.
	 *
	 * Existe porque o mesmo bloco (botão contornado pequeno + seta que desliza no
	 * hover + rótulo em maiúsculas) estava copiado em cinco arquivos, um deles já
	 * com `ArrowLeft` do lucide e os outros com o SVG à mão. Cada cópia era uma
	 * chance de a próxima tela nascer com outro tamanho de seta ou outro peso de
	 * fonte — que foi exatamente o que aconteceu com o wizard do relatório.
	 *
	 * `href` renderiza um `<a>` (navegação de verdade: nova aba, URL visível);
	 * `onclick` renderiza um `<button>`, para quem volta desfazendo estado local
	 * em vez de mudar de rota. Passar os dois é erro de uso — o `href` vence.
	 */
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';

	const {
		href,
		onclick,
		rotulo = 'Voltar',
		class: classe = ''
	}: {
		href?: string;
		onclick?: () => void;
		/** Só troque quando o destino não for óbvio ("Voltar para a escala"). */
		rotulo?: string;
		class?: string;
	} = $props();

	const CLASSES =
		'btn btn-sm preset-outlined-surface-500 hover:bg-surface-50 dark:hover:bg-surface-900 px-3 py-1.5 rounded-xl transition-all flex w-fit max-w-full items-center gap-2 group';
</script>

{#snippet conteudo()}
	<ArrowLeft size={16} class="shrink-0 transition-transform group-hover:-translate-x-1" />
	<span class="text-sm font-bold uppercase tracking-wider">{rotulo}</span>
{/snippet}

{#if href}
	<a {href} class="{CLASSES} {classe}">{@render conteudo()}</a>
{:else}
	<button type="button" class="{CLASSES} {classe}" {onclick}>{@render conteudo()}</button>
{/if}
