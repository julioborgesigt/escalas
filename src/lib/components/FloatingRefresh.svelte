<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	let refreshing = $state(false);

	async function handleRefresh() {
		if (refreshing) return;
		refreshing = true;
		await invalidateAll();
		refreshing = false;
	}
</script>

<button
	type="button"
	onclick={handleRefresh}
	disabled={refreshing}
	class="btn-icon preset-filled-primary-500 min-[900px]:hidden fixed bottom-6 right-4 z-30 w-12 h-12 rounded-full shadow-lg shadow-primary-500/30 transition-all disabled:opacity-60"
	aria-label="Atualizar dados"
>
	<svg
		class="w-5 h-5 {refreshing ? 'animate-spin' : ''}"
		fill="none"
		viewBox="0 0 24 24"
		stroke="currentColor"
	>
		<path
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="2"
			d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
		/>
	</svg>
</button>
