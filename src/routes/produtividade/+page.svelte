<script lang="ts">
	/**
	 * Painel de PRODUTIVIDADE: agrega as respostas dos formulários GISE em
	 * gráficos, rankings por unidade e detalhamentos exportáveis em PNG.
	 *
	 * A página recebe do servidor a LISTA CRUA de respostas (blobs JSON) e faz
	 * toda a agregação no cliente. É deliberado: os filtros recombinam os mesmos
	 * dados, e refazer a consulta a cada mexida de filtro seria uma ida ao
	 * servidor por clique.
	 *
	 * A barra tem DUAS linhas, e a divisão é semântica: em cima o que se compara
	 * (operação, eixo, quantas unidades, em que ordem) e embaixo o que entra na
	 * conta (tipo de equipe, período). Só os de baixo recortam dado — trocar de
	 * eixo não muda o total do painel, só a quebra.
	 *
	 * A cadeia de `$derived` mora em `_components/useProdutividade.svelte.ts`,
	 * nesta ordem por causa de custo:
	 *   filteredData → parsedData → stats / rankings / gráficos
	 * `parsedData` faz `JSON.parse` UMA vez por resposta; sem esse degrau, cada
	 * estatística e cada ranking reparsearia os mesmos blobs.
	 *
	 * As PERGUNTAS não são fixas: vêm do modelo salvo em `gise_modelo_formulario`
	 * e passam por `mapQuestions`, que só deixa passar as MARCADAS — e a marca diz
	 * em QUE forma cada uma aparece (colunas, ranking, detalhamento por tipo). Um
	 * formulário editado pelo assessor muda os cards sem tocar esta tela, e por
	 * isso nada aqui indexa resposta por posição.
	 *
	 * A única exceção é o bloco de PRISÕES, escrito no código porque o
	 * detalhamento dele soma três perguntas diferentes e não cabe numa marca que
	 * vive em uma só. Ele depende do modelo por PRESENÇA da pergunta — ver
	 * `temBlocoPrisoes`.
	 *
	 * A ORDEM dos cards também não é do formulário: é um dado próprio da operação
	 * (`painel_ordem`, migração 0064) que o Admin Geral monta arrastando NESTA
	 * tela, no modo "Organizar". Ela é dele porque a alternativa — reordenar as
	 * perguntas no editor — renumeraria o enunciado e mudaria o formulário que o
	 * policial preenche: reordenar a leitura mexeria na coleta. Card sem posição
	 * gravada (a pergunta marcada depois da última organização) entra no fim do
	 * bloco dele.
	 *
	 * Chart.js entra por `import()` dinâmico (~200 KB): a página abre com os
	 * filtros e a tabela antes de a biblioteca chegar.
	 */
	import type { PageProps } from './$types';
	import { goto } from '$app/navigation';
	import { slide } from 'svelte/transition';
	import Spinner from '$lib/components/Spinner.svelte';
	import GripVertical from '@lucide/svelte/icons/grip-vertical';
	import {
		useProdutividade,
		ESCOPO_BLOCOS,
		ROTULO_SECAO,
		type SecaoPainel
	} from './_components/useProdutividade.svelte';
	import { useOrganizacaoPainel } from './_components/useOrganizacaoPainel.svelte';
	import SecaoRankings from './_components/SecaoRankings.svelte';
	import SecaoGraficos from './_components/SecaoGraficos.svelte';
	import SecaoIndicadores from './_components/SecaoIndicadores.svelte';
	import BarraOrganizar from './_components/BarraOrganizar.svelte';
	import CardOrdenavel from './_components/CardOrdenavel.svelte';

	const { data }: PageProps = $props();
	const p = useProdutividade(() => data);

	// O gesto do arraste vive à parte da ORDEM: aquele nasce e morre num
	// `dragstart`/`drop`, esta vai ao banco. As três seções recebem o mesmo
	// objeto, que é o que mantém um arraste por vez na página inteira.
	const organizacao = useOrganizacaoPainel(
		() => p.organizando,
		(secao, de, para) => p.moverCard(secao, de, para)
	);

	// A barra tem sete controles com três formas repetidas (rótulo, campo,
	// segmento). Constantes em vez de string repetida: era assim que o "Tipo de
	// equipe" e a "Seccional" já divergiam em padding entre si.
	const ROTULO =
		'text-3xs font-black uppercase tracking-widest text-surface-400 dark:text-surface-500 pl-0.5 block';
	const CAMPO =
		'w-full px-3 py-2.5 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-bold';
	const SEGMENTO = 'flex-1 rounded-lg py-1.5 text-xs font-bold transition-colors';
	const SEG_ON = 'bg-white dark:bg-surface-700 shadow text-primary-600';
	const SEG_OFF = 'text-surface-600 dark:text-surface-400';
	/** Tipo de equipe que a operação não usa: visível, apagado e sem clique. */
	const SEG_OFF_DISABLED = 'opacity-40 cursor-not-allowed';
