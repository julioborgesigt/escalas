<script lang="ts">
	/**
	 * O card de UMA ESCALA GISE na tela do policial (`/res-gise`) — onde ele faz
	 * as três coisas que lhe cabem, na ordem em que o serviço acontece:
	 *
	 *   confirmar ENTRADA → enviar o RELATÓRIO de produtividade → confirmar SAÍDA
	 *
	 * Cada passo só libera quando o anterior está cumprido, e as duas presenças são
	 * assinatura avançada: exigem rubrica e, conforme as flags, foto, GPS e código
	 * por e-mail. A tela esconde o que não cabe, mas quem valida é o servidor —
	 * cada action revalida participação e horário por conta própria.
	 *
	 * O estado e as chamadas vivem em `useResGise`; este componente é a
	 * apresentação de um item da lista.
	 *
	 * A produtividade é a exceção entre os três passos: em vez de abrir um modal,
	 * o botão NAVEGA para `/res-gise/relatorio/[giseId]`. O modelo operacional tem
	 * 19 perguntas de nível 0 e os filhos condicionais — cabia num modal só como
	 * rolagem infinita. Lá o formulário é um wizard por etapas, com rascunho
	 * automático; entrada e saída continuam aqui porque são um botão cada.
	 */
	import { Dialog, Portal } from '@skeletonlabs/skeleton-svelte';
	import { actionButton, btnIcon } from './BotoesAcao.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import PainelAssinaturaToken from '$lib/components/PainelAssinaturaToken.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import { loading } from '$lib/loading.svelte';
	import { toaster } from '$lib/toast';
	import type { useResGise } from './useResGise.svelte';

	type ResGise = ReturnType<typeof useResGise>;

	const {
		resGise,
		isAdminGeral,
		isMobile,
		restringirSmartphone,
		minhaRubrica = null,
		abrirCadastroRubrica,
		voltarParaLista
	}: {
		resGise: ResGise;
		isAdminGeral: boolean;
		isMobile: boolean;
		restringirSmartphone: boolean;
		minhaRubrica?: string | null;
		abrirCadastroRubrica: () => void;
		voltarParaLista: () => void;
	} = $props();

	const usuario = $derived(page.data.usuario);
	const giseId = $derived(resGise.escalaSelecionada?.id ?? null);
	const esc = $derived(resGise.escalaSelecionada);

	/**
	 * Rota do wizard do relatório. Dois parâmetros, ambos opcionais:
	 * `equipeId` só vai quando existe (no quadro de supervisão ele é `0`, e a
	 * resposta do SEINT lá é individual), e `status` viaja de ida e volta para o
	 * retorno cair na MESMA aba de filtro — sem ele, quem retifica um relatório
	 * de escala finalizada volta para "Ativas" e não acha a própria escala.
	 */
	const urlRelatorio = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const params = new URLSearchParams();
		if (esc?.equipe_id) params.set('equipeId', String(esc.equipe_id));
		const status = page.url.searchParams.get('status');
		if (status) params.set('status', status);
		const qs = params.toString();
		return `/res-gise/relatorio/${giseId}${qs ? `?${qs}` : ''}`;
	});

	/**
	 * Estado das três tarefas, num lugar só. O template lia estas mesmas
	 * condições em oito pontos diferentes (`presenca?.entrada_timestamp` seis
	 * vezes), e cada leitura era uma chance de divergir das outras.
	 *
	 * `temProdutividade`: supervisor e assessor não devem relatório — o servidor
	 * já lhes dá `equipeRespondida: true` de saída (`+page.server.ts`, "quem deve
	 * o relatório muda por papel"). Para eles o passo não existe, em vez de
	 * aparecer eternamente concluído.
	 */
	const temProdutividade = $derived(
		!!esc && esc.equipe_tipo !== 'assessor' && esc.equipe_tipo !== 'supervisor'
	);
	const entradaOk = $derived(!!esc?.presenca?.entrada_timestamp);
	const relatorioOk = $derived(!!esc?.equipeRespondida);
	const saidaOk = $derived(!!esc?.presenca?.saida_timestamp);
	const horarioEntradaLiberado = $derived(!!esc && resGise.isHorarioLiberado(esc, isAdminGeral));
	const horarioSaidaLiberado = $derived(!!esc && resGise.isSaidaLiberada(esc, isAdminGeral));

	/** Qual modal de PRESENÇA está aberto (o relatório é rota, não modal). */
	let modalPresenca = $state<'entrada' | 'saida' | null>(null);

	/** Fecha o modal da tarefa assim que ela é cumprida (inclusive pelo A3, que
	 *  confirma pela API e volta pelo `sincronizarPresencaAtual`). */
	$effect(() => {
		if (modalPresenca === 'entrada' && entradaOk) modalPresenca = null;
		if (modalPresenca === 'saida' && saidaOk) modalPresenca = null;
	});

	/** "2026-07-18 20:42:55" (horário local, -3h) → "18/07/2026 às 20:42". */
	function fmtDataHora(ts: string | null | undefined): string {
		if (!ts) return '';
		const [data, hora] = ts.split(/[ T]/);
		const [ano, mes, dia] = data.split('-');
		if (!ano || !mes || !dia) return ts;
		return `${dia}/${mes}/${ano}${hora ? ' às ' + hora.slice(0, 5) : ''}`;
	}
	// Só mostra "última atualização" quando difere do envio (houve retificação).
	const houveRetificacao = $derived(
		!!resGise.respostaAtualizadaEm &&
			!!resGise.respostaEnviadaEm &&
			resGise.respostaAtualizadaEm !== resGise.respostaEnviadaEm
	);

	// Controles dos painéis ocultos de assinatura A3 (um por tipo de presença,
	// evitando corrida ao alternar o payload `tipo` entre entrada e saída).
	let painelA3Entrada = $state<{ assinarComSerpro: () => Promise<void> } | null>(null);
	let painelA3Saida = $state<{ assinarComSerpro: () => Promise<void> } | null>(null);

	async function confirmarPresencaA3(tipo: 'entrada' | 'saida') {
		const ctrl = tipo === 'entrada' ? painelA3Entrada : painelA3Saida;
		if (!ctrl) {
			toaster.error({
				title: 'Painel de assinatura não inicializado',
				description: 'Recarregue a página (F5) e tente novamente.'
			});
			return;
		}
		await ctrl.assinarComSerpro();
	}
