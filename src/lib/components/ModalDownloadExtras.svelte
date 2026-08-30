<script lang="ts">
	/**
	 * Modal "Relatórios de Extra (GISE)": lista um item por relatório —
	 * o do quadro de supervisão (quando há supervisor/assessor/SEINT) e um por
	 * seccional. Assinados liberam download (s/c manifesto); pendentes liberam
	 * a via de conferência (rascunho). O lote "Todos" só habilita quando todos
	 * os itens da lista estão assinados.
	 */
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import Download from '@lucide/svelte/icons/download';
	import FileText from '@lucide/svelte/icons/file-text';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Clock from '@lucide/svelte/icons/clock';
	import X from '@lucide/svelte/icons/x';

	type GiseEscala = {
		id: number;
		status: string;
		data_inicio: string;
		supervisor_id?: number | null;
		assessor_id?: number | null;
		seint1_id?: number | null;
		seint2_id?: number | null;
		assinaturasRelatorioExtraIds?: number[];
		seccionais?: { id: number; nome?: string }[];
	};

	let {
		open = $bindable(false),
		gise,
		supervisaoExtraUnidadeId,
		podeManifesto = false
	}: {
		open: boolean;
		gise: GiseEscala | null;
		supervisaoExtraUnidadeId: number | null;
		/** Exibe as opções "c/ manifesto" — só para quem o servidor de fato
		 * atende com o blob forense (regra `podeBaixarComManifesto`). */
		podeManifesto?: boolean;
	} = $props();

	type ExtraItem = {
		id: number;
		nome: string;
		disponivel: boolean;
	};

	/**
	 * `disponivel` = existe assinatura para aquele destino. A comparação é feita
	 * pelo id da unidade: o quadro de supervisão usa a unidade sintética
	 * (`supervisaoExtraUnidadeId`) e cada seccional, o próprio id.
	 */
	const items = $derived.by<ExtraItem[]>(() => {
		if (!gise) return [];
		const list: ExtraItem[] = [];

		const temSupervisao = !!(
			gise.supervisor_id ||
			gise.assessor_id ||
			gise.seint1_id ||
			gise.seint2_id
		);

		if (temSupervisao && supervisaoExtraUnidadeId != null) {
			const disponivel = !!gise.assinaturasRelatorioExtraIds?.includes(supervisaoExtraUnidadeId);
			list.push({
				id: supervisaoExtraUnidadeId,
				nome: 'Quadro de Supervisão',
				disponivel
			});
		}

		if (gise.seccionais) {
			for (const sec of gise.seccionais) {
				const disponivel = !!gise.assinaturasRelatorioExtraIds?.includes(sec.id);
				list.push({
					id: sec.id,
					nome: sec.nome || `Seccional #${sec.id}`,
					disponivel
				});
			}
		}

		return list.sort((a, b) => Number(a.disponivel) - Number(b.disponivel));
	});

	const disponiveis = $derived(items.filter((i) => i.disponivel));
	/** Lote "Todos" só libera quando cada item da lista já tem assinatura. */
	const todosAssinados = $derived(items.length > 0 && disponiveis.length === items.length);

	function baixarItem(id: number, comManifesto = false) {
		if (!gise) return;
		const url = `/api/gise/${gise.id}/download?format=extraordinario&seccionalId=${id}${comManifesto ? '&manifesto=true' : ''}`;
		window.open(url, '_blank');
	}

	/**
	 * "Baixar todos" dispara um clique por arquivo com 250 ms de intervalo — o
	 * navegador bloqueia downloads em rajada disparados no mesmo tick.
	 */
	async function baixarTodos(comManifesto = false) {
		if (!gise || !todosAssinados) return;
		for (const item of disponiveis) {
			const a = document.createElement('a');
			a.href = `/api/gise/${gise.id}/download?format=extraordinario&seccionalId=${item.id}${comManifesto ? '&manifesto=true' : ''}`;
			a.target = '_blank';
			a.click();
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
	}
</script>

<!--
	Exceção deliberada ao ModalShell: a lista de downloads controla o próprio
	scroll. O card cresce até ~92vh; só a lista rola quando o conteúdo estoura
	esse teto (header/footer fixos).
-->
<Dialog
	{open}
	onOpenChange={(e) => {
		open = e.open;
	}}
>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm"
	>
		<div
			class="card-elevated rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4 max-h-[92vh] overflow-hidden flex flex-col"
		>
			<div
				class="flex items-center justify-between border-b border-surface-200 dark:border-surface-800 pb-3 shrink-0"
			>
				<div class="min-w-0">
					<Dialog.Title class="text-lg font-bold text-surface-900 dark:text-surface-50">
						Relatórios de Extra (GISE)
					</Dialog.Title>
					<p class="text-xs text-surface-600 dark:text-surface-400 mt-0.5">
						Escala de {gise ? gise.data_inicio : ''}
					</p>
				</div>
				<button
					type="button"
					class="btn btn-sm preset-outlined-surface-500 p-1.5 rounded-lg text-surface-500 hover:text-surface-800 dark:hover:text-surface-200"
					onclick={() => (open = false)}
				>
					<X size={18} />
				</button>
			</div>

			<div class="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
				{#if items.length === 0}
					<div class="text-center py-6 text-sm text-surface-600 dark:text-surface-400">
						Nenhum relatório de extra configurado para esta escala.
					</div>
				{:else}
					{#each items as item (item.id)}
						<div
							class="flex items-center justify-between p-3 rounded-xl border transition-all duration-150 bg-white dark:bg-surface-800/40 hover:bg-surface-100 dark:hover:bg-surface-800
								{item.disponivel
								? 'border-success-500/30 dark:border-success-500/20'
								: 'border-surface-200 dark:border-surface-800'}"
						>
							<div class="flex items-center gap-3 min-w-0">
								<div
									class="p-2 rounded-lg shrink-0
										{item.disponivel
										? 'bg-success-500/10 text-success-600 dark:text-success-400'
										: 'bg-surface-100 dark:bg-surface-800 text-surface-400 dark:text-surface-500'}"
								>
									<FileText size={18} />
								</div>
								<div class="min-w-0">
									<p
										class="text-xs font-semibold text-surface-800 dark:text-surface-200 truncate leading-snug"
									>
										{item.nome}
									</p>
									<div class="flex items-center gap-1 mt-0.5">
										{#if item.disponivel}
											<CheckCircle2
												size={12}
												class="text-success-600 dark:text-success-400 shrink-0"
											/>
											<span class="text-3xs text-success-700 dark:text-success-400 font-medium"
												>Assinado (Disponível)</span
											>
										{:else}
											<Clock size={12} class="text-warning-600 dark:text-warning-500 shrink-0" />
											<span class="text-3xs text-warning-700 dark:text-warning-500 font-medium"
												>Pendente (Não assinado)</span
											>
										{/if}
									</div>
								</div>
							</div>

							{#if item.disponivel}
								<div class="flex gap-1 shrink-0">
									<button
										type="button"
										class="btn btn-sm rounded-lg px-2 py-1.5 transition-all bg-primary-500/10 hover:bg-primary-500 text-primary-600 hover:text-white dark:text-primary-400 text-3xs font-bold leading-tight"
										onclick={() => baixarItem(item.id, false)}
										title={podeManifesto
											? 'Baixar sem manifesto (para impressão)'
											: 'Baixar relatório assinado'}
									>
										<Download size={13} class="shrink-0" />
									</button>
									{#if podeManifesto}
										<button
											type="button"
											class="btn btn-sm rounded-lg px-2 py-1.5 transition-all bg-tertiary-500/10 hover:bg-tertiary-500 text-tertiary-600 hover:text-white dark:text-tertiary-400 text-3xs font-bold leading-tight"
											onclick={() => baixarItem(item.id, true)}
											title="Baixar com manifesto (folha de auditoria)"
										>
											<Download size={13} class="shrink-0" />
											<span class="hidden sm:inline">+</span>
										</button>
									{/if}
								</div>
							{:else}
								<button
									type="button"
									class="btn btn-sm rounded-lg px-2 py-1.5 transition-all shrink-0 bg-warning-500/10 hover:bg-warning-500 text-warning-700 hover:text-white dark:text-warning-400 text-3xs font-bold leading-tight"
									onclick={() => baixarItem(item.id, false)}
									title="Baixar via de conferência (rascunho sem assinatura)"
								>
									<Download size={13} class="shrink-0" />
								</button>
							{/if}
						</div>
					{/each}
				{/if}
			</div>

			<div
				class="border-t border-surface-200 dark:border-surface-800 pt-3 flex flex-col sm:flex-row items-center gap-3 shrink-0"
			>
				<div
					class="text-2xs text-surface-600 dark:text-surface-400 font-medium text-center sm:text-left flex-1"
				>
					{disponiveis.length} de {items.length} relatórios disponíveis
				</div>
				<div class="flex flex-row flex-nowrap justify-end gap-2 w-full sm:w-auto">
					<span
						class="inline-flex"
						title={todosAssinados
							? undefined
							: 'Disponível após a assinatura de todos os relatórios'}
					>
						<button
							type="button"
							class="btn text-xs px-3 py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 transition-all {todosAssinados
								? 'preset-filled-primary-500'
								: 'bg-surface-200 text-surface-700 dark:bg-surface-700 dark:text-surface-200 cursor-not-allowed'}"
							disabled={!todosAssinados}
							onclick={() => baixarTodos(false)}
							title={todosAssinados
								? podeManifesto
									? 'Baixar todos sem manifesto (para impressão)'
									: 'Baixar todos os relatórios assinados'
								: undefined}
						>
							<Download size={14} />
							{podeManifesto ? 'Todos s/ manifesto' : 'Baixar todos'}
						</button>
					</span>
					{#if podeManifesto}
						<span
							class="inline-flex"
							title={todosAssinados
								? undefined
								: 'Disponível após a assinatura de todos os relatórios'}
						>
							<button
								type="button"
								class="btn text-xs px-3 py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 transition-all {todosAssinados
									? 'preset-filled-tertiary-500'
									: 'bg-surface-200 text-surface-700 dark:bg-surface-700 dark:text-surface-200 cursor-not-allowed'}"
								disabled={!todosAssinados}
								onclick={() => baixarTodos(true)}
								title={todosAssinados
									? 'Baixar todos com manifesto (folha de auditoria)'
									: undefined}
							>
								<Download size={14} />
								Todos c/ manifesto
							</button>
						</span>
					{/if}
				</div>
			</div>
		</div>
	</Dialog.Content>
</Dialog>
