<script lang="ts">
	import { Portal } from '@skeletonlabs/skeleton-svelte';
	import Spinner from './Spinner.svelte';

	type Option = { value: unknown; label: string };

	let {
		options = [],
		loadOptions = undefined,
		selectedOption = undefined,
		debounceMs = 300,
		minSearchChars = 0,
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
		value: unknown;
		placeholder?: string;
		id?: string;
		name?: string;
		class?: string;
		disabled?: boolean;
	} = $props();

	const isAsync = $derived(typeof loadOptions === 'function');

	let isOpen = $state(false);
	let searchTerm = $state('');
	let containerRef: HTMLDivElement;
	let portalListRef = $state<HTMLUListElement | null>(null);

	let asyncOptions = $state<Option[]>([]);
	let asyncLoading = $state(false);
	let asyncError = $state<string | null>(null);
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let inFlightController: AbortController | null = null;
	let asyncPickedOption = $state<Option | null>(null);

	// Position of the dropdown (for fixed portal rendering)
	let dropdownRect = $state<{ top: number; left: number; width: number } | null>(null);

	function updateDropdownPos() {
		if (!containerRef) return;
		const rect = containerRef.getBoundingClientRect();
		dropdownRect = { top: rect.bottom, left: rect.left, width: rect.width };
	}

	$effect(() => {
		if (!isOpen) {
			dropdownRect = null;
			return;
		}
		updateDropdownPos();
		const onScroll = () => updateDropdownPos();
		const onResize = () => updateDropdownPos();
		window.addEventListener('scroll', onScroll, { capture: true, passive: true });
		window.addEventListener('resize', onResize);
		return () => {
			window.removeEventListener('scroll', onScroll, { capture: true });
			window.removeEventListener('resize', onResize);
		};
	});

	function valuesEqual(a: unknown, b: unknown): boolean {
		if (Object.is(a, b)) return true;
		if (a == null || b == null) return false;
		return String(a) === String(b);
	}

	function isValueEmpty(v: unknown): boolean {
		return v === null || v === undefined || v === '';
	}

	const selectedLabel = $derived.by(() => {
		if (!isAsync) {
			return options.find((o) => o.value === value)?.label || '';
		}
		if (isValueEmpty(value)) return '';
		if (selectedOption != null && valuesEqual(selectedOption.value, value)) {
			return selectedOption.label;
		}
		if (asyncPickedOption != null && valuesEqual(asyncPickedOption.value, value)) {
			return asyncPickedOption.label;
		}
		const hit = asyncOptions.find((o) => valuesEqual(o.value, value));
		return hit?.label ?? '';
	});

	const filteredOptions = $derived(
		isAsync
			? asyncOptions
			: options.filter((o) => {
					if (!searchTerm) return true;
					return o.label.toLowerCase().includes(searchTerm.toLowerCase());
				})
	);

	function pickOption(option: Option) {
		value = option.value;
		if (typeof loadOptions === 'function') {
			asyncPickedOption = option;
		}
		searchTerm = '';
		isOpen = false;
	}

	$effect(() => {
		if (typeof loadOptions !== 'function') return;
		if (isValueEmpty(value)) {
			asyncPickedOption = null;
			return;
		}
		if (selectedOption != null && valuesEqual(selectedOption.value, value)) {
			asyncPickedOption = null;
		}
	});

	function handleWindowClick(e: MouseEvent) {
		if (!isOpen) return;
		const target = e.target as Node;
		const inContainer = containerRef && containerRef.contains(target);
		const inPortal = portalListRef && portalListRef.contains(target);
		if (!inContainer && !inPortal) {
			isOpen = false;
		}
	}

	$effect(() => {
		if (!isAsync || !isOpen) return;

		const term = searchTerm.trim();
		if (term.length < minSearchChars) {
			asyncOptions = [];
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
					asyncOptions = result;
					asyncLoading = false;
				}
			} catch (err) {
				if (!controller.signal.aborted) {
					asyncOptions = [];
					asyncError = err instanceof Error ? err.message : 'Erro na busca';
					asyncLoading = false;
				}
			}
		}, debounceMs);

		return () => {
			if (debounceTimer) clearTimeout(debounceTimer);
			controller.abort();
		};
	});
</script>

<svelte:window onclick={handleWindowClick} />

<div class="relative w-full {className}" bind:this={containerRef}>
	<input type="hidden" {name} {id} {value} />

	<div class="relative w-full">
		{#if !isOpen && !isValueEmpty(value)}
			<button
				type="button"
				{disabled}
				class="w-full text-left truncate px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
				onclick={() => {
					isOpen = true;
					searchTerm = '';
				}}
			>
				{selectedLabel}
			</button>
			<button
				type="button"
				{disabled}
				class="absolute right-2 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 disabled:opacity-50"
				onclick={() => {
					value = null;
					asyncPickedOption = null;
					searchTerm = '';
				}}
				title="Limpar seleção"
			>
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		{:else}
			<div class="relative">
				<input
					type="text"
					{disabled}
					class="w-full px-3 py-[7px] pl-8 rounded-xl border {isOpen ? 'border-primary-500' : 'border-surface-300 dark:border-surface-700'} bg-white dark:bg-surface-800 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
					{placeholder}
					bind:value={searchTerm}
					onfocus={() => (isOpen = true)}
					autocomplete="off"
				/>
				<svg
					class="w-4 h-4 text-surface-400 absolute left-2.5 top-1/2 -translate-y-1/2"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
				</svg>
				{#if isOpen && !searchTerm && isValueEmpty(value)}
					<button
						type="button"
						class="absolute right-2 top-1/2 -translate-y-1/2 text-surface-400"
						onclick={() => (isOpen = false)}
						aria-label="Minimizar opções"
						title="Minimizar opções"
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
						</svg>
					</button>
				{/if}
			</div>
		{/if}
	</div>
</div>

{#if isOpen && dropdownRect}
	<Portal>
		<ul
			bind:this={portalListRef}
			class="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl shadow-xl max-h-80 overflow-y-auto"
			style="position: fixed; top: {dropdownRect.top + 4}px; left: {dropdownRect.left}px; width: {dropdownRect.width}px; z-index: 9999;"
		>
			{#if isAsync && asyncLoading}
				<li class="px-3 py-2 text-sm text-surface-500 cursor-default flex items-center gap-2">
					<Spinner size="sm" class="text-primary-500" />
					Buscando...
				</li>
			{:else if isAsync && asyncError}
				<li class="px-3 py-2 text-sm text-error-600 cursor-default">
					{asyncError}
				</li>
			{:else if isAsync && minSearchChars > 0 && searchTerm.trim().length < minSearchChars}
				<li class="px-3 py-2 text-sm text-surface-500 cursor-default">
					Digite ao menos {minSearchChars} caractere{minSearchChars > 1 ? 's' : ''} para buscar
				</li>
			{:else if filteredOptions.length === 0}
				<li class="px-3 py-2 text-sm text-surface-500 cursor-default">
					Nenhum resultado encontrado
				</li>
			{:else}
				{#each filteredOptions as option}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<li
						class="px-3 py-2 text-sm cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors {value === option.value
							? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 font-medium'
							: 'text-surface-900 dark:text-surface-100'}"
						onclick={() => pickOption(option)}
					>
						{option.label}
					</li>
				{/each}
			{/if}
		</ul>
	</Portal>
{/if}
