<script lang="ts">
	/**
	 * Console do Super Administrador. Os quadros vêm de `cardsBemVindoDaPagina`,
	 * como nas demais telas de boas-vindas — aqui a lista é fixa (estrutura,
	 * configurações e auditoria), e é o teste de paridade que garante que ela
	 * continue igual às abas da navegação lateral.
	 */
	import type { PageProps } from './$types';
	import { page } from '$app/state';
	import BemVindoPagina from '$lib/components/bem-vindo/BemVindoPagina.svelte';
	import BemVindoCabecalho from '$lib/components/bem-vindo/BemVindoCabecalho.svelte';
	import BemVindoCardAcao from '$lib/components/bem-vindo/BemVindoCardAcao.svelte';
	import { cardsBemVindoDaPagina } from '../_components/bem-vindo-cards';

	const { data }: PageProps = $props();
	const usuario = $derived(data.usuario);

	const acoes = $derived(cardsBemVindoDaPagina(usuario, page.data));
</script>

<svelte:head>
	<title>Administração do Sistema — Portal de Escalas</title>
</svelte:head>

<BemVindoPagina>
	<BemVindoCabecalho
		modulo="Administração do Sistema"
		{usuario}
		descricao="Você está no console do Super Administrador. Aqui ficam a estrutura do sistema (unidades e policiais), as configurações globais e a auditoria — sem as abas operacionais do dia a dia."
		accent="primary"
	/>

	<section class="mt-6 sm:mt-8">
		<h2
			class="mb-4 text-2xs font-semibold tracking-[0.18em] text-surface-600 uppercase dark:text-surface-400"
		>
			Áreas de gestão
		</h2>
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each acoes as acao (acao.href)}
				<BemVindoCardAcao {...acao} accent="primary" />
			{/each}
		</div>
	</section>
</BemVindoPagina>
