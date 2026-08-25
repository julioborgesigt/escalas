<script lang="ts">
	/**
	 * Cabeçalho (ícone de cadeado + título + descrição) das telas de senha —
	 * alterar-senha e redefinir-senha tinham a mesma marcação byte a byte.
	 *
	 * `mostrarIcone` fica ligado por padrão; no primeiro acesso de /alterar-senha
	 * some — o cadeado competia com o aviso amarelo e ocupava altura no celular.
	 */
	const {
		titulo,
		descricao,
		mostrarIcone = true
	}: { titulo: string; descricao: string; mostrarIcone?: boolean } = $props();
</script>

<div class="text-center mb-6">
	{#if mostrarIcone}
		<div
			class="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary-500/10 border border-primary-500/20 mb-4"
		>
			<svg
				class="w-7 h-7 text-primary-500"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="1.8"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
				/>
			</svg>
		</div>
	{/if}
	<h1 class="text-xl font-bold">{titulo}</h1>
	<p class="text-sm text-surface-600 dark:text-surface-400 mt-1">{descricao}</p>
</div>
