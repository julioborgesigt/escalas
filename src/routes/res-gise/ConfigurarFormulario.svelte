<script lang="ts">
	import { enhance } from '$app/forms';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import { loading } from '$lib/loading.svelte';
	import type { useResGise } from './useResGise.svelte';
	import type { GiseModeloPerguntaConfig } from '$lib/types';

	type ResGise = ReturnType<typeof useResGise>;

	const {
		resGise,
		modeloPadraoOperacional,
		modeloPadraoSeint
	}: {
		resGise: ResGise;
		modeloPadraoOperacional: GiseModeloPerguntaConfig[];
		modeloPadraoSeint: GiseModeloPerguntaConfig[];
	} = $props();

	let dialogRestaurarAberto = $state(false);

	function solicitarRestaurarPadrao() {
		dialogRestaurarAberto = true;
	}

	function confirmarRestaurarPadrao() {
		dialogRestaurarAberto = false;
		const padrao = resGise.configTipo === 'seint' ? modeloPadraoSeint : modeloPadraoOperacional;
		resGise.perguntasConfig = structuredClone(padrao);
	}
</script>

{#snippet btnIcon(path: string)}
	<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
		<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d={path} />
	</svg>
{/snippet}

{#snippet actionButton(
	label: string,
	iconPath?: string,
	variant = 'primary',
	type = 'outlined',
	onclick?: ((e: MouseEvent) => void) | undefined,
	disabled = false,
	loadingState = false,
	classes = '',
	btnType: 'button' | 'submit' = 'button',
	size = 'sm'
)}
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

<section
	class="card p-4 sm:p-6 md:p-8 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-3xl shadow-xl space-y-6 sm:space-y-8 animate-in fade-in zoom-in-95 duration-500"
