<script lang="ts">
	/**
	 * `/res-gise` — a tela do POLICIAL na GISE: onde ele confirma entrada e saída
	 * e entrega o relatório de produtividade das escalas em que está escalado.
	 *
	 * Duas audiências no mesmo arquivo, e é essa a razão do tamanho:
	 * - o POLICIAL vê seus cards de serviço (`FormularioServico`, um por escala);
	 * - o ADMIN GERAL não tem serviço nenhum aqui — para ele a tela é a
	 *   `ConfigurarFormulario`, o editor do modelo de perguntas.
	 *
	 * O estado e as chamadas ficam em DOIS composables, um por audiência —
	 * `usePresencaGise` e `useEditorModelo`. Este arquivo escolhe o que mostrar e
	 * hospeda os modais compartilhados (pad de assinatura e cadastro de rubrica).
	 * O editor só é instanciado para o Admin Geral: o policial não paga por ele.
	 *
	 * `minhaRubrica` espelha o dado do `load` mas é estado local: salvar ou
	 * excluir a rubrica precisa refletir na hora, sem recarregar a página inteira
	 * no meio de uma assinatura.
	 */
	import type { PageProps } from './$types';
	import { actionButton } from './_components/BotoesAcao.svelte';
	import { goto } from '$app/navigation';
	import { page, navigating } from '$app/state';
	import SkeletonCard from '$lib/components/SkeletonCard.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import { useAutorizacao, useMobile, useInvalidateOnFocus } from '$lib/composables';
	import { fetchSyncEstado } from '$lib/sync-estado';
	import SignaturePad from '$lib/components/SignaturePad.svelte';
	import type { SignaturePadStep } from '$lib/components/SignaturePadTypes';
	import ModalCadastrarRubrica from '$lib/components/ModalCadastrarRubrica.svelte';
	import ModalShell from '$lib/components/ModalShell.svelte';
	import BotaoVoltar from '$lib/components/BotaoVoltar.svelte';
	import BotaoLimparFiltros from '$lib/components/BotaoLimparFiltros.svelte';
	import { usePresencaGise } from './_components/usePresencaGise.svelte';
	import { fmtDate } from '$lib/gise/formatters';
	import { CICLOS } from '$lib/gise/ciclos';
	import FiltroHistoricoSegmento from '$lib/gise/FiltroHistoricoSegmento.svelte';
	import {
		CLASSE_BARRA_FILTRO,
		CLASSE_CAMPO_FILTRO,
		CLASSE_INPUT_FILTRO,
		CLASSE_ROTULO_FILTRO
	} from '$lib/gise/filtro-historico-ui';
	import { loading } from '$lib/loading.svelte';
	import ConfigurarFormulario from './_components/ConfigurarFormulario.svelte';
	import FormularioServico from './_components/FormularioServico.svelte';
	import { toaster } from '$lib/toast';

	const { data }: PageProps = $props();
	const auth = useAutorizacao();
	const isAdminGeral = $derived(auth.isAdmin);
	const presenca = usePresencaGise(() => data);
	const mobileState = useMobile();
	const isMobile = $derived(mobileState.isMobile);
	// Modo da tela: "Histórico GISE" (?status=finalizadas) x "Presença GISE"
	// (ativas). São duas abas da sidebar apontando para a mesma rota; a lista já
	// vem filtrada pelo servidor, então aqui o modo só ajusta título, texto de
	// vazio e a busca detalhada (tipo de equipe, mês, ciclo ou data — só no histórico).
	const ehHistorico = $derived(presenca.statusFilterUrl === 'finalizadas');
	// Título da aba (Presença × Histórico). "escalas extras", não "GISE": a lista
	// inclui qualquer operação (CRAJUBAR, EDGE…), e chamá-las de GISE virou
	// informação errada. O Admin Geral continua no editor do formulário.
	const tituloPagina = $derived(
		isAdminGeral ? 'Relatórios GISE' : ehHistorico ? 'Histórico' : 'Minhas escalas extras'
	);
	const subtituloPagina = $derived(
		isAdminGeral
			? 'Gestão de produtividade e relatórios operacionais'
			: ehHistorico
				? 'Escalas extras em que você foi escalado.'
				: 'Escalas extras ativas em que você está escalado.'
	);

	// Presença/relatório de outra sessão: foco + broadcast + poll (quente se há
	// serviço ativo sem saída).
	useInvalidateOnFocus('app:res-gise', {
		isHot: () =>
			!isAdminGeral &&
			Boolean(
				presenca.escalaSelecionada &&
				!(
					'presenca' in presenca.escalaSelecionada &&
					presenca.escalaSelecionada.presenca?.saida_timestamp
				)
			),
		probe: async () => {
			try {
				const e = await fetchSyncEstado();
				return e.resGise?.stamp ?? null;
			} catch {
				return null;
			}
		}
	});

	let signatureStep = $state<SignaturePadStep>('signature');
	$effect(() => {
		if (presenca.capturandoRubrica) {
			signatureStep = 'signature';
		}
	});

	// Cadastro de rubrica reutilizável (assinatura por Token A3 no computador).
	// `minhaRubrica` espelha `data.minhaRubrica` mas pode mudar localmente após
	// salvar/excluir sem exigir reload.
	let cadastrandoRubrica = $state(false);
	// Só consideramos "tem rubrica" quando o valor é um dataURL de imagem real.
	// Um valor vazio/corrompido (ex.: `data:image/png;base64,` sem conteúdo, ou
	// lixo persistido) é tratado como AUSÊNCIA — evita cair no ramo "rubrica
	// cadastrada" e renderizar uma imagem quebrada no lugar do estado vazio.
	function rubricaValida(v: string | null | undefined): string | null {
		return typeof v === 'string' && v.startsWith('data:image/') && v.length > 100 ? v : null;
	}
	// Derivado gravável: espelha o load, mas admite o set local pós-cadastro.
	let minhaRubrica: string | null = $derived(rubricaValida(data.minhaRubrica));

	/**
	 * A URL manda na seleção. `selecionarEscala` já ESCREVIA `?giseId=&equipeId=`,
	 * mas ninguém lia de volta: recarregar a página — ou voltar do wizard do
	 * relatório — caía na lista com a URL apontando para uma escala que a tela não
	 * mostrava. Aqui os dois sentidos existem, então a rota é de fato endereçável.
	 *
	 * O efeito escreve o mesmo estado que lê; a guarda de igualdade é o que faz a
	 * segunda passada parar. E é ela também que preserva o objeto local depois de
	 * um `invalidateAll` — quem re-sincroniza com o dado fresco é
	 * `sincronizarPresencaAtual`, que sabe o que fazer quando a escala SAI da lista.
	 */
	$effect(() => {
		const idUrl = Number(page.url.searchParams.get('giseId')) || 0;
		if (!idUrl) {
			if (presenca.escalaSelecionada) presenca.escalaSelecionada = null;
			return;
		}
		const equipeUrl = Number(page.url.searchParams.get('equipeId')) || 0;
		const atual = presenca.escalaSelecionada;
		if (atual?.id === idUrl && (!equipeUrl || atual.equipe_id === equipeUrl)) return;
		const alvo = data.minhasEscalas?.find(
			(e) => e.id === idUrl && (!equipeUrl || e.equipe_id === equipeUrl)
		);
		if (alvo) presenca.escalaSelecionada = alvo;
	});

	function voltarParaLista() {
		// Só mexe na URL: o efeito acima é quem tira a seleção.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const params = new URLSearchParams(page.url.searchParams);
		params.delete('giseId');
		params.delete('equipeId');
		const qs = params.toString();
		goto(qs ? `?${qs}` : page.url.pathname, { keepFocus: true, noScroll: true });
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	$effect(() => {
		if (presenca.escalaSelecionada) window.scrollTo({ top: 0, behavior: 'smooth' });
	});

	const navegandoParaEscala = $derived(
		navigating?.to != null &&
			navigating.to.url.pathname === page.url.pathname &&
			navigating.to.url.searchParams.get('giseId') !== (page.url.searchParams.get('giseId') ?? null)
	);
	const navegandoFiltros = $derived(
		navigating?.to != null &&
			navigating.to.url.pathname === page.url.pathname &&
			!navegandoParaEscala
	);
</script>

<svelte:head>
	<title>{tituloPagina} - Portal de Escalas</title>
</svelte:head>

<div class="space-y-6">
	<!-- Voltar ACIMA do título, como nas demais telas de detalhe: para o Admin
	     Geral esta tela é o editor do formulário DE UMA OPERAÇÃO, alcançado pelo
	     botão "Formulário" de /gise/operacoes — e desde que o item saiu da barra
	     lateral, o caminho de volta precisa estar na própria página. -->
	{#if isAdminGeral}
		<BotaoVoltar href="/gise/operacoes" rotulo="Voltar às operações" />
	{/if}

	<header class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 sm:mb-6">
		<div>
			<h1
				class={[
					'font-bold',
					ehHistorico
						? 'font-heading text-base sm:text-lg leading-tight text-surface-700 dark:text-surface-300'
						: 'h1 text-2xl'
				]}
			>
				{tituloPagina}
			</h1>
			<p
				class={[
					'font-medium text-surface-600 dark:text-surface-400',
					ehHistorico ? 'text-xs' : 'text-sm'
				]}
			>
				{subtituloPagina}
			</p>
		</div>
	</header>

	{#if isAdminGeral}
		<!-- `getData` e não o composable pronto: o editor se instancia DENTRO do
		     componente, que só é renderizado para o Admin Geral. O policial não
		     paga pelos efeitos do editor. `aoSalvar` religa as duas metades —
		     gravar o modelo invalida o load, e quem tiver escala selecionada
		     precisa reapontar para a linha nova. -->
		<ConfigurarFormulario
			getData={() => data}
			aoSalvar={() => presenca.reaplicarEscalaSelecionada()}
			modeloAnteriorOperacional={data.modeloAnteriorOperacional}
			modeloAnteriorSeint={data.modeloAnteriorSeint}
		/>
	{:else}
		<!-- Slide lateral: container oculta o painel fora de tela -->
		<div class="overflow-hidden">
			<div
				class="flex transition-transform duration-300 ease-in-out"
				style="transform: translateX({presenca.escalaSelecionada ? '-50%' : '0%'}); width: 200%;"
			>
				<!-- Panel 1: Lista de Escalas -->
				<div class="min-w-0 space-y-4" style="width: 50%;">
					<div class="px-2 space-y-3">
						<!-- Busca detalhada (só no histórico). Tipo de equipe e período
						     escolhem o recorte; mês civil, ciclo (21→20) e data são
						     mutuamente exclusivos — o seletor esconde os campos dos outros. -->
						{#if ehHistorico}
							<div class="space-y-2 pt-3">
								<div class="flex flex-col gap-2 xs:flex-row xs:items-center xs:justify-between">
									<span
										class="text-2xs font-black text-surface-600 dark:text-surface-400 uppercase tracking-widest"
										>Busca Detalhada</span
									>
									<BotaoLimparFiltros
										temFiltros={presenca.temFiltrosHistorico}
										onclick={presenca.limparFiltros}
										classes="w-full xs:w-auto"
									/>
								</div>
								<div class={CLASSE_BARRA_FILTRO}>
									<FiltroHistoricoSegmento
										kind="tipo"
										value={presenca.tipoFilterUrl}
										onValueChange={(v) => presenca.changeTipoFilter(v)}
									/>
									<FiltroHistoricoSegmento
										kind="periodo"
										value={presenca.modoPeriodo}
										onValueChange={(v) => {
											if (v === 'mes' || v === 'ciclo' || v === 'data') {
												presenca.changeModoPeriodo(v);
											}
										}}
									/>
									{#if presenca.modoPeriodo === 'ciclo'}
										<div class={CLASSE_CAMPO_FILTRO}>
											<span class={CLASSE_ROTULO_FILTRO}>Ciclo</span>
											<div class="flex w-full min-w-0 items-center gap-1.5">
												<label class="sr-only" for="anoCicloMember">Ano do ciclo</label>
												<select
													id="anoCicloMember"
													class="{CLASSE_INPUT_FILTRO} w-[5.5rem] shrink-0"
													value={presenca.anoFilterUrl ?? ''}
													onchange={(e) => presenca.changeCicloFilter('ano', e.currentTarget.value)}
												>
													{#each presenca.anosCiclo as ano (ano)}
														<option value={ano}>{ano}</option>
													{/each}
												</select>
												<label class="sr-only" for="numeroCicloMember">Número do ciclo</label>
												<select
													id="numeroCicloMember"
													class="{CLASSE_INPUT_FILTRO} min-w-0 flex-1 sm:w-[13.5rem] sm:flex-none"
													value={presenca.cicloFilterUrl ?? ''}
													onchange={(e) =>
														presenca.changeCicloFilter('ciclo', e.currentTarget.value)}
												>
													{#each CICLOS as c (c.n)}
														<option value={c.n}>{c.label}</option>
													{/each}
												</select>
											</div>
										</div>
									{:else if presenca.modoPeriodo === 'mes'}
										<div class={CLASSE_CAMPO_FILTRO}>
											<label class={CLASSE_ROTULO_FILTRO} for="mesMember">Mês</label>
											<input
												id="mesMember"
												type="month"
												class="{CLASSE_INPUT_FILTRO} w-full sm:w-[12.5rem]"
												value={presenca.mesFilterUrl}
												onchange={(e) => presenca.changeDateFilter('mes', e.currentTarget.value)}
											/>
										</div>
									{:else}
										<div class={CLASSE_CAMPO_FILTRO}>
											<label class={CLASSE_ROTULO_FILTRO} for="dataMember">Data específica</label>
											<input
												id="dataMember"
												type="date"
												class="{CLASSE_INPUT_FILTRO} w-full sm:w-[12.5rem]"
												value={presenca.dataFilterUrl}
												onchange={(e) => presenca.changeDateFilter('data', e.currentTarget.value)}
											/>
										</div>
									{/if}
								</div>
							</div>
						{/if}
					</div>
					{#if navegandoFiltros}
						<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 px-2">
							{#each { length: 6 } as _, i (i)}
								<SkeletonCard lines={3} hasFooter={false} />
							{/each}
						</div>
					{:else}
						<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 px-2">
							{#each data.minhasEscalas as escala (`${escala.id}_${escala.equipe_id}_${escala.equipe_tipo}`)}
								{@const estaCarregando =
									!!navegandoParaEscala &&
									navigating?.to?.url.searchParams.get('giseId') === String(escala.id)}
								<div
									role="button"
									tabindex="0"
									class="w-full text-left p-4 rounded-2xl border transition-all cursor-pointer {presenca
										.escalaSelecionada?.id === escala.id &&
									presenca.escalaSelecionada?.equipe_id === escala.equipe_id
										? 'border-primary-500 bg-primary-500/10'
										: 'border-surface-200 dark:border-white/10 bg-white dark:bg-surface-900 hover:border-primary-500/50'} {estaCarregando
										? 'opacity-60'
										: ''}"
									onclick={() => presenca.selecionarEscala(escala)}
									onkeydown={(e) => e.key === 'Enter' && presenca.selecionarEscala(escala)}
								>
									<div class="flex items-center justify-between">
										<p class="text-sm font-bold text-surface-900 dark:text-surface-100">
											{fmtDate(escala.data_inicio)}
											<span class="ml-1 opacity-50 font-normal">#{escala.id}</span>
										</p>
										{#if estaCarregando}
											<div class="flex items-center gap-1 pr-0.5">
												<div
													class="w-1.5 h-1.5 rounded-full bg-primary-500 animate-bounce [animation-delay:-0.3s]"
												></div>
												<div
													class="w-1.5 h-1.5 rounded-full bg-primary-500 animate-bounce [animation-delay:-0.15s]"
												></div>
												<div class="w-1.5 h-1.5 rounded-full bg-primary-500 animate-bounce"></div>
											</div>
										{:else}
											<span class="badge preset-filled-primary-500 text-3xs uppercase font-bold"
												>{escala.equipe_tipo}</span
											>
										{/if}
									</div>
									<div class="mt-1 space-y-1.5">
										<p
											class="text-xs uppercase tracking-wider leading-tight {escala.assinada
												? 'text-success-500 font-bold'
												: 'text-surface-600 dark:text-surface-400'}"
										>
											{escala.assinada
												? 'SUPERVISOR ASSINOU'
												: 'AGUARDANDO ASSINATURA DO SUPERVISOR'}
										</p>

										{#if escala.equipeRespondida || escala.extraAssinado || (escala.presenca?.saida_timestamp && !escala.extraAssinado)}
											<div class="flex flex-row gap-2 w-full sm:w-auto sm:gap-1.5">
												{#if escala.equipeRespondida && escala.seccional_id !== 0}
													{@render actionButton(
														'PRODUTIVIDADE',
														'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4',
														'success',
														'filled',
														(e: MouseEvent) => {
															e.stopPropagation();
															presenca.baixarRelatorio(escala);
														},
														false,
														presenca.baixandoProdutividade === escala.id,
														'flex-1 sm:flex-none w-full sm:w-auto text-3xs px-3 py-1.5',
														'button',
														'sm'
													)}
												{/if}
												{#if escala.extraAssinado}
													{@render actionButton(
														'RELAT. EXTRA',
														'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
														'warning',
														'filled',
														(e: MouseEvent) => {
															e.stopPropagation();
															presenca.baixarRelatorioExtra(escala);
														},
														false,
														presenca.baixandoExtra === escala.id,
														'flex-1 sm:flex-none w-full sm:w-auto text-3xs px-3 py-1.5',
														'button',
														'sm'
													)}
												{:else if escala.presenca?.saida_timestamp}
													{@render actionButton(
														'RELAT. EXTRA',
														'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
														'surface',
														'filled',
														(e: MouseEvent) => {
															e.stopPropagation();
															toaster.create({
																title:
																	'Relatório de Extraordinário enviado para assinatura do supervisor. Estará disponível para download após assinado.',
																type: 'warning'
															});
														},
														false,
														false,
														'flex-1 sm:flex-none w-full sm:w-auto text-3xs px-3 py-1.5 opacity-60 cursor-pointer',
														'button',
														'sm'
													)}
												{/if}
											</div>
										{/if}
									</div>
								</div>
							{:else}
								<p class="text-xs text-surface-600 dark:text-surface-400 italic col-span-full px-2">
									{ehHistorico
										? 'Nenhuma escala GISE encerrada no seu histórico.'
										: 'Nenhuma escala GISE ativa no momento.'}
								</p>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Panel 2: Formulário de Serviço -->
				<!-- Largura cheia do container, igual ao painel 1 e às demais telas de
				     detalhe. `px-2` idêntico ao do painel 1: qualquer diferença faz o
				     card saltar na horizontal durante o slide. Quem precisa de coluna
				     estreita (stepper, CTAs, estados vazios) trava por dentro, no
				     `FormularioServico` — não aqui, senão o formulário de
				     produtividade perde a largura de que os grids dele precisam. -->
				<div class="min-w-0 px-2" style="width: 50%;">
					<div class="space-y-4">
						<button
							type="button"
							class="btn btn-sm preset-outlined-surface-500 flex items-center gap-1.5"
							onclick={voltarParaLista}
						>
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M15 19l-7-7 7-7"
								/>
							</svg>
							Voltar
						</button>
						{#if presenca.escalaSelecionada}
							<section
								class="card p-4 sm:p-6 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-3xl shadow-sm"
							>
								<FormularioServico
									{presenca}
									{isAdminGeral}
									{isMobile}
									restringirSmartphone={data.restringirSmartphone}
									{minhaRubrica}
									abrirCadastroRubrica={() => (cadastrandoRubrica = true)}
									{voltarParaLista}
								/>
							</section>
						{/if}
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>

<svelte:window
	onkeydown={(e) => {
		if (presenca.escalaSelecionada && e.key === 'Escape' && !presenca.capturandoRubrica)
			voltarParaLista();
	}}
/>

<!-- Modal de Rubrica — Confirmação de Entrada / Saída do Policial -->
{#if presenca.escalaSelecionada}
	{@const tipoPresenca = !presenca.escalaSelecionada.presenca?.entrada_timestamp
		? 'entrada'
		: 'saida'}
	{@const titulo =
		signatureStep === 'camera'
			? 'Prova de Vida'
			: signatureStep === 'password'
				? 'Confirme sua senha'
				: signatureStep === 'email_code'
					? 'Confirmação de Identidade'
					: tipoPresenca === 'entrada'
						? 'Confirmação de Entrada'
						: 'Confirmação de Saída'}
	{@const descricao =
		signatureStep === 'camera'
			? 'Cumpra o desafio de presença na tela para provar que você está ativo.'
			: signatureStep === 'password'
				? 'A sessão sozinha não basta. Digite a senha de acesso para assinar.'
				: signatureStep === 'email_code'
					? 'Por razões de segurança, insira o código enviado para o seu e-mail funcional.'
					: tipoPresenca === 'entrada'
						? 'Registre sua rubrica para confirmar a entrada no serviço.'
						: 'Registre sua rubrica para confirmar a saída do serviço.'}
	<ModalShell
		open={presenca.capturandoRubrica}
		title={titulo}
		description={descricao}
		largura="2xl"
		camada="empilhado"
		familia="assinatura"
		pending={loading.active}
		onOpenChange={(novoOpen) => {
			if (!novoOpen && !loading.active) presenca.capturandoRubrica = false;
		}}
	>
		{#if loading.active}
			<div class="flex flex-col items-center gap-4 py-10">
				<Spinner size="lg" class="text-primary-500" />
				<p
					class="text-sm font-semibold text-surface-600 dark:text-surface-400 uppercase tracking-wider"
				>
					{tipoPresenca === 'entrada' ? 'Registrando entrada...' : 'Registrando saída...'}
				</p>
			</div>
		{:else if presenca.capturandoRubrica}
			<SignaturePad
				onConfirm={tipoPresenca === 'entrada' ? presenca.salvarEntrada : presenca.salvarSaida}
				onCancel={() => (presenca.capturandoRubrica = false)}
				exigirFoto={page.data.exigirFotoAssinatura ?? true}
				exigirGps={page.data.exigirGpsAssinatura ?? true}
				exigirCodigoEmail={page.data.exigirCodigoEmailAssinatura ?? false}
				rubricaSalva={minhaRubrica}
				bind:step={signatureStep}
			/>
		{/if}
	</ModalShell>
{/if}

<!-- Modal de cadastro/gestão da rubrica reutilizável (assinatura Token A3 no computador) -->
<ModalCadastrarRubrica
	bind:open={cadastrandoRubrica}
	rubricaAtual={minhaRubrica}
	onSaved={(nova) => (minhaRubrica = nova)}
/>
