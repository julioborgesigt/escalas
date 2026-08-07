<script lang="ts">
	import type { PageProps } from './$types';
	import BemVindoPagina from '$lib/components/bem-vindo/BemVindoPagina.svelte';
	import BemVindoCabecalho from '$lib/components/bem-vindo/BemVindoCabecalho.svelte';
	import BemVindoCardAcao from '$lib/components/bem-vindo/BemVindoCardAcao.svelte';

	const { data }: PageProps = $props();
	const usuario = $derived(data.usuario);

	// Esta rota só é alcançada pelo Admin Geral no módulo GISE: o `load`
	// redireciona seccional/unidade/policial para /escalas/bem-vindo (ou /bem-vindo)
	// via `obterRotaBemVindo`. Por isso não há ramo de sub-admin aqui — o antigo
	// (`isSubAdmin && showResGise`) era código morto. O ramo não-admin abaixo é só
	// um fallback defensivo caso a rota seja renderizada fora do fluxo normal.
	const descricao = $derived(
		usuario?.tipo === 'admin'
			? 'Você está no ambiente de gestão do módulo GISE. Como administrador, utilize as áreas abaixo para gerenciar a alocação das equipes, analisar a produtividade ou ajustar configurações.'
			: 'Você está no ambiente de planejamento especial do GISE. Aqui você pode gerenciar a alocação de equipes operacionais e validar os relatórios consolidados de serviço extraordinário.'
	);

	const acoes = $derived.by(() => {
		if (usuario?.tipo === 'admin') {
			return [
				{
					titulo: 'Escalas GISE',
					descricao:
						'Planeje, gerencie e valide a alocação de equipes operacionais e equipes de inteligência em serviço extraordinário.',
					href: '/gise',
					cta: 'Acessar escalas GISE'
				},
				{
					titulo: 'Produtividade',
					descricao:
						'Acompanhe relatórios de apreensões de armas e drogas, analise os índices de prisões e exporte gráficos consolidados.',
					href: '/produtividade',
					cta: 'Acessar produtividade'
				},
				{
					titulo: 'Configurações GISE',
					descricao:
						'Configure parâmetros globais do módulo GISE, como valores limite de cotas financeiras e horas extras permitidas.',
					href: '/gise/config',
					cta: 'Abrir configurações'
				},
				{
					titulo: 'Configuração de Formulários',
					descricao:
						'Crie e gerencie os modelos de formulário (operacional e SEINT) do relatório de produtividade preenchido pelas equipes GISE.',
					href: '/res-gise',
					cta: 'Configurar formulários'
				},
				{
					titulo: 'Policiais',
					descricao: 'Consulte e gerencie o cadastro de policiais e seus dados.',
					href: '/policiais',
					cta: 'Gerenciar policiais'
				},
				{
					titulo: 'Solicitações',
					descricao:
						'Analise e aprove ou rejeite as solicitações de alteração de dados enviadas pelos policiais.',
					href: '/solicitacoes',
					cta: 'Ver solicitações'
				}
			];
		}
		// Fallback defensivo — o `load` impede que não-admins cheguem aqui.
		return [
			{
				titulo: 'Painel GISE',
				descricao:
					'Acesse o painel para gerenciar a alocação de equipes e acompanhar o serviço extraordinário.',
				href: '/gise',
				cta: 'Entrar no painel'
			}
		];
	});
</script>

<svelte:head>
	<title>Bem-vindo ao GISE - Portal de Escalas</title>
</svelte:head>

<BemVindoPagina>
	<BemVindoCabecalho
		modulo="Módulo GISE"
		{usuario}
		{descricao}
		accent="secondary"
	/>

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
