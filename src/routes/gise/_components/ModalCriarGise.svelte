<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { fmtDate, diaSemana } from '$lib/gise/gise-formatters';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import { loading } from '$lib/loading.svelte';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import { page } from '$app/state';
	import type { ActionResult } from '@sveltejs/kit';

	let {
		open = $bindable(false),
		escalas,
		onSuccess
	}: {
		open: boolean;
		escalas: { id: number; data_inicio: string; status: string }[];
		onSuccess: (count: number, firstId?: number) => void;
	} = $props();

	let diasModal = $state<Record<string, { f: boolean }>>({});
	let calAno = $state(2026);
	let calMes = $state(0);
	let novaHoraEntrada = $state('08:00');
	let novaHoraSaida = $state('16:00');
	let modoCriacao = $state<'completa' | 'clonada' | 'branco'>('completa');
	let clonarDeId = $state<number | ''>('');

	const MESES_CAL = [
		'Janeiro',
		'Fevereiro',
		'Março',
		'Abril',
		'Maio',
		'Junho',
		'Julho',
		'Agosto',
		'Setembro',
		'Outubro',
		'Novembro',
		'Dezembro'
	];
	const DIAS_SEM_CAL = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

	const diasModalOrdenados = $derived(
		Object.keys(diasModal)
			.sort()
			.map((iso) => ({ iso, feriado: diasModal[iso].f }))
	);
	const datasJsonHidden = $derived(
		JSON.stringify(diasModalOrdenados.map(({ iso, feriado }) => ({ data: iso, feriado })))
	);
	const calTitulo = $derived(`${MESES_CAL[calMes]} de ${calAno}`);
	const gradeCalendario = $derived.by(() => {
		const year = calAno;
		const month = calMes;
		const first = new Date(year, month, 1).getDay();
		const n = new Date(year, month + 1, 0).getDate();
		const cells: ({ day: number } | null)[] = [];
		for (let i = 0; i < first; i++) cells.push(null);
		for (let d = 1; d <= n; d++) cells.push({ day: d });
		while (cells.length % 7 !== 0) cells.push(null);
		while (cells.length < 42) cells.push(null);
		return cells;
	});

	let prevOpen = false;
	$effect(() => {
		if (open && !prevOpen) {
			const h = hoje();
			diasModal = { [h]: { f: false } };
			const [y, m] = h.split('-').map(Number);
			calAno = y;
			calMes = m - 1;
			modoCriacao = 'completa';
			clonarDeId = escalas.length > 0 ? escalas[0].id : '';
			novaHoraEntrada = (page.data.defaultHoraEntrada as string) ?? '08:00';
			novaHoraSaida = (page.data.defaultHoraSaida as string) ?? '16:00';
		}
		prevOpen = open;
	});

	function isoDiaLocal(year: number, month: number, day: number): string {
		return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
	}

	function calCicloDia(iso: string) {
		const next = { ...diasModal };
		if (!(iso in next)) {
			next[iso] = { f: false };
		} else if (!next[iso].f) {
			next[iso] = { f: true };
		} else {
			delete next[iso];
		}
		diasModal = next;
	}

	function calRemoverDia(iso: string) {
		if (!(iso in diasModal)) return;
		const next = { ...diasModal };
		delete next[iso];
		diasModal = next;
	}

	function calMesAnterior() {
		if (calMes === 0) {
			calMes = 11;
			calAno--;
		} else {
			calMes--;
		}
	}

	function calMesProximo() {
		if (calMes === 11) {
			calMes = 0;
			calAno++;
		} else {
			calMes++;
		}
	}

	function validarHora(v: string): boolean {
		if (!v) return true;
		return /^\d{1,2}:\d{2}$/.test(v);
	}

	function hoje(): string {
		return new Date().toISOString().slice(0, 10);
	}

	function handleCriarGise({ cancel }: { cancel: () => void }) {
		if (diasModalOrdenados.length === 0) {
			toaster.error({ title: 'Selecione pelo menos um dia' });
			cancel();
			return;
		}
		if (!novaHoraEntrada || !novaHoraSaida) {
			toaster.error({ title: 'Preencha os horários' });
			cancel();
			return;
		}
		if (!validarHora(novaHoraEntrada) || !validarHora(novaHoraSaida)) {
			toaster.error({ title: 'Formato inválido', description: 'Use o formato HH:MM, ex: 08:00' });
			cancel();
			return;
		}
		loading.show('Criando escala(s) GISE...');
		return async ({ result }: { result: ActionResult }) => {
			loading.hide();
			if (result.type === 'success') {
				const d = result.data as Record<string, unknown>;
				const count = (d.count as number) ?? 1;
				const primeiroId = (d.ids as number[])?.[0] ?? (d.id as number);
				toaster.success({
					title: `${count} escala(s) GISE criada(s)`,
					description: count > 1 ? 'As escalas foram adicionadas à lista de escalas ativas.' : ''
				});
				open = false;
				await invalidateAll();
				onSuccess(count, primeiroId);
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				toaster.error({ title: (d?.error as string) || 'Erro ao criar GISE' });
			}
		};
	}
