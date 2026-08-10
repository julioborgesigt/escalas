<script lang="ts">
	/**
	 * Card de uma GISE ativa na lista `/gise`.
	 *
	 * Concentra o "o que falta" da escala: a faixa colorida no topo dá o status
	 * num relance e os dois botões (escala × extras) mudam de cor e de dica
	 * conforme o supervisor ainda precise assinar, esteja no meio ou já tenha
	 * terminado. Quem não é o supervisor da escala vê só os downloads.
	 */
	import { goto } from '$app/navigation';
	import { slide } from 'svelte/transition';
	import { statusLabel, statusColor, statusStrip, fmtDate, diaSemana } from '$lib/gise/formatters';
	import PenLine from '@lucide/svelte/icons/pen-line';

	const {
		ativa,
		operacaoNome = '',
		isSupervisor,
		isDesktop,
		usuario,
		menuExpandidoId,
		onAssEscala,
		onAssExtra,
		onEscalaPdf,
		onExtraPdf,
		onToggleMenu
	}: {
		ativa: {
			id: number;
			status: string;
			data_inicio: string;
			hora_entrada: string;
			hora_saida: string;
			totalSeccionais: number;
			extrasPendentes: number;
			assinaturasRelatorioExtra?: number;
			supervisor_id?: number | null;
			assessor_id?: number | null;
			seint1_id?: number | null;
			seint2_id?: number | null;
		};
		/** Sigla/nome da operação desta escala; vazio esconde o selo. */
		operacaoNome?: string;
		isSupervisor: boolean;
		isDesktop: boolean;
		usuario: { id?: number | null } | null;
		menuExpandidoId: number | null;
		onAssEscala: () => void;
		onAssExtra: () => void;
		onEscalaPdf: () => void;
		onExtraPdf: () => void;
		onToggleMenu: () => void;
	} = $props();

	/** Faixa de 4 px no topo: mesmo canal do chip (`statusStrip` em formatters). */
	const faixaStatus = $derived(statusStrip(ativa.status));

	// O quadro de supervisão (supervisor/assessor/SEINT) rende um relatório de
	// extra próprio, somado ao de cada seccional — daí o "+1" no total esperado.
	const temSupervisao = $derived(
		!!(ativa.supervisor_id || ativa.assessor_id || ativa.seint1_id || ativa.seint2_id)
	);
	const totalExtras = $derived(ativa.totalSeccionais + (temSupervisao ? 1 : 0));
	// Status a partir dos quais a escala já foi assinada e seguiu adiante — todos
	// contam como "assinada" para o botão, inclusive os posteriores.
	const escalaConcluida = $derived(
		[
			'em_andamento',
			'aguardando_relatorios',
			'aguardando_assinatura_relat',
			'pronta_para_finalizar',
			'finalizada'
		].includes(ativa.status)
	);
	// Três estados do botão de extras: nenhum, alguns (tertiary) e todos (success).
	// `>=` e não `===` porque uma seccional removida depois da assinatura deixaria
	// o contador acima do total esperado.
	const jaAssinados = $derived(ativa.assinaturasRelatorioExtra ?? 0);
	const extraConcluido = $derived(jaAssinados >= totalExtras);
	const extraParcial = $derived(jaAssinados > 0 && jaAssinados < totalExtras);
</script>

<div
	class="flex flex-col rounded-2xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-sm overflow-hidden hover:shadow-md hover:border-primary-500/40 dark:hover:border-primary-400/20 transition-all duration-200 group"
