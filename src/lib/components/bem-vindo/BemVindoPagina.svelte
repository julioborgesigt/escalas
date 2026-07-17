<!-- Casca comum das telas de boas-vindas (redesign institucional): conteúdo
     apoiado direto no fundo da página, sem o antigo container translúcido.
     Centraliza verticalmente porque essas telas têm pouco conteúdo. -->
<script lang="ts">
	import type { Snippet } from 'svelte';

	const { children }: { children: Snippet } = $props();
</script>

<div
	class="animate-fade-in mx-auto flex min-h-[70vh] w-full max-w-5xl flex-col justify-center px-4 py-10 sm:px-6 sm:py-14"
>
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
