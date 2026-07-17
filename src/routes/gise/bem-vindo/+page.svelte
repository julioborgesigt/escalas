<script lang="ts">
	import type { PageProps } from './$types';
	import { Shield, Calendar, TrendingUp, Sliders, FileText, FileCheck } from 'lucide-svelte';
	import BemVindoPagina from '$lib/components/bem-vindo/BemVindoPagina.svelte';
	import BemVindoCabecalho from '$lib/components/bem-vindo/BemVindoCabecalho.svelte';
	import BemVindoCardAcao from '$lib/components/bem-vindo/BemVindoCardAcao.svelte';

	const { data }: PageProps = $props();
	const usuario = $derived(data.usuario);
	const isSubAdmin = $derived(
		usuario?.papel === 'admin_unidade' || usuario?.papel === 'admin_seccional'
	);
	const showResGise = $derived(
		!!(data.isMembroGise || data.isSupervisorGise || data.isSupervisaoGise)
	);

	const descricao = $derived(
		usuario?.tipo === 'admin'
			? 'Você está no ambiente de gestão do módulo GISE. Como administrador, utilize as áreas abaixo para gerenciar a alocação das equipes, analisar a produtividade ou ajustar configurações.'
			: isSubAdmin && showResGise
				? usuario?.papel === 'admin_unidade'
					? 'Você está no ambiente administrativo do GISE. Por aqui, você poderá gerenciar a alocação de equipes operacionais e de inteligência, bem como confirmar sua presença na escala GISE, quando escalado.'
					: 'Você está no ambiente administrativo do GISE. Por aqui, você poderá planejar e gerenciar a alocação de equipes operacionais e de inteligência da seccional, bem como confirmar sua presença na escala GISE, quando escalado.'
				: isSubAdmin
					? usuario?.papel === 'admin_unidade'
						? 'Você está no ambiente de planejamento especial do GISE. Como administrador da unidade, você poderá gerenciar a alocação de equipes operacionais e de inteligência, bem como confirmar sua presença na escala GISE, quando estiver escalado.'
						: 'Você está no ambiente de planejamento especial do GISE. Como administrador da seccional, você poderá gerenciar a alocação de equipes operacionais e de inteligência, bem como confirmar sua presença na escala GISE, quando estiver escalado.'
					: 'Você está no ambiente de planejamento especial do GISE. Aqui você pode gerenciar a alocação de equipes operacionais e validar os relatórios consolidados de serviço extraordinário.'
	);

	const acoes = $derived.by(() => {
		if (usuario?.tipo === 'admin') {
			return [
				{
					icone: Calendar,
					titulo: 'Escalas GISE',
					descricao:
						'Planeje, gerencie e valide a alocação de equipes operacionais e equipes de inteligência em serviço extraordinário.',
					href: '/gise',
					cta: 'Acessar escalas GISE'
				},
				{
					icone: TrendingUp,
					titulo: 'Produtividade',
					descricao:
						'Acompanhe relatórios de apreensões de armas e drogas, analise os índices de prisões e exporte gráficos consolidados.',
					href: '/produtividade',
					cta: 'Acessar produtividade'
				},
				{
					icone: Sliders,
					titulo: 'Configurações GISE',
					descricao:
						'Configure parâmetros globais do módulo GISE, como valores limite de cotas financeiras e horas extras permitidas.',
					href: '/gise/config',
					cta: 'Abrir configurações'
				},
				{
					icone: FileText,
					titulo: 'Formulários e Presenças',
					descricao:
						'Gerencie modelos de formulários de relatório de inteligência e valide os arquivos de presença das equipes GISE.',
					href: '/res-gise',
					cta: 'Abrir formulários'
				}
			];
		}
		if (isSubAdmin && showResGise) {
			return [
				{
					icone: Calendar,
					titulo: 'Escalas GISE',
					descricao:
						usuario?.papel === 'admin_unidade'
							? 'Gerencie a alocação de equipes operacionais e de inteligência da sua unidade na escala GISE.'
							: 'Planeje, gerencie e valide a alocação de equipes operacionais e de inteligência na escala GISE da seccional.',
					href: '/gise',
					cta: 'Acessar escalas GISE'
				},
				{
					icone: FileCheck,
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
				icone: Shield,
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
	<BemVindoCabecalho icone={Shield} modulo="Módulo GISE" {usuario} {descricao} accent="secondary" />

	<section class="mt-6 sm:mt-8">
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
	</section>
</BemVindoPagina>
