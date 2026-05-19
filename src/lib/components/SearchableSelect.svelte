<script lang="ts">
	import { Combobox, Portal, useListCollection, type ComboboxRootProps } from '@skeletonlabs/skeleton-svelte';

	type Option = { value: unknown; label: string };

	let {
		options = [],
		loadOptions = undefined,
		selectedOption = undefined,
		debounceMs = 300,
		minSearchChars = 0,
		showTrigger = true,
		value = $bindable(null),
		placeholder = 'Selecione...',
		id = '',
		name = '',
		class: className = '',
		disabled = false
	}: {
		options?: Option[];
		loadOptions?: (query: string, signal: AbortSignal) => Promise<Option[]>;
		selectedOption?: Option | null;
		debounceMs?: number;
		minSearchChars?: number;
		showTrigger?: boolean;
		value: unknown;
		placeholder?: string;
		id?: string;
		name?: string;
		class?: string;
		disabled?: boolean;
	} = $props();

	const isAsync = $derived(typeof loadOptions === 'function');

	function isValueEmpty(v: unknown): boolean {
		return v === null || v === undefined || v === '';
	}

	// Sync mode items (filtered)
	let syncItems = $state<Option[]>([]);
	$effect(() => {
		syncItems = options;
	});

	// Async mode items
	let asyncItems = $state<Option[]>([]);
	let asyncLoading = $state(false);
	let asyncError = $state<string | null>(null);
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let inFlightController: AbortController | null = null;

	// Cleanup on unmount
	$effect(() => {
		return () => {
			if (debounceTimer) clearTimeout(debounceTimer);
			if (inFlightController) inFlightController.abort();
		};
	});

	// For async: seed items with selectedOption so label shows for pre-selected values
	const effectiveAsyncItems = $derived.by(() => {
		if (asyncItems.length > 0) return asyncItems;
		if (!isValueEmpty(value)) {
			const hint = selectedOption ?? null;
			if (hint && String(hint.value) === String(value)) return [hint as Option];
		}
		return [];
	});

	const items = $derived(isAsync ? effectiveAsyncItems : syncItems);

	const collection = $derived(
		useListCollection({
			items,
			itemToString: (item) => item.label,
			itemToValue: (item) => String(item.value)
		})
	);

	// Combobox expects string[] for value
	const comboboxValue = $derived(isValueEmpty(value) ? [] : [String(value)]);

	const onValueChange: ComboboxRootProps['onValueChange'] = (event) => {
		if (!event.value || event.value.length === 0) {
			value = null;
			return;
		}
		const strVal = event.value[0];
		const option = items.find((o) => String(o.value) === strVal);
		// Preserve original type (e.g. number ids)
		value = option ? option.value : strVal;
	};

	const onOpenChange: ComboboxRootProps['onOpenChange'] = () => {
		asyncError = null;
		if (!isAsync) {
			syncItems = options;
		}
	};

	const onInputValueChange: ComboboxRootProps['onInputValueChange'] = (event) => {
		const term = event.inputValue;

		if (!isAsync) {
			syncItems = term
				? options.filter((o) => o.label.toLowerCase().includes(term.toLowerCase()))
				: options;
			return;
		}

		if (term.length < minSearchChars) {
			asyncItems = [];
			asyncLoading = false;
			return;
		}

		if (debounceTimer) clearTimeout(debounceTimer);
		if (inFlightController) inFlightController.abort();

		const controller = new AbortController();
		inFlightController = controller;
		asyncLoading = true;
		asyncError = null;

		debounceTimer = setTimeout(async () => {
			try {
				const result = await loadOptions!(term, controller.signal);
				if (!controller.signal.aborted) {
					asyncItems = result;
					asyncLoading = false;
				}
			} catch (err) {
				if (!controller.signal.aborted) {
					asyncItems = [];
					asyncError = err instanceof Error ? err.message : 'Erro na busca';
					asyncLoading = false;
				}
			}
		}, debounceMs);
	};
</script>

<div class="relative w-full {className}">
	<input type="hidden" {id} {name} value={isValueEmpty(value) ? '' : String(value)} />
	<Combobox
		value={comboboxValue}
		{collection}
		{placeholder}
		{disabled}
		{onValueChange}
		{onOpenChange}
		{onInputValueChange}
		class="w-full"
	>
		<Combobox.Control
			class="flex items-center w-full rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 focus-within:border-primary-400 focus-within:ring-1 focus-within:ring-primary-400/30 transition-colors overflow-hidden {disabled ? 'opacity-60 cursor-not-allowed' : ''}"
		>
			<Combobox.Input
				class="flex-1 min-w-0 px-3 py-2 text-sm bg-transparent text-surface-900 dark:text-surface-50 placeholder:text-surface-400 dark:placeholder:text-surface-500 focus:outline-none disabled:cursor-not-allowed"
			/>
			{#if !isValueEmpty(value)}
				<Combobox.ClearTrigger
					class="flex items-center justify-center px-2 py-2 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors"
				/>
			{/if}
			{#if showTrigger}
				<Combobox.Trigger
					class="flex items-center justify-center px-2 py-2 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors"
				/>
			{/if}
		</Combobox.Control>
		<Portal>
			<Combobox.Positioner>
				<Combobox.Content>
					{#if asyncLoading}
						<div class="px-3 py-2 text-sm text-surface-500 flex items-center gap-2">
							<svg class="animate-spin h-4 w-4 text-primary-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
							</svg>
							Buscando...
						</div>
					{:else if asyncError}
						<div class="px-3 py-2 text-sm text-error-600">{asyncError}</div>
					{:else if isAsync && minSearchChars > 0 && asyncItems.length === 0}
						<div class="px-3 py-2 text-sm text-surface-500">
							Digite ao menos {minSearchChars} caractere{minSearchChars > 1 ? 's' : ''} para buscar
						</div>
					{:else if items.length === 0}
						<div class="px-3 py-2 text-sm text-surface-500">Nenhum resultado encontrado</div>
					{:else}
						{#each items as item (String(item.value))}
							<Combobox.Item {item}>
								<Combobox.ItemText>{item.label}</Combobox.ItemText>
								<Combobox.ItemIndicator />
							</Combobox.Item>
						{/each}
					{/if}
				</Combobox.Content>
			</Combobox.Positioner>
		</Portal>
	</Combobox>
</div>
