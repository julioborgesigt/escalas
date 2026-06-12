<script lang="ts">
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import { Download, FileText, CheckCircle2, Clock, X } from 'lucide-svelte';

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
		supervisaoExtraUnidadeId
	}: {
		open: boolean;
		gise: GiseEscala | null;
		supervisaoExtraUnidadeId: number | null;
	} = $props();

	type ExtraItem = {
		id: number;
		nome: string;
		disponivel: boolean;
	};

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

		return list;
	});

	const disponiveis = $derived(items.filter((i) => i.disponivel));

	function baixarItem(id: number) {
		if (!gise) return;
		window.open(`/api/gise/${gise.id}/download?format=extraordinario&seccionalId=${id}`, '_blank');
	}

	async function baixarTodos() {
		if (!gise || disponiveis.length === 0) return;
		for (const item of disponiveis) {
			const a = document.createElement('a');
			a.href = `/api/gise/${gise.id}/download?format=extraordinario&seccionalId=${item.id}`;
			a.target = '_blank';
			a.click();
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
	}
</script>

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
			class="bg-surface-50 dark:bg-surface-900 rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4 max-h-[85vh] overflow-y-auto border border-surface-200 dark:border-white/10 flex flex-col"
		>
			<div
				class="flex items-center justify-between border-b border-surface-200 dark:border-surface-800 pb-3"
			>
				<div class="min-w-0">
					<Dialog.Title class="text-lg font-bold text-surface-900 dark:text-surface-50">
						Relatórios de Extra (GISE)
					</Dialog.Title>
					<p class="text-xs text-surface-505 dark:text-surface-400 mt-0.5">
						Escala de {gise ? gise.data_inicio : ''}
					</p>
				</div>
				<button
					type="button"
					class="btn btn-sm preset-outlined-surface-500 p-1.5 rounded-lg text-surface-500 hover:text-surface-850 dark:hover:text-surface-200"
					onclick={() => (open = false)}
				>
					<X size={18} />
				</button>
			</div>

			<div class="flex-1 overflow-y-auto space-y-2 pr-1 max-h-[50vh]">
				{#if items.length === 0}
					<div class="text-center py-6 text-sm text-surface-400">
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
											<span
												class="text-[0.65rem] text-success-700 dark:text-success-400 font-medium"
												>Assinado (Disponível)</span
											>
										{:else}
											<Clock size={12} class="text-warning-600 dark:text-warning-500 shrink-0" />
											<span
												class="text-[0.65rem] text-warning-700 dark:text-warning-500 font-medium"
												>Pendente (Não assinado)</span
											>
										{/if}
									</div>
								</div>
							</div>

							<button
								type="button"
								class="btn btn-sm rounded-lg p-1.5 transition-all shrink-0
									{item.disponivel
									? 'bg-primary-500/10 hover:bg-primary-500 text-primary-600 hover:text-white dark:text-primary-400'
									: 'bg-surface-100 dark:bg-surface-800 text-surface-300 dark:text-surface-700 cursor-not-allowed'}"
								disabled={!item.disponivel}
								onclick={() => baixarItem(item.id)}
								title={item.disponivel ? 'Baixar relatório' : 'Aguardando assinatura'}
							>
								<Download size={16} />
							</button>
						</div>
					{/each}
				{/if}
			</div>

			<div
				class="border-t border-surface-200 dark:border-surface-800 pt-3 flex flex-col sm:flex-row items-center gap-3"
			>
				<div class="text-[0.7rem] text-surface-500 font-medium text-center sm:text-left flex-1">
					{disponiveis.length} de {items.length} relatórios disponíveis
				</div>
				<div class="flex justify-end gap-2 w-full sm:w-auto">
					<button
						type="button"
						class="btn preset-outlined-surface-500 text-xs px-4 py-2 rounded-xl w-full sm:w-auto font-semibold"
						onclick={() => (open = false)}
					>
						Fechar
					</button>
					<button
						type="button"
						class="btn preset-filled-primary-500 text-xs px-4 py-2 rounded-xl w-full sm:w-auto font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95 disabled:preset-filled-surface-200 disabled:dark:preset-filled-surface-800 disabled:text-surface-400 disabled:cursor-not-allowed"
						disabled={disponiveis.length === 0}
						onclick={baixarTodos}
					>
						<Download size={14} />
						Baixar todos
					</button>
				</div>
			</div>
		</div>
	</Dialog.Content>
</Dialog>
