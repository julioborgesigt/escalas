<script lang="ts">
	/**
	 * Alternador de duas opções no visual do Policial × Administrador.
	 *
	 * A string de classe do `Tabs.Trigger` (~230 caracteres, `data-[selected]:`
	 * e variantes de tema) já divergiu quando estava copiada à mão nas duas
	 * telas do login (credenciais e recuperação). Um ajuste de contraste num
	 * arquivo só não pode deixar as abas diferentes.
	 *
	 * O ESTADO continua de quem chama (`valor` é `$bindable`).
	 */
	import { Tabs } from '@skeletonlabs/skeleton-svelte';

	interface Opcao {
		value: string;
		label: string;
	}

	let {
		valor = $bindable(),
		opcoes,
		aoTrocar,
		class: classe = '',
		ariaLabel
	}: {
		valor: string;
		opcoes: readonly Opcao[];
		aoTrocar?: () => void;
		class?: string;
		ariaLabel?: string;
	} = $props();

	const GATILHO =
		'px-3 py-2 text-sm font-semibold rounded-lg flex-1 text-center cursor-pointer select-none ' +
		'transition-all duration-200 text-surface-600 dark:text-surface-400 ' +
		'data-[selected]:bg-primary-500 data-[selected]:text-white data-[selected]:shadow-md ' +
		'data-[selected]:shadow-primary-500/25 hover:text-surface-700 dark:hover:text-surface-200';
</script>

<Tabs
	value={valor}
	onValueChange={(e) => {
		valor = e.value;
		aoTrocar?.();
	}}
	class="w-full {classe}"
>
	<Tabs.List
		aria-label={ariaLabel}
		class="flex w-full items-center gap-1 rounded-xl border border-surface-200 bg-surface-100 p-1 dark:border-surface-700 dark:bg-surface-800"
	>
		{#each opcoes as opt (opt.value)}
			<Tabs.Trigger value={opt.value} class={GATILHO}>{opt.label}</Tabs.Trigger>
		{/each}
	</Tabs.List>
</Tabs>
