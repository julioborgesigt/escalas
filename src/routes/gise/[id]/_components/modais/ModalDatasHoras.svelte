<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';

	interface Props {
		open: boolean;
		pendingCrud: boolean;
		editaBloqueado: boolean;
		dataInicio: string;
		horaEntrada: string;
		horaSaida: string;
		onClose: () => void;
		onSubmit: SubmitFunction;
		normalizarHora: (v: string) => string | null;
		validarHora: (v: string) => boolean;
	}

	let {
		open,
		pendingCrud,
		editaBloqueado,
		dataInicio = $bindable(),
		horaEntrada = $bindable(),
		horaSaida = $bindable(),
		onClose,
		onSubmit,
		normalizarHora,
		validarHora
	}: Props = $props();
</script>

{#if open}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
		<div
			class="bg-surface-50 dark:bg-surface-900 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4"
		>
			<h2 class="text-lg font-bold text-surface-900 dark:text-surface-50">
				Editar Data e Horários
			</h2>
			{#if editaBloqueado}
				<div
					class="rounded-xl bg-warning-500/10 border border-warning-500/30 px-4 py-2 text-sm text-warning-700 dark:text-warning-400"
				>
					⚠️ A assinatura digital será <strong>revogada</strong> ao salvar.
				</div>
			{/if}
			<div>
				<label
					for="editDataInicio"
					class="text-sm font-medium text-surface-600 dark:text-surface-400 block mb-1">Data</label
				>
				<input
					id="editDataInicio"
					type="date"
					bind:value={dataInicio}
					class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
				/>
			</div>
			<div class="rounded-xl border border-surface-200 dark:border-surface-700 p-3 space-y-2">
				<p class="text-sm font-semibold text-surface-600 dark:text-surface-400">Horários</p>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="editHoraEntrada" class="text-sm text-surface-500 block mb-1">Entrada</label>
						<input
							id="editHoraEntrada"
							type="text"
							placeholder="Ex: 08:00"
							bind:value={horaEntrada}
							class="w-full px-3 py-2 rounded-xl border bg-white dark:bg-surface-800 text-sm {horaEntrada &&
							!validarHora(horaEntrada)
								? 'border-error-500'
								: 'border-surface-300 dark:border-surface-700'}"
						/>
					</div>
					<div>
						<label for="editHoraSaida" class="text-sm text-surface-500 block mb-1">Saída</label>
						<input
							id="editHoraSaida"
							type="text"
							placeholder="Ex: 16:00"
							bind:value={horaSaida}
							class="w-full px-3 py-2 rounded-xl border bg-white dark:bg-surface-800 text-sm {horaSaida &&
							!validarHora(horaSaida)
								? 'border-error-500'
								: 'border-surface-300 dark:border-surface-700'}"
						/>
					</div>
				</div>
				<p class="text-xs text-surface-400">Formato: HH:MM · ex: 08:00 · 14:30</p>
			</div>
			<div class="flex justify-end gap-3">
				<button
					type="button"
					class="btn preset-outlined-surface text-sm px-4 py-2 rounded-xl"
					onclick={onClose}>Cancelar</button
				>
				<form method="POST" action="?/salvarDatasHorarios" use:enhance={onSubmit} class="contents">
					<input type="hidden" name="data_inicio" value={dataInicio} />
					<input type="hidden" name="hora_entrada" value={normalizarHora(horaEntrada) ?? ''} />
					<input type="hidden" name="hora_saida" value={normalizarHora(horaSaida) ?? ''} />
					<button
						type="submit"
						class="btn preset-filled-primary-500 text-sm px-4 py-2 rounded-xl flex items-center gap-2"
						disabled={pendingCrud}
					>
						{pendingCrud ? 'Salvando...' : 'Salvar'}
					</button>
				</form>
			</div>
		</div>
	</div>
{/if}
