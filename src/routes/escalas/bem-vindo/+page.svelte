<script lang="ts">
	import type { PageProps } from './$types';
	import { ICONE } from '$lib/constants/icones';
	import BemVindoPagina from '$lib/components/bem-vindo/BemVindoPagina.svelte';
	import BemVindoCabecalho from '$lib/components/bem-vindo/BemVindoCabecalho.svelte';
	import BemVindoCardAcao from '$lib/components/bem-vindo/BemVindoCardAcao.svelte';

	const { data }: PageProps = $props();
	const usuario = $derived(data.usuario);
	const showResGise = $derived(
		!!(data.isMembroGise || data.isSupervisorGise || data.isSupervisaoGise)
	);

	const descricao = $derived(
		usuario?.tipo === 'admin'
			? 'Você está no ambiente de gestão do Portal de Escalas. Como administrador, utilize as áreas abaixo para monitorar a conformidade das escalas ou gerenciar os novos recebimentos.'
			: usuario?.papel === 'admin_seccional'
				? 'Você está no ambiente administrativo da seccional. Gerencie e supervisione as escalas ordinárias ou acesse o planejamento e acompanhamento do módulo GISE.'
				: usuario?.papel === 'admin_unidade'
					? showResGise
						? 'Você está no ambiente administrativo do Portal de Escalas. Por aqui, você poderá criar e gerenciar as escalas ordinárias (mensal) de plantão e expediente e a escala de final de semana, bem como confirmar sua presença na escala GISE, quando escalado.'
						: 'Você está no ambiente de gestão do Portal de Escalas. Por aqui, você poderá criar e gerenciar as escalas ordinárias (mensal) de plantão e expediente e a escala de final de semana de sua unidade.'
					: 'Você está no ambiente de gestão ordinária do Portal de Escalas. Planeje plantões, expedientes e controle as assinaturas digitais de sua unidade administrativa com facilidade.'
	);

	const acoes = $derived.by(() => {
		if (usuario?.tipo === 'admin') {
			return [
				{
					icone: ICONE.painel,
					titulo: 'Painel de Compliance',
					descricao:
						'Acompanhe o envio e assinatura das escalas por delegacia, monitorando o cumprimento dos prazos e identificando pendências.',
					href: '/painel',
					cta: 'Acessar painel'
				},
				{
					icone: ICONE.caixaEntrada,
					titulo: 'Caixa de Entrada',
					descricao:
						'Visualize e gerencie os envios e assinaturas de escalas em tempo real, além de realizar exportações (Word, Excel, PDF).',
					href: '/recebidos',
					cta: 'Acessar caixa de entrada'
				}
			];
		}
		if (usuario?.papel === 'admin_seccional') {
			const lista = [
				{
					icone: ICONE.calendario,
					titulo: 'Escalas Ordinárias',
					descricao:
						'Envie e gerencie as escalas ordinárias de sua seccional, incluindo plantão (mensal), expediente e a escala de final de semana.',
					href: '/escalas',
					cta: 'Acessar escalas'
				},
				{
					icone: ICONE.pranchetaLista,
					titulo: 'Escalas GISE',
					descricao:
						'Preencha e gerencie a escalação dos policiais convocados para atuar nas operações extraordinárias do GISE.',
					href: '/gise',
					cta: 'Acessar escalas GISE'
				}
			];
			if (showResGise) {
				lista.push({
					icone: ICONE.documento,
					titulo: 'Presença GISE',
					descricao:
						'Confirme sua presença nas escalas extraordinárias GISE onde foi alocado e assine a folha correspondente.',
					href: '/res-gise',
					cta: 'Confirmar presença'
				});
			}
			return lista;
		}
		if (usuario?.papel === 'admin_unidade' && showResGise) {
			return [
				{
					icone: ICONE.calendario,
					titulo: 'Gestão de Escalas',
					descricao:
						'Crie e gerencie as escalas ordinárias (mensal) de plantão e expediente e a escala de final de semana de sua unidade administrativa.',
					href: '/escalas',
					cta: 'Acessar escalas'
				},
				{
					icone: ICONE.documento,
					titulo: 'Presença GISE',
					descricao:
						'Confirme sua presença nas escalas GISE ativas onde você foi alocado e assine a folha de presença correspondente.',
					href: '/res-gise',
					cta: 'Acessar presença GISE'
				}
			];
		}
		return [
			{
				icone: ICONE.calendario,
				titulo: 'Painel de Escalas',
				descricao:
					'Acesse o painel para criar, enviar e acompanhar as escalas ordinárias de sua unidade.',
				href: '/escalas',
				cta: 'Entrar no painel'
			}
		];
	});
</script>

<svelte:head>
	<title>Bem-vindo às Escalas - Portal de Escalas</title>
</svelte:head>

<BemVindoPagina>
	<BemVindoCabecalho
		icone={ICONE.casa}
		modulo="Módulo de Escalas"
		{usuario}
		{descricao}
		accent="primary"
	/>

	<section class="mt-6 sm:mt-8">
		<h2
			class="mb-4 text-2xs font-semibold tracking-[0.18em] text-surface-500 uppercase dark:text-surface-400"
		>
			Acesso rápido
		</h2>
		<div
			class="grid grid-cols-1 gap-4 {acoes.length === 3
				? 'sm:grid-cols-2 lg:grid-cols-3'
				: acoes.length === 2
					? 'sm:grid-cols-2'
					: ''}"
		>
			{#each acoes as acao (acao.href)}
				<BemVindoCardAcao {...acao} accent="primary" horizontal={acoes.length === 1} />
			{/each}
		</div>
	</section>
</BemVindoPagina>
