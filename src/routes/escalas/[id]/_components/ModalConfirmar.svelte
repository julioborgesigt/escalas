<!--
	Adapter das confirmações da escala: preserva a API local enquanto delega
	semântica, fechamento e layout ao ModalShell compartilhado.
-->
<script lang="ts">
	import ModalShell from '$lib/components/ModalShell.svelte';
	import type { Snippet } from 'svelte';

	let {
		open = $bindable(false),
		title,
		description,
		actions
	}: {
		open: boolean;
		title: string;
		description: Snippet;
		actions: Snippet;
	} = $props();
</script>

<ModalShell bind:open {title} {description} cancelLabel="Cancelar">
	{#snippet footer()}
		{@render actions()}
	{/snippet}
</ModalShell>
