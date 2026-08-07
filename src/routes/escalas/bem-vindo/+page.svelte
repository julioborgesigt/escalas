<script lang="ts">
	/**
	 * Página inicial do módulo de escalas — o que cada usuário vê ao entrar.
	 *
	 * Toda a ramificação daqui existe por um motivo só: **o portal atende papéis
	 * com atribuições opostas**, e mostrar o mesmo menu para todos fazia o usuário
	 * clicar em coisas que não podia fazer. As combinações que importam:
	 *
	 * - Admin Geral → conformidade e recebidos, não cria escala;
	 * - DPC (seccional ou unidade) → CONFERE e ASSINA; não cria;
	 * - OIP admin de unidade → CRIA e gerencia as escalas da sua unidade;
	 * - admin de seccional (não-DPC) → envia e gerencia, mais o módulo GISE;
	 * - qualquer um com vínculo GISE ativo → ganha também o acesso à `/res-gise`.
	 *
	 * `descricao` e `acoes` são derivados dessas condições e ficam neste arquivo,
	 * juntos, de propósito: espalhar as regras pelos componentes de card faria
	 * cada mudança de política ter de ser caçada em cinco lugares.
	 *
	 * Os flags (`isSupervisorGise`, `isMembroGise`, `isSupervisaoGise`) chegam
	 * resolvidos pelo servidor — a página não decide permissão, só apresentação.
	 */
	import type { PageProps } from './$types';
	import BemVindoPagina from '$lib/components/bem-vindo/BemVindoPagina.svelte';
	import BemVindoCabecalho from '$lib/components/bem-vindo/BemVindoCabecalho.svelte';
	import BemVindoCardAcao from '$lib/components/bem-vindo/BemVindoCardAcao.svelte';

	const { data }: PageProps = $props();
	const usuario = $derived(data.usuario);
	// DPC (seccional/unidade) confere e assina; OIP cria e gerencia as escalas.
	const isDpc = $derived(usuario?.cargo === 'DPC');
	// admin_unidade só supervisiona GISE se for DPC — o flag já reflete isso.
	const isSupervisorGise = $derived(!!data.isSupervisorGise);
	const showResGise = $derived(
		!!(data.isMembroGise || data.isSupervisorGise || data.isSupervisaoGise)
	);
	// Histórico GISE: participou de alguma GISE já encerrada (independe de vínculo
	// ativo). Espelha a aba "Histórico GISE" da sidebar.
	const temGiseHistorico = $derived(!!data.temGiseHistorico);

	const isSubAdmin = $derived(
		usuario?.papel === 'admin_seccional' || usuario?.papel === 'admin_unidade'
	);
	const local = $derived(usuario?.papel === 'admin_seccional' ? 'sua seccional' : 'sua unidade');

	const descricao = $derived.by(() => {
		if (usuario?.tipo === 'admin') {
			return 'Você está no ambiente de gestão do Portal de Escalas. Como administrador, utilize as áreas abaixo para monitorar a conformidade das escalas ou gerenciar os novos recebimentos.';
		}
		// DPC (unidade ou seccional): confere e assina — não cria escalas.
		if (isSubAdmin && isDpc) {
			const base = `Você está no ambiente da ${local}. Aqui você pode conferir e assinar as escalas ordinárias (mensal) de plantão e expediente.`;
			return isSupervisorGise
				? `${base} Você também tem acesso e pode assinar a escala GISE, quando supervisor, bem como confirmar sua presença.`
				: base;
		}
		if (usuario?.papel === 'admin_seccional') {
			return 'Você está no ambiente administrativo da seccional. Envie e gerencie as escalas ordinárias ou acesse o planejamento e acompanhamento do módulo GISE.';
		}
		if (usuario?.papel === 'admin_unidade') {
			return showResGise
				? 'Você está no ambiente administrativo do Portal de Escalas. Por aqui, você poderá criar e gerenciar as escalas ordinárias (mensal) de plantão e expediente e a escala de final de semana, bem como confirmar sua presença na escala GISE, quando escalado.'
				: 'Você está no ambiente de gestão do Portal de Escalas. Por aqui, você poderá criar e gerenciar as escalas ordinárias (mensal) de plantão e expediente e a escala de final de semana de sua unidade.';
		}
		return 'Você está no ambiente de gestão ordinária do Portal de Escalas. Planeje plantões, expedientes e controle as assinaturas digitais de sua unidade administrativa com facilidade.';
	});

	const acoes = $derived.by(() => {
		if (usuario?.tipo === 'admin') {
			return [
				{
					titulo: 'Painel de Compliance',
					descricao:
						'Acompanhe o envio e assinatura das escalas por delegacia, monitorando o cumprimento dos prazos e identificando pendências.',
					href: '/painel',
					cta: 'Acessar painel'
				},
				{
					titulo: 'Caixa de Entrada',
					descricao:
						'Visualize e gerencie os envios e assinaturas de escalas em tempo real, além de realizar exportações (Word, Excel, PDF).',
					href: '/recebidos',
					cta: 'Acessar caixa de entrada'
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

		// Card de escalas ordinárias: DPC confere/assina; OIP cria/gerencia.
		const ondeDesc =
			usuario?.papel === 'admin_seccional' ? 'de sua seccional' : 'de sua unidade administrativa';
		const cardOrdinaria = isDpc
			? {
					titulo: 'Conferência e Assinatura',
					descricao: `Confira e assine as escalas ordinárias (mensal) de plantão e expediente ${ondeDesc}.`,
					href: '/escalas',
					cta: 'Conferir e assinar'
				}
			: usuario?.papel === 'admin_seccional'
				? {
						titulo: 'Escalas Ordinárias',
						descricao:
							'Envie e gerencie as escalas ordinárias de sua seccional, incluindo plantão (mensal), expediente e a escala de final de semana.',
						href: '/escalas',
						cta: 'Acessar escalas'
					}
				: {
						titulo: 'Gestão de Escalas',
						descricao:
							'Crie e gerencie as escalas ordinárias (mensal) de plantão e expediente e a escala de final de semana de sua unidade administrativa.',
						href: '/escalas',
						cta: 'Acessar escalas'
					};

		const cardGiseEscalas = {
			titulo: 'Escalas GISE',
			descricao:
				usuario?.papel === 'admin_seccional'
					? 'Preencha e gerencie a escalação dos policiais convocados para atuar nas operações extraordinárias do GISE.'
					: 'Supervisione a alocação de equipes operacionais e de inteligência na escala GISE.',
			href: '/gise',
			cta: 'Acessar escalas GISE'
		};

		const cardPresencaGise = {
			titulo: 'Presença GISE',
			descricao:
				'Confirme sua presença nas escalas GISE ativas onde você foi alocado e assine a folha de presença correspondente.',
			href: '/res-gise',
			cta: 'Acessar presença GISE'
		};

		const cardHistoricoGise = {
			titulo: 'Histórico GISE',
			descricao:
				'Consulte suas escalas GISE já encerradas: comprovantes de presença e relatórios das operações anteriores.',
			href: '/res-gise?status=finalizadas',
			cta: 'Ver histórico GISE'
		};

		// Todo policial (incl. sub-admins) tem "Meu perfil" na sidebar — espelhado aqui.
		const cardMeuPerfil = {
			titulo: 'Meu perfil',
			descricao:
				'Atualize seus dados cadastrais, gerencie sua rubrica e ajuste as preferências da conta.',
			href: '/perfil',
			cta: 'Abrir meu perfil'
		};

		if (usuario?.papel === 'admin_seccional') {
			// Admin seccional sempre tem acesso ao módulo GISE (espelha a sidebar).
			const lista = [cardOrdinaria, cardGiseEscalas];
			if (showResGise) lista.push(cardPresencaGise);
			if (temGiseHistorico) lista.push(cardHistoricoGise);
			lista.push(cardMeuPerfil);
			return lista;
		}
		if (usuario?.papel === 'admin_unidade') {
			const lista = [cardOrdinaria];
			// GISE só quando supervisor (admin_unidade só supervisiona se DPC).
			if (isSupervisorGise) lista.push(cardGiseEscalas);
			if (showResGise) lista.push(cardPresencaGise);
			if (temGiseHistorico) lista.push(cardHistoricoGise);
			lista.push(cardMeuPerfil);
			return lista;
		}
		const lista = [
			{
				titulo: 'Painel de Escalas',
				descricao:
					'Acesse o painel para criar, enviar e acompanhar as escalas ordinárias de sua unidade.',
				href: '/escalas',
				cta: 'Entrar no painel'
			}
		];
		if (temGiseHistorico) lista.push(cardHistoricoGise);
		lista.push(cardMeuPerfil);
		return lista;
	});
</script>

<svelte:head>
	<title>Bem-vindo às Escalas - Portal de Escalas</title>
</svelte:head>

<BemVindoPagina>
	<BemVindoCabecalho
		modulo="Módulo de Escalas"
		{usuario}
		{descricao}
		accent="primary"
	/>

	<section class="mt-6 sm:mt-8">
		<h2
			class="mb-4 text-2xs font-semibold tracking-[0.18em] text-surface-600 uppercase dark:text-surface-400"
		>
			Acesso rápido
		</h2>
		<div class="grid grid-cols-1 gap-4 {acoes.length > 1 ? 'sm:grid-cols-2 lg:grid-cols-3' : ''}">
			{#each acoes as acao (acao.href)}
				<BemVindoCardAcao {...acao} accent="primary" horizontal={acoes.length === 1} />
			{/each}
		</div>
	</section>
</BemVindoPagina>
