<script lang="ts">
	const {
		totalPoliciais,
		totalSelecionados,
		modoSelecao,
		pendingRemoverSelecionados,
		onSelecionarTodos,
		onRemoverSelecionados,
		onRemoverTodos,
		onIniciarSelecao,
		onCancelarSelecao
	}: {
		totalPoliciais: number;
		totalSelecionados: number;
		modoSelecao: boolean;
		pendingRemoverSelecionados: boolean;
		onSelecionarTodos: () => void;
		onRemoverSelecionados: () => void;
		onRemoverTodos: () => void;
		onIniciarSelecao: () => void;
		onCancelarSelecao: () => void;
	} = $props();
</script>

<div class="flex flex-wrap items-center justify-between gap-2 mb-3">
	{#if modoSelecao}
		<div class="flex items-center gap-2 flex-wrap">
			<span class="text-xs font-semibold text-surface-600 dark:text-surface-400">
				{totalSelecionados} selecionado(s)
			</span>
			<button
				type="button"
				class="btn text-xs px-3 py-1.5 rounded-xl border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
				onclick={onSelecionarTodos}
			>
				Selecionar Todos
			</button>
		</div>
		<div class="flex gap-2">
			<button
				type="button"
				class="btn text-xs font-semibold px-3 py-1.5 rounded-xl border border-error-500/40 bg-error-500/10 text-error-700 dark:text-error-400 hover:bg-error-500/20 transition-colors disabled:opacity-40"
				disabled={totalSelecionados === 0 || pendingRemoverSelecionados}
				onclick={onRemoverSelecionados}
			>
				Remover ({totalSelecionados})
			</button>
			<button
				type="button"
				class="btn text-xs px-3 py-1.5 rounded-xl border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
				onclick={onCancelarSelecao}
			>
				Cancelar
			</button>
		</div>
	{:else}
		<div></div>
		<div class="flex gap-2">
			<button
				type="button"
				class="btn text-xs px-3 py-1.5 rounded-xl border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
				onclick={onIniciarSelecao}
			>
				Selecionar
			</button>
			<button
				type="button"
				class="btn text-xs font-semibold px-3 py-1.5 rounded-xl border border-error-500/40 bg-error-500/10 text-error-700 dark:text-error-400 hover:bg-error-500/20 transition-colors"
				onclick={onRemoverTodos}
			>
				Remover Todos
			</button>
		</div>
	{/if}
</div>
