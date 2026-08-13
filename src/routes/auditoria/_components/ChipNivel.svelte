<script lang="ts">
	/**
	 * Chip de severidade (trilha forense) ou nível (log técnico) em `/auditoria`.
	 * As duas telas usavam o mesmo `<span>` com mapas locais; as chaves diferem
	 * (`info`/`aviso`/`critico` vs `warn`/`error`) e o visual é o mesmo.
	 */
	const TOM: Record<string, { label: string; cls: string }> = {
		info: { label: 'Info', cls: 'bg-surface-300/40 text-surface-700 dark:text-surface-200' },
		aviso: { label: 'Aviso', cls: 'bg-warning-500/20 text-warning-700 dark:text-warning-300' },
		warn: { label: 'Aviso', cls: 'bg-warning-500/20 text-warning-700 dark:text-warning-300' },
		critico: { label: 'Crítico', cls: 'bg-error-500/20 text-error-700 dark:text-error-300' },
		error: { label: 'Erro', cls: 'bg-error-500/20 text-error-700 dark:text-error-300' }
	};

	const {
		nivel,
		fallback = 'info'
	}: {
		nivel: string | null | undefined;
		fallback?: string;
	} = $props();

	const tom = $derived(TOM[nivel ?? ''] ?? TOM[fallback] ?? TOM.info);
</script>

<span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium {tom.cls}">
	{tom.label}
</span>
