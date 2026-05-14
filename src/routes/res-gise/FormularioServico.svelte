<script lang="ts">
	import { enhance } from '$app/forms';
	import RelatorioProdutividade from './RelatorioProdutividade.svelte';
	import { loading } from '$lib/loading.svelte';
	import type { useResGise } from './useResGise.svelte';

	type ResGise = ReturnType<typeof useResGise>;

	let {
		resGise,
		isAdminGeral,
		isMobile,
		restringirSmartphone,
		voltarParaLista
	}: {
		resGise: ResGise;
		isAdminGeral: boolean;
		isMobile: boolean;
		restringirSmartphone: boolean;
		voltarParaLista: () => void;
	} = $props();
</script>

{#snippet statusBadge(status: string)}
	{@const config: Record<string, { label: string; class: string }> = {
		ativas: { label: 'Em Andamento', class: 'preset-filled-primary-500' },
		finalizadas: { label: 'Finalizada', class: 'preset-filled-success-500' },
		pendentes: { label: 'Pendente', class: 'preset-filled-warning-500' }
	}}
	{@const item = config[status] || { label: status, class: 'preset-tonal-surface' }}
	<span class="badge {item.class} text-[0.6rem] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shadow-sm">
		{item.label}
	</span>
{/snippet}

{#snippet btnIcon(path: string)}
	<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
		<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d={path} />
	</svg>
{/snippet}

{#snippet actionButton(label: string, iconPath?: string, variant = 'primary', type = 'outlined', onclick?: any, disabled = false, loadingState = false, classes = '', btnType: 'button' | 'submit' = 'button', size = 'sm')}
	{@const baseClass = `btn btn-${size} preset-${type}-${variant}-500 rounded-xl font-bold whitespace-nowrap transition-all flex items-center justify-center gap-2 ${classes}`}
	<button
		type={btnType}
		class={baseClass}
		{onclick}
		disabled={disabled || loading.active || loadingState}
	>
		{#if iconPath}{@render btnIcon(iconPath)}{/if}
		<span>{loading.active && loadingState ? 'Carregando...' : label}</span>
	</button>
{/snippet}

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
					class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold {resGise.escalaSelecionada
						.presenca?.entrada_timestamp
						? 'bg-success-500 text-white'
						: 'bg-primary-500 text-white shadow-lg shadow-primary-500/30'}"
				>
					{#if resGise.escalaSelecionada.presenca?.entrada_timestamp}✓{:else}1{/if}
				</div>
				<span
					class="text-[0.6rem] font-bold uppercase tracking-wider {resGise.escalaSelecionada
						.presenca?.entrada_timestamp
						? 'text-success-600'
						: 'text-primary-500'}">Entrada</span
				>
			</div>
			<div class="flex-1 h-px bg-surface-200 dark:border-surface-800 mx-2 -mt-4"></div>
			<div class="flex flex-col items-center gap-1">
				<div
					class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold {resGise.escalaSelecionada.equipeRespondida
						? 'bg-success-500 text-white'
						: resGise.escalaSelecionada.presenca?.entrada_timestamp
							? 'bg-primary-500 text-white'
							: 'bg-surface-200 text-surface-400'}"
				>
					{#if resGise.escalaSelecionada.equipeRespondida}✓{:else}2{/if}
				</div>
				<span
					class="text-[0.6rem] font-bold uppercase tracking-wider {resGise.escalaSelecionada.equipeRespondida
						? 'text-success-600'
						: 'text-surface-400'}">Produtividade</span
				>
			</div>
			<div class="flex-1 h-px bg-surface-200 dark:border-surface-800 mx-2 -mt-4"></div>
			<div class="flex flex-col items-center gap-1">
				<div
					class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold {resGise.escalaSelecionada
						.presenca?.saida_timestamp
						? 'bg-success-500 text-white'
						: resGise.escalaSelecionada.equipeRespondida
							? 'bg-primary-500 text-white'
							: 'bg-surface-200 text-surface-400'}"
				>
					{#if resGise.escalaSelecionada.presenca?.saida_timestamp}✓{:else}3{/if}
				</div>
				<span
					class="text-[0.6rem] font-bold uppercase tracking-wider {resGise.escalaSelecionada
						.presenca?.saida_timestamp
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
						O registro de entrada estará disponível às <span
							class="font-bold text-primary-500"
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
					<div class="flex flex-col gap-4 max-w-sm mx-auto">
						<div
							class="bg-error-500/10 border border-error-500/20 p-4 rounded-xl text-center"
						>
							<p
								class="text-[0.85rem] text-error-600 font-bold uppercase tracking-wider mb-1"
							>
								Uso Restrito a Smartphone
							</p>
							<p class="text-[0.8rem] text-error-700/80">
								O registro de entrada requer geolocalização e câmera do celular. Por favor,
								acesse via dispositivo móvel.
							</p>
						</div>
					</div>
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
							<svg
								class="w-4 h-4 text-white"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
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
							<p class="text-[0.65rem] text-success-600 dark:text-success-500">
								{new Date(resGise.escalaSelecionada.presenca.entrada_timestamp).toLocaleString(
									'pt-BR'
								)}
							</p>
						</div>
					</div>
				</div>

				<!-- Formulário de produtividade (só equipes operacionais / SEINT com relatório) -->
				{#if resGise.escalaSelecionada.equipe_tipo !== 'assessor' && resGise.escalaSelecionada.equipe_tipo !== 'supervisor'}
				<div class="space-y-4 pt-4 border-t border-surface-200 dark:border-surface-800">
					<div class="flex items-center justify-between">
						<h3 class="font-bold uppercase text-sm tracking-wider">
							Resultados do Serviço
						</h3>
						{#if resGise.escalaSelecionada.equipeRespondida}
							{@render statusBadge('finalizadas')}
						{/if}
					</div>

					{#if loading.active}
						<div class="flex flex-col items-center gap-3 py-12">
							<svg class="w-8 h-8 text-primary-500 animate-spin" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
							</svg>
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
									</div>
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
								</div>
							{:else}
								{#if resGise.escalaSelecionada.equipeRespondida && !Object.keys(resGise.respostas).length}
									<div class="p-3 bg-primary-500/5 border border-primary-500/10 rounded-xl">
										<p class="text-[0.65rem] text-primary-600 dark:text-primary-400 italic">
											Um integrante da equipe já respondeu. Você pode visualizar ou
											retificar os dados abaixo.
										</p>
									</div>
								{/if}

								<div class="animate-in fade-in slide-in-from-top-4 duration-500">
									<RelatorioProdutividade modelo={resGise.perguntasForm} bind:respostas={resGise.respostas} />
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
									<form method="POST" action="?/salvarResposta" use:enhance={resGise.handleSalvarResposta(isAdminGeral)} class="contents">
										<input type="hidden" name="giseId" value={resGise.escalaSelecionada?.id} />
										{#if resGise.escalaSelecionada?.equipe_id}
											<input type="hidden" name="equipeId" value={resGise.escalaSelecionada.equipe_id} />
										{/if}
										<input type="hidden" name="respostas" value={resGise.respostasJson} />

										{@render actionButton(
											loading.active ? 'Processando...' : (resGise.escalaSelecionada.equipeRespondida ? 'Salvar Alterações' : 'Finalizar Entrega'),
											undefined,
											'primary',
											'filled',
											undefined,
											loading.active,
											false,
											'flex-1 py-4 text-lg shadow-xl shadow-primary-500/20',
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
				<div
					class="space-y-10 pt-8 border-t border-surface-200 dark:border-surface-800 p-4 sm:p-6"
				>
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
								{@render btnIcon('M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z')}
								<p class="text-[0.65rem] text-warning-700 dark:text-warning-400">
									Você deve preencher e enviar o <strong>Relatório de Produtividade</strong> (resultados
									do serviço) antes de confirmar a saída.
								</p>
							</div>
							{@render actionButton('Confirmar Saída', undefined, 'surface', 'outlined', undefined, true, false, 'w-full py-4 text-lg bg-surface-200 dark:bg-surface-800 text-surface-500 dark:text-surface-400 border-2 border-surface-300 dark:border-surface-700 cursor-not-allowed')}
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
							<div class="flex flex-col gap-3">
								<div
									class="bg-error-500/10 border border-error-500/20 p-3 rounded-xl text-center"
								>
									<p
										class="text-[0.85rem] text-error-600 font-bold uppercase tracking-wider mb-1"
									>
										Uso Restrito a Smartphone
									</p>
									<p class="text-[0.8rem] text-error-700/80">
										Requer câmera e GPS de um celular para concluir a saída.
									</p>
								</div>
							</div>
						{/if}
					{:else}
						<div
							class="flex items-center gap-3 p-4 bg-surface-500/10 border border-surface-500/20 rounded-2xl"
						>
							<div class="bg-surface-500 p-2 rounded-full">
								{@render btnIcon('M5 13l4 4L19 7')}
							</div>
							<div>
								<p
									class="text-xs font-bold text-surface-700 dark:text-surface-400 uppercase"
								>
									Saída Confirmada
								</p>
								<p class="text-[0.65rem] text-surface-600 dark:text-surface-500">
									{new Date(resGise.escalaSelecionada.presenca.saida_timestamp).toLocaleString(
										'pt-BR'
									)}
								</p>
							</div>
						</div>
					{/if}
				</div>

				<div class="pt-6">
					<button type="button"
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
