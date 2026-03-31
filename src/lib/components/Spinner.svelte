<script lang="ts">
	let { size = 'sm' }: { size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' } = $props();
	const sizes = {
		xs:  'w-3 h-3 border-[1.5px]',
		sm:  'w-3.5 h-3.5 border-2',
		md:  'w-4 h-4 border-2',
		lg:  'w-7 h-7 border-[3px]',
		xl:  'w-10 h-10 border-4',
	};
</script>

<span
	class="inline-block rounded-full animate-spin border-current/25 border-t-current shrink-0 {sizes[size]}"
	aria-hidden="true"
></span>
