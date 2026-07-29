<script lang="ts">
	/**
	 * O card de UMA ESCALA GISE na tela do policial (`/res-gise`) — onde ele faz
	 * as três coisas que lhe cabem, na ordem em que o serviço acontece:
	 *
	 *   confirmar ENTRADA → confirmar SAÍDA → enviar o RELATÓRIO de produtividade
	 *
	 * Cada passo só aparece quando o anterior está cumprido, e todos são
	 * assinatura avançada: exigem rubrica e, conforme as flags, foto, GPS e código
	 * por e-mail. A tela esconde o que não cabe, mas quem valida é o servidor —
	 * `/res-gise/+page.server.ts` revalida participação e horário em cada action.
	 *
	 * O estado e as chamadas vivem em `useResGise`; este componente é a
	 * apresentação de um item da lista. O formulário de produtividade em si é o
	 * `RelatorioProdutividade`, montado a partir do modelo salvo — as perguntas
	 * não são fixas.
	 */
	import { enhance } from '$app/forms';
	import { actionButton, btnIcon } from './BotoesAcao.svelte';
	import { page } from '$app/state';
	import RelatorioProdutividade from './RelatorioProdutividade.svelte';
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

{#snippet statusBadge(status: string)}
	{@const config: Record<string, { label: string; class: string }> = {
		ativas: { label: 'Em Andamento', class: 'preset-filled-primary-500' },
		finalizadas: { label: 'Finalizada', class: 'preset-filled-success-500' },
		pendentes: { label: 'Pendente', class: 'preset-filled-warning-500' }
	}}
	{@const item = config[status] || { label: status, class: 'preset-tonal-surface' }}
	<span
		class="badge {item.class} text-3xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shadow-sm"
	>
		{item.label}
	</span>
{/snippet}

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

{#if resGise.escalaSelecionada}
	<div class="space-y-6">
		<div class="border-b border-surface-200 dark:border-surface-800 pb-4">
			<h2 class="text-xl font-bold">Relatório de Serviço</h2>
			<p class="text-xs text-primary-500 font-medium">
				Data: {resGise.fmtDate(resGise.escalaSelecionada.data_inicio)}
			</p>
		</div>

		<!-- Stepper Visual -->
		<div class="flex items-center justify-between px-2 sm:px-4 mb-4">
			<div class="flex flex-col items-center gap-1 group">
				<div
					class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold {resGise
						.escalaSelecionada.presenca?.entrada_timestamp
						? 'bg-success-500 text-white'
						: 'bg-primary-500 text-white shadow-lg shadow-primary-500/30'}"
				>
					{#if resGise.escalaSelecionada.presenca?.entrada_timestamp}✓{:else}1{/if}
				</div>
				<span
					class="text-3xs font-bold uppercase tracking-wider {resGise.escalaSelecionada.presenca
						?.entrada_timestamp
						? 'text-success-600'
						: 'text-primary-500'}">Entrada</span
				>
			</div>
			<div class="flex-1 h-px bg-surface-200 dark:border-surface-800 mx-2 -mt-4"></div>
			<div class="flex flex-col items-center gap-1">
				<div
					class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold {resGise
						.escalaSelecionada.equipeRespondida
						? 'bg-success-500 text-white'
						: resGise.escalaSelecionada.presenca?.entrada_timestamp
							? 'bg-primary-500 text-white'
							: 'bg-surface-200 text-surface-400'}"
				>
					{#if resGise.escalaSelecionada.equipeRespondida}✓{:else}2{/if}
				</div>
				<span
					class="text-3xs font-bold uppercase tracking-wider {resGise.escalaSelecionada
						.equipeRespondida
						? 'text-success-600'
						: 'text-surface-400'}">Produtividade</span
				>
			</div>
			<div class="flex-1 h-px bg-surface-200 dark:border-surface-800 mx-2 -mt-4"></div>
			<div class="flex flex-col items-center gap-1">
				<div
					class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold {resGise
						.escalaSelecionada.presenca?.saida_timestamp
						? 'bg-success-500 text-white'
						: resGise.escalaSelecionada.equipeRespondida
							? 'bg-primary-500 text-white'
							: 'bg-surface-200 text-surface-400'}"
				>
					{#if resGise.escalaSelecionada.presenca?.saida_timestamp}✓{:else}3{/if}
				</div>
				<span
					class="text-3xs font-bold uppercase tracking-wider {resGise.escalaSelecionada.presenca
						?.saida_timestamp
						? 'text-success-600'
						: 'text-surface-400'}">Saída</span
				>
			</div>
		</div>

		{#if !resGise.isHorarioLiberado(resGise.escalaSelecionada, isAdminGeral)}
			<div class="p-4 sm:p-6 text-center space-y-4">
				<div
					class="bg-primary-500/10 p-4 rounded-full w-16 h-16 mx-auto flex items-center justify-center"
				>
					<svg
						class="w-8 h-8 text-primary-500"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
						/></svg
					>
				</div>
				<div>
					<h3 class="font-bold text-lg">Horário não atingido</h3>
					<p class="text-sm text-surface-500">
						O registro de entrada estará disponível às <span class="font-bold text-primary-500"
							>{resGise.escalaSelecionada.horarioPrevisto?.inicio ?? '—'}</span
						>.
					</p>
				</div>
			</div>
		{:else if !resGise.escalaSelecionada.presenca?.entrada_timestamp}
			<div class="p-4 sm:p-6 space-y-10">
				<div class="space-y-2">
					<h3 class="font-bold uppercase text-sm tracking-wider">Confirmação de Entrada</h3>
					<p class="text-xs text-surface-500">
						Confirme sua entrada no serviço com uma rubrica para liberar o formulário de
						produtividade.
					</p>
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
			</div>
		{:else}
			<!-- Fluxo Pós-Entrada -->
			<div class="space-y-8">
				<!-- Entrada Info -->
				<div
					class="flex items-center justify-between p-4 bg-success-500/10 border border-success-500/20 rounded-2xl"
				>
					<div class="flex items-center gap-3">
						<div class="bg-success-500 p-2 rounded-full">
							<svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M5 13l4 4L19 7"
								/></svg
							>
						</div>
						<div>
							<p class="text-xs font-bold text-success-700 dark:text-success-400 uppercase">
								Entrada Confirmada
							</p>
							<p class="text-3xs text-success-600 dark:text-success-500">
								{new Date(resGise.escalaSelecionada.presenca.entrada_timestamp).toLocaleString(
									'pt-BR',
									{ timeZone: 'America/Sao_Paulo' }
								)}
							</p>
						</div>
					</div>
					{@render btnBaixarComprovante('entrada')}
				</div>

				<!-- Formulário de produtividade (só equipes operacionais / SEINT com relatório) -->
				{#if resGise.escalaSelecionada.equipe_tipo !== 'assessor' && resGise.escalaSelecionada.equipe_tipo !== 'supervisor'}
					<div class="space-y-4 pt-4 border-t border-surface-200 dark:border-surface-800">
						<div class="flex items-center justify-between">
							<h3 class="font-bold uppercase text-sm tracking-wider">Resultados do Serviço</h3>
							{#if resGise.escalaSelecionada.equipeRespondida}
								{@render statusBadge('finalizadas')}
							{/if}
						</div>

						{#if loading.active}
							<div class="flex flex-col items-center gap-3 py-12">
								<Spinner size="lg" class="text-primary-500" />
								<p class="text-sm font-semibold text-surface-500 uppercase tracking-wider">
									{loading.message}
								</p>
							</div>
						{:else}
							<div class="space-y-5">
								{#if resGise.escalaSelecionada.equipeRespondida && !resGise.exibirRelatorio}
									<div
										class="p-4 sm:p-6 bg-success-500/5 border border-success-500/20 rounded-3xl text-center space-y-4 animate-in fade-in zoom-in-95 duration-500"
									>
										<div
											class="bg-success-500/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto"
										>
											{@render btnIcon('M5 13l4 4L19 7')}
										</div>
										<div>
											<p class="font-bold text-success-700 dark:text-success-400">
												Relatório Entregue
											</p>
											<p class="text-xs text-success-600 dark:text-success-500">
												Os dados de produtividade foram registrados com sucesso.
											</p>
											{#if resGise.respostaEnviadaEm}
												<div
													class="mt-2 text-3xs text-success-700/80 dark:text-success-500/90 space-y-0.5 tabular-nums"
												>
													<p>
														Enviado em
														<span class="font-bold">{fmtDataHora(resGise.respostaEnviadaEm)}</span>
													</p>
													{#if houveRetificacao}
														<p>
															Última atualização em
															<span class="font-bold"
																>{fmtDataHora(resGise.respostaAtualizadaEm)}</span
															>
														</p>
													{/if}
												</div>
											{/if}
										</div>
										<div class="flex flex-col gap-2">
											{@render actionButton(
												'Atualizar / Retificar Dados',
												undefined,
												'primary',
												'outlined',
												() => (resGise.exibirRelatorio = true),
												false,
												false,
												'w-full py-2 text-xs uppercase'
											)}
											{#if resGise.escalaSelecionada.seccional_id !== 0}
												<button
													type="button"
													class="btn btn-sm preset-tonal-surface-500 rounded-lg text-3xs font-bold uppercase flex items-center justify-center gap-1.5 w-full"
													title="Baixar relatório de produtividade em PDF"
													onclick={() => resGise.baixarRelatorio(resGise.escalaSelecionada!)}
													disabled={loading.active ||
														resGise.baixandoProdutividade === resGise.escalaSelecionada.id}
												>
													{#if resGise.baixandoProdutividade === resGise.escalaSelecionada.id}
														<Spinner size="sm" />
													{:else}
														{@render btnIcon(
															'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4'
														)}
													{/if}
													<span>Baixar relatório</span>
												</button>
											{/if}
										</div>
									</div>
								{:else}
									{#if resGise.escalaSelecionada.equipeRespondida && !Object.keys(resGise.respostas).length}
										<div class="p-3 bg-primary-500/5 border border-primary-500/10 rounded-xl">
											<p class="text-3xs text-primary-600 dark:text-primary-400 italic">
												Um integrante da equipe já respondeu. Você pode visualizar ou retificar os
												dados abaixo.
											</p>
										</div>
									{/if}

									<div class="animate-in fade-in slide-in-from-top-4 duration-500">
										<RelatorioProdutividade
											modelo={resGise.perguntasForm}
											bind:respostas={resGise.respostas}
										/>
									</div>

									<div class="flex gap-3">
										{#if resGise.escalaSelecionada.equipeRespondida}
											{@render actionButton(
												'Cancelar',
												undefined,
												'surface',
												'tonal',
												() => (resGise.exibirRelatorio = false),
												false,
												false,
												'px-6'
											)}
										{/if}
										<form
											method="POST"
											action="?/salvarResposta"
											use:enhance={resGise.handleSalvarResposta(isAdminGeral)}
											class="contents"
										>
											<input type="hidden" name="giseId" value={resGise.escalaSelecionada?.id} />
											{#if resGise.escalaSelecionada?.equipe_id}
												<input
													type="hidden"
													name="equipeId"
													value={resGise.escalaSelecionada.equipe_id}
												/>
											{/if}
											<input type="hidden" name="respostas" value={resGise.respostasJson} />

											{@render actionButton(
												loading.active
													? 'Processando...'
													: resGise.escalaSelecionada.equipeRespondida
														? 'Salvar Alterações'
														: 'Finalizar Entrega',
												undefined,
												'primary',
												'filled',
												undefined,
												loading.active,
												false,
												'flex-1 shadow-sm',
												'submit'
											)}
										</form>
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/if}

				<!-- Saída -->
				<div class="space-y-10 pt-8 border-t border-surface-200 dark:border-surface-800 p-4 sm:p-6">
					<h3 class="font-bold uppercase text-sm tracking-wider">Término do Plantão</h3>

					{#if !resGise.escalaSelecionada.presenca?.saida_timestamp}
						{#if !resGise.isSaidaLiberada(resGise.escalaSelecionada, isAdminGeral)}
							<div class="p-4 sm:p-6 text-center space-y-4">
								<div
									class="bg-primary-500/10 p-4 rounded-full w-16 h-16 mx-auto flex items-center justify-center"
								>
									<svg
										class="w-8 h-8 text-primary-500"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										><path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
										/></svg
									>
								</div>
								<div>
									<h3 class="font-bold text-lg">Saída ainda não disponível</h3>
									<p class="text-sm text-surface-500">
										A confirmação de saída estará disponível às <span
											class="font-bold text-primary-500"
											>{resGise.escalaSelecionada.horarioPrevisto?.fim ?? '—'}</span
										>.
									</p>
								</div>
							</div>
						{:else if !resGise.escalaSelecionada.equipeRespondida}
							<div
								class="p-3 bg-warning-500/10 border border-warning-500/20 rounded-xl flex items-start gap-3"
							>
								{@render btnIcon(
									'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'
								)}
								<p class="text-3xs text-warning-700 dark:text-warning-400">
									Você deve preencher e enviar o <strong>Relatório de Produtividade</strong> (resultados
									do serviço) antes de confirmar a saída.
								</p>
							</div>
							{@render actionButton(
								'Confirmar Saída',
								undefined,
								'surface',
								'outlined',
								undefined,
								true,
								false,
								'w-full py-4 text-lg bg-surface-200 dark:bg-surface-800 text-surface-500 dark:text-surface-400 border-2 border-surface-300 dark:border-surface-700 cursor-not-allowed'
							)}
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
					{:else}
						<div
							class="flex items-center gap-3 p-4 bg-surface-500/10 border border-surface-500/20 rounded-2xl"
						>
							<div class="bg-surface-500 p-2 rounded-full">
								{@render btnIcon('M5 13l4 4L19 7')}
							</div>
							<div>
								<p class="text-xs font-bold text-surface-700 dark:text-surface-400 uppercase">
									Saída Confirmada
								</p>
								<p class="text-3xs text-surface-600 dark:text-surface-500">
									{new Date(resGise.escalaSelecionada.presenca.saida_timestamp).toLocaleString(
										'pt-BR',
										{ timeZone: 'America/Sao_Paulo' }
									)}
								</p>
							</div>
							{@render btnBaixarComprovante('saida')}
						</div>
					{/if}
				</div>

				<div class="pt-6">
					<button
						type="button"
						class="btn btn-sm text-surface-500 hover:text-primary-500 transition-colors w-full"
						onclick={voltarParaLista}
					>
						← Voltar para lista de escalas
					</button>
				</div>
			</div>
		{/if}
	</div>
{/if}
