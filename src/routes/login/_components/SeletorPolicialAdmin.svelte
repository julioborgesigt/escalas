<script lang="ts">
	/**
	 * O alternador Policial × Administrador da tela de login.
	 *
	 * Aparece duas vezes no mesmo fluxo — no formulário de credenciais e no de
	 * recuperação de senha —, e as duas cópias carregavam a MESMA string de
	 * classe do `Tabs.Trigger` escrita à mão quatro vezes (dois gatilhos × dois
	 * arquivos). Uma string de ~230 caracteres com `data-[selected]:` e variantes
	 * de tema é exatamente o tipo de coisa que diverge sem ninguém notar: basta
	 * um ajuste de contraste aplicado num arquivo só para as duas abas do mesmo
	 * fluxo ficarem diferentes.
	 *
	 * O ESTADO continua de quem chama (`tipo` é `$bindable`): quem decide o que
	 * fazer com a troca é o formulário — `/recuperar` limpa o identificador
	 * digitado ao alternar, o de credenciais não.
	 */
	import { Tabs } from '@skeletonlabs/skeleton-svelte';

	interface Props {
		tipo: 'policial' | 'admin';
		/** Chamado DEPOIS de `tipo` mudar. `/recuperar` usa para limpar o campo. */
		aoTrocar?: () => void;
		/** Espaçamento do contexto — o formulário de recuperação pede `mb-4`. */
		class?: string;
	}

	let { tipo = $bindable(), aoTrocar, class: classe = '' }: Props = $props();

	const GATILHO =
		'px-3 py-2 text-sm font-semibold rounded-lg flex-1 text-center cursor-pointer select-none ' +
		'transition-all duration-200 text-surface-600 dark:text-surface-400 ' +
		'data-[selected]:bg-primary-500 data-[selected]:text-white data-[selected]:shadow-md ' +
		'data-[selected]:shadow-primary-500/25 hover:text-surface-700 dark:hover:text-surface-200';
</script>

<Tabs
	value={tipo}
	onValueChange={(e) => {
		tipo = e.value as 'policial' | 'admin';
		aoTrocar?.();
	}}
	class="w-full {classe}"
>
	<Tabs.List
		class="flex w-full items-center gap-1 rounded-xl border border-surface-200 bg-surface-100 p-1 dark:border-surface-700 dark:bg-surface-800"
	>
		<Tabs.Trigger value="policial" class={GATILHO}>Policial</Tabs.Trigger>
		<Tabs.Trigger value="admin" class={GATILHO}>Administrador</Tabs.Trigger>
	</Tabs.List>
</Tabs>
