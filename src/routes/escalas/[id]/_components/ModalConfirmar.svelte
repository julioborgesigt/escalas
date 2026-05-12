<script lang="ts">
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
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

<Dialog {open} onOpenChange={(e) => (open = e.open)}>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="card p-4 sm:p-6 max-w-sm w-full max-h-[calc(100dvh-2rem)] overflow-y-auto bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10"
		>
			<Dialog.Title class="h3 font-bold mb-2">{title}</Dialog.Title>
			<Dialog.Description class="text-surface-600 dark:text-surface-400 mb-6">
				{@render description()}
			</Dialog.Description>
			<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
				<Dialog.CloseTrigger class="btn preset-outlined-surface">Cancelar</Dialog.CloseTrigger>
				{@render actions()}
			</div>
		</div>
	</Dialog.Content>
</Dialog>
