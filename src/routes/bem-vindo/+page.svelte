<script lang="ts">
	import type { PageProps } from './$types';
	import { page } from '$app/state';
	import { ICONE } from '$lib/constants/icones';
	import BemVindoPagina from '$lib/components/bem-vindo/BemVindoPagina.svelte';
	import BemVindoCabecalho from '$lib/components/bem-vindo/BemVindoCabecalho.svelte';
	import BemVindoCardAcao from '$lib/components/bem-vindo/BemVindoCardAcao.svelte';
	import IconeSvg from '$lib/components/bem-vindo/IconeSvg.svelte';

	const { data }: PageProps = $props();
	const usuario = $derived(data.usuario);

	const isSupervisorGise = $derived(page.data.isSupervisorGise ?? false);
	const isMembroGise = $derived(page.data.isMembroGise ?? false);
	const isSupervisaoGise = $derived(page.data.isSupervisaoGise ?? false);

	const acoes = $derived.by(() => {
		const lista = [];
		if (isSupervisorGise) {
			lista.push({
				icone: ICONE.pranchetaLista,
				titulo: 'Supervisão GISE',
				descricao:
					'Acompanhe e supervisione o planejamento e a execução das escalas GISE sob sua responsabilidade.',
				href: '/gise',
				cta: 'Acessar supervisão'
			});
		}
		if (isMembroGise || isSupervisaoGise) {
			lista.push({
				icone: ICONE.documento,
				titulo: 'Presença GISE',
				descricao:
					'Confirme sua presença nas escalas GISE em que foi alocado e assine a folha correspondente.',
				href: '/res-gise',
				cta: 'Registrar presença'
			});
		}
		return lista;
	});
</script>

<svelte:head>
	<title>Bem-vindo ao Portal de Escalas</title>
</svelte:head>

<BemVindoPagina>
	<BemVindoCabecalho
		icone={ICONE.casa}
		modulo="Portal de Escalas"
		{usuario}
		descricao="Acompanhe seus plantões de serviço ativo, registre suas presenças e preencha seus relatórios de produtividade operacional."
		accent="secondary"
	/>

	<section class="mt-6 sm:mt-8">
		{#if acoes.length > 0}
			<h2
				class="mb-4 text-2xs font-semibold tracking-[0.18em] text-surface-500 uppercase dark:text-surface-400"
			>
				Acesso rápido
			</h2>
			<div class="grid grid-cols-1 gap-4 {acoes.length > 1 ? 'sm:grid-cols-2' : ''}">
				{#each acoes as acao (acao.href)}
					<BemVindoCardAcao {...acao} accent="secondary" horizontal={acoes.length === 1} />
				{/each}
			</div>
		{:else}
			<div class="card-elevated flex items-start gap-3 rounded-xl p-5">
				<IconeSvg paths={ICONE.info} class="mt-0.5 h-4 w-4 shrink-0 text-surface-400" />
				<div>
					<p class="text-sm font-semibold text-surface-900 dark:text-surface-50">
						Nenhuma convocação ativa
					</p>
					<p class="mt-1 text-xs leading-relaxed text-surface-600 dark:text-surface-400">
						No momento você não possui nenhuma convocação para escala GISE ativa. Em caso de dúvida,
						verifique com a chefia de sua unidade.
					</p>
				</div>
			</div>
		{/if}
	</section>
</BemVindoPagina>
