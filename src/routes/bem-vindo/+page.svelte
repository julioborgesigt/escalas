<script lang="ts">
	import type { PageProps } from './$types';
	import { page } from '$app/state';
	import BemVindoPagina from '$lib/components/bem-vindo/BemVindoPagina.svelte';
	import BemVindoCabecalho from '$lib/components/bem-vindo/BemVindoCabecalho.svelte';
	import BemVindoCardAcao from '$lib/components/bem-vindo/BemVindoCardAcao.svelte';

	const { data }: PageProps = $props();
	const usuario = $derived(data.usuario);

	const isSupervisorGise = $derived(page.data.isSupervisorGise ?? false);
	// Espelha a aba "Presença GISE" da sidebar: escala ativa + entrada/saída pendente.
	const temPresencaGisePendente = $derived(page.data.temPresencaGisePendente ?? false);
	// Histórico GISE: participou de alguma GISE já encerrada (independe de
	// convocação ativa). Espelha a aba "Histórico GISE" da sidebar.
	const temGiseHistorico = $derived(page.data.temGiseHistorico ?? false);

	// Cards de convocação GISE (só quando há vínculo ativo).
	const giseCards = $derived.by(() => {
		const lista = [];
		if (isSupervisorGise) {
			lista.push({
				titulo: 'Supervisão GISE',
				descricao:
					'Acompanhe e supervisione o planejamento e a execução das escalas GISE sob sua responsabilidade.',
				href: '/gise',
				cta: 'Acessar supervisão'
			});
		}
		if (temPresencaGisePendente) {
			lista.push({
				titulo: 'Minha presença',
				descricao:
					'Confirme sua presença nas escalas extras em que foi alocado e assine a folha correspondente.',
				href: '/res-gise',
				cta: 'Registrar presença'
			});
		}
		return lista;
	});

	const semConvocacao = $derived(giseCards.length === 0);

	// Card do histórico: só quando há GISE encerrada. Fica FORA de `giseCards`
	// (que alimenta `semConvocacao`) porque histórico não é convocação ativa.
	const cardHistoricoGise = {
		titulo: 'Meu histórico',
		descricao:
			'Consulte suas escalas extras já encerradas: comprovantes de presença e relatórios das operações anteriores.',
		href: '/res-gise?status=finalizadas',
		cta: 'Ver histórico'
	};

	// "Meu perfil" está na sidebar de todo policial — espelhado no acesso rápido.
	const acoes = $derived([
		...giseCards,
		...(temGiseHistorico ? [cardHistoricoGise] : []),
		{
			titulo: 'Meu perfil',
			descricao:
				'Atualize seus dados cadastrais, gerencie sua rubrica e ajuste as preferências da conta.',
			href: '/perfil',
			cta: 'Abrir meu perfil'
		}
	]);
</script>

<svelte:head>
	<title>Bem-vindo ao Portal de Escalas</title>
</svelte:head>

<BemVindoPagina>
	<BemVindoCabecalho
		modulo="Portal de Escalas"
		{usuario}
		descricao="Acompanhe seus plantões de serviço ativo, registre suas presenças e preencha seus relatórios de produtividade operacional."
		accent="secondary"
	/>

	<section class="mt-6 sm:mt-8">
		<h2
			class="mb-4 text-2xs font-semibold tracking-[0.18em] text-surface-600 uppercase dark:text-surface-400"
		>
			Acesso rápido
		</h2>
		{#if semConvocacao}
			<div class="card-elevated mb-4 rounded-xl p-5">
				<p class="text-sm font-semibold text-surface-900 dark:text-surface-50">
					Nenhuma convocação ativa
				</p>
				<p class="mt-1 text-xs leading-relaxed text-surface-600 dark:text-surface-400">
					No momento você não possui nenhuma convocação para escala GISE ativa. Em caso de dúvida,
					verifique com a chefia de sua unidade.
				</p>
			</div>
		{/if}
		<div class="grid grid-cols-1 gap-4 {acoes.length > 1 ? 'sm:grid-cols-2 lg:grid-cols-3' : ''}">
			{#each acoes as acao (acao.href)}
				<BemVindoCardAcao {...acao} accent="secondary" horizontal={acoes.length === 1} />
			{/each}
		</div>
	</section>
</BemVindoPagina>
