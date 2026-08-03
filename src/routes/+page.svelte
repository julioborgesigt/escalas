<script lang="ts">
	import { page } from '$app/state';
	const usuario = $derived(page.data.usuario);
</script>

<svelte:head>
	<title>Início — Escalas PC-CE</title>
</svelte:head>

<div class="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
	{#if usuario}
		<div
			class="w-16 h-16 rounded-full bg-success-500/15 border border-success-500/30 flex items-center justify-center mb-6"
		>
			<svg class="w-8 h-8 text-success-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
			</svg>
		</div>
		<h1 class="text-2xl font-bold text-surface-900 dark:text-surface-50 mb-3">
			Login bem sucedido!
		</h1>
		<p class="text-surface-600 dark:text-surface-400 text-base max-w-sm">
			Volte depois, você ainda não foi escalado.
		</p>
	{/if}
</div>