>
	<div
		class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-surface-200 dark:border-surface-800 pb-6"
	>
		<div class="w-full sm:w-auto">
			<h2 class="text-xl sm:text-2xl font-black uppercase tracking-tight">Configurar Formulário</h2>
			<p class="text-sm text-surface-500 mt-1">
				Defina os textos e campos do relatório de produtividade oficial.
			</p>

			<div
				class="flex gap-2 mt-4 bg-surface-100 dark:bg-surface-800 p-1 rounded-xl w-full sm:w-fit"
			>
				<button
					type="button"
					class="flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-bold transition-all {resGise.configTipo ===
					'operacional'
						? 'bg-white dark:bg-surface-700 shadow text-primary-600'
						: 'text-surface-500'}"
					onclick={() => (resGise.configTipo = 'operacional')}>Operacional</button
				>
				<button
					type="button"
					class="flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-bold transition-all {resGise.configTipo ===
					'seint'
						? 'bg-white dark:bg-surface-700 shadow text-primary-600'
						: 'text-surface-500'}"
					onclick={() => (resGise.configTipo = 'seint')}>SEINT (Inteligência)</button
				>
			</div>
		</div>
		<div class="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
			{@render actionButton(
				'Restaurar Padrão',
				undefined,
				'surface',
				'outlined',
				solicitarRestaurarPadrao,
				false,
				false,
				'w-full sm:w-auto sm:flex-none px-4 py-2.5 text-xs'
			)}

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

	<div class="grid grid-cols-1 gap-4">
		{#snippet renderItem(p: GiseModeloPerguntaConfig, level = 0)}
			<div
				class="group p-3 sm:p-5 bg-surface-50 dark:bg-surface-950/40 rounded-2xl border border-surface-200 dark:border-surface-800 transition-all hover:border-primary-500/50 hover:shadow-lg"
				style="margin-left: clamp(0px, {level * 1.5}vw, {level * 2}rem)"
			>
				<div class="flex flex-col md:flex-row gap-3 sm:gap-5 items-start">
					<div
						class="w-8 h-8 flex items-center justify-center rounded-lg bg-surface-200 dark:bg-surface-800 text-[0.6rem] font-black text-surface-500 shrink-0"
					>
						{#if level > 0}↳{:else}{resGise.perguntasConfig.indexOf(p) + 1}{/if}
					</div>

					<div class="space-y-1.5 flex-1 w-full min-w-0">
						<div class="flex items-center justify-between pl-1 gap-2 flex-wrap mb-1">
							<label
								for="qtxt-{p.id}"
								class="text-[0.6rem] font-black text-surface-400 uppercase tracking-widest"
								>Texto da Pergunta</label
							>
							{#if p.key?.startsWith('extra_')}
								<span
									class="badge preset-filled-secondary-500 text-[0.55rem] font-black uppercase whitespace-nowrap"
									>CAMPO ADICIONAL</span
								>
							{:else}
								<span
									class="bg-surface-100 dark:bg-surface-800 text-[0.5rem] font-black px-2 py-0.5 rounded-full text-surface-400 uppercase border border-surface-200 dark:border-surface-700 whitespace-nowrap"
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
							class="text-[0.65rem] font-black text-surface-400 uppercase tracking-widest"
							>Tipo do Campo</label
						>
						<select
							id="p-tp-{p.id}"
							bind:value={p.tipo}
							class="w-full px-4 py-3 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-sm font-bold focus:ring-2 focus:ring-primary-500 transition-all shadow-sm"
						>
							<optgroup label="Campos Básicos">
								<option value="texto">Texto Curto</option>
								<option value="textarea">Texto Longo</option>
								<option value="numero">Número</option>
								<option value="sim_nao">Sim / Não (Condicional)</option>
								<option value="select_99">Quantitativo (0-99)</option>
							</optgroup>
							<optgroup label="Campos Inteligentes (Sistemáticos)">
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
						{#if p.tipo === 'sim_nao' || p.tipo === 'mandados_maiores' || p.tipo === 'prisoes_maiores' || p.tipo === 'apreensoes_menores' || p.tipo === 'drogas_complex' || p.tipo === 'armas_complex' || p.tipo === 'celulares_complex' || p.tipo === 'analise_complex' || p.tipo === 'relatorios_seint_complex' || p.tipo === 'foragidos_complex' || p.tipo === 'operacoes_seint_complex'}
							<button
								type="button"
								class="p-3 text-primary-500 hover:bg-primary-500/10 rounded-xl transition-all"
								onclick={() => resGise.adicionarSubPergunta(p)}
								title="Adicionar Sub-pergunta (se SIM)"
							>
								<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2.5"
										d="M19 14l-7 7m0 0l-7-7m7 7V3"
									/></svg
								>
							</button>
						{/if}
						<button
							type="button"
							class="p-3 text-error-500 hover:bg-error-500/10 rounded-xl transition-all"
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
				{#if ['mandados_maiores', 'prisoes_maiores', 'apreensoes_menores', 'drogas_complex', 'armas_complex', 'celulares_complex', 'analise_complex', 'relatorios_seint_complex', 'foragidos_complex', 'operacoes_seint_complex'].includes(p.tipo)}
					<div
						class="mt-4 p-4 bg-primary-500/5 dark:bg-primary-500/10 rounded-2xl border border-dashed border-primary-500/30 space-y-4"
					>
						<div class="flex items-center gap-2 mb-2">
							<svg
								class="w-4 h-4 text-primary-500"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
								/></svg
							>
							<span
								class="text-[0.65rem] font-black text-primary-600 dark:text-primary-400 uppercase tracking-widest"
								>Personalizar Rótulos do Campo Inteligente</span
							>
						</div>

						<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
							{#if p.tipo === 'mandados_maiores' || p.tipo === 'prisoes_maiores' || p.tipo === 'apreensoes_menores' || p.tipo === 'celulares_complex' || p.tipo === 'analise_complex' || p.tipo === 'relatorios_seint_complex' || p.tipo === 'foragidos_complex' || p.tipo === 'operacoes_seint_complex'}
								<div class="space-y-1">
									<label
										for="subqtd-{p.id}"
										class="text-[0.6rem] font-bold text-surface-400 uppercase">Quantidade:</label
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
										class="text-[0.6rem] font-bold text-surface-400 uppercase tracking-wider"
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
										class="text-[0.6rem] font-bold text-surface-400 uppercase"
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
										class="text-[0.6rem] font-bold text-surface-400 uppercase"
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
										class="text-[0.6rem] font-bold text-surface-400 uppercase"
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
										class="text-[0.6rem] font-bold text-surface-400 uppercase"
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
					<div class="mt-6 space-y-6 pt-2 border-l-4 border-primary-500/20">
						{#each p.filhos as filho (filho.id)}
							{@render renderItem(filho, level + 1)}
						{/each}
					</div>
				{/if}
			</div>
		{/snippet}

		{#each resGise.perguntasConfig as p (p.id)}
			{@render renderItem(p)}
		{/each}
	</div>

	<div
		class="w-full p-4 sm:p-6 bg-surface-50 dark:bg-surface-950/40 rounded-b-3xl border-t border-surface-200 dark:border-surface-800"
	>
		<form
			method="POST"
			action="?/salvarModelo"
			use:enhance={resGise.handleSalvarModelo}
			class="w-full flex flex-col sm:flex-row items-stretch sm:items-center gap-4"
		>
			<input type="hidden" name="config" value={resGise.configJson} />
			<input type="hidden" name="tipo" value={resGise.configTipo} />

			<div
				class="flex-grow p-4 bg-surface-100 dark:bg-surface-800 rounded-2xl border border-surface-200 dark:border-surface-700"
			>
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
					<p class="text-[0.65rem] font-bold text-surface-900 dark:text-surface-100">
						{loading.active ? 'Salvando alterações...' : 'Pronto para salvar'}
					</p>
				</div>
			</div>

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
				'w-full sm:w-auto py-3.5 text-sm shadow-lg shadow-primary-500/20'
			)}
		</form>
	</div>
</section>

<!-- Diálogo de confirmação para restaurar modelo padrão -->
<Dialog open={dialogRestaurarAberto} onOpenChange={(e) => (dialogRestaurarAberto = e.open)}>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="card p-4 sm:p-6 max-w-sm w-full max-h-[calc(100dvh-2rem)] overflow-y-auto bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10"
		>
			<Dialog.Title class="text-lg font-bold mb-2">Restaurar modelo padrão?</Dialog.Title>
			<Dialog.Description class="text-sm text-surface-600 dark:text-surface-300 mb-6">
				As perguntas do modelo <strong>{resGise.configTipo}</strong> serão substituídas pelo padrão. Essa
				ação não pode ser desfeita.
			</Dialog.Description>
			<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
				<Dialog.CloseTrigger class="btn preset-outlined-surface-500">Cancelar</Dialog.CloseTrigger>
				<button
					type="button"
					class="btn preset-filled-warning-500"
					onclick={confirmarRestaurarPadrao}
				>
					Restaurar
				</button>
			</div>
		</div>
	</Dialog.Content>
</Dialog>
