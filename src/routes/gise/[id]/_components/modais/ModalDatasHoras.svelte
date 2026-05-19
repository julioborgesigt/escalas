<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { toaster } from '$lib/toast';
	import { normalizarHora, validarHora } from '$lib/gise/gise-horarios';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';

	interface GiseInfo {
		data_inicio: string;
		hora_entrada: string | null;
		hora_saida: string | null;
		feriado?: boolean;
	}

	interface Props {
		open: boolean;
		pendingCrud: boolean;
		editaBloqueado: boolean;
		gise: GiseInfo;
		onClose: () => void;
		onSubmit: SubmitFunction;
	}

	let { open, pendingCrud, editaBloqueado, gise, onClose, onSubmit }: Props = $props();

	// Estado do calendário e horários
	let dataInicio = $state('');
	let feriado = $state(false);
	let horaEntrada = $state('');
	let horaSaida = $state('');

	// Lógica do calendário
	let calAno = $state(new Date().getFullYear());
	let calMes = $state(new Date().getMonth());

	const MESES_CAL = [
		'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
		'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
	];
	const DIAS_SEM_CAL = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

	const calTitulo = $derived(`${MESES_CAL[calMes]} de ${calAno}`);
	const gradeCalendario = $derived.by(() => {
		const first = new Date(calAno, calMes, 1).getDay();
		const n = new Date(calAno, calMes + 1, 0).getDate();
		const cells: ({ day: number } | null)[] = [];
		for (let i = 0; i < first; i++) cells.push(null);
		for (let d = 1; d <= n; d++) cells.push({ day: d });
		while (cells.length % 7 !== 0) cells.push(null);
		return cells;
	});

	function isoDiaLocal(year: number, month: number, day: number): string {
		return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
	}

	function hoje(): string {
		return new Date().toISOString().slice(0, 10);
	}

	function fmtDate(iso: string): string {
		if (!iso) return '';
		const [y, m, d] = iso.split('-');
		return `${d}/${m}/${y}`;
	}

	function selecionarDia(iso: string) {
		if (dataInicio === iso) {
			feriado = !feriado;
		} else {
			dataInicio = iso;
			feriado = false;
		}
	}

	function calMesAnterior() {
		if (calMes === 0) { calMes = 11; calAno--; }
		else { calMes--; }
	}

	function calMesProximo() {
		if (calMes === 11) { calMes = 0; calAno++; }
		else { calMes++; }
	}

	$effect(() => {
		if (open) {
			dataInicio = gise.data_inicio;
			feriado = !!gise.feriado;
			horaEntrada = gise.hora_entrada ?? '';
			horaSaida = gise.hora_saida ?? '';
			const [y, m] = dataInicio.split('-').map(Number);
			calAno = y;
			calMes = m - 1;
		}
	});

	const onSubmitWrapper: SubmitFunction = (input) => {
		const horas = [horaEntrada, horaSaida];
		if (horas.some((h) => !h)) {
			toaster.error({ title: 'Preencha todos os horários' });
			input.cancel();
			return;
		}
		if (horas.some((h) => !validarHora(h))) {
			toaster.error({ title: 'Formato inválido', description: 'Use o formato HH:MM, ex: 14:00' });
			input.cancel();
			return;
		}
		return onSubmit(input);
	};
</script>

<Dialog
	{open}
	onOpenChange={(e) => { if (!pendingCrud && !e.open) onClose(); }}
