import { createToaster } from '@skeletonlabs/skeleton-svelte';

// Cria a instância global de Toaster usando a arquitetura Zag.js do Skeleton V4
export const toaster = createToaster({
	placement: 'bottom-end',
	overlap: true,
	gap: 16
});
