<!-- Casca comum das telas de boas-vindas: conteúdo apoiado direto no fundo da
     página. Não re-restringe a largura nem re-aplica padding horizontal — o
     container do layout já dá `max-w-6xl mx-auto px-2 sm:px-4`, então isto fica
     `w-full` para casar com a largura das demais páginas (antes um `max-w-5xl`
     deixava as boas-vindas mais estreitas que o resto). -->
<script lang="ts">
	import type { Snippet } from 'svelte';

	const { children }: { children: Snippet } = $props();
</script>

<div class="animate-fade-in w-full">
	{@render children()}
</div>

<style>
	.animate-fade-in {
		animation: fadeIn 0.4s ease-out both;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
