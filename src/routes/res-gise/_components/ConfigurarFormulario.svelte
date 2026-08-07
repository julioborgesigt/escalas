<script lang="ts">
	/**
	 * Editor do MODELO do formulário de produtividade — a tela do Admin Geral em
	 * `/res-gise`. Um modelo por tipo de equipe (`operacional` e `seint`),
	 * gravado como JSON em `gise_modelo_formulario`.
	 *
	 * O que se edita é a estrutura das perguntas que TODO policial vai responder,
	 * então duas coisas precisam ficar claras para quem mexer aqui:
	 *
	 * - a `key` de cada pergunta é o que casa com a resposta gravada. Trocá-la
	 *   não migra nada: as respostas antigas continuam no banco com a chave velha
	 *   e simplesmente deixam de aparecer nos relatórios;
	 * - a `etapa` é o que fatia o formulário em passos para o policial. É editável
	 *   só no NÍVEL 0 porque os filhos aparecem sob o "Sim" do pai — separá-los
	 *   dele em outra etapa quebraria o gate;
	 * - "Restaurar anterior" traz de volta a versão salva ANTES da última
	 *   gravação (coluna `config_anterior`, migração 0039). Ele só CARREGA no
	 *   editor — nada é gravado até o admin clicar em Salvar, que é quando as
	 *   duas versões trocam de lugar. O `structuredClone` evita que editar
	 *   depois de restaurar mute o objeto vindo do `load`.
	 */
	import { enhance } from '$app/forms';
	import { actionButton } from './BotoesAcao.svelte';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import { loading } from '$lib/loading.svelte';
	import { agruparPorEtapa } from '$lib/gise/etapas-formulario';
	import { TIPOS_COM_FILHOS, TIPOS_COM_LISTA } from '$lib/gise/tipos-pergunta';
	import { ChevronDown, ChevronUp, CornerDownRight, GripVertical, SquarePen } from '@lucide/svelte';
	import type { useResGise } from './useResGise.svelte';
	import type { GiseModeloPerguntaConfig } from '$lib/types';

	type ResGise = ReturnType<typeof useResGise>;

	const {
		resGise,
		modeloAnteriorOperacional,
		modeloAnteriorSeint
	}: {
		resGise: ResGise;
		modeloAnteriorOperacional: GiseModeloPerguntaConfig[] | null;
		modeloAnteriorSeint: GiseModeloPerguntaConfig[] | null;
	} = $props();

	/** Versão anterior do tipo em edição — `null` enquanto só houve a primeira
	 *  gravação, e é o que desabilita o botão. */
	const modeloAnterior = $derived(
		resGise.configTipo === 'seint' ? modeloAnteriorSeint : modeloAnteriorOperacional
	);

	/**
	 * Prévia do fatiamento em etapas — pela MESMA função que o wizard do policial
	 * usa, então o que o admin vê aqui é o que o policial vai ver. Serve de
	 * resumo no topo e de fonte do `datalist`, que é o que evita "Viatura" e
	 * "viatura" virarem duas etapas por erro de digitação.
	 */
	const etapas = $derived(agruparPorEtapa(resGise.perguntasConfig));

	/**
	 * Tipos com rótulos personalizáveis: os de lista (Quantidade + Legenda) mais
	 * drogas e armas (Lista de Tipos + Detalhamento). `operacoes_seint_pura` fica
	 * de fora porque não tem par Sim/Não para rotular.
	 */
	const TIPOS_COM_ROTULOS = [
		...TIPOS_COM_LISTA.filter((t) => t !== 'operacoes_seint_pura'),
		'drogas_complex',
		'armas_complex'
	];

	/**
	 * Arraste para reordenar (só NÍVEL 0 — filho pertence ao pai).
	 *
	 * `idArrastavel` existe por causa de um detalhe do HTML5 drag-and-drop: quem
	 * arrasta tem de ser o CARD inteiro, mas marcá-lo `draggable` fixo impede
	 * selecionar texto nos campos dentro dele. Então a alça liga o `draggable` no
	 * `mousedown` e o `dragend`/`mouseup` desliga.
	 *
	 * Arrastar sozinho não serve para toque nem para teclado, por isso as setas
	 * ↑/↓ ao lado da alça fazem a MESMA coisa e são o caminho acessível.
	 */
	let idArrastavel = $state<number | null>(null);
	let indiceArrastando = $state<number | null>(null);
	let indiceAlvo = $state<number | null>(null);

	function limparArraste() {
		idArrastavel = null;
		indiceArrastando = null;
		indiceAlvo = null;
	}

	function soltarEm(indice: number) {
		if (indiceArrastando !== null) resGise.moverPergunta(indiceArrastando, indice);
		limparArraste();
	}

	let dialogRestaurarAberto = $state(false);

	function solicitarRestaurarAnterior() {
		if (!modeloAnterior) return;
		dialogRestaurarAberto = true;
	}

	function confirmarRestaurarAnterior() {
		dialogRestaurarAberto = false;
		if (!modeloAnterior) return;
		resGise.perguntasConfig = structuredClone(modeloAnterior);
	}
