import { createToaster } from '@skeletonlabs/skeleton-svelte';

// Cria a instância global de Toaster usando a arquitetura Zag.js do Skeleton V4.
// Placement 'bottom-end' (canto inferior direito): o Zag ancora o grupo por
// estilos inline próprios (`insetInlineEnd` + `align-items: flex-end`) — o grupo
// no layout NÃO deve receber classes de posição (inset/p-*/flex), senão o toast
// desalinha (com classes próprias ficava colado à esquerda).
// No mobile o toast usa largura ~cheia (`w-[calc(100vw-2rem)]`), então o
// deslocamento de 1rem à direita o deixa visualmente centrado do mesmo jeito.
export const toaster = createToaster({
	placement: 'bottom-end',
	overlap: true,
	gap: 16
});
