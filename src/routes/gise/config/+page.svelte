<script lang="ts">
	/**
	 * Configurações do módulo GISE (Admin Geral): as VAGAS padrão de cada equipe
	 * nova — quantos DPC e OIP — e os textos fixos dos relatórios de extra.
	 *
	 * As vagas valem apenas para equipes CRIADAS DEPOIS: cada equipe guarda as
	 * suas em `slots_dpc`/`slots_oip`, então mudar aqui não redimensiona GISE em
	 * andamento. É preset, não política retroativa.
	 */
	import type { PageProps } from './$types';
	import { enhance } from '$app/forms';
	import { loading } from '$lib/loading.svelte';
	import { toaster } from '$lib/toast';

	const { data }: PageProps = $props();

	const vagas = $derived(data.vagas);
</script>

<svelte:head>
	<title>Config. GISE | Escalas</title>
</svelte:head>

<div class="min-w-0 space-y-6">
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 sm:mb-8">
		<div class="min-w-0">
			<h1 class="h1 text-2xl font-bold">Configurações GISE</h1>
			<p class="text-sm text-surface-600 dark:text-surface-400 mt-0.5">
				Vagas padrão por unidade e textos dos relatórios de extra.
			</p>
		</div>
	</div>

	<form
		method="POST"
		action="?/salvar"
		class="min-w-0"
		use:enhance={() => {
			loading.show('A gravar…');
			return async ({ result, update }) => {
				loading.hide();
				if (
					result.type === 'success' &&
					'data' in result &&
					(result.data as { success?: boolean })?.success
				) {
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
		<div class="grid min-w-0 gap-6 lg:grid-cols-2 lg:items-start">
			<!-- Card 1: Vagas padrão por unidade -->
			<section class="card-elevated min-w-0 rounded-2xl p-5 sm:p-6 space-y-4">
				<div>
					<h2 class="text-base font-semibold">Vagas padrão por unidade</h2>
					<p class="text-sm text-surface-600 dark:text-surface-400 mt-1">
						Preset para equipes criadas depois — não redimensiona GISE em andamento.
					</p>
				</div>

				<div class="rounded-xl border border-surface-200/70 bg-surface-50 dark:border-white/10 dark:bg-surface-800/40 p-4 space-y-3">
					<p class="text-sm font-semibold">Equipe operacional</p>
					<div class="flex flex-wrap items-center gap-3 sm:gap-4">
						<div class="flex items-center gap-2">
							<label class="text-sm text-surface-600 dark:text-surface-400 w-8" for="op_dpc"
								>DPC</label
							>
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
						<div class="flex items-center gap-2">
							<label class="text-sm text-surface-600 dark:text-surface-400 w-8" for="op_oip"
								>OIP</label
							>
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

				<div class="rounded-xl border border-surface-200/70 bg-surface-50 dark:border-white/10 dark:bg-surface-800/40 p-4 space-y-3">
					<p class="text-sm font-semibold">Equipe SEINT</p>
					<div class="flex flex-wrap items-center gap-3 sm:gap-4">
						<div class="flex items-center gap-2">
							<label class="text-sm text-surface-600 dark:text-surface-400 w-8" for="seint_dpc"
								>DPC</label
							>
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
						<div class="flex items-center gap-2">
							<label class="text-sm text-surface-600 dark:text-surface-400 w-8" for="seint_oip"
								>OIP</label
							>
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

				<div class="rounded-xl border border-surface-200/70 bg-surface-50 dark:border-white/10 dark:bg-surface-800/40 p-4 space-y-3">
					<p class="text-sm font-semibold">Horário padrão da GISE</p>
					<div class="flex flex-wrap items-center gap-3 sm:gap-4">
						<div class="flex min-w-0 items-center gap-2">
							<label
								class="shrink-0 text-sm text-surface-600 dark:text-surface-400"
								for="default_hora_entrada">Entrada</label
							>
							<input
								id="default_hora_entrada"
								name="default_hora_entrada"
								type="text"
								placeholder="08:00"
								class="w-20 px-2 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm"
								value={data.defaultHoraEntrada}
							/>
						</div>
						<div class="flex min-w-0 items-center gap-2">
							<label
								class="shrink-0 text-sm text-surface-600 dark:text-surface-400"
								for="default_hora_saida">Saída</label
							>
							<input
								id="default_hora_saida"
								name="default_hora_saida"
								type="text"
								placeholder="16:00"
								class="w-20 px-2 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm"
								value={data.defaultHoraSaida}
							/>
						</div>
					</div>
				</div>
			</section>

			<!-- Card 2: Texto Breve relatório -->
			<section class="card-elevated min-w-0 rounded-2xl p-5 sm:p-6 space-y-4">
				<div>
					<h2 class="text-base font-semibold">Texto "Breve relatório"</h2>
					<p class="text-sm text-surface-600 dark:text-surface-400 mt-1">
						Textos usados nos PDFs de extra.
					</p>
				</div>

				<div class="min-w-0">
					<label for="breve_tit" class="block text-sm font-medium mb-1">Título (rótulo)</label>
					<input
						id="breve_tit"
						name="breve_titulo"
						type="text"
						class="w-full min-w-0 max-w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm"
						value={data.breveForm.titulo}
					/>
				</div>
				<div class="min-w-0">
					<label for="breve_sec" class="block text-sm font-medium mb-1"
						>Parágrafo – extra por <strong>seccional</strong></label
					>
					<textarea
						id="breve_sec"
						name="breve_texto_seccional"
						rows="4"
						class="w-full min-w-0 max-w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm min-h-[110px] resize-y break-words"
						value={data.breveForm.textoSeccional}></textarea>
				</div>
				<div class="min-w-0">
					<label for="breve_sup" class="block text-sm font-medium mb-1"
						>Parágrafo – extra de <strong>supervisão</strong></label
					>
					<textarea
						id="breve_sup"
						name="breve_texto_supervisao"
						rows="4"
						class="w-full min-w-0 max-w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm min-h-[110px] resize-y break-words"
						value={data.breveForm.textoSupervisao}></textarea>
				</div>
			</section>
		</div>

		<div class="flex justify-end border-t border-surface-200 dark:border-white/10 pt-4 mt-6">
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
