<script lang="ts">
	/**
	 * Select com busca — usado em todo lugar que escolhe policial ou unidade.
	 *
	 * Dois modos, e a diferença é de onde vêm as opções:
	 * - `options` fixo (unidades, alguns milhares no máximo, já carregados);
	 * - `loadOptions` assíncrono (policiais), com debounce e CANCELAMENTO da
	 *   busca anterior via `useBuscaDebounce`. Sem cancelar, respostas fora de
	 *   ordem faziam a lista piscar com o resultado de uma busca já abandonada.
	 *
	 * `selectedOption` existe além de `value` porque o rótulo do item escolhido
	 * pode não estar na lista atual: reabrir uma escala mostra "FULANO DE TAL"
	 * sem precisar rebuscar, e digitar outra coisa não apaga a seleção.
	 *
	 * O menu vai num `Portal` para escapar do `overflow` das tabelas e modais
	 * onde o componente costuma viver.
	 */
	import {
		Combobox,
		Portal,
		useListCollection,
		type ComboboxRootProps
	} from '@skeletonlabs/skeleton-svelte';
	import { useBuscaDebounce } from '$lib/composables/useBuscaDebounce.svelte';
	import Spinner from './Spinner.svelte';

	type Option = { value: unknown; label: string };

	let {
		options = [],
		loadOptions = undefined,
		selectedOption = undefined,
		debounceMs = 300,
		minSearchChars = 0,
		showTrigger = true,
		value = $bindable<unknown>(null),
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

	// Sync mode items (filtered): $derived gravável — reseta para a lista
	// completa quando a prop `options` muda; os handlers abaixo reatribuem
	// localmente para aplicar o filtro digitado.
	let syncItems = $derived(options);

	// Async mode: debounce + abort + flags encapsulados no composable.
	// Getters preservam a reatividade das props (lidas a cada busca).
	const busca = useBuscaDebounce<Option>({
		debounceMs: () => debounceMs,
		minChars: () => minSearchChars,
		buscar: (termo, signal) => loadOptions!(termo, signal)
	});

	// For async: seed items with selectedOption so label shows for pre-selected values
	const effectiveAsyncItems = $derived.by(() => {
		if (busca.resultados.length > 0) return busca.resultados;
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
		busca.erro = '';
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

		busca.buscar(term);
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
			class="flex items-center w-full rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 focus-within:border-primary-400 focus-within:ring-1 focus-within:ring-primary-400/30 transition-colors overflow-hidden {disabled
				? 'opacity-60 cursor-not-allowed'
				: ''}"
		>
			<Combobox.Input
				class="flex-1 min-w-0 pl-3 pr-1 py-1.5 text-sm bg-transparent text-surface-900 dark:text-surface-50 placeholder:text-surface-400 dark:placeholder:text-surface-500 focus:outline-none disabled:cursor-not-allowed"
			/>
			{#if !isValueEmpty(value)}
				<Combobox.ClearTrigger
					class="flex items-center justify-center w-5 h-5 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors [&_svg]:w-3 [&_svg]:h-3 flex-shrink-0"
				/>
			{/if}
			{#if showTrigger}
				<Combobox.Trigger
					class="flex items-center justify-center w-6 h-6 mr-1 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors [&_svg]:w-3.5 [&_svg]:h-3.5 flex-shrink-0"
				/>
			{/if}
		</Combobox.Control>
		<Portal>
			<Combobox.Positioner>
				<Combobox.Content
					class="z-50 min-w-[12rem] rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 shadow-lg py-1 max-h-64 overflow-y-auto"
				>
					{#if busca.buscando}
						<div class="px-3 py-2 text-sm text-surface-500 flex items-center gap-2">
							<Spinner size="sm" class="text-primary-500" />
							Buscando...
						</div>
					{:else if busca.erro}
						<div class="px-3 py-2 text-sm text-error-600">{busca.erro}</div>
					{:else if isAsync && minSearchChars > 0 && !busca.buscou}
						<div class="px-3 py-2 text-sm text-surface-500">
							Digite ao menos {minSearchChars} caractere{minSearchChars > 1 ? 's' : ''} para buscar
						</div>
					{:else if items.length === 0}
						<div class="px-3 py-2 text-sm text-surface-500">Nenhum resultado encontrado</div>
					{:else}
						{#each items as item (String(item.value))}
							<Combobox.Item
								{item}
								class="flex items-center justify-between gap-2 px-3 py-2 text-sm text-surface-800 dark:text-surface-100 cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-700 data-[highlighted]:bg-surface-100 dark:data-[highlighted]:bg-surface-700"
							>
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
