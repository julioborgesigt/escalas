<script lang="ts">
	import { enhance } from '$app/forms';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import { toaster } from '$lib/toast';
	import RelatorioProdutividade from './RelatorioProdutividade.svelte';
	import SignaturePad from '$lib/components/SignaturePad.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import { useAutorizacao, useMobile } from '$lib/composables';
	import { page } from '$app/state';
	import { useResGise } from './useResGise.svelte';

	let { data } = $props();
	const { isAdmin: isAdminGeral } = useAutorizacao();
	const resGise = useResGise(() => data);
	const mobileState = useMobile();
	const isMobile = $derived(mobileState.isMobile);

	const isSupervisorGise = $derived(data.isSupervisorGise);
	const podeVerListaGeral = $derived(isAdminGeral || isSupervisorGise);
	let escalaSelecionada = $derived(resGise.escalaSelecionada);

	let dialogRestaurarAberto = $state(false);

	function solicitarRestaurarPadrao() {
		dialogRestaurarAberto = true;
	}

	function confirmarRestaurarPadrao() {
		dialogRestaurarAberto = false;
		const padrao = resGise.configTipo === 'seint' ? data.modeloPadraoSeint : data.modeloPadraoOperacional;
		resGise.perguntasConfig = structuredClone(padrao);
	}

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

