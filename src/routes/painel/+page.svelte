<script lang="ts">
	/**
	 * PAINEL DE COMPLIANCE — quais unidades deviam ter escala e não têm.
	 *
	 * Uma linha por (unidade × regime × mês) exigível, com o estado apurado: em
	 * dia, pendente, assinada, ignorada. É a tela que o Admin Geral usa para
	 * cobrar, então "ausência de escala" é o dado principal — e por isso a
	 * apuração é do servidor, que sabe o universo de unidades, e não da lista de
	 * escalas existentes.
	 *
	 * `data.compliance` chega como PROMISE (streaming do `load`): a página pinta
	 * os filtros de imediato e o relatório preenche quando resolve. A promessa é
	 * resolvida aqui num `$effect` em vez de `{#await}` no markup para preservar
	 * a cadeia de deriveds (dados → filtrados → agrupados) — com `{#await}` cada
	 * bloco receberia o valor por conta própria e a filtragem teria de ser
	 * duplicada. `null` significa "computando" e é o que mostra o skeleton.
	 *
	 * "Ignorar" uma pendência é TRIAGEM LOCAL: a chave vai para o localStorage
	 * deste navegador, não para o banco. Serve para o admin tirar da frente o que
	 * já resolveu por fora — a pendência continua existindo e outro admin (ou
	 * outro navegador) continua vendo. Não confundir com decisão registrada.
	 */
	import type { PageProps } from './$types';
	import { opcoesMeses } from '$lib/utils/datas';
	import {
		Lock,
		Check,
		CheckCircle2,
		Clock,
		XCircle,
		BellOff,
		Search,
		PartyPopper
	} from 'lucide-svelte';
	import { goto, invalidate } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { page, navigating } from '$app/state';
	import { SvelteSet } from 'svelte/reactivity';
	import SkeletonCard from '$lib/components/SkeletonCard.svelte';
	import { browser } from '$app/environment';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import { toaster } from '$lib/toast';
	import type { ItemCompliance } from '$lib/types';
	import { useAutorizacao, getSavedFilters } from '$lib/composables';
	import { loading as loadingService } from '$lib/loading.svelte';
	import type { ActionResult } from '@sveltejs/kit';

	const { data }: PageProps = $props();

	const auth = useAutorizacao();
	const isAdmin = $derived(auth.isAdmin);
	const savedFilters = getSavedFilters('filtros_painel', {
		regime: 'todos',
		seccional: '',
		unidade: '',
		mesCorrente: true,
		agrupamento: 'nenhum',
		pendentes: true,
		ignorados: false
	});

	// `data.compliance` chega como PROMISE (streaming do load): o shell pinta
	// já com os filtros, e o relatório preenche quando resolver. `null` =
	// computando (skeleton). Resolver aqui — em vez de {#await} no template —
	// preserva a cadeia de deriveds (dados → dadosFiltrados → dadosAgrupados).
	let complianceResolvido = $state<ItemCompliance[] | null>(null);
	$effect(() => {
		const promessa = data.compliance;
		complianceResolvido = null;
		let ativo = true;
		Promise.resolve(promessa)
			.then((v) => {
				if (ativo) complianceResolvido = v as ItemCompliance[];
			})
			.catch(() => {
				if (!ativo) return;
				complianceResolvido = [];
				toaster.create({ title: 'Erro ao carregar o compliance', type: 'error' });
			});
		return () => {
			ativo = false;
		};
	});
	const dados = $derived(complianceResolvido ?? []);
	const carregandoCompliance = $derived(complianceResolvido === null);
	const unidadesDB = $derived(data.unidades);

	// Filtros
	const filtroRegime = 'todos';
	let filtroSeccional = $state<number | 'todas' | ''>(
		savedFilters.seccional !== undefined
			? (savedFilters.seccional as unknown as number | 'todas' | '')
			: ''
	);
	let filtroUnidade = $state(savedFilters.unidade);
	// svelte-ignore state_referenced_locally
	let filtroAno = $state(data.filtroAno);
	// svelte-ignore state_referenced_locally
	let filtroMes = $state(data.filtroMes);
	const filtroAgrupamento = 'unidade';
	let filtroPendentes = $state(true);
	let mostrarIgnorados = $state(!!savedFilters.ignorados);

	// Salvar filtros a cada mudança
	$effect(() => {
		if (browser) {
			localStorage.setItem(
				'filtros_painel',
				JSON.stringify({
					regime: filtroRegime,
					seccional: filtroSeccional,
					unidade: filtroUnidade,
					agrupamento: filtroAgrupamento,
					ignorados: mostrarIgnorados
				})
			);
		}
	});

	const seccionais = $derived(unidadesDB.filter((u) => u.tipo === 'seccional'));

	// Itens ignorados (persistidos no localStorage)
	const ignorados = new SvelteSet<string>();

	function chaveIgnorado(item: ItemCompliance): string {
		return `${item.unidade_nome}|${item.tipo_regime}|${item.data_inicio}`;
	}

	function ignorarItem(item: ItemCompliance) {
		const chave = chaveIgnorado(item);
		ignorados.add(chave);
		localStorage.setItem('compliance_ignorados', JSON.stringify([...ignorados]));
	}

	function restaurarItem(item: ItemCompliance) {
		const chave = chaveIgnorado(item);
		ignorados.delete(chave);
		localStorage.setItem('compliance_ignorados', JSON.stringify([...ignorados]));
	}

	const dadosFiltrados = $derived(
		dados.filter((d) => {
			const ignorado = ignorados.has(chaveIgnorado(d));
			if (!mostrarIgnorados && ignorado) return false;
			if (mostrarIgnorados && !ignorado) return false;
			if (filtroRegime !== 'todos' && d.tipo_regime !== filtroRegime) return false;
			if (filtroPendentes && d.status === 'ok') return false;

			if (filtroSeccional !== 'todas') {
				const udb = unidadesDB.find((u) => u.nome === d.unidade_nome);
				if (udb) {
					if (udb.tipo === 'seccional' && udb.id !== filtroSeccional) return false;
					if (udb.tipo === 'delegacia' && udb.seccional_id !== filtroSeccional) return false;
				}
			}

			if (filtroUnidade && d.unidade_nome !== filtroUnidade) return false;
			return true;
		})
	);

	const dadosAgrupados = $derived.by(() => {
		const base = [...dadosFiltrados];
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const gruposMap = new Map<string, ItemCompliance[]>();
		for (const item of base) {
			const chave = item.unidade_nome;
			if (!gruposMap.has(chave)) gruposMap.set(chave, []);
			gruposMap.get(chave)!.push(item);
		}

		return Array.from(gruposMap.entries()).map(([titulo, itens]) => ({ titulo, itens }));
	});

	const unidadesDropdown = $derived(
		[
			...new Set(
				dados
					.filter((d) => {
						if (filtroSeccional === 'todas') return true;
						const udb = unidadesDB.find((u) => u.nome === d.unidade_nome);
						if (!udb) return true;
						return (
							(udb.tipo === 'seccional' && udb.id === filtroSeccional) ||
							(udb.tipo === 'delegacia' && udb.seccional_id === filtroSeccional)
						);
					})
					.map((d) => d.unidade_nome)
			)
		].sort()
	);

	const totais = $derived({
		ok: dados.filter((d) => d.status === 'ok' && !ignorados.has(chaveIgnorado(d))).length,
		nao_assinada: dados.filter(
			(d) => d.status === 'nao_assinada' && !ignorados.has(chaveIgnorado(d))
		).length,
		nao_criada: dados.filter((d) => d.status === 'nao_criada' && !ignorados.has(chaveIgnorado(d)))
			.length,
		ignorados: ignorados.size
	});

	const seccionaisOptions = $derived(seccionais.map((s) => ({ value: s.id, label: s.nome })));

	const unidadesDropdownOptions = $derived(unidadesDropdown.map((u) => ({ value: u, label: u })));

	const mesesOptions = opcoesMeses(true);

	const anosOptions = [
		{ value: 'todos', label: 'Todos' },
		{ value: '2024', label: '2024' },
		{ value: '2025', label: '2025' },
		{ value: '2026', label: '2026' },
		{ value: '2027', label: '2027' }
	];

	// Normalizações para quando as caixas de seleção forem limpas (null / '')
	$effect(() => {
		if (filtroSeccional === null) {
			filtroSeccional = '';
		}
	});

	$effect(() => {
		if (filtroUnidade === null) {
			filtroUnidade = '';
		}
	});

	// Sync local month/year state with query parameters.
	// `ultimoNavegado` impede navegação repetida para o mesmo alvo: se o
	// servidor normalizar o valor (ex.: '05' → '5'), o estado local diverge de
	// `data` para sempre e, sem o guard, este efeito entraria em loop infinito
	// de goto().
	let ultimoNavegado: string | null = null;
	$effect(() => {
		if (filtroAno === null) filtroAno = 'todos';
		if (filtroMes === null) filtroMes = 'todos';

		const alvo = `${filtroAno}|${filtroMes}`;
		if (alvo !== `${data.filtroAno}|${data.filtroMes}` && alvo !== ultimoNavegado) {
			ultimoNavegado = alvo;
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			const params = new URLSearchParams(page.url.searchParams);
			params.set('ano', filtroAno);
			params.set('mes', filtroMes);
			goto(`?${params}`, { keepFocus: true, noScroll: true });
		}
	});

	$effect(() => {
		filtroAno = data.filtroAno;
		filtroMes = data.filtroMes;
	});

	// Limpar unidade quando a seccional muda DE FATO. Compara o valor
	// normalizado (null ≡ '') para não disparar quando o efeito de
	// normalização converte null → '' sem mudança real de seccional.
	let prevSeccional: string | number | undefined;
	$effect(() => {
		const sec = filtroSeccional ?? '';
		if (prevSeccional !== undefined && sec !== prevSeccional) {
			filtroUnidade = '';
		}
		prevSeccional = sec;
	});

	// Exclusão de escala (para "não assinada")
	let escalaExcluirOpen = $state(false);
	let itemParaExcluir = $state<ItemCompliance | null>(null);

	async function carregar() {
		loadingService.show('Atualizando dados de compliance...');
		try {
			const stored = localStorage.getItem('compliance_ignorados');
			if (stored) {
				ignorados.clear();
				for (const k of JSON.parse(stored) as string[]) ignorados.add(k);
			}
		} catch {
			/* ignora */
		}
		// Chave declarada com depends() no load: invalidate(pathname) exigia
		// match exato de URL e não funcionava com ?ano=&mes= presentes.
		await invalidate('app:painel');
		loadingService.hide();
	}

	async function limparFiltros() {
		filtroSeccional = '';
		filtroUnidade = '';
		filtroPendentes = true;
		mostrarIgnorados = false;

		const hoje = new Date();
		filtroAno = String(hoje.getFullYear());
		filtroMes = String(hoje.getMonth() + 1);

		await goto('?', { keepFocus: true, noScroll: true });
	}

	function handleExcluirEscala() {
		loadingService.show('Excluindo escala...');
		return async ({ result }: { result: ActionResult }) => {
			loadingService.hide();
			if (result.type === 'success') {
				toaster.create({ title: 'Escala excluída com sucesso!', type: 'success' });
				await invalidate('app:painel');
				escalaExcluirOpen = false;
				itemParaExcluir = null;
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				toaster.create({ title: String(d?.error || 'Erro ao excluir escala'), type: 'error' });
			}
		};
	}

	const temFiltros = $derived(
		filtroSeccional !== 'todas' ||
			filtroUnidade !== '' ||
			filtroPendentes !== true ||
			mostrarIgnorados !== false ||
			filtroAno !== String(new Date().getFullYear()) ||
			filtroMes !== String(new Date().getMonth() + 1)
	);

	$effect(() => {
		if (isAdmin && browser) {
			try {
				const stored = localStorage.getItem('compliance_ignorados');
				if (stored) {
					ignorados.clear();
					for (const k of JSON.parse(stored) as string[]) ignorados.add(k);
				}
			} catch {
				/* ignora */
			}
		}
	});
