<script lang="ts">
	import { goto } from '$app/navigation';
	import { slide } from 'svelte/transition';

	let {
		ativa,
		isSupervisor,
		isDesktop,
		usuario,
		menuExpandidoId,
		onAssEscala,
		onAssExtra,
		onExtraPdf,
		onToggleMenu
	}: {
		ativa: any;
		isSupervisor: boolean;
		isDesktop: boolean;
		usuario: any;
		menuExpandidoId: number | null;
		onAssEscala: () => void;
		onAssExtra: () => void;
		onExtraPdf: () => void;
		onToggleMenu: () => void;
	} = $props();

	const statusStrip = $derived(
		ativa.status === 'aguardando_assinatura'
			? 'bg-primary-500'
			: ativa.status === 'em_preenchimento'
				? 'bg-warning-500'
				: ativa.status === 'em_andamento'
					? 'bg-success-500'
					: ativa.status === 'aguardando_relatorios'
						? 'bg-info-500'
						: ativa.status === 'aguardando_assinatura_relat'
							? 'bg-secondary-500'
							: ativa.status === 'pronta_para_finalizar'
								? 'bg-success-600'
								: 'bg-surface-400'
	);

	const temSupervisao = $derived(
		!!(ativa.supervisor_id || ativa.assessor_id || ativa.seint1_id || ativa.seint2_id)
	);
	const totalExtras = $derived(ativa.totalSeccionais + (temSupervisao ? 1 : 0));
	const escalaConcluida = $derived(
		['em_andamento', 'aguardando_relatorios', 'aguardando_assinatura_relat', 'pronta_para_finalizar', 'finalizada'].includes(ativa.status)
	);
	const jaAssinados = $derived(ativa.assinaturasRelatorioExtra ?? 0);
	const extraConcluido = $derived(jaAssinados >= totalExtras);
	const extraParcial = $derived(jaAssinados > 0 && jaAssinados < totalExtras);

	function statusLabel(status: string): string {
		const labels: Record<string, string> = {
			em_definicao_supervisor: 'Em definição do supervisor',
			em_preenchimento: 'Preenchendo escalados',
			aguardando_assinatura: 'Aguardando assinatura do supervisor',
			em_andamento: 'GISE em operação',
			aguardando_relatorios: 'Aguardando entradas',
			aguardando_assinatura_relat: 'Aguardando assinatura dos Rel. de Extra',
			pronta_para_finalizar: 'Pronta para finalizar',
			finalizada: 'Concluída'
		};
		return labels[status] ?? status;
	}

	function statusColor(status: string): string {
		const colors: Record<string, string> = {
			em_definicao_supervisor: 'bg-surface-500/15 text-surface-600 dark:text-surface-300',
			em_preenchimento: 'bg-warning-500/15 text-warning-700 dark:text-warning-400',
			aguardando_assinatura: 'bg-primary-500/15 text-primary-700 dark:text-primary-400',
			em_andamento: 'bg-success-500/15 text-success-700 dark:text-success-400',
			aguardando_relatorios: 'bg-warning-500/15 text-warning-700 dark:text-warning-400',
			aguardando_assinatura_relat: 'bg-tertiary-500/15 text-tertiary-700 dark:text-tertiary-400',
			pronta_para_finalizar: 'bg-success-500/20 text-success-800 dark:text-success-300',
			finalizada: 'bg-surface-500/15 text-surface-600 dark:text-surface-400'
		};
		return colors[status] ?? '';
	}

	function fmtDate(iso: string): string {
		if (!iso) return '';
		const [y, m, d] = iso.split('-');
		return `${d}/${m}/${y}`;
	}

	function diaSemana(iso: string): string {
		if (!iso) return '';
		const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
		return dias[new Date(iso + 'T12:00:00').getDay()];
	}
</script>

<div
	class="flex flex-col rounded-2xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-sm overflow-hidden hover:shadow-md hover:border-primary-500/40 dark:hover:border-primary-400/20 transition-all duration-200 group"
