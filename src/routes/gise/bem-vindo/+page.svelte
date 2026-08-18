<script lang="ts">
	/**
	 * Boas-vindas do módulo GISE. Só o Admin Geral em módulo GISE chega aqui — o
	 * `load` manda seccional/unidade/policial para `/escalas/bem-vindo` (ou
	 * `/bem-vindo`) via `obterRotaBemVindo`.
	 *
	 * Os quadros vêm de `cardsBemVindoDaPagina`, derivados das mesmas flags da
	 * navegação lateral (`_components/bem-vindo-cards.ts`).
	 */
	import type { PageProps } from './$types';
	import { page } from '$app/state';
	import BemVindoPagina from '$lib/components/bem-vindo/BemVindoPagina.svelte';
	import BemVindoCabecalho from '$lib/components/bem-vindo/BemVindoCabecalho.svelte';
	import BemVindoCardAcao from '$lib/components/bem-vindo/BemVindoCardAcao.svelte';
	import { cardsBemVindoDaPagina } from '../../_components/bem-vindo-cards';

	const { data }: PageProps = $props();
	const usuario = $derived(data.usuario);

	const acoes = $derived(cardsBemVindoDaPagina(usuario, page.data));

	const descricao = $derived(
		usuario?.tipo === 'admin'
			? 'Você está no ambiente de gestão do módulo GISE. Use as áreas abaixo para escalar as equipes, acompanhar a produtividade e configurar as operações.'
			: 'Você está no ambiente de planejamento do serviço extraordinário. Acompanhe a escalação das equipes e os relatórios das operações.'
	);
</script>

<svelte:head>
	<title>Bem-vindo ao GISE - Portal de Escalas</title>
</svelte:head>

<BemVindoPagina>
	<BemVindoCabecalho modulo="Módulo GISE" {usuario} {descricao} accent="secondary" />

	<section class="mt-6 sm:mt-8">
		<h2
			class="mb-4 text-2xs font-semibold tracking-[0.18em] text-surface-600 uppercase dark:text-surface-400"
		>
			Acesso rápido
		</h2>
		<div class="grid grid-cols-1 gap-4 {acoes.length > 1 ? 'sm:grid-cols-2 lg:grid-cols-3' : ''}">
			{#each acoes as acao (acao.href)}
				<BemVindoCardAcao {...acao} accent="secondary" horizontal={acoes.length === 1} />
			{/each}
		</div>
	</section>
</BemVindoPagina>