</script>

<Dialog
	{open}
	onOpenChange={(e) => {
		if (!loading.active) open = e.open;
	}}
>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="bg-surface-50 dark:bg-surface-900 rounded-2xl shadow-2xl w-full max-w-lg p-3 sm:p-4 space-y-2.5 max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto border border-surface-200 dark:border-white/10"
		>
			<Dialog.Title
				class="text-base sm:text-lg font-bold text-surface-900 dark:text-surface-50 leading-tight"
			>
				Nova Escala GISE
			</Dialog.Title>
			<p class="text-[0.65rem] sm:text-xs text-surface-500 leading-snug">
				Uma escala por dia. No calendário: <span
					class="text-primary-600 dark:text-primary-400 font-medium">1º clique</span
				>
				seleciona (azul), <span class="text-error-600 dark:text-error-400 font-medium">2º</span>
				marca feriado (vermelho),
				<span class="font-medium text-surface-600 dark:text-surface-400">3º</span> remove o dia.
			</p>

			<!-- Calendário -->
			<div
				class="rounded-xl border border-surface-200 dark:border-surface-700 p-2 sm:p-2.5 space-y-1 bg-white dark:bg-surface-800/40"
			>
				<div class="flex items-center justify-between gap-1.5">
					<button
						type="button"
						class="btn preset-outlined-surface-500 p-1.5 rounded-lg shrink-0"
						aria-label="Mês anterior"
						onclick={calMesAnterior}
					>
						<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M15 19l-7-7 7-7"
							/></svg
						>
					</button>
					<p
						class="text-xs sm:text-sm font-semibold text-surface-800 dark:text-surface-100 text-center min-w-0 flex-1"
					>
						{calTitulo}
					</p>
					<button
						type="button"
						class="btn preset-outlined-surface-500 p-1.5 rounded-lg shrink-0"
						aria-label="Próximo mês"
						onclick={calMesProximo}
					>
						<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 5l7 7-7 7"
							/></svg
						>
					</button>
				</div>
				<div
					class="grid grid-cols-7 gap-px text-center text-[0.6rem] font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 py-0.5"
				>
					{#each DIAS_SEM_CAL as ds (ds)}
						<span>{ds}</span>
					{/each}
				</div>
				<div class="grid grid-cols-7 gap-0.5">
					{#each gradeCalendario as cell, i (i)}
						{#if cell}
							{@const iso = cell ? isoDiaLocal(calAno, calMes, cell.day) : ''}
							{@const sel = iso in diasModal}
							{@const fer = sel && diasModal[iso].f}
							{@const ehHoje = iso === hoje()}
							<button
								type="button"
								onclick={() => iso && calCicloDia(iso)}
								class="relative h-9 sm:h-9 rounded-md text-xs font-medium transition-colors border flex items-center justify-center touch-manipulation
									{sel
									? fer
										? 'border-error-500 bg-error-500/15 text-error-900 dark:text-error-100'
										: 'border-primary-500 bg-primary-500/10 text-primary-800 dark:text-primary-100'
									: 'border-transparent bg-surface-100/80 dark:bg-surface-700/50 text-surface-700 dark:text-surface-200 hover:bg-surface-200/80 dark:hover:bg-surface-600'}
									{ehHoje && !sel ? 'ring-1 ring-surface-400 dark:ring-surface-500' : ''}"
								aria-pressed={sel}
								aria-label="Dia {cell?.day} de {MESES_CAL[calMes]}, {sel
									? fer
										? 'feriado'
										: 'selecionado'
									: 'não selecionado'}"
							>
								{cell?.day}
								{#if fer}
									<span
										class="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-error-500"
										title="Feriado"
									></span>
								{/if}
							</button>
						{:else}
							<div class="h-9 sm:h-9"></div>
						{/if}
					{/each}
				</div>
			</div>

			{#if diasModalOrdenados.length > 0}
				<div class="min-w-0 space-y-0.5">
					<span class="text-[0.65rem] font-semibold text-surface-500"
						>Dias ({diasModalOrdenados.length})</span
					>
					<div
						class="flex flex-nowrap items-stretch gap-1.5 overflow-x-auto max-w-full pb-0.5 [scrollbar-width:thin]"
					>
						{#each diasModalOrdenados as { iso, feriado } (iso)}
							<span
								class="inline-flex items-center gap-0.5 pl-1.5 pr-0.5 py-0.5 rounded-md text-[0.65rem] font-medium border shrink-0
								{feriado
									? 'border-error-400/80 bg-error-500/10 text-error-900 dark:text-error-100'
									: 'border-primary-400/80 bg-primary-500/10 text-primary-900 dark:text-primary-100'}"
							>
								{fmtDate(iso)}
								{#if feriado}<span
										class="text-[0.6rem] font-bold text-error-600 dark:text-error-400">F</span
									>{/if}
								<button
									type="button"
									class="p-0.5 rounded text-surface-400 hover:text-error-600 dark:hover:text-error-400 shrink-0"
									aria-label="Remover {fmtDate(iso)}"
									onclick={() => calRemoverDia(iso)}
								>
									<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"
										><path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M6 18L18 6M6 6l12 12"
										/></svg
									>
								</button>
							</span>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Horários -->
			<div class="rounded-xl border border-surface-200 dark:border-surface-700 p-2.5 space-y-1.5">
				<p class="text-[0.65rem] sm:text-xs font-semibold text-surface-600 dark:text-surface-400">
					Horário padrão (todos os dias)
				</p>
				<div class="grid grid-cols-2 gap-2">
					<div>
						<label for="novaHoraEntrada" class="text-[0.65rem] text-surface-500 block mb-0.5"
							>Entrada</label
						>
						<input
							id="novaHoraEntrada"
							type="text"
							placeholder="Ex: 08:00"
							bind:value={novaHoraEntrada}
							class="w-full px-2.5 py-1.5 rounded-lg border bg-white dark:bg-surface-800 text-sm {novaHoraEntrada &&
							!validarHora(novaHoraEntrada)
								? 'border-error-500'
								: 'border-surface-300 dark:border-surface-700'}"
						/>
					</div>
					<div>
						<label for="novaHoraSaida" class="text-[0.65rem] text-surface-500 block mb-0.5"
							>Saída</label
						>
						<input
							id="novaHoraSaida"
							type="text"
							placeholder="Ex: 16:00"
							bind:value={novaHoraSaida}
							class="w-full px-2.5 py-1.5 rounded-lg border bg-white dark:bg-surface-800 text-sm {novaHoraSaida &&
							!validarHora(novaHoraSaida)
								? 'border-error-500'
								: 'border-surface-300 dark:border-surface-700'}"
						/>
					</div>
				</div>
			</div>

			<!-- Tipo de Criação -->
			<div class="space-y-2">
				<p class="text-[0.65rem] sm:text-xs font-semibold text-surface-600 dark:text-surface-400">
					Tipo de Escala
				</p>
				<div class="grid grid-cols-3 gap-1 sm:gap-2">
					<button
						type="button"
						class="btn py-2 rounded-lg flex flex-col items-center gap-0.5 border transition-all min-h-0 {modoCriacao ===
						'completa'
							? 'border-primary-500 bg-primary-500/10 text-primary-600'
							: 'border-surface-200 dark:border-surface-700 text-surface-500'}"
						onclick={() => (modoCriacao = 'completa')}
					>
						<span class="font-bold text-[0.65rem] sm:text-xs leading-tight text-center"
							>Completa</span
						>
						<span class="text-[0.6rem] opacity-70 leading-tight text-center hidden sm:block"
							>Seccionais</span
						>
					</button>
					<button
						type="button"
						class="btn py-2 rounded-lg flex flex-col items-center gap-0.5 border transition-all min-h-0 {modoCriacao ===
						'branco'
							? 'border-primary-500 bg-primary-500/10 text-primary-600'
							: 'border-surface-200 dark:border-surface-700 text-surface-500'}"
						onclick={() => (modoCriacao = 'branco')}
					>
						<span class="font-bold text-[0.65rem] sm:text-xs leading-tight text-center"
							>Em branco</span
						>
						<span class="text-[0.6rem] opacity-70 leading-tight text-center hidden sm:block"
							>Sem equipes</span
						>
					</button>
					<button
						type="button"
						class="btn py-2 rounded-lg flex flex-col items-center gap-0.5 border transition-all min-h-0 {modoCriacao ===
						'clonada'
							? 'border-primary-500 bg-primary-500/10 text-primary-600'
							: 'border-surface-200 dark:border-surface-700 text-surface-500'}"
						onclick={() => (modoCriacao = 'clonada')}
						disabled={escalas.length === 0}
					>
						<span class="font-bold text-[0.65rem] sm:text-xs leading-tight text-center">Copiar</span
						>
						<span class="text-[0.6rem] opacity-70 leading-tight text-center hidden sm:block"
							>De outra</span
						>
					</button>
				</div>

				{#if modoCriacao === 'clonada'}
					<div class="mt-1 animate-in fade-in slide-in-from-top-1 duration-300">
						<label
							for="clonarDe"
							class="text-[0.6rem] font-medium text-surface-500 dark:text-surface-400 block mb-0.5"
							>Escolha a escala de origem</label
						>
						<select
							id="clonarDe"
							bind:value={clonarDeId}
							class="w-full px-2.5 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-xs sm:text-sm"
						>
							{#each escalas.slice(0, 10) as esc (esc.id)}
								<option value={esc.id}>
									GISE — {diaSemana(esc.data_inicio)}
									{fmtDate(esc.data_inicio)} ({esc.status})
								</option>
							{/each}
						</select>
					</div>
				{/if}
			</div>
			<div class="flex justify-end gap-2 pt-1">
				<button
					type="button"
					class="btn preset-outlined-surface-500 text-xs sm:text-sm px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg sm:rounded-xl"
					onclick={() => (open = false)}
				>
					Cancelar
				</button>
				<form method="POST" action="?/criar" use:enhance={handleCriarGise} class="contents">
					<input type="hidden" name="datas_json" value={datasJsonHidden} />
					<input type="hidden" name="hora_entrada" value={novaHoraEntrada} />
					<input type="hidden" name="hora_saida" value={novaHoraSaida} />
					<input type="hidden" name="modo" value={modoCriacao} />
					{#if modoCriacao === 'clonada' && clonarDeId}
						<input type="hidden" name="clonar_de" value={clonarDeId} />
					{/if}
					<button
						type="submit"
						class="btn preset-filled-tertiary-500 border-2 border-tertiary-600/30 hover:border-tertiary-600 text-xs sm:text-sm px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg sm:rounded-xl transition-all active:scale-95 transition-all"
						disabled={loading.active ||
							diasModalOrdenados.length === 0 ||
							(modoCriacao === 'clonada' && !clonarDeId)}
					>
						{loading.active ? 'Criando...' : 'Criar Escala'}
					</button>
				</form>
			</div>
		</div>
	</Dialog.Content>
</Dialog>
