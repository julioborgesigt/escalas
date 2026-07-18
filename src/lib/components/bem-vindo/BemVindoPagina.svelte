<!-- Casca comum das telas de boas-vindas (redesign institucional): conteúdo
     apoiado direto no fundo da página, sem o antigo container translúcido.
     Alinhado ao topo, como as demais telas — o espaçamento superior vem do
     wrapper do layout (pt-20 mobile / pt-8 desktop); um min-height + centro
     vertical aqui criava um gap no topo que fugia do padrão. -->
<script lang="ts">
	import type { Snippet } from 'svelte';

	const { children }: { children: Snippet } = $props();
</script>

<div class="animate-fade-in mx-auto w-full max-w-5xl px-4 pb-10 sm:px-6">
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
