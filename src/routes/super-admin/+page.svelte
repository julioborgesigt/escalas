<script lang="ts">
	import type { PageProps } from './$types';
	import { ShieldCheck, Building, Users, Key, Settings, History } from 'lucide-svelte';
	import BemVindoPagina from '$lib/components/bem-vindo/BemVindoPagina.svelte';
	import BemVindoCabecalho from '$lib/components/bem-vindo/BemVindoCabecalho.svelte';
	import BemVindoCardAcao from '$lib/components/bem-vindo/BemVindoCardAcao.svelte';

	const { data }: PageProps = $props();
	const usuario = $derived(data.usuario);

	const acoes = [
		{
			icone: Building,
			titulo: 'Unidades',
			descricao:
				'Cadastre e gerencie a estrutura organizacional: departamentos, seccionais e delegacias.',
			href: '/unidades',
			cta: 'Gerenciar unidades'
		},
		{
			icone: Users,
			titulo: 'Policiais',
			descricao:
				'Gerencie o cadastro de policiais, papéis administrativos (RBAC) e a concessão de Admin Geral.',
			href: '/policiais',
			cta: 'Gerenciar policiais'
		},
		{
			icone: Key,
			titulo: 'Configurações de Assinatura',
			descricao:
				'Defina os requisitos das assinaturas eletrônicas (foto, GPS e código por e-mail / 2FA).',
			href: '/conf-ass',
			cta: 'Abrir configurações'
		},
		{
			icone: Settings,
			titulo: 'Configurações Gerais',
			descricao:
				'Ajustes globais do sistema, como o provedor de e-mail padrão (Cloudflare / Resend) com fallback.',
			href: '/config-geral',
			cta: 'Abrir configurações'
		},
		{
			icone: History,
			titulo: 'Auditoria',
			descricao:
				'Trilha forense de ações do sistema: filtros, verificação de integridade e exportação (CSV/PDF).',
			href: '/auditoria',
			cta: 'Abrir auditoria'
		}
	];
</script>

<svelte:head>
	<title>Administração do Sistema — Portal de Escalas</title>
</svelte:head>

<BemVindoPagina>
	<BemVindoCabecalho
		icone={ShieldCheck}
		modulo="Administração do Sistema"
		{usuario}
		descricao="Você está no console do Super Administrador. Aqui você gerencia a estrutura do sistema (unidades e policiais), as configurações globais e a auditoria/conformidade — sem as abas operacionais do dia a dia."
		accent="primary"
	/>

	<section class="mt-6 sm:mt-8">
		<h2
			class="mb-4 text-2xs font-semibold tracking-[0.18em] text-surface-500 uppercase dark:text-surface-400"
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
