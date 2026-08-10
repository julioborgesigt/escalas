<script lang="ts">
	/**
	 * Configuração de escala de uma operação: vagas padrão das equipes, horário
	 * padrão e os textos do breve relatório dos PDFs de extra.
	 *
	 * Era a tela global `/gise/config`. Virou por operação porque é isso que ela
	 * descreve — o tamanho da equipe e o texto do documento são da força-tarefa,
	 * não do sistema.
	 *
	 * A regra que a tela precisa comunicar em cada campo: **vazio herda**. O
	 * `placeholder` mostra o que vale se nada for escrito, e a legenda ao pé de
	 * cada bloco diz de onde esse valor vem. Sem isso, um campo em branco parece
	 * "zero" ou "sem texto", que são coisas diferentes de "usa o padrão".
	 */
	import type { PageProps } from './$types';
	import { enhance } from '$app/forms';
	import { loading } from '$lib/loading.svelte';
	import { toaster } from '$lib/toast';
	import BotaoVoltar from '$lib/components/BotaoVoltar.svelte';

	const { data }: PageProps = $props();
	const op = $derived(data.operacao);
	const herdado = $derived(data.herdado);

	const CAMPO_NUM =
		'w-20 px-2 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm';
	const CAMPO_TXT =
		'w-full min-w-0 max-w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm';

	/** `null` vira `''` — é o que faz o campo aparecer vazio e, assim, herdar. */
	function ouVazio(v: number | string | null | undefined): string {
		return v === null || v === undefined ? '' : String(v);
	}
</script>

<svelte:head>
	<title>Configurações · {op.nome} | Escalas</title>
</svelte:head>

