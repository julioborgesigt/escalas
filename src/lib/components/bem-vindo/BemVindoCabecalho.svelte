<!-- Cabeçalho institucional das telas de boas-vindas: identificação do módulo,
     saudação, data corrente e metadados do usuário (perfil, matrícula, lotação). -->
<script lang="ts">
	import type { ComponentType, SvelteComponent } from 'svelte';
	import type { IconProps } from 'lucide-svelte';
	import type { UsuarioLogado } from '$lib/auth';

	interface Props {
		icone: ComponentType<SvelteComponent<IconProps>>;
		/** Rótulo do módulo exibido acima da saudação (ex.: "Módulo de Escalas"). */
		modulo: string;
		usuario: UsuarioLogado | null | undefined;
		descricao: string;
		accent?: 'primary' | 'secondary';
	}

	const { icone: Icone, modulo, usuario, descricao, accent = 'primary' }: Props = $props();

	const estilos = {
		primary: {
			icone: 'border-primary-500/25 bg-primary-500/10 text-primary-600 dark:text-primary-400',
			eyebrow: 'text-primary-700 dark:text-primary-400',
			ponto: 'bg-primary-500'
		},
		secondary: {
			icone:
				'border-secondary-500/25 bg-secondary-500/10 text-secondary-600 dark:text-secondary-400',
			eyebrow: 'text-secondary-600 dark:text-secondary-400',
			ponto: 'bg-secondary-500'
		}
	} as const;
	const e = $derived(estilos[accent]);

	const primeiroNome = $derived(usuario?.nome?.split(' ')[0] ?? '');

	const perfil = $derived(
		usuario?.isSuperAdmin
			? 'Super Administrador'
			: usuario?.tipo === 'admin'
				? 'Administrador Geral'
				: usuario?.papel === 'admin_seccional'
					? 'Administração Seccional'
					: usuario?.papel === 'admin_unidade'
						? 'Administração de Unidade'
						: 'Acesso Operacional'
	);

	// Data corrente apenas no cliente: o fuso do servidor (UTC) pode divergir do
	// usuário perto da virada do dia e causaria mismatch de hidratação no SSR.
	let dataAtual = $state('');
	$effect(() => {
		const formatada = new Intl.DateTimeFormat('pt-BR', {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		}).format(new Date());
		dataAtual = formatada.charAt(0).toUpperCase() + formatada.slice(1);
	});

	const chip =
		'inline-flex items-center gap-1.5 rounded-md border border-surface-200 bg-white px-2.5 py-1 text-2xs font-medium text-surface-600 dark:border-white/10 dark:bg-surface-900 dark:text-surface-300';
</script>

<header>
	<div class="flex items-start justify-between gap-4">
		<div class="flex items-center gap-3 sm:gap-4">
			<div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border {e.icone}">
				<Icone class="h-5 w-5" aria-hidden="true" />
			</div>
			<div class="min-w-0">
				<p class="text-2xs font-semibold tracking-[0.18em] uppercase {e.eyebrow}">{modulo}</p>
				<h1
					class="mt-0.5 text-xl font-bold tracking-tight text-surface-900 sm:text-2xl dark:text-surface-50"
				>
					Bem-vindo(a), {primeiroNome}
				</h1>
			</div>
		</div>
		{#if dataAtual}
			<p class="hidden shrink-0 pt-1 text-xs text-surface-500 md:block dark:text-surface-400">
				{dataAtual}
			</p>
		{/if}
	</div>

	<p class="mt-4 max-w-3xl text-sm leading-relaxed text-surface-600 dark:text-surface-300">
		{descricao}
	</p>

	<div class="mt-4 flex flex-wrap items-center gap-2">
		<span class={chip}>
			<span class="h-1.5 w-1.5 rounded-full {e.ponto}" aria-hidden="true"></span>
			{perfil}
		</span>
		{#if usuario?.matricula}
			<span class={chip}>Matrícula {usuario.matricula}</span>
		{/if}
		{#if usuario?.lotacao}
			<span class={chip}>{usuario.lotacao}</span>
		{/if}
	</div>

	<div class="mt-6 border-t border-surface-200 sm:mt-8 dark:border-white/10"></div>
</header>