>
	<div class="h-1 {faixaStatus}"></div>

	<div class="flex flex-col gap-3 p-4 sm:p-5 flex-1">
		<div class="flex items-center gap-2 flex-wrap">
			<span
				class="inline-flex items-center rounded-full bg-primary-500/10 px-2 py-0.5 text-3xs font-bold uppercase tracking-wide text-primary-700 dark:text-primary-400"
			>
				Ativa #{ativa.id}
			</span>
			{#if operacaoNome}
				<!-- Sem o selo, escalas de operações diferentes ficam visualmente
				     idênticas na mesma lista — e elas têm formulários e metas
				     diferentes. -->
				<span
					class="inline-flex items-center rounded-full bg-tertiary-500/15 px-2 py-0.5 text-3xs font-bold uppercase tracking-wide text-tertiary-700 dark:text-tertiary-300 border border-tertiary-500/20"
				>
					{operacaoNome}
				</span>
			{/if}
			<span
				class="inline-flex items-center rounded-full px-2 py-0.5 text-3xs font-bold uppercase tracking-wide {statusColor(
					ativa.status
				)}"
			>
				{statusLabel(ativa.status)}
			</span>
			{#if ativa.supervisor_id === usuario?.id}
				<span
					class="inline-flex items-center rounded-full bg-warning-500/15 px-2 py-0.5 text-3xs font-bold uppercase tracking-wide text-warning-700 dark:text-warning-400 border border-warning-500/20"
				>
					Sou Supervisor
				</span>
			{/if}
		</div>

		<div class="flex-1">
			<p
				class="text-base sm:text-lg font-bold text-surface-800 dark:text-surface-100 leading-tight group-hover:text-primary-600 dark:group-hover:text-primary-300 transition-colors"
			>
				{diaSemana(ativa.data_inicio)}, {fmtDate(ativa.data_inicio)}
			</p>
			<p class="text-sm font-medium text-surface-600 dark:text-surface-300 mt-1">
				{ativa.hora_entrada} às {ativa.hora_saida}
			</p>
		</div>

		<div class="flex flex-col gap-2 pt-3 border-t border-surface-100 dark:border-surface-700/50">
			{#if isSupervisor && ativa.supervisor_id === usuario?.id}
				<div class="flex gap-2 w-full">
					<button
						type="button"
						class="btn btn-sm flex-1 font-bold text-xs px-3 py-1.5 flex items-center justify-center gap-1 transition-all {ativa.status ===
						'aguardando_assinatura'
							? 'preset-filled-warning-500 text-warning-950'
							: escalaConcluida
								? 'preset-filled-success-500 text-white'
								: 'bg-surface-200/50 dark:bg-surface-800 text-surface-600 dark:text-surface-400 border border-surface-300/50 dark:border-surface-700'}"
						onclick={onAssEscala}
						title={ativa.status === 'aguardando_assinatura'
							? isDesktop
								? 'Assinar via Token'
								: 'Assinar em Tela'
							: escalaConcluida
								? 'Escala já assinada'
								: 'Ver o que falta para assinar'}
					>
						{#if escalaConcluida}
							<svg
								class="w-3 h-3 shrink-0"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								stroke-width="3"
							>
								<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
							</svg>
						{:else}
							<PenLine class="w-3 h-3 shrink-0" aria-hidden="true" />
						{/if}
						{escalaConcluida ? 'Escala assinada' : 'Ass. Escala'}
					</button>

					<button
						type="button"
						class="btn btn-sm flex-1 font-bold text-xs px-3 py-1.5 flex items-center justify-center gap-1 transition-all {extraConcluido
							? 'preset-filled-success-500 text-white'
							: extraParcial
								? 'preset-filled-tertiary-500'
								: ativa.extrasPendentes > 0
									? 'preset-filled-warning-500 text-warning-950'
									: 'bg-surface-200/50 dark:bg-surface-800 text-surface-600 dark:text-surface-400 border border-surface-300/50 dark:border-surface-700'}"
						onclick={onAssExtra}
						title={ativa.extrasPendentes > 0
							? isDesktop
								? 'Assinar extras via Token'
								: 'Assinar extras em Tela'
							: extraConcluido
								? 'Todos os extras assinados'
								: 'Ver status dos extras'}
					>
						{#if extraConcluido}
							<svg
								class="w-3 h-3 shrink-0"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								stroke-width="3"
							>
								<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
							</svg>
						{:else}
							<PenLine class="w-3 h-3 shrink-0" aria-hidden="true" />
						{/if}
						{extraConcluido ? 'Extra assinado' : `Ass. Extra (${jaAssinados}/${totalExtras})`}
					</button>
				</div>
			{/if}

			<button
				type="button"
				class="btn btn-sm w-full md:hidden {menuExpandidoId === ativa.id
					? 'preset-filled-surface-500 text-white'
					: 'preset-outlined-surface-500'} text-xs px-3 py-1.5 transition-all font-bold"
				onclick={onToggleMenu}
			>
				{menuExpandidoId === ativa.id ? 'Ocultar' : 'Opções'}
			</button>

			{#if isDesktop || menuExpandidoId === ativa.id}
				<div
					class="flex flex-row gap-2 mt-1 w-full"
					transition:slide={{ duration: isDesktop ? 0 : 200 }}
				>
					<button
						type="button"
						class="btn flex-1 justify-center preset-filled-surface-100 dark:preset-filled-surface-800 text-3xs sm:text-2xs py-2 px-1 border border-surface-200 dark:border-surface-700 hover:preset-filled-primary-500 hover:text-white transition-all font-bold uppercase tracking-tight whitespace-nowrap shadow-sm"
						onclick={() => goto(`/gise/${ativa.id}`)}
					>
						Abrir escala
					</button>
					<button
						type="button"
						class="btn flex-1 justify-center preset-filled-surface-100 dark:preset-filled-surface-800 text-3xs sm:text-2xs py-2 px-1 border border-surface-200 dark:border-surface-700 hover:preset-filled-primary-500 hover:text-white transition-all font-bold uppercase tracking-tight whitespace-nowrap shadow-sm"
						onclick={onEscalaPdf}
					>
						Escala PDF
					</button>
					<button
						type="button"
						class="btn flex-1 justify-center preset-filled-surface-100 dark:preset-filled-surface-800 text-3xs sm:text-2xs py-2 px-1 border border-surface-200 dark:border-surface-700 hover:preset-filled-primary-500 hover:text-white transition-all font-bold uppercase tracking-tight whitespace-nowrap shadow-sm"
						onclick={onExtraPdf}
						title={isSupervisor
							? 'Baixar relatório de extra da supervisão'
							: 'Entrar na escala para escolher o relatório'}
					>
						Extra PDF
					</button>
				</div>
			{/if}
		</div>
	</div>
</div>