<div class="min-w-0 max-w-3xl space-y-6">
	<BotaoVoltar href="/gise/operacoes" />

	<div class="min-w-0">
		<h1 class="h1 text-2xl font-bold">Configurações da operação</h1>
		<p class="text-sm text-surface-600 dark:text-surface-400 mt-0.5">
			{op.nome} — vagas padrão, horário e textos do relatório de extra.
		</p>
	</div>

	<div
		class="rounded-xl border border-primary-500/25 bg-primary-500/5 dark:bg-primary-500/10 p-4 text-sm"
	>
		<p class="text-surface-700 dark:text-surface-300">
			<strong>Campo vazio herda o padrão do sistema.</strong> O valor cinza dentro de cada campo é o
			que vale se você não escrever nada. Zero não é o mesmo que vazio: <code>0</code> significa “esta
			equipe não tem essa vaga”.
		</p>
	</div>

	<form
		method="POST"
		action="?/salvar"
		class="min-w-0 space-y-6"
		use:enhance={() => {
			loading.show('A gravar…');
			return async ({ result, update }) => {
				loading.hide();
				if (result.type === 'success') {
					toaster.success({ title: `Configurações de ${op.nome} salvas` });
					await update({ reset: false });
				} else if (result.type === 'failure') {
					const err = (result.data as { error?: string } | undefined)?.error;
					toaster.error({ title: err || 'Não foi possível guardar' });
				} else {
					await update({ reset: false });
				}
			};
		}}
	>
		<section class="card-elevated min-w-0 rounded-2xl p-5 sm:p-6 space-y-4">
			<div>
				<h2 class="text-base font-semibold">Vagas padrão por unidade</h2>
				<p class="text-sm text-surface-600 dark:text-surface-400 mt-1">
					Aplicadas às equipes criadas <strong>depois</strong> — não redimensiona escala em andamento.
				</p>
			</div>

			{#if op.usa_equipe_operacional}
				<div
					class="rounded-xl border border-surface-200/70 bg-surface-50 dark:border-white/10 dark:bg-surface-800/40 p-4 space-y-3"
				>
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
								placeholder={String(herdado.vagas.operacional.dpc)}
								value={ouVazio(op.vagas_operacional_dpc)}
								class={CAMPO_NUM}
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
								placeholder={String(herdado.vagas.operacional.oip)}
								value={ouVazio(op.vagas_operacional_oip)}
								class={CAMPO_NUM}
							/>
						</div>
					</div>
				</div>
			{/if}

			{#if op.usa_equipe_seint}
				<div
					class="rounded-xl border border-surface-200/70 bg-surface-50 dark:border-white/10 dark:bg-surface-800/40 p-4 space-y-3"
				>
					<p class="text-sm font-semibold">Equipe de inteligência (SEINT)</p>
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
								placeholder={String(herdado.vagas.seint.dpc)}
								value={ouVazio(op.vagas_seint_dpc)}
								class={CAMPO_NUM}
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
								placeholder={String(herdado.vagas.seint.oip)}
								value={ouVazio(op.vagas_seint_oip)}
								class={CAMPO_NUM}
							/>
						</div>
					</div>
				</div>
			{/if}

			{#if !op.usa_equipe_operacional || !op.usa_equipe_seint}
				<p class="text-2xs text-surface-600 dark:text-surface-400">
					Só aparece o tipo de equipe que esta operação usa. Para mudar isso, edite a operação em
					<a href="/gise/operacoes" class="anchor">Operações</a>.
				</p>
			{/if}

			<div
				class="rounded-xl border border-surface-200/70 bg-surface-50 dark:border-white/10 dark:bg-surface-800/40 p-4 space-y-3"
			>
				<p class="text-sm font-semibold">Horário padrão das escalas</p>
				<div class="flex flex-wrap items-center gap-3 sm:gap-4">
					<div class="flex min-w-0 items-center gap-2">
						<label
							class="shrink-0 text-sm text-surface-600 dark:text-surface-400"
							for="hora_entrada">Entrada</label
						>
						<input
							id="hora_entrada"
							name="hora_entrada"
							type="text"
							placeholder={herdado.horaEntrada}
							value={ouVazio(op.hora_entrada_padrao)}
							class={CAMPO_NUM}
						/>
					</div>
					<div class="flex min-w-0 items-center gap-2">
						<label class="shrink-0 text-sm text-surface-600 dark:text-surface-400" for="hora_saida"
							>Saída</label
						>
						<input
							id="hora_saida"
							name="hora_saida"
							type="text"
							placeholder={herdado.horaSaida}
							value={ouVazio(op.hora_saida_padrao)}
							class={CAMPO_NUM}
						/>
					</div>
				</div>
			</div>
		</section>

		<section class="card-elevated min-w-0 rounded-2xl p-5 sm:p-6 space-y-4">
			<div>
				<h2 class="text-base font-semibold">Texto “Breve relatório”</h2>
				<p class="text-sm text-surface-600 dark:text-surface-400 mt-1">
					Vai nos PDFs de extra desta operação. Diferente das vagas, este texto é lido na hora de
					gerar o PDF — vale também para escalas já criadas que ainda não foram assinadas.
				</p>
			</div>

			<div class="min-w-0">
				<label for="breve_tit" class="block text-sm font-medium mb-1">Título (rótulo)</label>
				<input
					id="breve_tit"
					name="breve_titulo"
					type="text"
					maxlength="200"
					placeholder={herdado.breveTitulo}
					value={ouVazio(op.breve_relatorio_titulo)}
					class={CAMPO_TXT}
				/>
			</div>

			<div class="min-w-0">
				<label for="breve_sec" class="block text-sm font-medium mb-1">
					Parágrafo — extra por <strong>seccional</strong>
				</label>
				<textarea
					id="breve_sec"
					name="breve_texto_seccional"
					rows="4"
					maxlength="2000"
					placeholder={herdado.breveTextoSeccional}
					class="{CAMPO_TXT} min-h-[110px] resize-y break-words"
					>{ouVazio(op.breve_relatorio_texto_seccional)}</textarea
				>
			</div>

			<div class="min-w-0">
				<label for="breve_sup" class="block text-sm font-medium mb-1">
					Parágrafo — extra de <strong>supervisão</strong>
				</label>
				<textarea
					id="breve_sup"
					name="breve_texto_supervisao"
					rows="4"
					maxlength="2000"
					placeholder={herdado.breveTextoSupervisao}
					class="{CAMPO_TXT} min-h-[110px] resize-y break-words"
					>{ouVazio(op.breve_relatorio_texto_supervisao)}</textarea
				>
			</div>
		</section>

		<div class="flex justify-end border-t border-surface-200 dark:border-white/10 pt-4">
			<button
				type="submit"
				class="btn preset-filled-primary-500 px-6 py-2.5 rounded-xl font-semibold"
				disabled={loading.active}
			>
				{loading.active ? 'A gravar…' : 'Guardar'}
			</button>
		</div>
	</form>
</div>
