import { createToaster } from '@skeletonlabs/skeleton-svelte';

// Cria a instância global de Toaster usando a arquitetura Zag.js do Skeleton V4.
// Placement 'bottom' (centro inferior): o Zag ancora o grupo por estilos
// inline próprios — o grupo no layout NÃO deve receber classes de posição
// (inset/p-*/flex), senão o toast desalinha (ficava colado à esquerda).
export const toaster = createToaster({
	placement: 'bottom',
	overlap: true,
	gap: 16
});