</script>

<div class="space-y-6">
	<section class="card-elevated rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
		<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
			<div class="w-full sm:w-auto">
				<h2 class="text-xl sm:text-2xl font-bold tracking-tight">Configurar Formulário</h2>
				<p class="text-sm text-surface-600 dark:text-surface-400 mt-1">
					Defina os textos e campos do relatório de produtividade oficial.
				</p>

				<div
					class="flex gap-2 mt-4 bg-surface-100 dark:bg-surface-800 p-1 rounded-xl w-full sm:w-fit"
				>
					<button
						type="button"
						class="flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-bold transition-colors {resGise.configTipo ===
						'operacional'
							? 'bg-white dark:bg-surface-700 shadow text-primary-600'
							: 'text-surface-600 dark:text-surface-400'}"
						onclick={() => (resGise.configTipo = 'operacional')}>Operacional</button
					>
					<button
						type="button"
						class="flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-bold transition-colors {resGise.configTipo ===
						'seint'
							? 'bg-white dark:bg-surface-700 shadow text-primary-600'
							: 'text-surface-600 dark:text-surface-400'}"
						onclick={() => (resGise.configTipo = 'seint')}>SEINT (Inteligência)</button
					>
				</div>
			</div>
			<div class="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
				<!-- Desabilitado enquanto não existe versão anterior (primeira gravação
				     do tipo, ou JSON corrompido) — o `title` explica, senão o botão
				     apagado vira mistério. -->
				<span
					class="w-full sm:w-auto"
					title={modeloAnterior
						? 'Carrega no editor a versão salva antes da última alteração'
						: 'Ainda não há versão anterior deste modelo'}
				>
					{@render actionButton(
						'Restaurar Anterior',
						'M3 10h10a4 4 0 110 8h-1m-9-8l4-4m-4 4l4 4',
						'surface',
						'outlined',
						solicitarRestaurarAnterior,
						!modeloAnterior,
						false,
						'w-full sm:w-auto sm:flex-none px-4 py-2.5 text-xs'
					)}
				</span>

				{@render actionButton(
					'Nova Pergunta',
					'M12 4v16m8-8H4',
					'primary',
					'filled',
					resGise.adicionarPergunta,
					false,
					false,
					'w-full sm:w-auto sm:flex-none px-4 py-2.5 text-xs shadow-lg shadow-primary-500/30'
				)}
			</div>
		</div>
	</section>

	<!-- Prévia das etapas: o policial responde uma por tela, nesta ordem. -->
	<section class="card-elevated rounded-2xl p-4 sm:p-5 shadow-sm space-y-3">
		<p class="text-3xs font-semibold text-surface-600 dark:text-surface-400 uppercase tracking-widest">
			Etapas do formulário ({etapas.length})
		</p>
		<div class="flex flex-wrap items-center gap-2">
			{#each etapas as etapa, i (etapa.chave)}
				{#if i > 0}
					<span class="text-surface-400 dark:text-surface-600" aria-hidden="true">→</span>
				{/if}
				<span
					class="badge {etapa.chave
						? 'preset-filled-primary-500'
						: 'preset-outlined-surface-500'} text-3xs font-bold uppercase"
				>
					{etapa.titulo}
					<span class="opacity-70">· {etapa.perguntas.length}</span>
				</span>
			{/each}
		</div>
		<p class="text-xs text-surface-600 dark:text-surface-400">
			O policial responde uma etapa por tela. A ordem segue a
			<strong>primeira pergunta</strong> de cada etapa, então mover a pergunta move a etapa. Perguntas
			sem etapa ficam juntas num grupo próprio; se nenhuma tiver etapa, o formulário vira página única.
		</p>
	</section>

	<!-- Autocompletar do campo "Etapa": só nomes já em uso, para não multiplicar
	     etapas por variação de digitação. Não restringe — o admin pode criar uma
	     nova digitando um nome que ainda não existe. -->
	<datalist id="etapas-em-uso">
		{#each etapas as etapa (etapa.chave)}
			{#if etapa.chave}
				<option value={etapa.chave}></option>
			{/if}
		{/each}
	</datalist>

	<!-- `role="list"`/`listitem`: além de exigido pelo a11y do arraste, é o que
	     descreve a tela — uma lista ORDENADA de perguntas, em que a posição é
	     informação (ver `renumerarPerguntas`). -->
	<div class="grid grid-cols-1 gap-4" role="list">
		{#snippet renderItem(p: GiseModeloPerguntaConfig, level = 0, indice = -1)}
			{@const arrastando = indiceArrastando === indice && indice >= 0}
			{@const alvo = indiceAlvo === indice && indiceArrastando !== null && !arrastando}
			<div
				class="group card-elevated rounded-2xl shadow-sm p-3 sm:p-5 transition-colors hover:border-primary-500/50 {alvo
					? 'border-primary-500 ring-2 ring-primary-500/40'
					: 'border-surface-200 dark:border-white/10'} {arrastando ? 'opacity-40' : ''}"
				style="margin-left: clamp(0px, {level * 1.5}vw, {level * 2}rem)"
				role="listitem"
				draggable={idArrastavel === p.id}
				ondragstart={() => (indiceArrastando = indice)}
				ondragover={(e) => {
					if (indiceArrastando !== null && indice >= 0) e.preventDefault();
				}}
				ondragenter={() => {
					if (indiceArrastando !== null && indice >= 0) indiceAlvo = indice;
				}}
				ondrop={(e) => {
					e.preventDefault();
					soltarEm(indice);
				}}
				ondragend={limparArraste}
			>
				<!-- Só no nível 0: o filho aparece sob o "Sim" do pai, então tem de
				     ficar na etapa dele. Ver `agruparPorEtapa`. -->
				{#if level === 0}
					<div
						class="flex flex-wrap items-center gap-2 mb-4 pb-4 border-b border-dashed border-surface-300 dark:border-surface-700"
					>
						<!-- Alça de arraste + setas. As setas não são enfeite: são o único
						     caminho no celular e no teclado. -->
						<div class="flex items-center gap-0.5 shrink-0">
							<span
								class="flex cursor-grab items-center rounded-lg p-1.5 text-surface-400 transition-colors hover:bg-surface-200 active:cursor-grabbing dark:hover:bg-surface-800"
								title="Arraste para reordenar a pergunta"
								aria-hidden="true"
								onmousedown={() => (idArrastavel = p.id)}
								onmouseup={() => (idArrastavel = null)}
							>
								<GripVertical size={16} />
							</span>
							<button
								type="button"
								class="rounded-lg p-1 text-surface-400 transition-colors hover:bg-surface-200 disabled:opacity-30 dark:hover:bg-surface-800"
								title="Mover para cima"
								aria-label="Mover a pergunta {indice + 1} para cima"
								disabled={indice <= 0}
								onclick={() => resGise.moverPergunta(indice, indice - 1)}
							>
								<ChevronUp size={16} />
							</button>
							<button
								type="button"
								class="rounded-lg p-1 text-surface-400 transition-colors hover:bg-surface-200 disabled:opacity-30 dark:hover:bg-surface-800"
								title="Mover para baixo"
								aria-label="Mover a pergunta {indice + 1} para baixo"
								disabled={indice < 0 || indice >= resGise.perguntasConfig.length - 1}
								onclick={() => resGise.moverPergunta(indice, indice + 1)}
							>
								<ChevronDown size={16} />
							</button>
						</div>
						<label
							for="p-et-{p.id}"
							class="text-3xs font-semibold text-surface-600 dark:text-surface-400 uppercase tracking-widest"
							>Etapa</label
						>
						<input
							id="p-et-{p.id}"
							type="text"
							list="etapas-em-uso"
							bind:value={p.etapa}
							placeholder="Sem etapa"
							class="flex-1 min-w-0 sm:max-w-xs px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-xs font-bold"
						/>
					</div>
				{/if}

				<div class="flex flex-col md:flex-row gap-3 sm:gap-5 items-start">
					<div
						class="w-8 h-8 flex items-center justify-center rounded-lg bg-surface-200 dark:bg-surface-800 text-3xs font-bold text-surface-600 dark:text-surface-400 shrink-0"
					>
						{#if level > 0}↳{:else}{resGise.perguntasConfig.indexOf(p) + 1}{/if}
					</div>

					<div class="space-y-1.5 flex-1 w-full min-w-0">
						<div class="flex items-center justify-between pl-1 gap-2 flex-wrap mb-1">
							<label
								for="qtxt-{p.id}"
								class="text-3xs font-semibold text-surface-600 dark:text-surface-400 uppercase tracking-widest"
								>Texto da Pergunta</label
							>
							{#if p.key?.startsWith('extra_')}
								<span
									class="badge preset-filled-secondary-500 text-3xs font-bold uppercase whitespace-nowrap"
									>CAMPO ADICIONAL</span
								>
							{:else}
								<span
									class="bg-surface-100 dark:bg-surface-800 text-3xs font-bold px-2 py-0.5 rounded-full text-surface-600 dark:text-surface-400 uppercase border border-surface-200 dark:border-surface-700 whitespace-nowrap"
									>Campo Sistema</span
								>
							{/if}
						</div>
						<textarea
							id="qtxt-{p.id}"
							bind:value={p.texto}
							rows="2"
							class="w-full px-4 py-3 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-950 text-sm font-bold resize-none"
						></textarea>
					</div>

					<div class="w-full md:w-56 space-y-1.5 md:shrink-0">
						<label
							for="p-tp-{p.id}"
							class="text-3xs font-semibold text-surface-600 dark:text-surface-400 uppercase tracking-widest"
							>Tipo do Campo</label
						>
						<select
							id="p-tp-{p.id}"
							bind:value={p.tipo}
							class="w-full px-4 py-3 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-sm font-bold focus:ring-2 focus:ring-primary-500 transition-colors shadow-sm"
						>
							<optgroup label="Campos Básicos">
								<option value="texto">Texto Curto</option>
								<option value="textarea">Texto Longo</option>
								<option value="numero">Número</option>
								<option value="sim_nao">Sim / Não (Condicional)</option>
								<option value="select_99">Quantitativo (0-99)</option>
							</optgroup>
							<optgroup label="Campos Inteligentes (Sistemáticos)">
								<!-- Primeiro da lista por ser o ÚNICO que pode se repetir no
								     formulário: os demais gravam em chave fixa e só funcionam
								     uma vez (ver `$lib/gise/tipos-pergunta`). -->
								<option value="lista_detalhada"
									>Quantidade + Lista Nome/Procedimento (reutilizável)</option
								>
								<option value="vtr_placa">VTR e Placa (Inteligente)</option>
								<option value="mandados_maiores">Mandados Maiores (Auto-Listagem)</option>
								<option value="prisoes_maiores">Prisões Maiores (Auto-Listagem)</option>
								<option value="apreensoes_menores">Apreensões Menores (Auto-Listagem)</option>
								<option value="drogas_complex">Drogas Detalhado (Auto-Listagem)</option>
								<option value="armas_complex">Armas Detalhado (Auto-Listagem)</option>
								<option value="celulares_complex">Extração Celular (Auto-Listagem)</option>
								<option value="analise_complex">Análise de Dados (Auto-Listagem)</option>
								<option value="relatorios_seint_complex">Relatórios SEINT (Auto-Listagem)</option>
								<option value="foragidos_complex">Alvos Foragidos (Auto-Listagem)</option>
								<option value="operacoes_seint_complex">Operações SEINT (Auto-Listagem)</option>
								<option value="operacoes_seint_pura">Operações SEINT (Lista Pura)</option>
							</optgroup>
						</select>
					</div>

					<div class="flex gap-2 shrink-0 self-end md:self-start">
						{#if TIPOS_COM_FILHOS.includes(p.tipo)}
							<!-- `CornerDownRight` e não a seta reta de antes: ao lado das setas
							     de MOVER, uma seta para baixo virava "descer a pergunta". -->
							<button
								type="button"
								class="p-3 text-primary-500 hover:bg-primary-500/10 rounded-xl transition-colors"
								onclick={() => resGise.adicionarSubPergunta(p)}
								title="Adicionar Sub-pergunta (se SIM)"
							>
								<CornerDownRight class="w-5 h-5" />
							</button>
						{/if}
						<button
							type="button"
							class="p-3 text-error-500 hover:bg-error-500/10 rounded-xl transition-colors"
							onclick={() => resGise.removerPergunta(p.id)}
							aria-label="Remover Pergunta"
						>
							<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
								/></svg
							>
						</button>
					</div>
				</div>

				<!-- Novos controles de sub-textos para QUALQUER pergunta que use os tipos inteligentes -->
				{#if TIPOS_COM_ROTULOS.includes(p.tipo)}
					<div
						class="mt-4 p-4 bg-primary-500/5 dark:bg-primary-500/10 rounded-2xl border border-dashed border-primary-500/30 space-y-4"
					>
						<div class="flex items-center gap-2 mb-2">
							<SquarePen class="w-4 h-4 text-primary-500" aria-hidden="true" />
							<span
								class="text-3xs font-semibold text-primary-600 dark:text-primary-400 uppercase tracking-widest"
								>Personalizar Rótulos do Campo Inteligente</span
							>
						</div>

						<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
							{#if TIPOS_COM_LISTA.includes(p.tipo)}
								<div class="space-y-1">
									<label
										for="subqtd-{p.id}"
										class="text-3xs font-bold text-surface-600 dark:text-surface-400 uppercase"
										>Quantidade:</label
									>
									<input
										id="subqtd-{p.id}"
										type="text"
										bind:value={p.subtexto_qtd}
										placeholder="Ex: 5.1 QUANTIDADE:"
										class="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-xs font-bold"
									/>
								</div>
								<div class="space-y-1 md:col-span-2">
									<label
										for="sublst-{p.id}"
										class="text-3xs font-bold text-surface-600 dark:text-surface-400 uppercase tracking-wider"
										>Legenda Lista (ex: 5.2)</label
									>
									<input
										id="sublst-{p.id}"
										type="text"
										bind:value={p.subtexto_lista}
										placeholder="Ex: 5.2 LISTAGEM:"
										class="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-xs font-bold"
									/>
								</div>
							{:else if p.tipo === 'drogas_complex'}
								<div class="space-y-1">
									<label
										for="subtp-{p.id}"
										class="text-3xs font-bold text-surface-600 dark:text-surface-400 uppercase"
										>Lista de Tipos:</label
									>
									<input
										id="subtp-{p.id}"
										type="text"
										bind:value={p.subtexto_tipo}
										placeholder="Ex: 10.1 TIPO DE DROGA:"
										class="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-xs font-bold"
									/>
								</div>
								<div class="space-y-1">
									<label
										for="subdet-{p.id}"
										class="text-3xs font-bold text-surface-600 dark:text-surface-400 uppercase"
										>Detalhamento Pesos:</label
									>
									<input
										id="subdet-{p.id}"
										type="text"
										bind:value={p.subtexto_detalhe}
										placeholder="Ex: 10.1.1 PESOS:"
										class="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-xs font-bold"
									/>
								</div>
							{:else if p.tipo === 'armas_complex'}
								<div class="space-y-1">
									<label
										for="subtp-{p.id}"
										class="text-3xs font-bold text-surface-600 dark:text-surface-400 uppercase"
										>Lista de Tipos:</label
									>
									<input
										id="subtp-{p.id}"
										type="text"
										bind:value={p.subtexto_tipo}
										placeholder="Ex: 11.1 TIPO DE ARMA:"
										class="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-xs font-bold"
									/>
								</div>
								<div class="space-y-1">
									<label
										for="subdet-{p.id}"
										class="text-3xs font-bold text-surface-600 dark:text-surface-400 uppercase"
										>Legenda Quantidade:</label
									>
									<input
										id="subdet-{p.id}"
										type="text"
										bind:value={p.subtexto_detalhe}
										placeholder="Ex: 11.1.1 QUANTIDADE:"
										class="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-xs font-bold"
									/>
								</div>
							{/if}
						</div>
					</div>
				{/if}

				{#if p.filhos && p.filhos.length > 0}
					<div class="mt-6 space-y-6 pt-2 border-l-4 border-primary-500/20" role="list">
						{#each p.filhos as filho (filho.id)}
							{@render renderItem(filho, level + 1)}
						{/each}
					</div>
				{/if}
			</div>
		{/snippet}

		{#each resGise.perguntasConfig as p, i (p.id)}
			{@render renderItem(p, 0, i)}
		{/each}
	</div>

	<div
		class="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 border-t border-surface-200 dark:border-white/10 pt-4 mt-2"
	>
		<form
			method="POST"
			action="?/salvarModelo"
			use:enhance={resGise.handleSalvarModelo}
			class="w-full flex flex-col sm:flex-row items-stretch sm:items-center gap-4"
		>
			<input type="hidden" name="config" value={resGise.configJson} />
			<input type="hidden" name="tipo" value={resGise.configTipo} />

			<div class="flex-grow card-elevated-2 rounded-xl p-4">
				<p
					class="text-xs font-bold text-surface-600 dark:text-surface-400 uppercase tracking-widest mb-1"
				>
					Status da Configuração
				</p>
				<div class="flex items-center gap-2">
					<div
						class="w-2 h-2 rounded-full {loading.active
							? 'bg-warning-500 animate-pulse'
							: 'bg-success-500'}"
					></div>
					<p class="text-3xs font-bold text-surface-900 dark:text-surface-100">
						{loading.active ? 'Salvando alterações...' : 'Pronto para salvar'}
					</p>
				</div>
			</div>

			<!-- O 9º argumento (`btnType`) é obrigatório aqui: sem ele o
			     `actionButton` cai no default `type="button"`, e um botão desse tipo
			     dentro de um `<form>` NÃO submete. Como também não há `onclick`, o
			     clique não fazia absolutamente nada — o modelo nunca era salvo. -->
			{@render actionButton(
				loading.active
					? 'Salvando...'
					: `Salvar Modelo ${resGise.configTipo === 'seint' ? 'SEINT' : 'Operacional'}`,
				undefined,
				'primary',
				'filled',
				undefined,
				loading.active,
				false,
				'w-full sm:w-auto py-3.5 text-sm shadow-lg shadow-primary-500/20',
				'submit'
			)}
		</form>
	</div>
</div>

<!-- Diálogo de confirmação para restaurar a versão anterior -->
<Dialog open={dialogRestaurarAberto} onOpenChange={(e) => (dialogRestaurarAberto = e.open)}>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="card p-4 sm:p-6 max-w-sm w-full max-h-[calc(100dvh-2rem)] overflow-y-auto card-elevated shadow-2xl rounded-2xl"
		>
			<Dialog.Title class="text-lg font-bold mb-2">Restaurar versão anterior?</Dialog.Title>
			<Dialog.Description class="text-sm text-surface-600 dark:text-surface-300 mb-6">
				As perguntas do modelo <strong>{resGise.configTipo}</strong> voltam a ser as da versão salva
				antes da última alteração. As edições que estiverem na tela agora são descartadas.
				<br /><br />
				Nada é gravado ainda: revise e clique em <strong>Salvar</strong> para efetivar.
			</Dialog.Description>
			<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
				<Dialog.CloseTrigger class="btn preset-outlined-surface-500">Cancelar</Dialog.CloseTrigger>
				<button
					type="button"
					class="btn preset-filled-warning-500"
					onclick={confirmarRestaurarAnterior}
				>
					Restaurar
				</button>
			</div>
		</div>
	</Dialog.Content>
</Dialog>