>
	<div class="h-1 {statusStrip}"></div>

	<div class="flex flex-col gap-3 p-4 sm:p-5 flex-1">
		<div class="flex items-center gap-2 flex-wrap">
			<span
				class="inline-flex items-center rounded-full bg-primary-500/10 px-2 py-0.5 text-[0.62rem] font-bold uppercase tracking-wide text-primary-700 dark:text-primary-400"
			>
				Ativa #{ativa.id}
			</span>
			<span
				class="inline-flex items-center rounded-full px-2 py-0.5 text-[0.62rem] font-bold uppercase tracking-wide {statusColor(ativa.status)}"
			>
				{statusLabel(ativa.status)}
			</span>
			{#if ativa.supervisor_id === usuario?.id}
				<span
					class="inline-flex items-center rounded-full bg-warning-500/15 px-2 py-0.5 text-[0.62rem] font-bold uppercase tracking-wide text-warning-700 dark:text-warning-400 border border-warning-500/20"
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

		<div class="flex flex-col gap-3 pt-3 border-t border-surface-100 dark:border-surface-700/50">
			<div
				class="flex flex-col min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between gap-3"
			>
				<div class="flex items-center gap-2 min-w-0">
					<button
						type="button"
						class="btn btn-sm shrink-0 {menuExpandidoId === ativa.id
							? 'preset-filled-surface-500 text-white'
							: 'preset-outlined-surface-500'} text-xs px-3 py-1.5 transition-all font-bold"
						onclick={onToggleMenu}
					>
						{menuExpandidoId === ativa.id ? 'Ocultar' : 'Opções'}
					</button>
				</div>

				{#if isSupervisor && ativa.supervisor_id === usuario?.id}
					<div class="flex gap-2 shrink-0">
						<button
							type="button"
							class="btn btn-sm flex-1 min-[420px]:flex-none font-bold text-xs px-3 py-1.5 flex items-center justify-center gap-1 transition-all active:scale-95 {ativa.status ===
							'aguardando_assinatura'
								? 'preset-filled-warning-500 text-warning-950'
								: escalaConcluida
									? 'preset-filled-success-500 text-white'
									: 'bg-surface-200/50 dark:bg-surface-800 text-surface-500 dark:text-surface-400 border border-surface-300/50 dark:border-surface-700'}"
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
							{/if}
							Ass. Escala
						</button>

						<button
							type="button"
							class="btn btn-sm flex-1 min-[420px]:flex-none font-bold text-xs px-3 py-1.5 flex items-center justify-center gap-1 transition-all active:scale-95 {extraConcluido
								? 'preset-filled-success-500 text-white'
								: extraParcial
									? 'bg-orange-500 hover:bg-orange-600 text-white border-orange-600'
									: ativa.extrasPendentes > 0
										? 'preset-filled-warning-500 text-warning-950'
										: 'bg-surface-200/50 dark:bg-surface-800 text-surface-500 dark:text-surface-400 border border-surface-300/50 dark:border-surface-700'}"
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
							{/if}
							Ass. Extra ({jaAssinados}/{totalExtras})
						</button>
					</div>
				{/if}
			</div>

			{#if menuExpandidoId === ativa.id}
				<div class="flex flex-row gap-2 mt-1 w-full" transition:slide={{ duration: 200 }}>
					<button
						type="button"
						class="btn flex-1 justify-center preset-filled-surface-100 dark:preset-filled-surface-800 text-[0.65rem] sm:text-[0.7rem] py-2 px-1 border border-surface-200 dark:border-surface-700 hover:preset-filled-primary-500 hover:text-white transition-all font-bold uppercase tracking-tight whitespace-nowrap shadow-sm"
						onclick={() => goto(`/gise/${ativa.id}`)}
					>
						Acessar GISE
					</button>
					<a
						class="btn flex-1 justify-center preset-filled-surface-100 dark:preset-filled-surface-800 text-[0.65rem] sm:text-[0.7rem] py-2 px-1 border border-surface-200 dark:border-surface-700 hover:preset-filled-primary-500 hover:text-white transition-all no-underline font-bold uppercase tracking-tight whitespace-nowrap shadow-sm"
						href="/api/gise/{ativa.id}/download?format=pdf"
						target="_blank"
					>
						Escala PDF
					</a>
					<button
						type="button"
						class="btn flex-1 justify-center preset-filled-surface-100 dark:preset-filled-surface-800 text-[0.65rem] sm:text-[0.7rem] py-2 px-1 border border-surface-200 dark:border-surface-700 hover:preset-filled-primary-500 hover:text-white transition-all font-bold uppercase tracking-tight whitespace-nowrap shadow-sm"
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
