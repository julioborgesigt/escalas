<script lang="ts">
	/**
	 * Lista de `SkeletonCard` para o layout mobile durante navegação same-path.
	 */
	import SkeletonCard from './SkeletonCard.svelte';

	const { count = 5 }: { count?: number } = $props();
</script>

{#each { length: count } as _, i (i)}
	<SkeletonCard />
{/each}
