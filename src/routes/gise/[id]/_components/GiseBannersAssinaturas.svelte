<script lang="ts">
	interface DocumentoAssinadoInfo {
		existe: boolean;
		assinante_nome: string;
		assinante_cpf: string;
		data: string;
		verificacao_hash: string | null;
	}

	interface AssinaturaRelatorio {
		tipo: string;
		assinante_nome: string;
		[key: string]: unknown;
	}

	interface Props {
		documentoAssinadoInfo: DocumentoAssinadoInfo | null;
		assinaturasRelatorios: AssinaturaRelatorio[] | undefined;
	}

	let { documentoAssinadoInfo, assinaturasRelatorios }: Props = $props();

	const extraordinarios = $derived(
		(assinaturasRelatorios ?? []).filter((a) => a.tipo === 'extraordinario')
	);
</script>

<div class="space-y-3">
	{#if documentoAssinadoInfo?.existe}
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
					Escala GISE Assinada
				</h3>
				<p class="text-sm text-surface-600 dark:text-surface-300 mt-1 font-medium">
					Assinado por {documentoAssinadoInfo.assinante_nome}.
				</p>
			</div>
		</div>
	{/if}

	{#each extraordinarios as assRel}
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
					Relatório Extraordinário Assinado
				</h3>
				<p class="text-sm text-surface-600 dark:text-surface-300 mt-1 font-medium">
					Assinado por {assRel.assinante_nome}.
				</p>
			</div>
		</div>
	{/each}
</div>