</script>

<svelte:head>
	<title>Painel de Compliance | Escalas</title>
</svelte:head>

{#if !isAdmin}
	<div class="text-center py-32 text-surface-500">
		<Lock class="w-8 h-8 mx-auto mb-2" aria-hidden="true" />
		<p>Acesso restrito a administradores.</p>
	</div>
{:else}
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
		<div>
			<h1 class="h1 text-2xl font-bold">Painel de Compliance</h1>
			<p class="text-sm text-surface-500 mt-0.5">
				Controle de envio e assinatura de escalas por unidade
			</p>
		</div>
		<div class="flex gap-2 justify-end w-full sm:w-auto">
			<button
				type="button"
				class="btn btn-sm {temFiltros
					? 'preset-filled-warning-500'
					: 'preset-outlined-primary-500 opacity-40'}"
				onclick={limparFiltros}
				disabled={!temFiltros && !loadingService.active}
			>
				Limpar filtros
			</button>
			<button
				type="button"
				class="btn preset-outlined-primary-500 btn-sm"
				onclick={carregar}
				disabled={loadingService.active}
			>
				{#if loadingService.active}
					Atualizando...
				{:else}
					<svg class="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
						/>
					</svg>
				{/if}
				Atualizar
			</button>
		</div>
	</div>

	<!-- Cards de resumo -->
	{#if !loadingService.active}
		<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
			<div class="p-4 rounded-2xl bg-success-500/10 border border-success-500/20 text-center">
				<p class="text-2xl font-bold text-success-600 dark:text-success-400">{totais.ok}</p>
				<p class="text-xs text-surface-500 mt-1 font-medium">
					<CheckCircle2 class="inline w-3.5 h-3.5 -mt-0.5" aria-hidden="true" /> Em dia
				</p>
			</div>
			<div class="p-4 rounded-2xl bg-warning-500/10 border border-warning-500/20 text-center">
				<p class="text-2xl font-bold text-warning-600 dark:text-warning-400">
					{totais.nao_assinada}
				</p>
				<p class="text-xs text-surface-500 mt-1 font-medium">
					<Clock class="inline w-3.5 h-3.5 -mt-0.5" aria-hidden="true" /> Não Assinada
				</p>
			</div>
			<div class="p-4 rounded-2xl bg-error-500/10 border border-error-500/20 text-center">
				<p class="text-2xl font-bold text-error-600 dark:text-error-400">{totais.nao_criada}</p>
				<p class="text-xs text-surface-500 mt-1 font-medium">
					<XCircle class="inline w-3.5 h-3.5 -mt-0.5" aria-hidden="true" /> Não Criada
				</p>
			</div>
			<button
				type="button"
				class="p-4 rounded-2xl bg-surface-500/10 border border-surface-500/20 text-center cursor-pointer hover:bg-surface-500/20 transition-colors"
				onclick={() => {
					mostrarIgnorados = !mostrarIgnorados;
					filtroPendentes = false;
				}}
			>
				<p class="text-2xl font-bold text-surface-500">{totais.ignorados}</p>
				<p class="text-xs text-surface-500 mt-1 font-medium">
					<BellOff class="inline w-3.5 h-3.5 -mt-0.5" aria-hidden="true" /> Ignorados
				</p>
			</button>
		</div>
	{/if}

	<!-- Filtros -->
	<div
		class="p-4 sm:p-5 mb-6 rounded-2xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-white/10 shadow-sm flex flex-col gap-4 sm:gap-5"
	>
		<div class="flex flex-col lg:flex-row flex-wrap gap-3 items-stretch lg:items-end w-full">
			<div class="flex flex-col gap-1 w-full lg:w-48">
				<span class="label-text text-sm font-semibold">Seccional</span>
				<SearchableSelect
					options={seccionaisOptions}
					bind:value={filtroSeccional}
					placeholder="Selecione"
				/>
			</div>

			<div class="flex flex-col gap-1 w-full lg:w-48">
				<span class="label-text text-sm font-semibold">Unidade</span>
				<SearchableSelect
					options={unidadesDropdownOptions}
					bind:value={filtroUnidade}
					placeholder="Todas as unidades"
				/>
			</div>

			<div class="flex flex-col gap-1 w-full lg:w-28">
				<span class="label-text text-sm font-semibold">Ano</span>
				<SearchableSelect options={anosOptions} bind:value={filtroAno} placeholder="Todos" />
			</div>

			<div class="flex flex-col gap-1 w-full lg:w-36">
				<span class="label-text text-sm font-semibold">Mês</span>
				<SearchableSelect options={mesesOptions} bind:value={filtroMes} placeholder="Todos" />
			</div>
		</div>

		{#if mostrarIgnorados}
			<div class="pt-1 border-t border-surface-100 dark:border-white/5">
				<button
					type="button"
					class="btn btn-sm variant-soft-surface text-xs font-bold"
					onclick={() => {
						mostrarIgnorados = false;
						filtroPendentes = true;
					}}
				>
					← Voltar para pendências
				</button>
			</div>
		{/if}

		<hr class="opacity-50 dark:opacity-10" />
	</div>

	<!-- Modo ignorados: banner informativo -->
	{#if mostrarIgnorados}
		<div
			class="mb-4 p-3 rounded-xl bg-surface-500/10 border border-surface-500/20 text-sm text-surface-600 dark:text-surface-400 flex items-center gap-2"
		>
			<svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"
				><path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
				/></svg
			>
			Exibindo itens ignorados. Para restaurar, clique em <strong>Restaurar</strong> na linha correspondente.
		</div>
	{/if}

	<Dialog open={escalaExcluirOpen} onOpenChange={(e) => (escalaExcluirOpen = e.open)}>
		<Dialog.Content
			class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
		>
			<div
				class="card p-4 sm:p-6 max-w-sm w-full max-h-[calc(100dvh-2rem)] overflow-y-auto card-elevated shadow-2xl rounded-2xl"
			>
				<Dialog.Title class="h3 font-bold mb-2">Excluir Escala?</Dialog.Title>
				<Dialog.Description class="text-surface-600 dark:text-surface-400 mb-6">
					Tem certeza que deseja excluir esta escala de <strong
						>{itemParaExcluir?.unidade_nome}</strong
					>? O status voltará a ser "Não Criada".
				</Dialog.Description>
				<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
					<Dialog.CloseTrigger
						class="btn preset-outlined-surface-500"
						disabled={loadingService.active}>Cancelar</Dialog.CloseTrigger
					>
					<form
						method="POST"
						action="?/excluirEscala"
						use:enhance={handleExcluirEscala}
						class="contents"
					>
						<input type="hidden" name="escala_id" value={itemParaExcluir?.escala_id} />
						<button
							type="submit"
							class="btn preset-filled-error-500 flex items-center gap-2 transition-all"
							disabled={loadingService.active}
						>
							{loadingService.active ? 'Excluindo...' : 'Confirmar Exclusão'}
						</button>
					</form>
				</div>
			</div>
		</Dialog.Content>
	</Dialog>

	<!-- Tabela -->
	<div class="rounded-3xl card-glass p-4 sm:p-5">
		{#if loadingService.active}
			<div
				class="flex flex-col items-center justify-center py-16 gap-3 text-surface-400 dark:text-surface-500"
			>
				<span class="text-sm">Carregando...</span>
			</div>
		{:else if !filtroSeccional}
			<div class="text-center py-20">
				<Search class="w-10 h-10 mx-auto mb-4 text-surface-400" aria-hidden="true" />
				<p class="text-surface-600 dark:text-surface-400 text-lg font-semibold">
					Escolha um opção nos filtros para exibir
				</p>
			</div>
		{:else if carregandoCompliance}
			<!-- Compliance ainda resolvendo (streaming) — sem isto cairia no
			     estado vazio "Nenhuma pendência" durante o cálculo -->
			<div class="space-y-2" aria-busy="true">
				{#each { length: 6 } as _, i (i)}
					<SkeletonCard lines={2} hasFooter={false} />
				{/each}
			</div>
		{:else if dadosFiltrados.length === 0}
			<div class="text-center py-20">
				{#if mostrarIgnorados}
					<BellOff class="w-10 h-10 mx-auto mb-4 text-surface-400" aria-hidden="true" />
				{:else}
					<PartyPopper class="w-10 h-10 mx-auto mb-4 text-success-500" aria-hidden="true" />
				{/if}
				<p class="text-surface-600 dark:text-surface-400 text-lg font-semibold">
					{mostrarIgnorados ? 'Nenhum item ignorado' : 'Nenhuma pendência encontrada!'}
				</p>
				<p class="text-surface-500 text-sm mt-1">
					{mostrarIgnorados
						? 'Você não ignorou nenhuma pendência.'
						: 'Todas as escalas estão em dia com os filtros selecionados.'}
				</p>
			</div>
		{:else}
			<!-- Desktop table -->
			<!-- Sem `overflow-hidden` aqui (VIS-3): ele vence o `overflow:auto` do
			     `table-wrap` por ordem na folha e mata o scroll horizontal. O
			     `rounded-xl` continua recortando — `overflow:auto` já recorta. -->
			<div class="hidden md:block table-wrap rounded-xl">
				<table class="table">
					<thead>
						<tr>
							<th>Unidade</th>
							<th>Regime</th>
							<th>Período</th>
							<th>Status</th>
							<th class="text-left">Ações</th>
						</tr>
					</thead>
					<tbody>
						{#if navigating?.to && navigating.to.url.pathname === page.url.pathname}
							{#each { length: 8 } as _, i (i)}
								<tr class="animate-pulse">
									<td class="px-4 py-3"
										><div class="h-4 w-40 rounded bg-surface-200 dark:bg-surface-700"></div></td
									>
									<td class="px-4 py-3"
										><div
											class="h-6 w-20 rounded-full bg-surface-200 dark:bg-surface-700"
										></div></td
									>
									<td class="px-4 py-3"
										><div class="h-4 w-28 rounded bg-surface-200 dark:bg-surface-700"></div></td
									>
									<td class="px-4 py-3"
										><div
											class="h-6 w-20 rounded-full bg-surface-200 dark:bg-surface-700"
										></div></td
									>
									<td class="px-4 py-3"
										><div class="h-8 w-24 rounded-lg bg-surface-200 dark:bg-surface-700"></div></td
									>
								</tr>
							{/each}
						{:else}
							{#each dadosAgrupados as grupo (grupo.titulo)}
								{#if grupo.titulo}
									<tr class="bg-surface-200/50 dark:bg-surface-800/50 shadow-inner">
										<td
											colspan="5"
											class="py-1.5 px-4 text-3xs font-extrabold uppercase tracking-widest text-primary-600 dark:text-primary-400"
										>
											{grupo.titulo}
										</td>
									</tr>
								{/if}
								{#each grupo.itens as item (item.unidade_nome + item.tipo_regime + item.data_inicio)}
									<tr class={ignorados.has(chaveIgnorado(item)) ? 'opacity-50' : ''}>
										<td class="font-medium max-w-[305px] truncate">{item.unidade_nome}</td>
										<td>
											{#if item.tipo_regime === 'plantao'}
												<span
													class="badge preset-filled-tertiary-500/20 text-tertiary-900 dark:text-tertiary-200 border border-tertiary-500/30 text-xs font-bold"
													>Plantão</span
												>
											{:else if item.tipo_regime === 'expediente'}
												<span
													class="badge preset-filled-primary-500/20 text-primary-900 dark:text-primary-200 border border-primary-500/30 text-xs font-bold"
													>Expediente</span
												>
											{:else}
												<span
													class="badge preset-filled-warning-500/20 text-warning-900 dark:text-warning-200 border border-warning-500/30 text-xs font-bold"
													>FDS</span
												>
											{/if}
										</td>
										<td
											class="text-sm text-surface-600 dark:text-surface-300 whitespace-nowrap font-mono tabular-nums"
											>{item.periodo}</td
										>
										<td>
											{#if item.status === 'ok'}
												<span
													class="badge preset-filled-success-500 text-white text-xs font-bold px-2"
													><CheckCircle2 class="inline w-3.5 h-3.5 -mt-0.5" aria-hidden="true" /> Em dia</span
												>
											{:else if item.status === 'nao_assinada' && item.escala_id}
												<div class="flex items-center gap-1.5">
													<a
														href="/escalas/{item.escala_id}"
														class="badge bg-warning-500/15 text-warning-700 dark:text-warning-300 border border-warning-500/30 text-xs font-bold px-2 hover:bg-warning-500/30 transition-colors pointer-events-auto"
														><Clock class="inline w-3 h-3 -mt-0.5" aria-hidden="true" /> Não Assinada</a
													>
													<button
														type="button"
														class="text-error-500 hover:text-error-600 hover:bg-error-500/10 p-1 rounded-md transition-colors leading-none font-bold"
														title="Excluir escala"
														onclick={(e) => {
															e.preventDefault();
															itemParaExcluir = item;
															escalaExcluirOpen = true;
														}}>✕</button
													>
												</div>
											{:else if item.status === 'nao_assinada'}
												<span
													class="badge bg-warning-500/15 text-warning-700 dark:text-warning-300 border border-warning-500/30 text-xs font-bold px-2"
													><Clock class="inline w-3 h-3 -mt-0.5" aria-hidden="true" /> Não Assinada</span
												>
											{:else}
												<span
													class="badge bg-error-500/15 text-error-700 dark:text-error-300 border border-error-500/30 text-xs font-bold px-2"
													><XCircle class="inline w-3 h-3 -mt-0.5" aria-hidden="true" /> Não Criada</span
												>
											{/if}
										</td>
										<td>
											<div class="flex gap-2 justify-start">
												{#if mostrarIgnorados}
													<button
														type="button"
														class="btn btn-sm preset-outlined-primary-500"
														onclick={() => restaurarItem(item)}>Restaurar</button
													>
												{:else}
													<div class="flex gap-2 items-center">
														<button
															type="button"
															class="btn btn-sm preset-outlined-surface-500 opacity-60 hover:opacity-100"
															title="Ignorar esta pendência"
															onclick={() => ignorarItem(item)}
															><BellOff class="w-4 h-4" aria-hidden="true" /></button
														>
													</div>
												{/if}
											</div>
										</td>
									</tr>
								{/each}
							{/each}
						{/if}
					</tbody>
				</table>
			</div>

			<!-- Mobile cards -->
			<div class="md:hidden space-y-2">
				{#if navigating?.to && navigating.to.url.pathname === page.url.pathname}
					{#each { length: 5 } as _, i (i)}
						<SkeletonCard lines={3} hasFooter={false} />
					{/each}
				{:else}
					{#each dadosAgrupados as grupo (grupo.titulo)}
						{#if grupo.titulo}
							<div
								class="py-2 px-4 bg-surface-100 dark:bg-surface-800/40 text-3xs font-bold uppercase tracking-widest text-primary-600 dark:text-primary-400 rounded-lg"
							>
								{grupo.titulo}
							</div>
						{/if}

						<div
							class="divide-y divide-surface-200 dark:divide-white/5 bg-white/50 dark:bg-surface-900/30 rounded-xl overflow-hidden border border-surface-200 dark:border-white/5 mb-4"
						>
							{#each grupo.itens as item (item.unidade_nome + item.tipo_regime + item.data_inicio)}
								<div
									class="p-4 flex items-center justify-between gap-3 {ignorados.has(
										chaveIgnorado(item)
									)
										? 'opacity-50'
										: ''}"
								>
									<div class="min-w-0 flex-1">
										<p class="font-bold text-sm truncate">{item.unidade_nome}</p>
										<div class="flex items-center gap-2 mt-1.5 flex-wrap">
											{#if item.tipo_regime === 'plantao'}
												<span
													class="badge preset-filled-tertiary-500/20 text-tertiary-900 dark:text-tertiary-200 border border-tertiary-500/30 text-3xs font-bold px-1.5 py-0 leading-tight"
													>PLANTÃO</span
												>
											{:else if item.tipo_regime === 'expediente'}
												<span
													class="badge preset-filled-primary-500/20 text-primary-900 dark:text-primary-200 border border-primary-500/30 text-3xs font-bold px-1.5 py-0 leading-tight"
													>EXPEDIENTE</span
												>
											{:else}
												<span
													class="badge preset-filled-warning-500/20 text-warning-900 dark:text-warning-200 border border-warning-500/30 text-3xs font-bold px-1.5 py-0 leading-tight"
													>FDS</span
												>
											{/if}
											<span class="text-xs text-surface-500 font-medium font-mono tabular-nums"
												>{item.periodo}</span
											>
										</div>
										<div class="mt-2">
											{#if item.status === 'ok'}
												<span
													class="text-xs text-success-600 dark:text-success-400 font-bold flex items-center gap-1"
												>
													<Check class="w-3.5 h-3.5" aria-hidden="true" />
													Em dia
												</span>
											{:else if item.status === 'nao_assinada' && item.escala_id}
												<div class="flex items-center gap-2">
													<a
														href="/escalas/{item.escala_id}"
														class="text-xs text-warning-600 dark:text-warning-400 font-bold hover:underline decoration-warning-500 flex items-center gap-1"
													>
														<div class="w-2 h-2 rounded-full bg-warning-500 animate-pulse"></div>
														Não Assinada
													</a>
													<button
														type="button"
														class="text-error-500 font-black px-1.5 py-0.5 bg-error-500/10 rounded"
														onclick={(e) => {
															e.preventDefault();
															itemParaExcluir = item;
															escalaExcluirOpen = true;
														}}>✕</button
													>
												</div>
											{:else if item.status === 'nao_assinada'}
												<span
													class="text-xs text-warning-600 dark:text-warning-400 font-bold flex items-center gap-1"
												>
													<div class="w-2 h-2 rounded-full bg-warning-500"></div>
													Não Assinada
												</span>
											{:else}
												<span
													class="text-xs text-error-600 dark:text-error-400 font-bold flex items-center gap-1"
												>
													<div class="w-2 h-2 rounded-full bg-error-500"></div>
													Não Criada
												</span>
											{/if}
										</div>
									</div>

									<div class="shrink-0 flex items-center gap-2">
										{#if mostrarIgnorados}
											<button
												type="button"
												class="btn btn-sm preset-outlined-primary-500 text-xs font-bold"
												onclick={() => restaurarItem(item)}>Restaurar</button
											>
										{:else}
											<button
												type="button"
												class="btn btn-sm w-9 h-9 !p-0 preset-outlined-surface-500 flex items-center justify-center rounded-full"
												title="Ignorar"
												onclick={() => ignorarItem(item)}
											>
												<BellOff class="w-4 h-4" aria-hidden="true" />
											</button>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					{/each}
				{/if}
			</div>
		{/if}
	</div>
{/if}
