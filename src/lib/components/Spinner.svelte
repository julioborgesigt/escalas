<script lang="ts">
	import { Progress } from '@skeletonlabs/skeleton-svelte';

	let {
		size = 'sm',
		class: className = ''
	}: {
		size?: 'xs' | 'sm' | 'md' | 'lg';
		class?: string;
	} = $props();

	const sizeMap: Record<string, string> = {
		xs: '0.75rem',
		sm: '1rem',
		md: '1.25rem',
		lg: '2rem'
	};
</script>

<Progress
	value={null}
	aria-label="Carregando"
	style="display: inline-flex; flex-direction: row; width: auto; gap: 0;"
	class="shrink-0 {className}"
>
	<Progress.Circle style="--size: {sizeMap[size]}; --thickness: calc(var(--size) / 8);">
		<Progress.CircleTrack class="stroke-transparent" />
		<Progress.CircleRange class="stroke-current" />
	</Progress.Circle>
</Progress>