{#snippet actionButton(label: string, iconPath?: string, variant = 'primary', type = 'outlined', onclick?: any, disabled = false, loading = false, classes = '', btnType: 'button' | 'submit' = 'button', size = 'sm')}
	{@const baseClass = `btn btn-${size} preset-${type}-${variant}-500 rounded-xl font-bold whitespace-nowrap transition-all flex items-center justify-center gap-2 ${classes}`}
	<button
		type={btnType}
		class={baseClass}
		{onclick}
		disabled={disabled || loading}
	>
		{#if loading}
			<Spinner size="sm" />
		{:else}
			{#if iconPath}{@render btnIcon(iconPath)}{/if}
			<span>{label}</span>
		{/if}
	</button>
{/snippet}


<svelte:head>
	<title>Relatórios GISE - Portal de Escalas</title>
</svelte:head>

<div class="space-y-6">
	<header class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
		<div>
			<h1
				class="text-2xl sm:text-4xl font-black text-surface-900 dark:text-surface-50 uppercase tracking-tighter"
			>
				Relatórios GISE
			</h1>
			<p class="text-surface-500 font-medium">Gestão de produtividade e relatórios operacionais</p>
		</div>

		{#if podeVerListaGeral}
			<div class="bg-surface-100 dark:bg-surface-800 p-1.5 rounded-2xl flex gap-1 shadow-inner">
				<button
					class="px-6 py-2.5 rounded-xl text-sm font-bold transition-all {resGise.activeTab === 'relatorios'
						? 'bg-white dark:bg-surface-700 shadow-md text-primary-600'
						: 'text-surface-500 hover:text-surface-700'}"
					onclick={() => (resGise.activeTab = 'relatorios')}
				>
					Relatórios
				</button>
				{#if isAdminGeral}
					<button
						class="px-6 py-2.5 rounded-xl text-sm font-bold transition-all {resGise.activeTab ===
						'configurador'
							? 'bg-white dark:bg-surface-700 shadow-md text-primary-600'
							: 'text-surface-500 hover:text-surface-700'}"
						onclick={() => (resGise.activeTab = 'configurador')}
					>
						Configurar Form
					</button>
				{/if}
			</div>
		{/if}
	</header>

	{#if isAdminGeral && resGise.activeTab === 'configurador'}
		<section
			class="card p-4 sm:p-8 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-3xl shadow-xl space-y-8 animate-in fade-in zoom-in-95 duration-500"
		>
			<div
				class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-surface-200 dark:border-surface-800 pb-6"
			>
				<div>
					<h2 class="text-xl sm:text-2xl font-black uppercase tracking-tight">
						Configurar Formulário
					</h2>
					<p class="text-sm text-surface-500 mt-1">
						Defina os textos e campos do relatório de produtividade oficial.
					</p>

					<div class="flex gap-2 mt-4 bg-surface-100 dark:bg-surface-800 p-1 rounded-xl w-fit">
						<button
							class="px-4 py-1.5 rounded-lg text-xs font-bold transition-all {resGise.configTipo ===
							'operacional'
								? 'bg-white dark:bg-surface-700 shadow text-primary-600'
								: 'text-surface-500'}"
							onclick={() => (resGise.configTipo = 'operacional')}>Operacional</button
						>
						<button
							class="px-4 py-1.5 rounded-lg text-xs font-bold transition-all {resGise.configTipo === 'seint'
								? 'bg-white dark:bg-surface-700 shadow text-primary-600'
								: 'text-surface-500'}"
							onclick={() => (resGise.configTipo = 'seint')}>SEINT (Inteligência)</button
						>
					</div>
				</div>
				<div class="flex flex-wrap items-center gap-2">
					{@render actionButton(
						'Restaurar Padrão',
						undefined,
						'surface',
						'outlined',
						solicitarRestaurarPadrao,
						false,
						false,
						'px-4 py-2 text-xs'
					)}

					{@render actionButton(
						'Nova Pergunta',
						'M12 4v16m8-8H4',
						'primary',
						'filled',
						resGise.adicionarPergunta,
						false,
						false,
						'px-4 py-2 shadow-lg shadow-primary-500/30'
					)}
				</div>
			</div>

			<div class="grid grid-cols-1 gap-4 max-h-[70vh] overflow-y-auto pr-4 custom-scrollbar">
				{#snippet renderItem(p: any, level = 0)}
					<div
						class="group p-5 bg-surface-50 dark:bg-surface-950/40 rounded-2xl border border-surface-200 dark:border-surface-800 transition-all hover:border-primary-500/50 hover:shadow-lg"
						style="margin-left: {level * 2}rem"
					>
						<div class="flex flex-col md:flex-row gap-5 items-start">
							<div
								class="w-8 h-8 flex items-center justify-center rounded-lg bg-surface-200 dark:bg-surface-800 text-[0.6rem] font-black text-surface-500 shrink-0"
							>
								{#if level > 0}↳{:else}{resGise.perguntasConfig.indexOf(p) + 1}{/if}
							</div>

							<div class="space-y-1.5 flex-1">
								<label
									for="qtxt-{p.id}"
									class="text-[0.6rem] font-black text-surface-400 uppercase tracking-widest pl-1"
									>Texto da Pergunta</label
								>
								<div class="relative">
									<textarea
										id="qtxt-{p.id}"
										bind:value={p.texto}
										rows="2"
										class="w-full px-4 py-3 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-950 text-sm font-bold resize-none"
									></textarea>
									<div class="absolute top-2 right-2 flex gap-2">
										{#if p.key?.startsWith('extra_')}
											<span
												class="badge preset-filled-secondary-500 text-[0.55rem] font-black uppercase"
												>CAMPO ADICIONAL</span
											>
										{:else}
											<span
												class="bg-surface-100 dark:bg-surface-800 text-[0.5rem] font-black px-2 py-0.5 rounded-full text-surface-400 uppercase border border-surface-200 dark:border-surface-700"
												>Campo Sistema</span
											>
										{/if}
									</div>
								</div>
							</div>

							<div class="w-full md:w-56 space-y-1.5 shrink-0">
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
										<option value="relatorios_seint_complex"
											>Relatórios SEINT (Auto-Listagem)</option
										>
										<option value="foragidos_complex">Alvos Foragidos (Auto-Listagem)</option>
										<option value="operacoes_seint_complex">Operações SEINT (Auto-Listagem)</option>
										<option value="operacoes_seint_pura">Operações SEINT (Lista Pura)</option>
									</optgroup>
								</select>
							</div>

							<div class="flex gap-2 shrink-0">
								{#if p.tipo === 'sim_nao' || p.tipo === 'mandados_maiores' || p.tipo === 'prisoes_maiores' || p.tipo === 'apreensoes_menores' || p.tipo === 'drogas_complex' || p.tipo === 'armas_complex' || p.tipo === 'celulares_complex' || p.tipo === 'analise_complex' || p.tipo === 'relatorios_seint_complex' || p.tipo === 'foragidos_complex' || p.tipo === 'operacoes_seint_complex'}
									<button
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
												class="text-[0.6rem] font-bold text-surface-400 uppercase"
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
				class="flex justify-end p-6 bg-surface-50 dark:bg-surface-950/40 rounded-3xl border-t border-surface-200 dark:border-surface-800"
			>
				<form
					method="POST"
					action="?/salvarModelo"
					use:enhance={resGise.handleSalvarModelo}
					class="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 pt-4 border-t border-surface-200 dark:border-surface-800"
				>
					<input type="hidden" name="config" value={resGise.configJson} />
					<input type="hidden" name="tipo" value={resGise.configTipo} />

					<div class="flex-1 p-4 bg-surface-100 dark:bg-surface-800 rounded-2xl border border-surface-200 dark:border-surface-700">
						<p class="text-xs font-bold text-surface-600 dark:text-surface-400 uppercase tracking-widest mb-1">Status da Configuração</p>
						<div class="flex items-center gap-2">
							<div class="w-2 h-2 rounded-full {resGise.salvandoModelo ? 'bg-warning-500 animate-pulse' : 'bg-success-500'}"></div>
							<p class="text-[0.65rem] font-bold text-surface-900 dark:text-surface-100">
								{resGise.salvandoModelo ? 'Salvando alterações...' : 'Pronto para salvar'}
							</p>
						</div>
					</div>

					{@render actionButton(
						resGise.salvandoModelo ? 'Salvando...' : `Salvar Modelo ${resGise.configTipo}`,
						undefined,
						'primary',
						'filled'
					)}
				</form>
			</div>
		</section>
	{:else if podeVerListaGeral && resGise.activeTab === 'relatorios'}
		<div class="grid grid-cols-1 md:grid-cols-4 gap-6">
			<div class="md:col-span-1 space-y-4">
				<div class="flex items-center justify-between px-2">
					<h2 class="text-sm font-bold uppercase tracking-widest text-surface-500">Escalas GISE</h2>
					<span class="badge preset-filled-primary-500 text-[0.6rem]">{data.listaAdmin.length}</span
					>
				</div>

				<div class="space-y-3 px-2 mb-4">
					<div class="space-y-1">
						<label
							for="f-status"
							class="text-[0.6rem] font-black text-surface-400 uppercase tracking-widest"
							>Status da Escala</label
						>
						<select
							id="f-status"
							bind:value={resGise.statusFilterUrl}
							onchange={() => resGise.changeStatusFilter(resGise.statusFilterUrl)}
							class="w-full px-3 py-2 rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900 text-[0.7rem] font-bold outline-none focus:ring-1 focus:ring-primary-500"
						>
							<option value="">-- Selecione Status --</option>
							<option value="ativas">Escalas Ativas</option>
							<option value="finalizadas">Escalas Finalizadas</option>
						</select>
					</div>

					<div class="space-y-1 {resGise.statusFilterUrl ? '' : 'opacity-50 pointer-events-none'}">
						<label
							for="f-sec"
							class="text-[0.6rem] font-black text-surface-400 uppercase tracking-widest"
							>Seccional</label
						>
						<select
							id="f-sec"
							bind:value={resGise.seccionalFilter}
							class="w-full px-3 py-2 rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900 text-[0.7rem] font-bold outline-none focus:ring-1 focus:ring-primary-500"
						>
							{#each resGise.seccionaisDisponiveis as s}
								<option value={s}>{s === 'todas' ? 'Todas Seccionais' : s}</option>
							{/each}
						</select>
					</div>
					<div class="space-y-1">
						<label
							for="f-mes"
							class="text-[0.6rem] font-black text-surface-400 uppercase tracking-widest"
							>Mês/Ano</label
						>
						<input
							id="f-mes"
							type="month"
							value={resGise.mesFilterUrl}
							oninput={(e) => resGise.changeDateFilter('mes', (e.target as HTMLInputElement).value)}
							class="w-full px-3 py-2 rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900 text-[0.7rem] font-bold outline-none focus:ring-1 focus:ring-primary-500"
						/>
					</div>
					<div class="space-y-1">
						<label
							for="f-data"
							class="text-[0.6rem] font-black text-surface-400 uppercase tracking-widest"
							>Data específica</label
						>
						<input
							id="f-data"
							type="date"
							value={resGise.dataFilterUrl}
							oninput={(e) => resGise.changeDateFilter('data', (e.target as HTMLInputElement).value)}
							class="w-full px-3 py-2 rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900 text-[0.7rem] font-bold outline-none focus:ring-1 focus:ring-primary-500"
						/>
					</div>
				</div>

				<div class="space-y-2 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
					{#if !resGise.statusFilterUrl}
						<div
							class="p-6 text-center border-2 border-dashed border-surface-200 dark:border-surface-800 rounded-2xl bg-surface-100/50 dark:bg-surface-900/50"
						>
							<svg
								class="w-8 h-8 text-surface-400 mx-auto mb-2"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
								/></svg
							>
							<p class="text-xs font-bold text-surface-600 dark:text-surface-400 uppercase">
								Selecione o Status
							</p>
							<p class="text-[0.6rem] text-surface-500 mt-1">
								Busque as escalas primeiro pelo seu status de atividade acima.
							</p>
						</div>
					{:else}
						{#each resGise.listaFiltrada as escala}
							<div
								role="button"
								tabindex="0"
								class="w-full text-left p-3 rounded-2xl border transition-all cursor-pointer {resGise.escalaSelecionada?.equipe_id ===
									escala.equipe_id && resGise.escalaSelecionada?.id === escala.id
									? 'border-primary-500 bg-primary-500/10 ring-1 ring-primary-500'
									: 'border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900 hover:border-surface-300'}"
								onclick={() => resGise.selecionarEscala(escala, podeVerListaGeral)}
								onkeydown={(e) => e.key === 'Enter' && resGise.selecionarEscala(escala, podeVerListaGeral)}
							>
								<div class="flex items-start justify-between gap-2">
									<div class="min-w-0">
										<p class="text-xs font-bold text-surface-900 dark:text-surface-100 truncate">
											{escala.seccional_nome}
										</p>
										<p class="text-[0.6rem] text-surface-500 mt-0.5">
											{resGise.fmtDate(escala.data_inicio)}
										</p>
									</div>
									<div class="flex flex-col items-end gap-1">
										<span
											class="text-[0.55rem] px-1.5 py-0.5 rounded font-black uppercase {escala.equipe_tipo ===
											'operacional'
												? 'bg-primary-500/20 text-primary-700'
												: 'bg-surface-500/20 text-surface-700'}">{escala.equipe_tipo}</span
										>
									</div>
								</div>

								<div class="mt-2 flex items-center justify-between">
									<div class="flex items-center gap-1.5">
										<div
											class="w-1.5 h-1.5 rounded-full {escala.equipeRespondida
												? 'bg-success-500'
												: 'bg-warning-500'}"
										></div>
										<p
											class="text-[0.6rem] font-bold {escala.equipeRespondida
												? 'text-success-600'
												: 'text-warning-600'} uppercase"
										>
											{escala.equipeRespondida ? 'Relatório Pronto' : 'Pendente'}
										</p>
									</div>

									<div class="flex items-center gap-1">
										{#if escala.equipeRespondida}
											<button
												class="btn-icon btn-icon-sm bg-primary-500/10 text-primary-600 hover:bg-primary-500 hover:text-white transition-all rounded-lg"
												onclick={(e) => {
													e.stopPropagation();
													resGise.baixarRelatorio(escala);
												}}
												disabled={resGise.baixandoProdutividade === escala.id}
												title="Baixar PDF de Produtividade"
											>
												{#if resGise.baixandoProdutividade === escala.id}
													<Spinner size="sm" />
												{:else}
													<svg
														class="w-3.5 h-3.5"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
														><path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2.5"
															d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
														/></svg
													>
												{/if}
											</button>
										{/if}
										{#if escala.extraAssinado}
											<button
												class="btn-icon btn-icon-sm bg-secondary-500/10 text-secondary-600 hover:bg-secondary-500 hover:text-white transition-all rounded-lg"
												onclick={(e) => {
													e.stopPropagation();
													resGise.baixarRelatorioExtra(escala);
												}}
												disabled={resGise.baixandoExtra === escala.id}
												title="Baixar Relatório Extraordinário (Assinado)"
											>
												{#if resGise.baixandoExtra === escala.id}
													<Spinner size="sm" />
												{:else}
													<svg
														class="w-3.5 h-3.5"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
														><path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2.5"
															d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
														/></svg
													>
												{/if}
											</button>
										{/if}
									</div>
								</div>
							</div>
						{:else}
							<div
								class="p-8 text-center border-2 border-dashed border-surface-200 dark:border-surface-800 rounded-3xl"
							>
								<p class="text-xs text-surface-500 italic">
									Nenhum relatório encontrado para este filtro.
								</p>
							</div>
						{/each}
					{/if}
				</div>
			</div>

			<div class="md:col-span-3">
				{#if resGise.escalaSelecionada}
					<section
						class="card p-4 md:p-6 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-3xl shadow-sm space-y-6"
					>
						<div
							class="flex items-center justify-between border-b border-surface-200 dark:border-surface-800 pb-4"
						>
							<div>
								<h2
									class="text-xl font-black text-surface-900 dark:text-surface-50 uppercase tracking-tight"
								>
									{resGise.escalaSelecionada.seccional_nome}
								</h2>
								<div class="flex items-center gap-2 mt-1">
									<span class="badge preset-filled-primary-500 text-[0.6rem]"
										>{resGise.escalaSelecionada.equipe_tipo}</span
									>
									<span class="text-xs text-surface-500 font-medium"
										>{resGise.fmtDate(resGise.escalaSelecionada.data_inicio)}</span
									>
								</div>
							</div>
						</div>

						{#if resGise.carregandoResposta}
							<div class="flex flex-col items-center justify-center py-24 gap-4">
								<Spinner size="lg" />
								<p class="text-sm font-bold text-surface-500 animate-pulse">CARREGANDO DADOS...</p>
							</div>
						{:else}
							<div class="space-y-6">
								<div
									class="p-4 bg-primary-500/5 border border-primary-500/10 rounded-2xl flex items-center gap-3"
								>
									<div class="bg-primary-500/20 p-2 rounded-lg">
										<svg
											class="w-5 h-5 text-primary-600"
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
									</div>
									<p
										class="text-[0.65rem] md:text-xs font-medium text-primary-700 dark:text-primary-400 leading-relaxed"
									>
										<strong>Modo Supervisor:</strong> Você está visualizando o formulário de produtividade.
										Todas as alterações feitas aqui serão refletidas nos relatórios finais da seccional.
									</p>
								</div>

								<RelatorioProdutividade modelo={resGise.perguntasForm} bind:respostas={resGise.respostas} />

								<div
									class="flex justify-end pt-4 border-t border-surface-200 dark:border-surface-800"
								>
									<form method="POST" action="?/salvarResposta" use:enhance={resGise.handleSalvarResposta(podeVerListaGeral)} class="contents">
										<input type="hidden" name="giseId" value={resGise.escalaSelecionada?.id} />
										{#if resGise.escalaSelecionada?.equipe_id}
											<input type="hidden" name="equipeId" value={resGise.escalaSelecionada.equipe_id} />
										{/if}
										<input type="hidden" name="respostas" value={resGise.respostasJson} />
										
										{@render actionButton(
											resGise.salvandoResposta ? 'Salvando...' : 'Salvar Alterações',
											undefined,
											'primary',
											'filled',
											undefined,
											resGise.salvandoResposta,
											resGise.salvandoResposta,
											'px-12 py-3 text-lg shadow-xl shadow-primary-500/20',
											'submit'
										)}
									</form>
								</div>
							</div>
						{/if}
					</section>
				{:else}
					<div
						class="h-[60vh] flex flex-col items-center justify-center text-center p-12 bg-surface-100/30 dark:bg-surface-900/10 border-2 border-dashed border-surface-200 dark:border-surface-800 rounded-3xl"
					>
						<div class="bg-surface-200 dark:bg-surface-800 p-6 rounded-full mb-6">
							<svg
								class="w-12 h-12 text-surface-400"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2.5"
									d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
								/></svg
							>
						</div>
						<h3 class="text-xl font-bold text-surface-900 dark:text-surface-50 mb-2">
							Selecione um Relatório
						</h3>
						<p class="text-sm text-surface-500 max-w-xs">
							Escolha uma escala e equipe na lista lateral para visualizar ou editar os dados de
							produtividade.
						</p>
					</div>
				{/if}
			</div>
		</div>
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-3 gap-6">
			<!-- Lista de Escalas -->
			<div class="md:col-span-1 space-y-4">
				<div class="px-2 space-y-3">
					<h2 class="text-lg font-bold">Minhas Escalas GISE</h2>

					<!-- Filtro de Status para Policiais -->
					<div
						class="flex p-1 bg-surface-100 dark:bg-surface-800 rounded-xl border border-surface-200 dark:border-surface-700"
					>
						<button
							class="flex-1 py-1.5 text-xs font-bold rounded-lg transition-all {(resGise.statusFilterUrl || 'ativas') === 'ativas'
								? 'bg-white dark:bg-surface-700 shadow-sm text-primary-600 dark:text-primary-400'
								: 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300'}"
							onclick={() => resGise.changeStatusFilter('ativas')}
						>
							Ativas
						</button>
						<button
							class="flex-1 py-1.5 text-xs font-bold rounded-lg transition-all {resGise.statusFilterUrl === 'finalizadas'
								? 'bg-white dark:bg-surface-700 shadow-sm text-primary-600 dark:text-primary-400'
								: 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300'}"
							onclick={() => resGise.changeStatusFilter('finalizadas')}
						>
							Histórico
						</button>
					</div>

					<!-- Busca Detalhada (Apenas no Histórico) -->
					{#if resGise.statusFilterUrl === 'finalizadas'}
						<div
							class="space-y-4 pt-4 border-t border-surface-200 dark:border-surface-800 animate-in fade-in slide-in-from-top-2 duration-300"
						>
							<div class="flex items-center justify-between">
								<span class="text-[0.65rem] font-black text-surface-400 uppercase tracking-widest"
									>Busca Detalhada</span
								>
								{#if resGise.mesFilterUrl || resGise.dataFilterUrl}
									<button
										class="text-[0.65rem] font-bold text-error-500 hover:underline px-2 py-0.5 bg-error-500/10 rounded-md transition-all"
										onclick={resGise.limparFiltros}
									>
										Limpar Filtros
									</button>
								{/if}
							</div>

							<div
								class="flex flex-col gap-4 bg-surface-100/50 dark:bg-surface-800/30 p-4 rounded-2xl border border-surface-200 dark:border-surface-800"
							>
								<div class="space-y-1.5">
									<label
										class="text-[0.6rem] font-black text-surface-500 uppercase tracking-wider ml-1"
										for="mesMember">Por Mês/Ano</label
									>
									<input
										id="mesMember"
										type="month"
										class="block w-full px-4 py-2.5 text-[0.8rem] rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 focus:ring-2 focus:ring-primary-500 transition-all font-bold shadow-sm"
										value={resGise.mesFilterUrl}
										onchange={(e) => resGise.changeDateFilter('mes', e.currentTarget.value)}
									/>
								</div>

								<div class="flex items-center gap-3 px-2">
									<div class="h-px flex-1 bg-surface-300 dark:bg-surface-700"></div>
									<span class="text-[0.65rem] font-black text-surface-400 uppercase tracking-widest"
										>OU</span
									>
									<div class="h-px flex-1 bg-surface-300 dark:bg-surface-700"></div>
								</div>

								<div class="space-y-1.5">
									<label
										class="text-[0.6rem] font-black text-surface-500 uppercase tracking-wider ml-1"
										for="dataMember">Por Data Específica</label
									>
									<input
										id="dataMember"
										type="date"
										class="block w-full px-4 py-2.5 text-[0.8rem] rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 focus:ring-2 focus:ring-primary-500 transition-all font-bold shadow-sm"
										value={resGise.dataFilterUrl}
										onchange={(e) => resGise.changeDateFilter('data', e.currentTarget.value)}
									/>
								</div>
							</div>

							<p class="text-[0.6rem] text-surface-500 italic text-center px-4 leading-tight">
								Selecione apenas um dos campos acima para refinar sua busca no histórico de escalas.
							</p>
						</div>
					{/if}
				</div>
				{#each data.minhasEscalas as escala}
					<div
						role="button"
						tabindex="0"
						class="w-full text-left p-4 rounded-2xl border transition-all cursor-pointer {resGise.escalaSelecionada?.id ===
						escala.id
							? 'border-primary-500 bg-primary-500/10'
							: 'border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900 hover:border-primary-500/50'}"
						onclick={() => resGise.selecionarEscala(escala, podeVerListaGeral)}
						onkeydown={(e) => e.key === 'Enter' && resGise.selecionarEscala(escala, podeVerListaGeral)}
					>
						<div class="flex items-center justify-between">
							<p class="text-sm font-bold text-surface-900 dark:text-surface-100">
								{resGise.fmtDate(escala.data_inicio)}
								<span class="ml-1 opacity-50 font-normal">#{escala.id}</span>
							</p>
							<span class="badge preset-filled-primary-500 text-[0.6rem] uppercase font-bold"
								>{escala.equipe_tipo}</span
							>
						</div>
						<div class="flex items-center justify-between mt-1">
							<p
								class="text-xs uppercase tracking-wider {escala.assinada
									? 'text-success-500 font-bold'
									: 'text-surface-500'}"
							>
								{escala.assinada ? 'SUPERVISOR ASSINOU' : 'AGUARDANDO ASSINATURA DO SUPERVISOR'}
							</p>

							<div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5">
								{#if escala.equipeRespondida}
									{@render actionButton(
										'PRODUTIVIDADE',
										'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4',
										'success',
										'filled',
										(e: any) => {
											e.stopPropagation();
											resGise.baixarRelatorio(escala);
										},
										false,
										resGise.baixandoProdutividade === escala.id,
										'text-[0.6rem] px-3 py-2',
										'button',
										'sm'
									)}
								{/if}
								{#if escala.extraAssinado}
									{@render actionButton(
										'RELAT. EXTRA',
										'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
										'primary',
										'filled',
										(e: any) => {
											e.stopPropagation();
											resGise.baixarRelatorioExtra(escala);
										},
										false,
										resGise.baixandoExtra === escala.id,
										'text-[0.6rem] px-3 py-2',
										'button',
										'sm'
									)}
								{/if}
							</div>
						</div>

						{#if escala.presenca?.saida_timestamp && !escala.extraAssinado}
							<div
								class="mt-2 p-2 bg-surface-100 dark:bg-surface-800 rounded-lg border border-primary-500/20"
							>
								<p
									class="text-[0.6rem] text-primary-600 dark:text-primary-400 font-bold italic text-center leading-tight"
								>
									Relatório de Extraordinário enviado para assinatura do supervisor. Estará
									disponível para download após assinado.
								</p>
							</div>
						{/if}
					</div>
				{:else}
					<p class="text-sm text-surface-500 italic px-2">
						Nenhuma escala gise encontrada para o seu perfil ou você já enviou o relatório.
					</p>
				{/each}
			</div>

			<!-- Formulário de Resposta -->
			<div class="md:col-span-2">
				{#if resGise.escalaSelecionada}
					<section
						class="card p-6 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-3xl shadow-sm space-y-6"
					>
						<div class="border-b border-surface-200 dark:border-surface-800 pb-4">
							<h2 class="text-xl font-bold">Relatório de Serviço</h2>
							<p class="text-xs text-primary-500 font-medium">
								Data: {resGise.fmtDate(resGise.escalaSelecionada.data_inicio)}
							</p>
						</div>

						<!-- Stepper Visual -->
						<div class="flex items-center justify-between px-4 mb-4">
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

						{#if !resGise.isHorarioLiberado(resGise.escalaSelecionada, podeVerListaGeral)}
							<div class="p-8 text-center space-y-4">
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
											>{resGise.escalaSelecionada.horarioPrevisto.inicio}</span
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

								{#if isMobile || !data.restringirSmartphone}
									{@render actionButton(
										'Confirmar Entrada',
										undefined,
										'primary',
										'filled',
										() => (resGise.capturandoRubrica = true),
										false,
										false,
										'px-12 py-4 text-lg shadow-xl shadow-primary-500/20'
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

								<!-- Formulário de Resultados -->
								<div class="space-y-4 pt-4 border-t border-surface-200 dark:border-surface-800">
									<div class="flex items-center justify-between">
										<h3 class="font-bold uppercase text-sm tracking-wider">
											Resultados do Serviço
										</h3>
										{#if resGise.escalaSelecionada.equipeRespondida}
											{@render statusBadge('finalizadas')}
										{/if}
									</div>

									{#if resGise.carregandoResposta}
										<div class="flex justify-center py-12">
											<Spinner size="lg" />
										</div>
									{:else}
										<div class="space-y-5">
											{#if resGise.escalaSelecionada.equipeRespondida && !resGise.exibirRelatorio}
												<div
													class="p-6 bg-success-500/5 border border-success-500/20 rounded-3xl text-center space-y-4 animate-in fade-in zoom-in-95 duration-500"
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
													<form method="POST" action="?/salvarResposta" use:enhance={resGise.handleSalvarResposta(podeVerListaGeral)} class="contents">
														<input type="hidden" name="giseId" value={resGise.escalaSelecionada?.id} />
														{#if resGise.escalaSelecionada?.equipe_id}
															<input type="hidden" name="equipeId" value={resGise.escalaSelecionada.equipe_id} />
														{/if}
														<input type="hidden" name="respostas" value={resGise.respostasJson} />
														
														{@render actionButton(
															resGise.salvandoResposta ? 'Processando...' : (resGise.escalaSelecionada.equipeRespondida ? 'Salvar Alterações' : 'Finalizar Entrega'),
															undefined,
															'primary',
															'filled',
															undefined,
															resGise.salvandoResposta,
															resGise.salvandoResposta,
															'flex-1 py-4 text-lg shadow-xl shadow-primary-500/20',
															'submit'
														)}
													</form>
												</div>
											{/if}
										</div>
									{/if}
								</div>

								<!-- Saída -->
								<div
									class="space-y-10 pt-8 border-t border-surface-200 dark:border-surface-800 p-4 sm:p-6"
								>
									<h3 class="font-bold uppercase text-sm tracking-wider">Término do Plantão</h3>

									{#if !resGise.escalaSelecionada.presenca?.saida_timestamp}
										{#if !resGise.escalaSelecionada.equipeRespondida}
											<div
												class="p-3 bg-warning-500/10 border border-warning-500/20 rounded-xl flex items-start gap-3"
											>
												{@render btnIcon('M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z')}
												<p class="text-[0.65rem] text-warning-700 dark:text-warning-400">
													Você deve preencher e enviar o <strong>Relatório de Produtividade</strong> (resultados
													do serviço) antes de confirmar a saída.
												</p>
											</div>
											{@render actionButton('Confirmar Saída', undefined, 'surface', 'tonal', undefined, true, false, 'w-full py-4 text-lg opacity-50 cursor-not-allowed')}
										{:else if isMobile || !data.restringirSmartphone}
											{@render actionButton(
												'Confirmar Saída',
												undefined,
												'primary',
												'outlined',
												() => (resGise.capturandoRubrica = true),
												false,
												false,
												'w-full py-4 text-lg'
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
									<button
										class="btn btn-sm text-surface-500 hover:text-primary-500 transition-colors w-full"
										onclick={() => (resGise.escalaSelecionada = null)}
									>
										← Voltar para lista de escalas
									</button>
								</div>
							</div>
						{/if}
					</section>
				{:else}
					<div
						class="h-full flex flex-col items-center justify-center text-center p-12 bg-surface-100/30 dark:bg-surface-900/10 border-2 border-dashed border-surface-200 dark:border-surface-800 rounded-3xl"
					>
						<div class="bg-surface-200 dark:bg-surface-800 p-4 rounded-full mb-4">
							<svg
								class="w-8 h-8 text-surface-400"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
								/></svg
							>
						</div>
						<p class="text-surface-500">
							Selecione uma escala à esquerda para preencher o formulário de resultados. Só irá
							aparecer alguma opção, caso o envio esteja pendente.
						</p>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<!-- Modal de Rubrica — Confirmação de Entrada / Saída do Policial -->
{#if resGise.capturandoRubrica && resGise.escalaSelecionada}
	{@const tipoPresenca = !resGise.escalaSelecionada.presenca?.entrada_timestamp ? 'entrada' : 'saida'}
	<div class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
		<div
			class="bg-surface-50 dark:bg-surface-900 rounded-3xl shadow-2xl w-full max-w-2xl p-4 sm:p-8 space-y-6 border border-white/10"
		>
			<div class="text-center space-y-2">
				<h2 class="text-2xl font-bold text-surface-900 dark:text-surface-50">
					{tipoPresenca === 'entrada' ? 'Confirmação de Entrada' : 'Confirmação de Saída'}
				</h2>
				<p class="text-sm text-surface-500">
					{tipoPresenca === 'entrada'
						? 'Registre sua rubrica para confirmar a entrada no serviço.'
						: 'Registre sua rubrica para confirmar a saída do serviço.'}
				</p>
			</div>

			{#if resGise.salvandoPresenca}
				<div class="flex flex-col items-center gap-3 py-10">
					<Spinner size="lg" />
					<p class="text-sm font-semibold text-surface-500 uppercase tracking-wider">
						{tipoPresenca === 'entrada' ? 'Registrando entrada...' : 'Registrando saída...'}
					</p>
				</div>
			{:else}
				<SignaturePad
					onConfirm={tipoPresenca === 'entrada' ? resGise.salvarEntrada : resGise.salvarSaida}
					onCancel={() => (resGise.capturandoRubrica = false)}
					exigirFoto={page.data.exigirFotoAssinatura ?? true}
					exigirGps={page.data.exigirGpsAssinatura ?? true}
					exigirCodigoEmail={page.data.exigirCodigoEmailAssinatura ?? false}
				/>
			{/if}

			<p class="text-sm text-surface-400 text-center italic">
				Esta rubrica será registrada permanentemente como comprovante de {tipoPresenca === 'entrada' ? 'entrada' : 'saída'} no serviço.
			</p>
		</div>
	</div>
{/if}

<!-- Diálogo de confirmação para restaurar modelo padrão -->
<Dialog open={dialogRestaurarAberto} onOpenChange={(e) => (dialogRestaurarAberto = e.open)}>
	{#snippet content()}
		<div class="p-6 max-w-sm">
			<h3 class="text-lg font-bold mb-2">Restaurar modelo padrão?</h3>
			<p class="text-sm text-surface-600 dark:text-surface-300 mb-6">
				As perguntas do modelo <strong>{resGise.configTipo}</strong> serão substituídas pelo padrão.
				Essa ação não pode ser desfeita.
			</p>
			<div class="flex justify-end gap-3">
				<button
					class="btn preset-outlined-surface-500"
					onclick={() => (dialogRestaurarAberto = false)}
				>
					Cancelar
				</button>
				<button class="btn preset-filled-warning-500" onclick={confirmarRestaurarPadrao}>
					Restaurar
				</button>
			</div>
		</div>
	{/snippet}
</Dialog>
