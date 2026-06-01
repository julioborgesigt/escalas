<script lang="ts">
	interface AssinaturaRelatorio {
		tipo: string;
		seccional_id: number;
		assinante_nome: string;
		[key: string]: unknown;
	}

	interface SeccionalNome {
		seccional_id: number;
		seccional_nome: string;
	}

	interface Props {
		assinaturasRelatorios: AssinaturaRelatorio[] | undefined;
		/** Unidade sintética do quadro de supervisão — não é seccional operacional. */
		supervisaoExtraUnidadeId?: number | null;
		seccionais?: SeccionalNome[] | null;
	}

	const {
		assinaturasRelatorios,
		supervisaoExtraUnidadeId = null,
		seccionais = null
	}: Props = $props();

	const extraordinariosSeccionais = $derived(
		(assinaturasRelatorios ?? []).filter(
			(a) =>
				a.tipo === 'extraordinario' &&
				(supervisaoExtraUnidadeId == null || a.seccional_id !== supervisaoExtraUnidadeId)
		)
	);

	function nomeSeccional(seccionalId: number): string {
		const s = seccionais?.find((x) => x.seccional_id === seccionalId);
		return s?.seccional_nome?.trim() || `Seccional #${seccionalId}`;
	}
</script>

<div class="space-y-3">
	{#each extraordinariosSeccionais as assRel}
		<div
			class="rounded-2xl border border-success-500/30 bg-success-500/10 p-5 flex items-start gap-4 shadow-sm"
		>
			<div class="bg-success-500 text-white p-2 rounded-full mt-1">
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="3"
						d="M5 13l4 4L19 7"
					/></svg
				>
			</div>
			<div class="flex-1">
				<h3 class="font-bold text-success-800 dark:text-success-400 uppercase tracking-tight">
					Relatório extraordinário da seccional assinado
				</h3>
				<p class="text-sm text-surface-600 dark:text-surface-300 mt-1 font-medium">
					O relatório de extra da seccional <strong class="text-surface-800 dark:text-surface-100"
						>{nomeSeccional(assRel.seccional_id)}</strong
					>
					foi assinado por
					<strong class="text-surface-800 dark:text-surface-100">{assRel.assinante_nome}</strong>.
				</p>
			</div>
		</div>
	{/each}
</div>
