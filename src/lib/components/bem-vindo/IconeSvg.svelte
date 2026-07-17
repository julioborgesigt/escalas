<!-- Ícone SVG das telas de boas-vindas, renderizado com os mesmos atributos
     do `itemMenu` da sidebar (outline 24×24, stroke 1.5) para que o ícone de
     um destino seja desenhado idêntico nos dois lugares. Paths vêm de
     `$lib/constants/icones`. -->
<script lang="ts">
	interface Props {
		paths: string[];
		class?: string;
	}

	const { paths, class: classe = '' }: Props = $props();
</script>

<svg class={classe} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
	{#each paths as d (d)}
		<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" {d} />
	{/each}
</svg>
