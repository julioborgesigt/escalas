<script lang="ts">
	/**
	 * Três linhas estratégicas [Ranking | Detailing] do painel operacional
	 * (prisões, drogas, armas). Labels/cores vêm de VIRTUAL_CHARTS.
	 */
	import { VIRTUAL_CHARTS, type RankingItem } from '$lib/export-charts';
	import RankingCard from './RankingCard.svelte';
	import DetailCard from './DetailCard.svelte';

	const {
		rankingPrisoes,
		rankingDrogasPeso,
		rankingArmas,
		stats,
		selectedCharts,
		onToggle
	}: {
		rankingPrisoes: RankingItem[];
		rankingDrogasPeso: RankingItem[];
		rankingArmas: RankingItem[];
		stats: {
			prisaoFlagrante: number;
			prisaoMandado: number;
			drogasPorTipo: Record<string, number>;
			drogasGeral: number;
			armasPorTipo: Record<string, number>;
			apreensoes_armas: number;
			[key: string]: unknown;
		};
		selectedCharts: (number | string)[];
		onToggle: (id: string | number) => void;
	} = $props();

	const prisoesFlagrante = $derived((stats['prisoes_apreensoes_flagrante'] as number) || 0);
	const detalhesPrisoes = $derived<[string, number][]>([
		['Flagrantes (P4)', stats.prisaoFlagrante],
		['Mandados (P5)', stats.prisaoMandado],
		['Total de Presos (P7)', prisoesFlagrante]
	]);
	const totalPrisoes = $derived(
		Math.max(prisoesFlagrante, stats.prisaoFlagrante, stats.prisaoMandado)
	);
	const detalhesDrogas = $derived(
		(Object.entries(stats.drogasPorTipo) as [string, number][])
			.sort((a, b) => b[1] - a[1])
			.slice(0, 8)
	);
	const detalhesArmas = $derived(
		(Object.entries(stats.armasPorTipo) as [string, number][])
			.sort((a, b) => b[1] - a[1])
			.slice(0, 8)
	);
</script>

{#snippet iconPrison(color: string)}
	<svg class="w-5 h-5" style="color: {color}" fill="none" stroke="currentColor" viewBox="0 0 24 24"
		><path
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="2"
			d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
		/></svg
	>
{/snippet}
{#snippet iconDrug(color: string)}
	<svg class="w-5 h-5" style="color: {color}" fill="none" stroke="currentColor" viewBox="0 0 24 24"
		><path
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="2"
			d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
		/></svg
	>
{/snippet}
{#snippet iconWeapon(color: string)}
	<svg class="w-5 h-5" style="color: {color}" fill="none" stroke="currentColor" viewBox="0 0 24 24"
		><path
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="2"
			d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
		/></svg
	>
{/snippet}

<div class="space-y-6 animate-in fade-in slide-in-from-top-4 duration-500">
	<!-- ROW 1: PRISONS -->
	<section class="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
		<RankingCard
			id="rank-prisoes"
			title={VIRTUAL_CHARTS['rank-prisoes'].label}
			ranking={rankingPrisoes}
			color={VIRTUAL_CHARTS['rank-prisoes'].color}
			icon={iconPrison}
			labelUnit=""
			selected={selectedCharts.includes('rank-prisoes')}
			{onToggle}
		/>
		<DetailCard
			id="detail-prisoes"
			title={VIRTUAL_CHARTS['detail-prisoes'].label}
			details={detalhesPrisoes}
			total={totalPrisoes}
			color={VIRTUAL_CHARTS['detail-prisoes'].color}
			unit=""
			selected={selectedCharts.includes('detail-prisoes')}
			{onToggle}
		/>
	</section>

	<!-- ROW 2: DRUGS -->
	<section class="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
		<RankingCard
			id="rank-drogas"
			title={VIRTUAL_CHARTS['rank-drogas'].label}
			ranking={rankingDrogasPeso}
			color={VIRTUAL_CHARTS['rank-drogas'].color}
			icon={iconDrug}
			labelUnit="kg"
			selected={selectedCharts.includes('rank-drogas')}
			{onToggle}
		/>
		<DetailCard
			id="detail-drogas"
			title={VIRTUAL_CHARTS['detail-drogas'].label}
			details={detalhesDrogas}
			total={stats.drogasGeral}
			color={VIRTUAL_CHARTS['detail-drogas'].color}
			unit="g"
			selected={selectedCharts.includes('detail-drogas')}
			{onToggle}
		/>
	</section>

	<!-- ROW 3: WEAPONS -->
	<section class="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
		<RankingCard
			id="rank-armas"
			title={VIRTUAL_CHARTS['rank-armas'].label}
			ranking={rankingArmas}
			color={VIRTUAL_CHARTS['rank-armas'].color}
			icon={iconWeapon}
			labelUnit=""
			selected={selectedCharts.includes('rank-armas')}
			{onToggle}
		/>
		<DetailCard
			id="detail-armas"
			title={VIRTUAL_CHARTS['detail-armas'].label}
			details={detalhesArmas}
			total={stats.apreensoes_armas}
			color={VIRTUAL_CHARTS['detail-armas'].color}
			unit=""
			selected={selectedCharts.includes('detail-armas')}
			{onToggle}
		/>
	</section>
</div>
