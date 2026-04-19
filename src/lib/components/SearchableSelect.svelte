<script lang="ts">
	type Option = { value: any; label: string };

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
		/** Lista síncrona de opções (modo client-side, padrão histórico). */
		options?: Option[];
		/**
		 * Modo assíncrono: callback que faz a busca server-side.
		 * Quando definido, o componente ignora `options` e usa apenas o resultado
		 * desta função. O `query` é o texto digitado no campo de busca.
		 * Aborte requisições em flight verificando `signal.aborted`.
		 */
		loadOptions?: (query: string, signal: AbortSignal) => Promise<Option[]>;
		/**
		 * Apenas no modo async: opção atualmente selecionada — usada para
		 * renderizar o label sem precisar buscá-la do servidor a cada montagem.
		 */
		selectedOption?: Option | null;
		/** Apenas no modo async: ms para debounce do `loadOptions` (default 300). */
		debounceMs?: number;
		/**
		 * Apenas no modo async: nº mínimo de caracteres para disparar busca.
		 * Default 0 (busca também com query vazia).
		 */
		minSearchChars?: number;
		value: any;
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

	// Modo assíncrono — estado próprio
	let asyncOptions = $state<Option[]>([]);
	let asyncLoading = $state(false);
	let asyncError = $state<string | null>(null);
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let inFlightController: AbortController | null = null;

	const selectedLabel = $derived(
		isAsync
			? selectedOption?.label ?? ''
			: options.find((o) => o.value === value)?.label || ''
	);

	const filteredOptions = $derived(
		isAsync
			? asyncOptions
			: options.filter((o) => {
					if (!searchTerm) return true;
					return o.label.toLowerCase().includes(searchTerm.toLowerCase());
				})
	);

	function handleSelect(val: any) {
		value = val;
		searchTerm = '';
		isOpen = false;
	}

	function handleWindowClick(e: MouseEvent) {
		if (isOpen && containerRef && !containerRef.contains(e.target as Node)) {
			isOpen = false;
		}
	}

	/**
	 * Modo async: dispara `loadOptions` com debounce sempre que o termo de
	 * busca muda E o dropdown está aberto. Cancela buscas anteriores em flight.
	 */
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

<div class="relative w-full {className} {isOpen ? 'z-[60]' : 'z-0'}" bind:this={containerRef}>
	<!-- Hidden input to make it work with native forms naturally -->
	<input type="hidden" {name} {id} {value} />

	<div class="relative w-full">
		{#if !isOpen && value !== null && value !== ''}
			<!-- Show the selected label acting as a button to open -->
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
					searchTerm = '';
				}}
				title="Limpar seleção"
			>
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		{:else}
			<!-- Search Input -->
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
				{#if isOpen && !searchTerm && value === null}
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

	{#if isOpen}
		<ul
			class="absolute z-50 w-full mt-1 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl shadow-xl max-h-80 overflow-y-auto"
		>
			{#if isAsync && asyncLoading}
				<li class="px-3 py-2 text-sm text-surface-500 cursor-default flex items-center gap-2">
					<svg class="animate-spin h-4 w-4 text-primary-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
					</svg>
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
						class="px-3 py-2 text-sm cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors {value ===
						option.value
							? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 font-medium'
							: 'text-surface-900 dark:text-surface-100'}"
						onclick={() => handleSelect(option.value)}
					>
						{option.label}
					</li>
				{/each}
			{/if}
		</ul>
	{/if}
</div>
