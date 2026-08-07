<script lang="ts">
	/**
	 * Card de KPI do console de auditoria / logs técnicos — rótulo uppercase +
	 * valor grande. Com `destaque` e valor numérico > 0, o número fica em vermelho.
	 */
	const {
		rotulo,
		valor,
		destaque = false
	}: {
		rotulo: string;
		valor: string | number;
		destaque?: boolean;
	} = $props();
</script>

<div
	class="rounded-xl border border-surface-200 dark:border-white/10 bg-surface-50 dark:bg-surface-900 p-4 flex flex-col justify-between min-h-[90px]"
>
	<div class="text-xs uppercase tracking-wide text-surface-600 dark:text-surface-400">
		{rotulo}
	</div>
	<div
		class="mt-1 text-lg sm:text-2xl font-bold truncate {destaque && Number(valor) > 0
			? 'text-error-600 dark:text-error-400'
			: 'text-surface-900 dark:text-white'}"
		title={String(valor)}
	>
		{valor}
	</div>
</div>
