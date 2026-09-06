<script lang="ts">
	/**
	 * O alternador Policial × Administrador da tela de login.
	 *
	 * Aparece duas vezes no mesmo fluxo — no formulário de credenciais e no de
	 * recuperação de senha. O cromado mora em `SeletorDuasOpcoes`; daqui só
	 * saem as duas etiquetas e o que fazer na troca (`aoTrocar`).
	 */
	import SeletorDuasOpcoes from './SeletorDuasOpcoes.svelte';

	interface Props {
		tipo: 'policial' | 'admin';
		/** Chamado DEPOIS de `tipo` mudar. `/recuperar` usa para limpar o campo. */
		aoTrocar?: () => void;
		/** Espaçamento do contexto — o formulário de recuperação pede `mb-4`. */
		class?: string;
	}

	let { tipo = $bindable(), aoTrocar, class: classe = '' }: Props = $props();
</script>

<SeletorDuasOpcoes
	bind:valor={tipo}
	opcoes={[
		{ value: 'policial', label: 'Policial' },
		{ value: 'admin', label: 'Administrador' }
	]}
	{aoTrocar}
	class={classe}
	ariaLabel="Tipo de acesso"
/>
