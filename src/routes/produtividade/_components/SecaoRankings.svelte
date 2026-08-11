<script lang="ts">
	/**
	 * A faixa de cards de RANKING e DETALHAMENTO do painel operacional.
	 *
	 * Duas origens, e a diferença importa:
	 *
	 * - o bloco de **prisões** é escrito no código. Ele soma três perguntas
	 *   (flagrantes, mandados e total de presos), e uma marca que vive numa
	 *   pergunta não descreve um card que atravessa três. Só aparece se o
	 *   formulário da operação tiver a pergunta que o alimenta — antes aparecia
	 *   sempre, zerado, em operação que nunca perguntou sobre flagrante;
	 * - os demais vêm do MODELO, um por pergunta marcada com a forma. Drogas e
	 *   armas eram blocos fixos como o de prisões e viraram isto na migração 0054:
	 *   a quebra por tipo de droga e por tipo de arma é da própria resposta, então
	 *   cabe numa marca — e assim o assessor pode desligar o que não quer.
	 *
	 * Os cards fluem dois por linha. Ranking e detalhamento da mesma pergunta
	 * ficam lado a lado porque são vizinhos no fluxo, que é como o painel sempre
	 * mostrou drogas e armas.
	 */
	import { VIRTUAL_CHARTS, type RankingItem } from '$lib/export-charts';
	import RankingCard from './RankingCard.svelte';
	import DetailCard from './DetailCard.svelte';
	import type { CardListagem } from './useProdutividade.svelte';

	const {
		temPrisoes,
		rankingPrisoes,
		cards,
		stats,
		rotuloGrupo,
		selectedCharts,
		onToggle
	}: {
		/** O bloco fixo de prisões cabe nesta operação? Ver `temBlocoPrisoes`. */
		temPrisoes: boolean;
		rankingPrisoes: RankingItem[];
		/** Os cards vindos do modelo, já na ordem do formulário. */
		cards: CardListagem[];
		stats: {
			prisaoFlagrante: number;
			prisaoMandado: number;
			/** P7, agregado por chave fixa — não depende de a pergunta estar marcada. */
			prisoesTotal: number;
			[key: string]: unknown;
		};
		/** "Seccional" ou "Delegacia" — o que cada linha do ranking é, no eixo atual. */
		rotuloGrupo: string;
		selectedCharts: (number | string)[];
		onToggle: (id: string | number) => void;
	} = $props();

	const detalhesPrisoes = $derived<[string, number][]>([
		['Flagrantes (P4)', stats.prisaoFlagrante],
		['Mandados (P5)', stats.prisaoMandado],
		['Total de Presos (P7)', stats.prisoesTotal]
	]);
	const totalPrisoes = $derived(
		Math.max(stats.prisoesTotal, stats.prisaoFlagrante, stats.prisaoMandado)
	);

	/**
	 * Peso de droga é somado em GRAMAS e mostrado em QUILOS.
	 *
	 * O card converte pela unidade que recebe, e é por isso que o ranking pede
	 * `kg` onde o detalhamento pede `g`: um lista totais de unidades (números
	 * grandes, kg é a leitura), o outro lista tipos de droga dentro da barra
	 * (gramas). A regra é do dado, não do card — vem de `identidadeDaPergunta`.
	 */
	function unidadeDoRanking(unidade: string): string {
		return unidade === 'g' ? 'kg' : unidade;
	}
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
{#snippet iconGrafico(color: string)}
	<svg class="w-5 h-5" style="color: {color}" fill="none" stroke="currentColor" viewBox="0 0 24 24"
		><path
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="2"
			d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
		/></svg
	>
{/snippet}

<div class="space-y-6 animate-in fade-in slide-in-from-top-4 duration-500">
	{#if temPrisoes}
		<section class="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
			<RankingCard
				id="rank-prisoes"
				title={VIRTUAL_CHARTS['rank-prisoes'].label}
				ranking={rankingPrisoes}
				color={VIRTUAL_CHARTS['rank-prisoes'].color}
				icon={iconPrison}
				labelUnit=""
				{rotuloGrupo}
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
	{/if}

	{#if cards.length > 0}
		<section class="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
			{#each cards as card (card.id)}
				{#if card.forma === 'ranking'}
					<RankingCard
						id={card.id}
						title="Ranking de {card.titulo}"
						ranking={card.ranking}
						color={card.cor}
						icon={iconGrafico}
						labelUnit={unidadeDoRanking(card.unidade)}
						{rotuloGrupo}
						selected={selectedCharts.includes(card.id)}
						{onToggle}
					/>
				{:else}
					<DetailCard
						id={card.id}
						title="Detalhamento de {card.titulo}"
						details={card.linhas}
						total={card.total}
						color={card.cor}
						unit={card.unidade}
						selected={selectedCharts.includes(card.id)}
						{onToggle}
					/>
				{/if}
			{/each}
		</section>
	{/if}
</div>
