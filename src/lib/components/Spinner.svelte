<script lang="ts">
	let {
		size = 'sm',
		class: className = ''
	}: {
		size?: 'xs' | 'sm' | 'md' | 'lg';
		class?: string;
	} = $props();

	const sizes: Record<string, string> = {
		xs: 'w-3 h-3 border-2',
		sm: 'w-4 h-4 border-2',
		md: 'w-5 h-5 border-2',
		lg: 'w-8 h-8 border-4'
	};
</script>

<span
	role="status"
	aria-label="Carregando"
	class="inline-block shrink-0 rounded-full animate-spin border-current border-t-transparent {sizes[size]} {className}"
></span>
