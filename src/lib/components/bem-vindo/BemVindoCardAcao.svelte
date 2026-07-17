<!-- Card de ação das telas de boas-vindas: âncora inteira clicável apoiada
     direto no fundo da página (card-elevated), sem botão preenchido — o CTA é
     um link discreto com seta. `horizontal` vira uma linha larga (usada quando
     o papel do usuário tem uma única ação disponível). -->
<script lang="ts">
	import type { ComponentType, SvelteComponent } from 'svelte';
	import type { IconProps } from 'lucide-svelte';
	import { ArrowRight } from 'lucide-svelte';

	interface Props {
		icone: ComponentType<SvelteComponent<IconProps>>;
		titulo: string;
		descricao: string;
		href: string;
		cta: string;
		accent?: 'primary' | 'secondary';
		horizontal?: boolean;
	}

	const {
		icone: Icone,
		titulo,
		descricao,
		href,
		cta,
		accent = 'primary',
		horizontal = false
	}: Props = $props();

	const estilos = {
		primary: {
			icone: 'border-primary-500/25 bg-primary-500/10 text-primary-600 dark:text-primary-400',
			hover: 'hover:border-primary-500/40 dark:hover:border-primary-400/40',
			cta: 'text-primary-700 dark:text-primary-400',
			foco: 'focus-visible:outline-primary-500'
		},
		secondary: {
			icone:
				'border-secondary-500/25 bg-secondary-500/10 text-secondary-600 dark:text-secondary-400',
			hover: 'hover:border-secondary-500/40 dark:hover:border-secondary-400/40',
			cta: 'text-secondary-600 dark:text-secondary-400',
			foco: 'focus-visible:outline-secondary-500'
		}
	} as const;
	const e = $derived(estilos[accent]);

	const base =
		'group card-elevated rounded-xl transition-all duration-200 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2';
</script>

{#if horizontal}
	<a {href} class="{base} flex items-center gap-4 p-4 sm:p-5 {e.hover} {e.foco}">
		<div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border {e.icone}">
			<Icone class="h-5 w-5" aria-hidden="true" />
		</div>
		<div class="min-w-0 flex-1">
			<h3 class="text-base font-semibold text-surface-900 dark:text-surface-50">{titulo}</h3>
			<p class="mt-0.5 text-xs leading-relaxed text-surface-600 sm:text-sm dark:text-surface-400">
				{descricao}
			</p>
		</div>
		<span class="hidden shrink-0 items-center gap-1.5 text-xs font-semibold sm:inline-flex {e.cta}">
			{cta}
			<ArrowRight
				class="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
				aria-hidden="true"
			/>
		</span>
		<ArrowRight class="h-4 w-4 shrink-0 text-surface-400 sm:hidden" aria-hidden="true" />
	</a>
{:else}
	<a {href} class="{base} flex flex-col gap-4 p-5 {e.hover} {e.foco}">
		<div class="flex h-10 w-10 items-center justify-center rounded-lg border {e.icone}">
			<Icone class="h-5 w-5" aria-hidden="true" />
		</div>
		<div class="flex-1 space-y-1.5">
			<h3 class="text-base font-semibold text-surface-900 dark:text-surface-50">{titulo}</h3>
			<p class="text-xs leading-relaxed text-surface-600 sm:text-sm dark:text-surface-400">
				{descricao}
			</p>
		</div>
		<span class="inline-flex items-center gap-1.5 text-xs font-semibold {e.cta}">
			{cta}
			<ArrowRight
				class="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
				aria-hidden="true"
			/>
		</span>
	</a>
{/if}
