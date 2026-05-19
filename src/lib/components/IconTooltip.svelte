<script lang="ts">
	import { Tooltip, Portal } from '@skeletonlabs/skeleton-svelte';
	import type { Snippet } from 'svelte';

	let {
		label,
		openDelay = 400,
		children
	}: {
		label: string;
		openDelay?: number;
		children: Snippet;
	} = $props();
</script>

<Tooltip {openDelay}>
	<Tooltip.Trigger>
		{@render children()}
	</Tooltip.Trigger>
	<Portal>
		<Tooltip.Positioner>
			<Tooltip.Content
				class="z-50 bg-surface-900 dark:bg-surface-50 text-surface-50 dark:text-surface-900 px-2 py-1 rounded-md text-[0.7rem] font-semibold shadow-lg max-w-xs"
			>
				{label}
			</Tooltip.Content>
		</Tooltip.Positioner>
	</Portal>
</Tooltip>