>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="bg-surface-50 dark:bg-surface-900 rounded-2xl shadow-2xl w-full max-w-lg p-3 sm:p-4 space-y-3 max-h-[calc(100dvh-1rem)] overflow-y-auto border border-surface-200 dark:border-white/10"
		>
			<div class="flex items-center justify-between">
				<Dialog.Title class="text-base sm:text-lg font-bold text-surface-900 dark:text-surface-50">
					Editar Data e Horários
				</Dialog.Title>
				<Dialog.CloseTrigger class="btn btn-sm p-1 opacity-50 hover:opacity-100" aria-label="Fechar">
					<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
				</Dialog.CloseTrigger>
			</div>

			{#if editaBloqueado}
				<div class="rounded-xl bg-warning-500/10 border border-warning-500/30 px-3 py-2 text-xs text-warning-700 dark:text-warning-400">
					⚠️ A assinatura digital será <strong>revogada</strong> ao salvar.
				</div>
			{/if}

			<p class="text-[0.65rem] sm:text-xs text-surface-500 leading-snug">
				No calendário: <span class="text-primary-600 dark:text-primary-400 font-medium">1º clique</span> seleciona a data, <span class="text-error-600 dark:text-error-400 font-medium">2º clique</span> marca como feriado.
			</p>

			<!-- Calendário -->
			<div class="rounded-xl border border-surface-200 dark:border-surface-700 p-2 sm:p-2.5 space-y-1 bg-white dark:bg-surface-800/40">
				<div class="flex items-center justify-between gap-1.5">
					<button type="button" class="btn preset-outlined-surface-500 p-1.5 rounded-lg shrink-0" onclick={calMesAnterior} aria-label="Mês anterior">
						<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
					</button>
					<p class="text-xs sm:text-sm font-semibold text-surface-800 dark:text-surface-100 text-center flex-1">{calTitulo}</p>
					<button type="button" class="btn preset-outlined-surface-500 p-1.5 rounded-lg shrink-0" onclick={calMesProximo} aria-label="Próximo mês">
						<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
					</button>
				</div>
				<div class="grid grid-cols-7 gap-px text-center text-[0.55rem] sm:text-[0.6rem] font-semibold uppercase tracking-wide text-surface-400 py-0.5">
					{#each DIAS_SEM_CAL as ds}<span>{ds}</span>{/each}
				</div>
				<div class="grid grid-cols-7 gap-0.5">
					{#each gradeCalendario as cell}
						{#if cell}
							{@const iso = cell ? isoDiaLocal(calAno, calMes, cell.day) : ''}
							{@const sel = iso === dataInicio}
							{@const fer = sel && feriado}
							{@const ehHoje = iso === hoje()}
							<button
								type="button"
								onclick={() => iso && selecionarDia(iso)}
								class="relative h-9 rounded-md text-xs font-medium transition-colors border flex items-center justify-center
									{sel
									? fer
										? 'border-error-500 bg-error-500/15 text-error-900 dark:text-error-100'
										: 'border-primary-500 bg-primary-500/10 text-primary-800 dark:text-primary-100'
									: 'border-transparent bg-surface-100/80 dark:bg-surface-700/50 text-surface-700 dark:text-surface-200 hover:bg-surface-200/80 dark:hover:bg-surface-600'}
									{ehHoje && !sel ? 'ring-1 ring-surface-400 dark:ring-surface-500' : ''}"
							>
								{cell?.day}
								{#if fer}<span class="absolute bottom-0 left-1/2 -translate-x-1/2 text-[0.45rem] font-bold uppercase text-error-700 dark:text-error-300 leading-none">F</span>{/if}
							</button>
						{:else}
							<div class="h-9"></div>
						{/if}
					{/each}
				</div>
			</div>

			<!-- Exibição da data selecionada -->
			<div class="flex items-center gap-2 px-3 py-2 rounded-xl border border-primary-400/30 bg-primary-500/5">
				<div class="bg-primary-500/10 p-1.5 rounded-lg text-primary-600">
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
				</div>
				<div class="min-w-0 flex-1">
					<p class="text-[0.6rem] font-bold uppercase text-primary-600/60 leading-none mb-0.5">Data Selecionada</p>
					<p class="text-sm font-bold text-primary-700 dark:text-primary-400">{fmtDate(dataInicio)} {feriado ? '(Feriado)' : ''}</p>
				</div>
			</div>

			<!-- Horários -->
			<div class="rounded-xl border border-surface-200 dark:border-surface-700 p-2.5 space-y-1.5 bg-white dark:bg-surface-800/40">
				<p class="text-[0.65rem] sm:text-xs font-semibold text-surface-600 dark:text-surface-400">Horários da Escala</p>
				<div class="grid grid-cols-2 gap-2">
					<div>
						<label for="editHoraEntrada" class="text-[0.65rem] text-surface-500 block mb-0.5">Entrada</label>
						<input
							id="editHoraEntrada"
							type="text"
							placeholder="Ex: 08:00"
							bind:value={horaEntrada}
							class="w-full px-2.5 py-1.5 rounded-lg border bg-white dark:bg-surface-800 text-sm {horaEntrada && !validarHora(horaEntrada) ? 'border-error-500' : 'border-surface-300 dark:border-surface-700'}"
						/>
					</div>
					<div>
						<label for="editHoraSaida" class="text-[0.65rem] text-surface-500 block mb-0.5">Saída</label>
						<input
							id="editHoraSaida"
							type="text"
							placeholder="Ex: 16:00"
							bind:value={horaSaida}
							class="w-full px-2.5 py-1.5 rounded-lg border bg-white dark:bg-surface-800 text-sm {horaSaida && !validarHora(horaSaida) ? 'border-error-500' : 'border-surface-300 dark:border-surface-700'}"
						/>
					</div>
				</div>
				<p class="text-[0.6rem] text-surface-400">Formato: HH:MM · ex: 08:00 · 14:30</p>
			</div>

			<div class="flex justify-end gap-2 pt-1">
				<button type="button" class="btn preset-outlined-surface text-xs sm:text-sm px-4 py-2 rounded-xl" onclick={onClose}>Cancelar</button>
				<form method="POST" action="?/salvarDatasHorarios" use:enhance={onSubmitWrapper} class="contents">
					<input type="hidden" name="data_inicio" value={dataInicio} />
					<input type="hidden" name="hora_entrada" value={normalizarHora(horaEntrada) ?? ''} />
					<input type="hidden" name="hora_saida" value={normalizarHora(horaSaida) ?? ''} />
					<input type="hidden" name="feriado" value={feriado ? "true" : "false"} />
					<button
						type="submit"
						class="btn preset-filled-primary-500 text-xs sm:text-sm px-6 py-2 rounded-xl font-bold transition-all active:scale-95"
						disabled={pendingCrud}
					>
						{pendingCrud ? 'Salvando...' : 'Salvar Alterações'}
					</button>
				</form>
			</div>
		</div>
	</Dialog.Content>
</Dialog>
