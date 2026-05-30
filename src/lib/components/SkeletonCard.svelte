<script lang="ts">
	const { lines = 3, hasFooter = true }: { lines?: number; hasFooter?: boolean } = $props();
</script>

<div
	class="p-4 rounded-2xl border border-surface-200 dark:border-white/10 bg-surface-100/50 dark:bg-surface-800/50 animate-pulse"
>
	<div class="flex justify-between mb-3">
		<div class="h-5 w-2/5 rounded-lg bg-surface-300 dark:bg-surface-700"></div>
		<div class="h-5 w-16 rounded-full bg-surface-200 dark:bg-surface-700"></div>
	</div>
	{#each { length: lines } as _}
		<div class="h-4 w-3/4 rounded bg-surface-200 dark:bg-surface-700 mb-2 last:mb-0"></div>
	{/each}
	{#if hasFooter}
		<div class="flex gap-2 mt-3 pt-3 border-t border-surface-200 dark:border-white/5">
			<div class="h-9 flex-1 rounded-xl bg-surface-200 dark:bg-surface-700"></div>
			<div class="h-9 w-9 rounded-xl bg-surface-200 dark:bg-surface-700"></div>
		</div>
	{/if}
</div>
