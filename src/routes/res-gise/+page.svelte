<script lang="ts">
	import { goto } from '$app/navigation';
	import { page, navigating } from '$app/state';
	import SkeletonCard from '$lib/components/SkeletonCard.svelte';
	import { useAutorizacao, useMobile } from '$lib/composables';
	import { Dialog, SegmentedControl } from '@skeletonlabs/skeleton-svelte';
	import SignaturePad from '$lib/components/SignaturePad.svelte';
	import { useResGise } from './useResGise.svelte';
	import { loading } from '$lib/loading.svelte';
	import ConfigurarFormulario from './ConfigurarFormulario.svelte';
	import FormularioServico from './FormularioServico.svelte';
	import { toaster } from '$lib/toast';

	let { data } = $props();
	const auth = useAutorizacao();
	const isAdminGeral = $derived(auth.isAdmin);
	const resGise = useResGise(() => data);
	const mobileState = useMobile();
	const isMobile = $derived(mobileState.isMobile);

	let signatureStep = $state<'signature' | 'camera' | 'email_code'>('signature');
	$effect(() => {
		if (resGise.capturandoRubrica) {
			signatureStep = 'signature';
		}
	});

	function voltarParaLista() {
		resGise.escalaSelecionada = null;
		const params = new URLSearchParams(page.url.searchParams);
		params.delete('giseId');
		params.delete('equipeId');
		const qs = params.toString();
		goto(qs ? `?${qs}` : page.url.pathname, { keepFocus: true, noScroll: true });
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	$effect(() => {
		if (resGise.escalaSelecionada) window.scrollTo({ top: 0, behavior: 'smooth' });
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

<svelte:head>
	<title>Relatórios GISE - Portal de Escalas</title>
</svelte:head>

<div class="space-y-6">
	<header class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 sm:mb-8">
		<div>
			<h1 class="h1 text-2xl font-bold">Relatórios GISE</h1>
			<p class="text-sm text-surface-500 font-medium">Gestão de produtividade e relatórios operacionais</p>
		</div>
	</header>

	{#if isAdminGeral}
		<ConfigurarFormulario
			{resGise}
			modeloPadraoOperacional={data.modeloPadraoOperacional}
			modeloPadraoSeint={data.modeloPadraoSeint}
		/>
	{:else}
		<!-- Slide lateral: container oculta o painel fora de tela -->
		<div class="overflow-hidden">
		<div
			class="flex transition-transform duration-300 ease-in-out"
			style="transform: translateX({resGise.escalaSelecionada ? '-50%' : '0%'}); width: 200%;"
		>
			<!-- Panel 1: Lista de Escalas -->
			<div class="min-w-0 space-y-4" style="width: 50%;">
				<div class="px-2 space-y-3">
					<!-- Título + Abas com layout responsivo -->
					<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
						<h2 class="text-lg font-bold">Minhas Escalas GISE</h2>
						
						<!-- Escolha entre Ativas e Histórico -->
						<SegmentedControl
							value={resGise.statusFilterUrl || 'ativas'}
							onValueChange={(e) => resGise.changeStatusFilter(e.value ?? '')}
							class="w-full sm:w-auto"
						>
							<SegmentedControl.Control
								class="flex items-center rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-800 p-1 gap-1 w-full sm:w-auto"
							>
								<SegmentedControl.Item
									value="ativas"
									class="px-3 py-2 text-sm font-semibold rounded-lg flex-1 sm:flex-none text-center cursor-pointer select-none transition-all duration-200 text-surface-500 dark:text-surface-400 data-[state=checked]:bg-primary-500 data-[state=checked]:text-white data-[state=checked]:shadow-md data-[state=checked]:shadow-primary-500/25 hover:text-surface-700 dark:hover:text-surface-200"
								>
									<SegmentedControl.ItemText>Ativas</SegmentedControl.ItemText>
									<SegmentedControl.ItemHiddenInput />
								</SegmentedControl.Item>
								<SegmentedControl.Item
									value="finalizadas"
									class="px-3 py-2 text-sm font-semibold rounded-lg flex-1 sm:flex-none text-center cursor-pointer select-none transition-all duration-200 text-surface-500 dark:text-surface-400 data-[state=checked]:bg-primary-500 data-[state=checked]:text-white data-[state=checked]:shadow-md data-[state=checked]:shadow-primary-500/25 hover:text-surface-700 dark:hover:text-surface-200"
								>
									<SegmentedControl.ItemText>Histórico</SegmentedControl.ItemText>
									<SegmentedControl.ItemHiddenInput />
								</SegmentedControl.Item>
							</SegmentedControl.Control>
						</SegmentedControl>
					</div>

					<!-- Busca Detalhada (Apenas no Histórico) -->
					{#if resGise.statusFilterUrl === 'finalizadas'}
						<div class="space-y-2 pt-3 border-t border-surface-200 dark:border-surface-800 animate-in fade-in slide-in-from-top-2 duration-300">
							<div class="flex items-center justify-between">
								<span class="text-[0.6rem] font-black text-surface-400 uppercase tracking-widest">Busca Detalhada</span>
								{#if resGise.mesFilterUrl || resGise.dataFilterUrl}
									<button type="button"
										class="text-[0.6rem] font-bold text-error-500 hover:underline px-2 py-0.5 bg-error-500/10 rounded-md transition-all"
										onclick={resGise.limparFiltros}
									>Limpar</button>
								{/if}
							</div>
							<!-- Filtros lado a lado -->
							<div class="grid grid-cols-2 gap-2 bg-surface-100/50 dark:bg-surface-800/30 p-3 rounded-xl border border-surface-200 dark:border-surface-800">
								<div class="space-y-1">
									<label class="text-[0.58rem] font-black text-surface-500 uppercase tracking-wider ml-0.5" for="mesMember">Mês/Ano</label>
									<input
										id="mesMember"
										type="month"
										class="block w-full px-3 py-2 text-xs rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 focus:ring-2 focus:ring-primary-500 transition-all font-bold shadow-sm"
										value={resGise.mesFilterUrl}
										onchange={(e) => resGise.changeDateFilter('mes', e.currentTarget.value)}
									/>
								</div>
								<div class="space-y-1">
									<label class="text-[0.58rem] font-black text-surface-500 uppercase tracking-wider ml-0.5" for="dataMember">Data Específica</label>
									<input
										id="dataMember"
										type="date"
										class="block w-full px-3 py-2 text-xs rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 focus:ring-2 focus:ring-primary-500 transition-all font-bold shadow-sm"
										value={resGise.dataFilterUrl}
										onchange={(e) => resGise.changeDateFilter('data', e.currentTarget.value)}
									/>
								</div>
							</div>
						</div>
					{/if}
				</div>
				{#if navegandoFiltros}
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 px-2">
						{#each { length: 6 } as _}
							<SkeletonCard lines={3} hasFooter={false} />
						{/each}
					</div>
				{:else}
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 px-2">
				{#each data.minhasEscalas as escala}
					{@const estaCarregando = !!navegandoParaEscala &&
						navigating?.to?.url.searchParams.get('giseId') === String(escala.id)}
					<div
						role="button"
						tabindex="0"
						class="w-full text-left p-4 rounded-2xl border transition-all cursor-pointer {resGise.escalaSelecionada?.id ===
							escala.id && resGise.escalaSelecionada?.equipe_id === escala.equipe_id
							? 'border-primary-500 bg-primary-500/10'
							: 'border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900 hover:border-primary-500/50'} {estaCarregando ? 'opacity-60' : ''}"
						onclick={() => resGise.selecionarEscala(escala, isAdminGeral)}
						onkeydown={(e) => e.key === 'Enter' && resGise.selecionarEscala(escala, isAdminGeral)}
					>
						<div class="flex items-center justify-between">
							<p class="text-sm font-bold text-surface-900 dark:text-surface-100">
								{resGise.fmtDate(escala.data_inicio)}
								<span class="ml-1 opacity-50 font-normal">#{escala.id}</span>
							</p>
							{#if estaCarregando}
								<div class="flex items-center gap-1 pr-0.5">
									<div class="w-1.5 h-1.5 rounded-full bg-primary-500 animate-bounce [animation-delay:-0.3s]"></div>
									<div class="w-1.5 h-1.5 rounded-full bg-primary-500 animate-bounce [animation-delay:-0.15s]"></div>
									<div class="w-1.5 h-1.5 rounded-full bg-primary-500 animate-bounce"></div>
								</div>
							{:else}
								<span class="badge preset-filled-primary-500 text-[0.6rem] uppercase font-bold"
									>{escala.equipe_tipo}</span
								>
							{/if}
						</div>
						<div class="mt-1 space-y-1.5">
							<p
								class="text-xs uppercase tracking-wider leading-tight {escala.assinada
									? 'text-success-500 font-bold'
									: 'text-surface-500'}"
							>
								{escala.assinada ? 'SUPERVISOR ASSINOU' : 'AGUARDANDO ASSINATURA DO SUPERVISOR'}
							</p>

							{#if escala.equipeRespondida || escala.extraAssinado || (escala.presenca?.saida_timestamp && !escala.extraAssinado)}
								<div class="flex flex-row gap-2 w-full sm:w-auto sm:gap-1.5">
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
											'flex-1 sm:flex-none w-full sm:w-auto text-[0.6rem] px-3 py-1.5',
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
											(e: any) => {
												e.stopPropagation();
												resGise.baixarRelatorioExtra(escala);
											},
											false,
											resGise.baixandoExtra === escala.id,
											'flex-1 sm:flex-none w-full sm:w-auto text-[0.6rem] px-3 py-1.5',
											'button',
											'sm'
										)}
									{:else if escala.presenca?.saida_timestamp}
										{@render actionButton(
											'RELAT. EXTRA',
											'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
											'surface',
											'filled',
											(e: any) => {
												e.stopPropagation();
												toaster.create({
													title: 'Relatório de Extraordinário enviado para assinatura do supervisor. Estará disponível para download após assinado.',
													type: 'warning'
												});
											},
											false,
											false,
											'flex-1 sm:flex-none w-full sm:w-auto text-[0.6rem] px-3 py-1.5 opacity-60 cursor-pointer',
											'button',
											'sm'
										)}
									{/if}
								</div>
							{/if}
						</div>
					</div>
				{:else}
					<p class="text-sm text-surface-500 italic col-span-full px-2">
						Nenhuma escala gise encontrada para o seu perfil ou você já enviou o relatório.
					</p>
				{/each}
				</div>
				{/if}
			</div>

			<!-- Panel 2: Formulário de Serviço -->
			<div class="min-w-0 px-2 sm:px-4" style="width: 50%;">
				<div class="max-w-2xl mx-auto space-y-4">
					<button
						type="button"
						class="btn btn-sm preset-outlined-surface-500 flex items-center gap-1.5"
						onclick={voltarParaLista}
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
						</svg>
						Voltar
					</button>
					{#if resGise.escalaSelecionada}
						<section
							class="card p-4 sm:p-6 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-3xl shadow-sm"
						>
							<FormularioServico
								{resGise}
								{isAdminGeral}
								{isMobile}
								restringirSmartphone={data.restringirSmartphone}
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

<svelte:window onkeydown={(e) => { if (resGise.escalaSelecionada && e.key === 'Escape' && !resGise.capturandoRubrica) voltarParaLista(); }} />

<!-- Modal de Rubrica — Confirmação de Entrada / Saída do Policial -->
<Dialog
	open={resGise.capturandoRubrica && !!resGise.escalaSelecionada}
	onOpenChange={(e) => { if (!e.open && !loading.active) resGise.capturandoRubrica = false; }}
>
	<Dialog.Content
		class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-md overflow-y-auto"
	>
		{#if resGise.escalaSelecionada}
			{@const tipoPresenca = !resGise.escalaSelecionada.presenca?.entrada_timestamp ? 'entrada' : 'saida'}
			{@const titulo = 
				signatureStep === 'camera'
					? 'Prova de Vida'
					: signatureStep === 'email_code'
						? 'Confirmação de Identidade'
						: (tipoPresenca === 'entrada' ? 'Confirmação de Entrada' : 'Confirmação de Saída')}
			{@const descricao = 
				signatureStep === 'camera'
					? 'Cumpra o desafio de presença na tela para provar que você está ativo.'
					: signatureStep === 'email_code'
						? 'Por razões de segurança, insira o código enviado para o seu e-mail funcional.'
						: (tipoPresenca === 'entrada'
							? 'Registre sua rubrica para confirmar a entrada no serviço.'
							: 'Registre sua rubrica para confirmar a saída do serviço.')}
			<div
				class="bg-surface-50 dark:bg-surface-900 rounded-3xl shadow-2xl w-full max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:p-8 space-y-6 border border-white/10"
			>
				<div class="text-center space-y-2">
					<Dialog.Title class="text-2xl font-bold text-surface-900 dark:text-surface-50">
						{titulo}
					</Dialog.Title>
					<Dialog.Description class="text-sm text-surface-500">
						{descricao}
					</Dialog.Description>
				</div>

				{#if loading.active}
					<div class="flex flex-col items-center gap-4 py-10">
						<svg class="w-10 h-10 text-primary-500 animate-spin" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
						</svg>
						<p class="text-sm font-semibold text-surface-500 uppercase tracking-wider">
							{tipoPresenca === 'entrada' ? 'Registrando entrada...' : 'Registrando saída...'}
						</p>
					</div>
				{:else if resGise.capturandoRubrica}
					<SignaturePad
						onConfirm={tipoPresenca === 'entrada' ? resGise.salvarEntrada : resGise.salvarSaida}
						onCancel={() => (resGise.capturandoRubrica = false)}
						exigirFoto={page.data.exigirFotoAssinatura ?? true}
						exigirGps={page.data.exigirGpsAssinatura ?? true}
						exigirCodigoEmail={page.data.exigirCodigoEmailAssinatura ?? false}
						bind:step={signatureStep}
					/>
				{/if}

				<p class="text-sm text-surface-400 text-center italic">
					Esta rubrica será registrada permanentemente como comprovante de {tipoPresenca === 'entrada' ? 'entrada' : 'saída'} no serviço.
				</p>
			</div>
		{/if}
	</Dialog.Content>
</Dialog>