</script>

{#snippet btnBaixarComprovante(tipo: 'entrada' | 'saida')}
	<button
		type="button"
		class="btn btn-sm preset-tonal-surface-500 rounded-lg text-3xs font-bold uppercase flex items-center gap-1.5 shrink-0 ml-auto"
		title="Baixar comprovante de {tipo === 'entrada' ? 'entrada' : 'saída'}"
		onclick={() => resGise.baixarTermoPresenca(tipo)}
		disabled={loading.active || resGise.baixandoTermo === tipo}
	>
		{#if resGise.baixandoTermo === tipo}
			<Spinner size="sm" />
		{:else}
			{@render btnIcon('M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4')}
		{/if}
		<span class="hidden sm:inline">Comprovante</span>
	</button>
{/snippet}

{#snippet blocoRestritoDesktop(tipo: 'entrada' | 'saida')}
	{@const rotulo = tipo === 'entrada' ? 'entrada' : 'saída'}
	<div class="flex flex-col gap-3 max-w-md mx-auto">
		<div class="bg-tertiary-500/5 border border-tertiary-500/25 p-4 rounded-2xl space-y-3">
			<div class="flex items-center gap-2">
				<svg
					class="w-5 h-5 text-tertiary-500 shrink-0"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
					/>
				</svg>
				<p class="text-sm font-bold text-surface-700 dark:text-surface-200 leading-tight">
					Assinar pelo computador <span class="text-3xs font-black text-tertiary-500 uppercase"
						>Certificado Digital · ICP-Brasil</span
					>
				</p>
			</div>

			{#if minhaRubrica}
				<!-- Padronizado com as demais telas de assinatura: só o botão de
				     confirmação. A rubrica é gerida no cadastro (aviso pós-login). -->
				<button
					type="button"
					class="btn preset-filled-tertiary-500 rounded-xl text-sm font-bold uppercase w-full shadow-sm transition-all"
					disabled={loading.active}
					onclick={() => confirmarPresencaA3(tipo)}
				>
					Confirmar {rotulo} com Certificado Digital
				</button>
			{:else}
				<div
					class="bg-warning-500/10 border border-warning-500/30 rounded-xl p-3 flex items-start gap-2"
				>
					<svg
						class="w-4 h-4 text-warning-500 shrink-0 mt-0.5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
						/>
					</svg>
					<p class="text-xs text-surface-600 dark:text-surface-300 leading-snug">
						Você ainda <strong>não cadastrou sua rubrica</strong>. Para confirmar a {rotulo} pelo computador
						com seu <strong>certificado digital</strong>, é necessário cadastrar primeiro a sua
						rubrica — ela será usada como sua assinatura gráfica.
					</p>
				</div>
				<button
					type="button"
					class="btn btn-sm preset-filled-tertiary-500 rounded-xl text-xs font-bold uppercase w-full shadow-sm"
					onclick={abrirCadastroRubrica}
				>
					Entendi — cadastrar rubrica
				</button>
			{/if}
			<p class="text-3xs text-surface-500 dark:text-surface-400 italic leading-snug">
				Pelo celular, a confirmação continua disponível com foto (prova de vida) e GPS.
			</p>
		</div>
	</div>
{/snippet}

<!-- Painéis ocultos de assinatura A3 da presença (um por tipo) -->
{#if giseId != null && minhaRubrica}
	<div class="sr-only" aria-hidden="true">
		<PainelAssinaturaToken
			bind:control={painelA3Entrada}
			signerName={usuario?.nome ?? undefined}
			signerCpf={usuario?.cpf ?? undefined}
			signerEmail={usuario?.email ?? undefined}
			prepararUrl={`/api/gise/${giseId}/presenca/preparar-assinatura`}
			finalizarUrl={`/api/gise/${giseId}/presenca/finalizar-assinatura`}
			nomeArquivo="termo_presenca_entrada.pdf"
			extraPayload={{ tipo: 'entrada' }}
			disabled={loading.active}
			baixarAutomatico={false}
			tituloSucesso="Entrada confirmada com certificado digital."
			onSuccess={async () => {
				await resGise.sincronizarPresencaAtual('entrada');
			}}
		/>
		<PainelAssinaturaToken
			bind:control={painelA3Saida}
			signerName={usuario?.nome ?? undefined}
			signerCpf={usuario?.cpf ?? undefined}
			signerEmail={usuario?.email ?? undefined}
			prepararUrl={`/api/gise/${giseId}/presenca/preparar-assinatura`}
			finalizarUrl={`/api/gise/${giseId}/presenca/finalizar-assinatura`}
			nomeArquivo="termo_presenca_saida.pdf"
			extraPayload={{ tipo: 'saida' }}
			disabled={loading.active}
			baixarAutomatico={false}
			tituloSucesso="Saída confirmada com certificado digital."
			onSuccess={async () => {
				await resGise.sincronizarPresencaAtual('saida');
			}}
		/>
	</div>
{/if}

{#snippet passo(
	indice: number,
	rotulo: string,
	concluido: boolean,
	ativo: boolean,
	acao: { label: string; onclick: () => void; disabled: boolean; titulo?: string } | null
)}
	<!-- `relative`: posicionado, então pinta ACIMA da linha conectora (que é
	     `absolute` e vem antes no DOM). -->
	<div class="relative flex flex-col items-center gap-1.5 text-center">
		<div
			class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold {concluido
				? 'bg-success-500 text-white'
				: ativo
					? 'bg-primary-500 text-white shadow-lg shadow-primary-500/30'
					: 'bg-surface-200 text-surface-600 dark:bg-surface-800 dark:text-surface-400'}"
		>
			{#if concluido}✓{:else}{indice}{/if}
		</div>
		<span
			class="text-3xs font-bold uppercase tracking-wider {concluido
				? 'text-success-600 dark:text-success-500'
				: ativo
					? 'text-primary-600 dark:text-primary-400'
					: 'text-surface-600 dark:text-surface-400'}">{rotulo}</span
		>
		{#if acao}
			<button
				type="button"
				class="btn btn-sm mt-1 w-full max-w-[11rem] rounded-xl text-3xs font-black uppercase tracking-wide whitespace-normal {acao.disabled
					? 'preset-outlined-surface-500 opacity-45 cursor-not-allowed'
					: concluido
						? 'preset-outlined-primary-500'
						: 'preset-filled-primary-500 shadow-md shadow-primary-500/20'}"
				disabled={acao.disabled || loading.active}
				title={acao.titulo}
				onclick={acao.onclick}
			>
				{acao.label}
			</button>
		{/if}
	</div>
{/snippet}

<!--
	Cabeçalho do quadro de resultado: marcador + rótulo + linha de detalhe. O
	texto muda conforme a tarefa esteja cumprida (`detalhe`) ou não
	(`pendencia`) — é o mesmo conteúdo dos avisos antigos, em coluna.
-->
{#snippet cabecalhoQuadro(
	rotulo: string,
	concluido: boolean,
	detalhe: string,
	pendencia: string,
	tom: 'success' | 'surface'
)}
	<div class="flex items-start gap-2">
		<div
			class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full {concluido
				? tom === 'success'
					? 'bg-success-500'
					: 'bg-surface-500'
				: 'bg-surface-200 dark:bg-surface-800'}"
		>
			{#if concluido}
				<svg
					class="h-3.5 w-3.5 text-white"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					aria-hidden="true"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="3"
						d="M5 13l4 4L19 7"
					/></svg
				>
			{:else}
				<span class="block h-1.5 w-1.5 rounded-full bg-surface-500 dark:bg-surface-500"></span>
			{/if}
		</div>
		<div class="min-w-0">
			<p
				class="text-3xs font-bold uppercase tracking-wider {concluido
					? tom === 'success'
						? 'text-success-700 dark:text-success-400'
						: 'text-surface-700 dark:text-surface-300'
					: 'text-surface-600 dark:text-surface-400'}"
			>
				{rotulo}
			</p>
			<p class="text-3xs tabular-nums text-surface-600 dark:text-surface-400">
				{concluido ? detalhe : pendencia}
			</p>
		</div>
	</div>
{/snippet}

{#if resGise.escalaSelecionada}
	{@const escala = resGise.escalaSelecionada}
	{@const passoAtivo = !entradaOk ? 1 : temProdutividade && !relatorioOk ? 2 : !saidaOk ? 3 : 0}
	{@const molduraQuadro = 'flex h-full flex-col gap-2 rounded-2xl border p-3 transition-colors'}
	{@const molduraPendente =
		'border-surface-200 bg-surface-50 dark:border-surface-800 dark:bg-surface-950/40'}

	<div class="space-y-6">
		<div class="border-b border-surface-200 dark:border-surface-800 pb-4">
			<h2 class="text-xl font-bold">Relatório de Serviço</h2>
			<p class="text-xs text-primary-500 font-medium">
				Data: {resGise.fmtDate(escala.data_inicio)}
			</p>
		</div>

		<!--
			Barra de progresso: os passos ficam FIXOS na tela e cada um leva ao seu
			modal. Antes as três tarefas eram seções empilhadas dentro do card, o que
			no desktop virava ~1050px de faixa com o conteúdo perdido no meio.

			Grade de N colunas com a linha conectora `absolute` entre os centros das
			colunas extremas: assim o botão de cada passo cai exatamente sob o seu
			círculo — o que o `justify-between` do layout antigo não permitia.
		-->
		<div class="relative grid gap-2 {temProdutividade ? 'grid-cols-3' : 'grid-cols-2'}">
			<div
				class="pointer-events-none absolute top-4 h-px bg-surface-200 dark:bg-surface-700 {temProdutividade
					? 'left-[16.667%] right-[16.667%]'
					: 'left-1/4 right-1/4'}"
			></div>

			{@render passo(
				1,
				'Entrada',
				entradaOk,
				passoAtivo === 1,
				entradaOk
					? null
					: {
							label: horarioEntradaLiberado ? 'Confirmar entrada' : 'Aguardando horário',
							onclick: () => (modalPresenca = 'entrada'),
							disabled: !horarioEntradaLiberado,
							titulo: horarioEntradaLiberado
								? undefined
								: `Liberado às ${escala.horarioPrevisto?.inicio ?? '—'}`
						}
			)}

			{#if temProdutividade}
				{@render passo(2, 'Produtividade', relatorioOk, passoAtivo === 2, {
					label: relatorioOk ? 'Retificar dados' : 'Preencher relatório',
					onclick: () => goto(urlRelatorio),
					disabled: !entradaOk,
					titulo: entradaOk ? undefined : 'Confirme a entrada primeiro'
				})}
			{/if}

			{@render passo(
				temProdutividade ? 3 : 2,
				'Saída',
				saidaOk,
				passoAtivo === 3,
				saidaOk
					? null
					: {
							label: !horarioSaidaLiberado
								? 'Aguardando horário'
								: !relatorioOk
									? 'Relatório pendente'
									: 'Confirmar saída',
							onclick: () => (modalPresenca = 'saida'),
							disabled: !entradaOk || !horarioSaidaLiberado || !relatorioOk,
							titulo: !horarioSaidaLiberado
								? `Liberado às ${escala.horarioPrevisto?.fim ?? '—'}`
								: !relatorioOk
									? 'Envie o relatório de produtividade antes'
									: undefined
						}
			)}
		</div>

		<!-- Resultados: um quadro por tarefa, lado a lado, na ordem de execução. -->
		<div class="grid grid-cols-1 gap-3 {temProdutividade ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}">
			<div
				class="{molduraQuadro} {entradaOk
					? 'border-success-500/25 bg-success-500/10'
					: molduraPendente}"
			>
				{@render cabecalhoQuadro(
					'Entrada confirmada',
					entradaOk,
					entradaOk && escala.presenca?.entrada_timestamp
						? new Date(escala.presenca.entrada_timestamp).toLocaleString('pt-BR', {
								timeZone: 'America/Sao_Paulo'
							})
						: '',
					horarioEntradaLiberado
						? 'Aguardando confirmação'
						: `Disponível às ${escala.horarioPrevisto?.inicio ?? '—'}`,
					'success'
				)}
				{#if entradaOk}
					<div class="mt-auto flex pt-1">{@render btnBaixarComprovante('entrada')}</div>
				{/if}
			</div>

			{#if temProdutividade}
				<div
					class="{molduraQuadro} {relatorioOk
						? 'border-success-500/25 bg-success-500/10'
						: molduraPendente}"
				>
					{@render cabecalhoQuadro(
						'Relatório entregue',
						relatorioOk,
						resGise.respostaEnviadaEm
							? `Enviado em ${fmtDataHora(resGise.respostaEnviadaEm)}${
									houveRetificacao
										? ` · retificado em ${fmtDataHora(resGise.respostaAtualizadaEm)}`
										: ''
								}`
							: 'Registrado',
						entradaOk ? 'Aguardando envio' : 'Confirme a entrada primeiro',
						'success'
					)}
					{#if relatorioOk && escala.seccional_id !== 0}
						<div class="mt-auto flex pt-1">
							<button
								type="button"
								class="btn btn-sm preset-tonal-surface-500 rounded-lg text-3xs font-bold uppercase flex items-center gap-1.5 shrink-0 ml-auto"
								title="Baixar relatório de produtividade em PDF"
								onclick={() => resGise.baixarRelatorio(escala)}
								disabled={loading.active || resGise.baixandoProdutividade === escala.id}
							>
								{#if resGise.baixandoProdutividade === escala.id}
									<Spinner size="sm" />
								{:else}
									{@render btnIcon(
										'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4'
									)}
								{/if}
								<span class="hidden sm:inline">Relatório</span>
							</button>
						</div>
					{/if}
				</div>
			{/if}

			<div
				class="{molduraQuadro} {saidaOk
					? 'border-surface-500/25 bg-surface-500/10'
					: molduraPendente}"
			>
				{@render cabecalhoQuadro(
					'Saída confirmada',
					saidaOk,
					saidaOk && escala.presenca?.saida_timestamp
						? new Date(escala.presenca.saida_timestamp).toLocaleString('pt-BR', {
								timeZone: 'America/Sao_Paulo'
							})
						: '',
					!horarioSaidaLiberado
						? `Disponível às ${escala.horarioPrevisto?.fim ?? '—'}`
						: !relatorioOk
							? 'Depende do relatório'
							: 'Aguardando confirmação',
					'surface'
				)}
				{#if saidaOk}
					<div class="mt-auto flex pt-1">{@render btnBaixarComprovante('saida')}</div>
				{/if}
			</div>
		</div>

		<div class="pt-2">
			<button
				type="button"
				class="btn btn-sm text-surface-600 hover:text-primary-500 transition-colors w-full"
				onclick={voltarParaLista}
			>
				← Voltar para lista de escalas
			</button>
		</div>
	</div>

	<!--
		Modais das três tarefas.

		O `<Portal>` NÃO É OPCIONAL aqui, e a razão não é óbvia: este componente
		vive dentro do painel 2 do slider de `+page.svelte`, cujo trilho tem
		`transform: translateX(-50%)`. Um `transform` diferente de `none` faz o
		elemento virar CONTAINING BLOCK dos descendentes `position: fixed` — então
		o `inset-0` do `Dialog.Content` passaria a se referir ao trilho (200% de
		largura, deslocado meia tela) e não à viewport, e o `overflow-hidden` do
		wrapper ainda recortaria o que sobrasse. Medido em Chromium: um `fixed
		inset-0` ali dentro rende `left:-648 · 2304×18px` num viewport de
		1920×900. O `Portal` monta o conteúdo em `document.body`, fora do trilho,
		preservando o contexto do Svelte (é assim que o `IconTooltip` e o popover
		da `TabelaEscalas` já fazem).

		A mesma armadilha existe com `contain: layout` (que `container-type`
		implica) — por isso este arquivo também não usa `@container`.

		`z-50` é o degrau de modal da escala do README; o pad de rubrica e o
		cadastro de rubrica (no `+page.svelte`) são `z-[60]`/`z-[70]` e abrem POR
		CIMA destes — empilhamento correto, já que a rubrica é o passo seguinte de
		dentro da confirmação.

		Não foram extraídos para componentes: os três dependem de `resGise`,
		`isMobile`, `restringirSmartphone`, `minhaRubrica`, dos painéis A3 e do
		snippet `blocoRestritoDesktop` — a extração custaria mais props do que
		poupa marcação (corolário do CLAUDE.md sobre quando NÃO extrair).
	-->
	<Dialog
		open={modalPresenca === 'entrada'}
		onOpenChange={(e) => {
			if (!e.open && !loading.active) modalPresenca = null;
		}}
	>
		<Portal>
			<Dialog.Content
				class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
			>
				<div
					class="card p-4 sm:p-6 max-w-md w-full max-h-[calc(100dvh-2rem)] overflow-y-auto card-elevated shadow-2xl rounded-2xl space-y-5"
				>
					<div class="space-y-1">
						<Dialog.Title class="text-lg font-bold">Confirmação de Entrada</Dialog.Title>
						<Dialog.Description class="text-sm text-surface-600 dark:text-surface-400">
							Confirme sua entrada no serviço com uma rubrica para liberar o formulário de
							produtividade.
						</Dialog.Description>
					</div>

					{#if isMobile || !restringirSmartphone}
						{@render actionButton(
							'Confirmar Entrada',
							undefined,
							'primary',
							'filled',
							() => (resGise.capturandoRubrica = true),
							false,
							false,
							'w-full py-4 text-lg shadow-xl shadow-primary-500/20'
						)}
					{:else}
						{@render blocoRestritoDesktop('entrada')}
					{/if}

					<div class="flex justify-end">
						{@render actionButton(
							'Fechar',
							undefined,
							'surface',
							'outlined',
							() => (modalPresenca = null),
							false,
							false,
							'px-6'
						)}
					</div>
				</div>
			</Dialog.Content>
		</Portal>
	</Dialog>

	<Dialog
		open={modalPresenca === 'saida'}
		onOpenChange={(e) => {
			if (!e.open && !loading.active) modalPresenca = null;
		}}
	>
		<Portal>
			<Dialog.Content
				class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
			>
				<div
					class="card p-4 sm:p-6 max-w-md w-full max-h-[calc(100dvh-2rem)] overflow-y-auto card-elevated shadow-2xl rounded-2xl space-y-5"
				>
					<div class="space-y-1">
						<Dialog.Title class="text-lg font-bold">Término do Plantão</Dialog.Title>
						<Dialog.Description class="text-sm text-surface-600 dark:text-surface-400">
							Confirme sua saída do serviço com uma rubrica.
						</Dialog.Description>
					</div>

					{#if !relatorioOk}
						<div
							class="p-3 bg-warning-500/10 border border-warning-500/20 rounded-xl flex items-start gap-3"
						>
							{@render btnIcon(
								'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'
							)}
							<p class="text-3xs text-warning-700 dark:text-warning-400">
								Você deve preencher e enviar o <strong>Relatório de Produtividade</strong>
								(resultados do serviço) antes de confirmar a saída.
							</p>
						</div>
					{:else if isMobile || !restringirSmartphone}
						{@render actionButton(
							'Confirmar Saída',
							undefined,
							'primary',
							'filled',
							() => (resGise.capturandoRubrica = true),
							false,
							false,
							'w-full py-4 text-lg shadow-xl shadow-primary-500/20'
						)}
					{:else}
						{@render blocoRestritoDesktop('saida')}
					{/if}

					<div class="flex justify-end">
						{@render actionButton(
							'Fechar',
							undefined,
							'surface',
							'outlined',
							() => (modalPresenca = null),
							false,
							false,
							'px-6'
						)}
					</div>
				</div>
			</Dialog.Content>
		</Portal>
	</Dialog>
{/if}
