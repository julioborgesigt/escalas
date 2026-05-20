<script lang="ts">
	import { enhance } from '$app/forms';
	import { loading } from '$lib/loading.svelte';
	import { toaster } from '$lib/toast';

	let { data } = $props();

	const vagas = $derived(data.vagas);
</script>

<svelte:head>
	<title>Config. GISE | Escalas</title>
</svelte:head>

<div class="max-w-2xl mx-auto space-y-6">
	<div class="flex flex-col gap-1">
		<h1 class="text-xl font-bold text-surface-900 dark:text-surface-50 sm:text-2xl">Configurações GISE</h1>
		<p class="text-sm text-surface-500 dark:text-surface-400">Vagas padrão por unidade e textos dos relatórios de extra.</p>
	</div>

	<form
		method="POST"
		action="?/salvar"
		class="space-y-8"
		use:enhance={() => {
			loading.show('A gravar…');
			return async ({ result, update }) => {
				loading.hide();
				if (result.type === 'success' && 'data' in result && (result.data as { success?: boolean })?.success) {
					toaster.success({ title: 'Configurações GISE salvas' });
					await update({ reset: false });
				} else if (result.type === 'failure' && 'data' in result) {
					const err = (result.data as { error?: string } | undefined)?.error;
					toaster.error({ title: err || 'Não foi possível guardar' });
				} else {
					await update({ reset: false });
				}
			};
		}}
	>
		<div
			class="card p-4 sm:p-6 bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-white/10 rounded-2xl space-y-4"
		>
			<h2 class="text-lg font-semibold text-surface-900 dark:text-surface-50">Vagas padrão por unidade</h2>
			
			<div class="grid sm:grid-cols-2 gap-6">
				<div
					class="rounded-xl border border-surface-200 dark:border-surface-700 p-4 space-y-3 bg-surface-100/50 dark:bg-surface-800/30"
				>
					<p class="text-sm font-semibold text-surface-800 dark:text-surface-100">Equipe operacional</p>
					<div class="flex flex-wrap items-center gap-x-6 gap-y-2">
						<div class="flex flex-wrap items-center gap-2">
							<label class="text-sm text-surface-600 dark:text-surface-400" for="op_dpc">DPC</label>
							<input
								id="op_dpc"
								name="op_dpc"
								type="number"
								min="0"
								max="999"
								class="w-20 px-2 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm"
								value={vagas.operacional.dpc}
							/>
						</div>
						<div class="flex flex-wrap items-center gap-2">
							<label class="text-sm text-surface-600 dark:text-surface-400" for="op_oip">OIP</label>
							<input
								id="op_oip"
								name="op_oip"
								type="number"
								min="0"
								max="999"
								class="w-20 px-2 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm"
								value={vagas.operacional.oip}
							/>
						</div>
					</div>
				</div>
				<div
					class="rounded-xl border border-surface-200 dark:border-surface-700 p-4 space-y-3 bg-surface-100/50 dark:bg-surface-800/30"
				>
					<p class="text-sm font-semibold text-surface-800 dark:text-surface-100">Equipe SEINT</p>
					<div class="flex flex-wrap items-center gap-x-6 gap-y-2">
						<div class="flex flex-wrap items-center gap-2">
							<label class="text-sm text-surface-600 dark:text-surface-400" for="seint_dpc">DPC</label>
							<input
								id="seint_dpc"
								name="seint_dpc"
								type="number"
								min="0"
								max="999"
								class="w-20 px-2 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm"
								value={vagas.seint.dpc}
							/>
						</div>
						<div class="flex flex-wrap items-center gap-2">
							<label class="text-sm text-surface-600 dark:text-surface-400" for="seint_oip">OIP</label>
							<input
								id="seint_oip"
								name="seint_oip"
								type="number"
								min="0"
								max="999"
								class="w-20 px-2 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm"
								value={vagas.seint.oip}
							/>
						</div>
					</div>
				</div>
			</div>
		</div>

		<div
			class="card p-4 sm:p-6 bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-white/10 rounded-2xl space-y-4"
		>
			<h2 class="text-lg font-semibold text-surface-900 dark:text-surface-50">Texto "Breve relatório"</h2>
			
			<div>
				<label for="breve_tit" class="block text-sm font-medium mb-1">Título (rótulo)</label>
				<input
					id="breve_tit"
					name="breve_titulo"
					type="text"
					class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm"
					value={data.breveForm.titulo}
				/>
			</div>
			<div>
				<label for="breve_sec" class="block text-sm font-medium mb-1"
					>Parágrafo – extra por <strong>seccional</strong></label
				>
				<textarea
					id="breve_sec"
					name="breve_texto_seccional"
					rows="4"
					class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm min-h-[110px] resize-y"
					value={data.breveForm.textoSeccional}
				></textarea>
			</div>
			<div>
				<label for="breve_sup" class="block text-sm font-medium mb-1"
					>Parágrafo – extra de <strong>supervisão</strong></label
				>
				<textarea
					id="breve_sup"
					name="breve_texto_supervisao"
					rows="4"
					class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm min-h-[110px] resize-y"
					value={data.breveForm.textoSupervisao}
				></textarea>
			</div>
		</div>

		<div class="flex justify-end">
			<button
				type="submit"
				class="btn preset-filled-primary-500 px-6 py-2 rounded-xl font-semibold"
				disabled={loading.active}
			>
				{loading.active ? 'A gravar…' : 'Guardar'}
			</button>
		</div>
	</form>
</div>