</script>

<svelte:head>
	<title>Produtividade — Escalas PC-CE</title>
</svelte:head>

<div
	class="pagina-produtividade space-y-8 pb-12 {p.selectedCharts.length > 0 ? 'has-selections' : ''}"
>
	<header class="flex flex-col md:flex-row md:items-start justify-between gap-4 sm:gap-6">
		<div class="space-y-1">
			<h1 class="h1 text-2xl font-bold">
				Produção {p.filterTipo === 'seint' ? 'Inteligência' : 'Operacional'}
			</h1>
			<p class="text-surface-600 dark:text-surface-400 font-medium print:hidden">
				Análise filtrada e segmentada dos resultados reais {p.filterTipo === 'seint'
					? '(SEINT)'
					: '(P4-P19)'}
			</p>
			{#if p.data.escopoRestrito}
				<!-- O recorte é do SERVIDOR, e quem o vê precisa saber: sem este aviso,
				     um total menor parece queda de produtividade em vez de recorte. -->
				<p class="text-2xs text-surface-600 dark:text-surface-400 mt-1 print:hidden">
					Exibindo apenas os dados das unidades que você administra nesta operação.
				</p>
			{/if}
		</div>
		<!-- Os controles não vão para o papel: quem lê o PDF não clica em "Baixar".

		     DOIS grupos, e a separação não é estética: "Organizar painel" muda o que
		     TODOS veem na operação, enquanto os de baixo produzem um arquivo para
		     quem clicou. Eles moraram juntos sob o rótulo "Baixar gráficos", que
		     descrevia três dos quatro botões e mentia sobre o primeiro. -->
		<div class="flex flex-col items-stretch gap-3 print:hidden md:items-end">
			<!-- Só o Admin Geral. Esconder o botão NÃO é a autorização: quem recusa
			     o PUT direto é `requireAdmin` em `/api/produtividade/ordem`. -->
			{#if p.podeOrganizar && !p.organizando}
				<button
					type="button"
					class="btn self-start md:self-end bg-surface-200/60 dark:bg-surface-800/60 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700 text-3xs font-black uppercase tracking-widest px-4 py-2 rounded-xl transition-colors flex items-center gap-2"
					onclick={() => (p.organizando = true)}
				>
					<GripVertical class="w-3.5 h-3.5" aria-hidden="true" />
					Organizar painel
				</button>
			{/if}

			<!-- Some no modo organizar: ali os cards estão inertes, e um botão de
			     baixar convidaria a exportar um painel em rascunho. -->
			{#if !p.organizando}
				<div class="flex flex-col items-start gap-2 md:items-end">
					<span
						class="text-xs font-bold uppercase tracking-widest text-surface-400 dark:text-surface-500"
						>Baixar gráficos</span
					>
					<div class="flex flex-wrap items-center gap-2 md:justify-end">
						{#if p.allChartsCount > 0}
							<button
								type="button"
								class="btn text-3xs font-black uppercase tracking-widest px-4 py-2 rounded-xl transition-colors {p
									.selectedCharts.length >= p.allChartsCount
									? 'bg-surface-900 dark:bg-surface-50 text-white dark:text-surface-950'
									: 'bg-surface-200/60 dark:bg-surface-800/60 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700'}"
								onclick={p.selectAllCharts}
							>
								{p.selectedCharts.length >= p.allChartsCount
									? 'Desmarcar Todos'
									: `Selecionar Todos (${p.allChartsCount})`}
							</button>
						{/if}

						<button
							type="button"
							class="btn {p.selectedCharts.length > 0
								? 'bg-error-600 hover:bg-error-700 text-white'
								: 'bg-surface-200/80 dark:bg-surface-800/80 text-surface-500 dark:text-surface-400 cursor-not-allowed'} text-3xs font-black uppercase tracking-widest py-2 px-4 rounded-xl transition-colors flex items-center gap-2"
							onclick={p.exportChartsAsImages}
							disabled={p.selectedCharts.length === 0 || p.exporting}
						>
							{#if p.exporting}
								<Spinner size="sm" />
								Exportando...
							{:else}
								<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="3"
										d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
									/></svg
								>
								Baixar (imagem){p.selectedCharts.length > 0 ? ` (${p.selectedCharts.length})` : ''}
							{/if}
						</button>

						<button
							type="button"
							class="btn {p.selectedCharts.length > 0
								? 'bg-secondary-600 hover:bg-secondary-700 text-white'
								: 'bg-surface-200/80 dark:bg-surface-800/80 text-surface-500 dark:text-surface-400 cursor-not-allowed'} text-3xs font-black uppercase tracking-widest py-2 px-4 rounded-xl transition-colors flex items-center gap-2"
							onclick={() => window.print()}
							disabled={p.selectedCharts.length === 0}
						>
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="3"
									d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
								/></svg
							>
							Baixar (PDF){p.selectedCharts.length > 0 ? ` (${p.selectedCharts.length})` : ''}
						</button>
					</div>
				</div>
			{/if}
		</div>
	</header>

	{#if p.organizando}
		<BarraOrganizar
			tipoEquipe={p.filterTipo === 'seint' ? 'Inteligência' : 'Operacional'}
			alterada={p.ordemAlterada}
			salvando={p.salvandoOrdem}
			temOrdemPropria={p.temOrdemPropria}
			onSalvar={p.salvarOrdem}
			onDescartar={p.descartarOrdem}
			onRestaurarPadrao={p.restaurarOrdemPadrao}
			onCancelar={p.cancelarOrganizacao}
		/>
	{/if}

	<!-- A barra de filtros é controle de tela: no PDF ela só ocuparia a primeira
	     folha antes do primeiro gráfico. -->
	<div class="space-y-3 print:hidden">
		<div class="flex items-center justify-between gap-2">
			<span
				class="text-xs font-bold uppercase tracking-widest text-surface-400 dark:text-surface-500"
				>Filtros</span
			>
			<button
				type="button"
				class="inline-flex items-center gap-1.5 rounded-xl border border-surface-300/80 bg-white px-3 py-1.5 text-xs font-semibold text-surface-700 transition-colors hover:border-primary-400/50 hover:bg-primary-500/5 dark:border-surface-600/80 dark:bg-surface-800 dark:text-surface-200 dark:hover:bg-surface-700/80 {p.mostrarFiltros
					? 'border-primary-500/50 bg-primary-500/5 dark:border-primary-500/40 dark:bg-primary-500/10'
					: ''}"
				onclick={() => (p.mostrarFiltros = !p.mostrarFiltros)}
				aria-expanded={p.mostrarFiltros}
			>
				<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
					/>
				</svg>
				{p.mostrarFiltros ? 'Ocultar filtros' : 'Filtros'}
				{#if p.filtrosAtivos}
					<span class="h-1.5 w-1.5 rounded-full bg-primary-500"></span>
				{/if}
			</button>
		</div>

		{#if p.mostrarFiltros}
			<section
				class="overflow-hidden rounded-3xl border border-surface-200 bg-white dark:border-surface-800 dark:bg-surface-900"
				transition:slide={{ duration: 250 }}
			>
				<div class="space-y-4 p-4 sm:p-5">
					<!-- LINHA 1 — o que está EM FOCO: qual operação, por qual eixo, e de que
					     tipo de equipe.
					     A divisão entre as duas linhas já foi SEMÂNTICA ("só os de baixo
					     recortam dado") e não é mais: o tipo de equipe recorta e mora aqui em
					     cima. Hoje ela é de USO — em cima o que se escolhe ao abrir o painel,
					     embaixo o que se mexe enquanto se lê. Quem precisa saber o que recorta
					     dado: tipo de equipe e período; quantidade e ordem seguem mexendo só na
					     apresentação da MESMA lista. -->
					<div class="grid grid-cols-1 gap-4 lg:grid-cols-12 items-end">
						<!-- Operação: navega (recarrega o `load`), porque trocar de operação
						     troca os MODELOS e as linhas de base — não é um recorte da
						     mesma lista, como os demais controles desta barra. -->
						{#if (p.data.operacoes ?? []).length > 1}
							<div class="space-y-1.5 lg:col-span-3">
								<label for="f-op" class={ROTULO}>Operação</label>
								<!-- Desabilitado enquanto se organiza: trocar de operação recarrega
								     os modelos, e o rascunho do arraste passaria a valer para cards
								     de outra operação. Impedir a troca perde menos que avisar
								     depois da perda. -->
								<select
									id="f-op"
									value={p.data.operacaoSelecionadaId ?? ''}
									disabled={p.organizando}
									title={p.organizando
										? 'Salve ou saia da organização do painel antes de trocar de operação'
										: undefined}
									onchange={(e) => goto(`/produtividade?operacaoId=${e.currentTarget.value}`)}
									class="{CAMPO} disabled:opacity-50 disabled:cursor-not-allowed"
								>
									{#each p.data.operacoes ?? [] as op (op.id)}
										<option value={op.id}>{op.nome}</option>
									{/each}
								</select>
							</div>
						{/if}

						<div class="space-y-1.5 lg:col-span-4">
							<p class={ROTULO}>Visualizar por</p>
							<div class="inline-flex w-full rounded-xl bg-surface-100 dark:bg-surface-800 p-1">
								<button
									type="button"
									class="{SEGMENTO} {p.modoVisualizacao === 'delegacias' ? SEG_ON : SEG_OFF}"
									onclick={() => (p.modoVisualizacao = 'delegacias')}>Delegacias</button
								>
								<button
									type="button"
									class="{SEGMENTO} {p.modoVisualizacao === 'seccionais' ? SEG_ON : SEG_OFF}"
									onclick={() => (p.modoVisualizacao = 'seccionais')}>Seccionais</button
								>
							</div>
						</div>

						<div class="space-y-1.5 lg:col-span-5">
							<p class={ROTULO}>Tipo de equipe</p>
							<div class="inline-flex w-full rounded-xl bg-surface-100 dark:bg-surface-800 p-1">
								<!-- Desabilitado, e não escondido: o botão apagado diz que a
								     operação NÃO tem aquele tipo de equipe. Escondê-lo faria a
								     barra parecer diferente sem explicar por quê. -->
								<button
									type="button"
									disabled={!p.tiposDisponiveis.includes('operacional')}
									title={p.tiposDisponiveis.includes('operacional')
										? undefined
										: 'Esta operação não usa equipe operacional'}
									class="{SEGMENTO} {p.filterTipo === 'operacional'
										? SEG_ON
										: SEG_OFF} {p.tiposDisponiveis.includes('operacional') ? '' : SEG_OFF_DISABLED}"
									onclick={() => (p.filterTipo = 'operacional')}>Operacional</button
								>
								<button
									type="button"
									disabled={!p.tiposDisponiveis.includes('seint')}
									title={p.tiposDisponiveis.includes('seint')
										? undefined
										: 'Esta operação não usa equipe de inteligência'}
									class="{SEGMENTO} {p.filterTipo === 'seint'
										? SEG_ON
										: SEG_OFF} {p.tiposDisponiveis.includes('seint') ? '' : SEG_OFF_DISABLED}"
									onclick={() => (p.filterTipo = 'seint')}>Inteligência</button
								>
							</div>
						</div>
					</div>

					<!-- LINHA 2 — o RECORTE: quantas unidades, em que ordem, em que período.
					     As frações do `grid-cols` não são arbitrárias: `1.5fr` é metade das 3
					     colunas que a quantidade tinha, e `2.1fr` são as 3 da ordem menos 30%.
					     Os dois guardam duas ou três opções curtas, e a largura que sobra vale
					     mais no período, que carrega duas datas. -->
					<div
						class="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_2.1fr_8.4fr] items-end border-t border-surface-200/70 dark:border-white/10 pt-4"
					>
						<div class="space-y-1.5">
							<!-- "Quantidade", e não "Quantidade de unidades": na largura pela metade
							     o rótulo longo quebrava em três linhas, e as opções ("5 unidades",
							     "10 unidades") já dizem de que quantidade se trata. -->
							<label for="f-qtd" class={ROTULO}>Quantidade</label>
							<select
								id="f-qtd"
								value={String(p.quantidade)}
								onchange={(e) =>
									(p.quantidade =
										e.currentTarget.value === 'todas'
											? 'todas'
											: (Number(e.currentTarget.value) as 5 | 10))}
								class={CAMPO}
							>
								<option value="5">5 unidades</option>
								<option value="10">10 unidades</option>
								<option value="todas">Todas</option>
							</select>
						</div>

						<div class="space-y-1.5">
							<label for="f-ordem" class={ROTULO}>Ordem</label>
							<select id="f-ordem" bind:value={p.ordem} class={CAMPO}>
								<option value="melhores">Melhores primeiro</option>
								<option value="piores">Piores primeiro</option>
							</select>
						</div>
						<div class="space-y-1.5">
							<label for="f-ano" class={ROTULO}>Período</label>
							<div class="flex flex-wrap lg:flex-nowrap items-end gap-2">
								<select
									id="f-ano"
									bind:value={p.filterAno}
									class="w-full lg:w-auto min-w-[120px] px-3 py-2.5 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-bold"
								>
									{#each p.anos as ano (ano)}
										<option value={String(ano)}>{ano}</option>
									{/each}
									<option value="personalizado">Personalizado</option>
								</select>

								{#if p.filterAno === 'personalizado'}
									<div class="flex items-end gap-2 w-full lg:w-auto">
										<div class="space-y-0.5 flex-1 lg:flex-initial">
											<label
												for="f-ini"
												class="text-3xs font-black text-surface-600 dark:text-surface-400 uppercase tracking-widest block pl-0.5"
												>De</label
											>
											<input
												id="f-ini"
												type="date"
												bind:value={p.filterInicio}
												class="w-full px-3 py-2 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-bold"
											/>
										</div>
										<span class="text-surface-400 pb-2">—</span>
										<div class="space-y-0.5 flex-1 lg:flex-initial">
											<label
												for="f-fim"
												class="text-3xs font-black text-surface-600 dark:text-surface-400 uppercase tracking-widest block pl-0.5"
												>Até</label
											>
											<input
												id="f-fim"
												type="date"
												bind:value={p.filterFim}
												class="w-full px-3 py-2 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-bold"
											/>
										</div>
									</div>
								{/if}
							</div>
						</div>
					</div>
				</div>
			</section>
		{/if}
	</div>

	{#if p.painelVazio}
		<!-- Nem indicador, nem bloco fixo, nem pergunta marcada. Sem este aviso a
		     página fica só com a barra de filtros e parece defeito — e o conserto
		     não está aqui, está no formulário da operação. -->
		<section class="card-elevated rounded-2xl p-5 sm:p-6 space-y-2">
			<h2 class="text-base font-semibold">Nada a mostrar nesta operação</h2>
			<p class="text-sm text-surface-600 dark:text-surface-400">
				Nenhuma pergunta do formulário está marcada para aparecer no painel, e a operação não tem
				indicador de meta configurado.
			</p>
			<p class="text-2xs text-surface-600 dark:text-surface-400">
				No editor do formulário, em <strong>Mostrar na produtividade</strong>, escolha a forma de
				cada pergunta que você quer acompanhar: colunas por unidade, ranking, ou detalhamento por
				tipo. As demais continuam sendo coletadas normalmente, apenas não viram card aqui.
			</p>
		</section>
	{/if}

	<!-- O conteúdo de uma faixa. Snippet, e não três blocos soltos, porque a ORDEM
	     das faixas é escolha do admin: com elas escritas em sequência no markup, a
	     categoria era a única coisa do painel que não se movia — e era o que fazia
	     o card de uma pergunta nova cair no meio da tela sem ninguém ter pedido.

	     Rankings e detalhamentos: o bloco de prisões só existe no operacional (as
	     perguntas que o alimentam são de lá) e chega na mesma lista dos demais, já
	     na ordem do painel; os cards vindos do modelo valem para os dois tipos de
	     equipe, porque saem do formulário em foco. -->
	{#snippet faixa(secao: SecaoPainel)}
		{#if secao === 'indicadores'}
			<SecaoIndicadores paineis={p.paineisIndicadores} Chart={p.ChartCtor} {organizacao} />
		{:else if secao === 'listagem'}
			<SecaoRankings
				cards={p.cardsListagem}
				rotuloGrupo={p.modoVisualizacao === 'delegacias' ? 'Delegacia' : 'Seccional'}
				selectedCharts={p.selectedCharts}
				onToggle={p.toggleChartSelection}
				{organizacao}
			/>
		{:else}
			<SecaoGraficos
				questions={p.QUESTIONS}
				stats={p.stats}
				canvasElements={p.canvasElements}
				selectedCharts={p.selectedCharts}
				modoVisualizacao={p.modoVisualizacao}
				onToggle={p.toggleChartSelection}
				{organizacao}
			/>
		{/if}
	{/snippet}

	<!-- Fora do modo, nenhuma moldura: a página fica exatamente como sempre foi,
	     com as três faixas empilhadas na ordem escolhida. -->
	<div class="space-y-8" role={p.organizando ? 'list' : undefined}>
		{#each p.secoesNaOrdem as secao, indice (secao)}
			{#if p.organizando}
				<CardOrdenavel
					{organizacao}
					secao={ESCOPO_BLOCOS}
					{indice}
					total={p.secoesNaOrdem.length}
					rotulo={ROTULO_SECAO[secao]}
					variante="bloco"
				>
					{@render faixa(secao)}
				</CardOrdenavel>
			{:else}
				{@render faixa(secao)}
			{/if}
		{/each}
	</div>
</div>

<style>
	/**
	 * IMPRESSÃO — o botão "Baixar (PDF)" é `window.print()`, então o PDF é a
	 * folha que estas regras descrevem. Cada card é uma UNIDADE: quebra só
	 * quando não cabe inteiro numa A4, que é o que `break-inside: avoid` pede ao
	 * paginador (o navegador ignora o pedido quando ele é impossível de honrar,
	 * e é exatamente o comportamento desejado).
	 *
	 * Os seletores são `:global()` DE PROPÓSITO. Os cards são renderizados por
	 * `SecaoGraficos`/`SecaoRankings`/`SecaoIndicadores`, e o CSS de componente
	 * do Svelte só alcança o markup DESTE arquivo: escrito sem `:global()`, o
	 * bloco compilava para `.card.svelte-hash`, que não casa com card nenhum —
	 * era por isso que os gráficos quebravam no meio, e também por que os cards
	 * não selecionados e a barra de filtros iam junto para o papel.
	 *
	 * `.pagina-produtividade` no início de cada seletor devolve o limite que o
	 * escopo dava: as regras valem para esta tela, não para o app inteiro.
	 */
	@media print {
		@page {
			size: A4 portrait;
			margin: 10mm;
		}

		:global(body) {
			background: white !important;
		}

		/* A grade de pares vira fluxo: a largura útil da folha (190mm) já cai
		 * abaixo do breakpoint `lg`, então a grade só tem uma coluna no papel —
		 * e fragmentar dentro de um container `grid` é irregular no Chrome. Em
		 * bloco, `gap` não vale mais; a margem recompõe o respiro entre cards. */
		:global(.pagina-produtividade section.grid) {
			display: block !important;
		}

		:global(.pagina-produtividade section.grid > * + *) {
			margin-top: 6mm;
		}

		/* A unidade indivisível da paginação. `overflow: visible` porque scroll
		 * interno (o ranking rola na tela) vira CORTE no papel, e
		 * `print-color-adjust` porque as barras de detalhamento são preenchimento
		 * de fundo — sem isso o Chrome imprime a barra vazia. */
		:global(.pagina-produtividade .card),
		:global(.pagina-produtividade .card-elevated) {
			break-inside: avoid;
			page-break-inside: avoid;
			overflow: visible !important;
			box-shadow: none !important;
			print-color-adjust: exact;
			-webkit-print-color-adjust: exact;
		}

		:global(.pagina-produtividade .card + .card),
		:global(.pagina-produtividade .card-elevated + .card-elevated) {
			margin-top: 6mm;
		}

		/* Controles que sobraram DENTRO do card: a caixa de seleção no canto e o
		 * "ver tabela" do indicador. No papel são tinta sem função. */
		:global(.pagina-produtividade .card button),
		:global(.pagina-produtividade .card-elevated > button) {
			display: none !important;
		}

		/* A borda azul é marca de SELEÇÃO na tela; no papel ela destacaria um card
		 * que não tem nada de diferente dos outros. */
		:global(.pagina-produtividade .card) {
			border-color: #e2e8f0 !important;
		}

		/* O canvas do Chart.js carrega a largura em px que tinha na TELA; sem
		 * este teto ele estoura a folha e o gráfico sai cortado na lateral.
		 * `height: auto` mantém a proporção do próprio canvas. */
		:global(.pagina-produtividade canvas) {
			max-width: 100% !important;
			height: auto !important;
		}

		/* Com seleção ativa, o papel leva só o que foi selecionado: os demais
		 * cards saem, e a seção que não sobrou com nenhum selecionado sai
		 * inteira (senão restam título e espaço em branco no meio do PDF). */
		:global(.has-selections .card:not(.selected-for-export)) {
			display: none !important;
		}

		:global(.has-selections section:not(:has(.selected-for-export))) {
			display: none !important;
		}
	}
</style>
