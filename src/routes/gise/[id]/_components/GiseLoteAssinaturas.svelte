<script lang="ts">
	import { slide } from 'svelte/transition';
	import { FileDown } from 'lucide-svelte';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import { loading } from '$lib/loading.svelte';
	import { getMembrosFromSec, checkAllSigned } from '$lib/gise/gise-page-helpers';
	import { toaster } from '$lib/toast';

	interface Props {
		giseId: number;
		quantidadePendentes: number;
		assinandoLote: boolean;
		etapaAssinatura: string;
		progressoLote: { atual: number; total: number };
		isMobile: boolean;
		onAssinarManualLote: () => void;
		onAssinarDigitalLote: () => void | Promise<void>;
		podeAssinar?: boolean;
		// Novas props para exibir assinaturas concluídas
		assinaturasRelatorios?:
			{ tipo: string; seccional_id: number; assinante_nome?: string }[] | null;
		seccionais?:
			| {
					seccional_id?: number;
					id?: number;
					seccional_nome?: string;
					unidades?: import('$lib/db/gise').GiseUnidadeSlot[];
			  }[]
			| null;
		supervisaoExtraUnidadeId?: number | null;
		giseStatus?: string;
		onConferencia?: () => void;
	}

	const {
		giseId,
		quantidadePendentes,
		assinandoLote,
		etapaAssinatura,
		progressoLote,
		isMobile,
		onAssinarManualLote,
		onAssinarDigitalLote,
		podeAssinar = true,
		assinaturasRelatorios = [],
		seccionais = [],
		supervisaoExtraUnidadeId = null,
		giseStatus = '',
		onConferencia
	}: Props = $props();

	let expandido = $state(false);

	const naoIniciou = $derived(
		['em_definicao_supervisor', 'em_preenchimento', 'aguardando_assinatura'].includes(
			giseStatus ?? ''
		)
	);

	const concluidosExtra = $derived(
		(assinaturasRelatorios ?? []).filter(
			(a) =>
				a.tipo === 'extraordinario' &&
				(supervisaoExtraUnidadeId == null || a.seccional_id !== supervisaoExtraUnidadeId)
		)
	);

	function nomeSeccional(seccionalId: number): string {
		const s = seccionais?.find((x) => x.seccional_id === seccionalId || x.id === seccionalId);
		return s?.seccional_nome?.trim() || `Seccional #${seccionalId}`;
	}

	const seccionaisComEquipes = $derived(
		(seccionais ?? []).filter((sec) => getMembrosFromSec(sec).length > 0)
	);

	const isAssinado = (sec: { seccional_id?: number; id?: number }) =>
		concluidosExtra.some((c) => c.seccional_id === sec.seccional_id || c.seccional_id === sec.id);

	const seccionaisFaltantes = $derived(seccionaisComEquipes.filter((sec) => !isAssinado(sec)));
	const seccionaisAssinadas = $derived(seccionaisComEquipes.filter((sec) => isAssinado(sec)));

	const totalEquipes = $derived(seccionaisComEquipes.length);
	const totalAssinados = $derived(seccionaisAssinadas.length);
	const totalProntosNaoAssinados = $derived(
		seccionaisFaltantes.filter((sec) => checkAllSigned(sec)).length
	);

	const statusLoteInfo = $derived.by(() => {
		if (totalEquipes > 0 && totalAssinados === totalEquipes) {
			return {
				text: 'Todos Assinados',
				class: 'bg-success-500/15 text-success-700 dark:text-success-400'
			};
		}
		if (totalAssinados > 0 && totalAssinados < totalEquipes) {
			return {
				text: 'Assinados (parcial)',
				class: 'bg-success-500/15 text-success-700 dark:text-success-400'
			};
		}
		if (totalAssinados === 0 && totalProntosNaoAssinados === totalEquipes && totalEquipes > 0) {
			return {
				text: 'Todos prontos para ass.',
				class: 'bg-warning-500/15 text-warning-700 dark:text-warning-400'
			};
		}
		if (
			totalAssinados === 0 &&
			totalProntosNaoAssinados > 0 &&
			totalProntosNaoAssinados < totalEquipes
		) {
			return {
				text: 'pronto para ass. (parcial)',
				class: 'bg-warning-500/15 text-warning-700 dark:text-warning-400'
			};
		}
		return {
			text: 'Aguardando saída equipes',
			class: 'bg-surface-500/10 text-surface-500 dark:text-surface-400'
		};
	});

	function mostrarOrientaConferencia() {
		toaster.warning({
			title: 'Conferência de Relatório',
			description:
				'Para visualizar o relatório individualmente de cada equipe, por favor, acesse a aba de detalhamento de cada seccional na seção "Seccionais Participantes" logo abaixo.'
		});
	}

	/** Todas as equipes com relatório de extra já assinado — segue o padrão dos
	    demais cards (escala/relatório de extra): oferecer download em vez de só conferência. */
	const todosAssinados = $derived(totalEquipes > 0 && totalAssinados === totalEquipes);

	/** Nome(s) de quem assinou — exibido no lugar da descrição quando todos os
	    relatórios estão assinados, como os demais cards de documento já fazem. */
	const nomesAssinantes = $derived(
		[...new Set(concluidosExtra.map((a) => a.assinante_nome?.trim()).filter(Boolean))].join(', ')
	);

	/** Diálogo de ciência jurídica antes da assinatura em lote por Token —
	    espelha o aviso do fluxo individual (ModalRelatorioDigital →
	    PainelAssinaturaToken), que o lote não exibia. */
	let confirmandoLote = $state(false);

	function confirmarAssinaturaLote() {
		confirmandoLote = false;
		void onAssinarDigitalLote();
	}

	/**
	 * Baixa, em lote, todos os relatórios de extra assinados das equipes — um por
	 * seccional. Mesma estratégia do `ModalDownloadExtras` (âncora + intervalo para
	 * não esbarrar no bloqueio de pop-ups do navegador).
	 */
	async function baixarTodosRelatorios(comManifesto = false) {
		if (concluidosExtra.length === 0) return;
		for (const rel of concluidosExtra) {
			const a = document.createElement('a');
			a.href = `/api/gise/${giseId}/download?format=extraordinario&seccionalId=${rel.seccional_id}${comManifesto ? '&manifesto=true' : ''}`;
			a.target = '_blank';
			a.rel = 'noopener';
			a.click();
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
	}
</script>

<!-- Par S/ manifesto + C/ manifesto — espelha o padrão dos cards de escala e de
     relatório de extra (GiseSupervisao). Para o lote, cada botão baixa TODOS os
     relatórios assinados das equipes de uma vez. -->
{#snippet botoesDownloadLote(mobile: boolean)}
	<button
		type="button"
		class="btn btn-xs preset-filled-primary-500 px-2.5 py-1.5 text-3xs font-bold rounded-lg flex items-center gap-1 {mobile
			? ''
			: 'hover:scale-[1.02] transition-all'}"
		onclick={() => baixarTodosRelatorios(false)}
		title="Baixar todos sem manifesto (para impressão)"
	>
		<FileDown size={13} class="shrink-0" />
		S/ manifesto
	</button>
	<button
		type="button"
		class="btn btn-xs preset-outlined-primary-500 px-2.5 py-1.5 text-3xs font-bold rounded-lg flex items-center gap-1 {mobile
			? ''
			: 'hover:scale-[1.02] transition-all'}"
		onclick={() => baixarTodosRelatorios(true)}
		title="Baixar todos com manifesto (folha de auditoria)"
	>
		<FileDown size={13} class="shrink-0" />
		C/ manifesto
	</button>
{/snippet}

<div class="flex flex-col gap-1.5 w-full animate-fade">
	<p class="text-3xs font-bold uppercase tracking-wider text-surface-400 dark:text-surface-500">
		Assinaturas em lote (equipes)
	</p>
	<div
		class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden shadow-sm hover:shadow-md transition-all duration-300"
	>
		{#if isMobile}
			<!-- Mobile layout: Collapsible card -->
			<button
				type="button"
				class="flex w-full items-center gap-2 p-3 text-left cursor-pointer active:bg-surface-100/60 dark:active:bg-surface-700/40"
				onclick={() => {
					expandido = !expandido;
				}}
			>
				<div
					class="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg {statusLoteInfo.text ===
						'Todos Assinados' || statusLoteInfo.text === 'Assinados (parcial)'
						? 'bg-success-100 dark:bg-success-900/30'
						: statusLoteInfo.text === 'Todos prontos para ass.' ||
							  statusLoteInfo.text === 'pronto para ass. (parcial)'
							? 'bg-warning-100 dark:bg-warning-900/30'
							: 'bg-surface-100 dark:bg-surface-800'}"
				>
					<svg
						class="w-3.5 h-3.5 {statusLoteInfo.text === 'Todos Assinados' ||
						statusLoteInfo.text === 'Assinados (parcial)'
							? 'text-success-600 dark:text-success-400'
							: statusLoteInfo.text === 'Todos prontos para ass.' ||
								  statusLoteInfo.text === 'pronto para ass. (parcial)'
								? 'text-warning-600 dark:text-warning-400'
								: 'text-surface-400 dark:text-surface-500'}"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						{#if statusLoteInfo.text === 'Todos Assinados' || statusLoteInfo.text === 'Assinados (parcial)'}
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M5 13l4 4L19 7"
							/>
						{:else if statusLoteInfo.text === 'Todos prontos para ass.' || statusLoteInfo.text === 'pronto para ass. (parcial)'}
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
							/>
						{:else}
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
							/>
						{/if}
					</svg>
				</div>
				<div class="min-w-0 flex-1">
					<span
						class="inline-flex items-center gap-1 rounded-full {statusLoteInfo.class} px-1.5 py-0.5 text-3xs font-bold uppercase"
					>
						{statusLoteInfo.text}
					</span>
					<p class="text-xs font-semibold text-surface-700 dark:text-surface-200 mt-0.5">
						Relatórios de extra — Equipes
					</p>
				</div>
				<svg
					class="h-4 w-4 shrink-0 text-surface-400 transition-transform duration-200 {expandido
						? 'rotate-180'
						: ''}"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M19 9l-7 7-7-7"
					/>
				</svg>
			</button>

			<!-- Body -->
			{#if expandido}
				<div
					transition:slide={{ duration: 200 }}
					class="px-3 pb-3 pt-2.5 border-t border-surface-200/50 dark:border-surface-700/50 flex flex-col justify-between gap-2.5"
				>
					<div class="space-y-2">
						{#if todosAssinados}
							<p class="text-xs font-bold text-surface-800 dark:text-surface-100 break-words">
								{nomesAssinantes || 'Assinado'}
							</p>
						{:else}
							<p class="text-2xs leading-snug text-surface-500 dark:text-surface-400">
								O supervisor poderá assinar os Relatórios de extra das equipes em lote (todos de uma
								vez), ou individualmente, através do quadro de cada seccional.
							</p>
							<p class="text-2xs leading-snug text-surface-500 dark:text-surface-400">
								<span class="text-error-600 dark:text-error-400 font-medium"
									>Faltando envio de:</span
								>
								{#if naoIniciou}
									Aguardando início
								{:else}
									{seccionaisFaltantes.length > 0
										? seccionaisFaltantes
												.map((s) => nomeSeccional(s.seccional_id ?? s.id ?? 0))
												.join(', ')
										: 'Nenhum'}
								{/if}
							</p>
							<p class="text-2xs leading-snug text-surface-500 dark:text-surface-400">
								<span class="text-success-600 dark:text-success-400 font-medium">Assinado de:</span>
								{#if naoIniciou}
									Aguardando início
								{:else}
									{seccionaisAssinadas.length > 0
										? seccionaisAssinadas
												.map((s) => nomeSeccional(s.seccional_id ?? s.id ?? 0))
												.join(', ')
										: 'Nenhum'}
								{/if}
							</p>
						{/if}

						{#if assinandoLote}
							<div class="flex flex-col gap-1.5">
								<p
									class="text-3xs font-bold uppercase tracking-widest text-warning-700 dark:text-warning-400 text-center"
								>
									{etapaAssinatura}
								</p>
								<div
									class="w-full bg-surface-200 dark:bg-surface-700 rounded-full h-2 overflow-hidden"
								>
									<div
										class="bg-warning-500 h-full transition-all duration-500 ease-out"
										style="width: {(progressoLote.atual / progressoLote.total) * 100}%"
									></div>
								</div>
								<p class="text-3xs text-surface-500 dark:text-surface-400 text-center">
									{progressoLote.atual} de {progressoLote.total}
								</p>
							</div>
						{/if}
					</div>

					{#if !assinandoLote}
						<div class="flex items-center gap-1.5 flex-wrap justify-end">
							{#if todosAssinados}
								{@render botoesDownloadLote(true)}
							{:else}
								<button
									type="button"
									class="btn btn-xs preset-tonal-primary border border-primary-500/30 hover:border-primary-500 px-2.5 py-1.5 text-3xs font-bold rounded-lg flex items-center gap-1"
									onclick={onConferencia || mostrarOrientaConferencia}
								>
									<svg
										class="h-2.5 w-2.5 shrink-0"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										><path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
										/></svg
									>
									Conferência
								</button>
								{#if podeAssinar}
									<button
										type="button"
										class="btn btn-xs preset-filled-warning-500 border border-warning-600/30 px-2.5 py-1.5 text-3xs font-bold rounded-lg hover:border-warning-600 disabled:opacity-40 flex items-center gap-1"
										disabled={loading.active || quantidadePendentes === 0}
										onclick={onAssinarManualLote}
									>
										<svg
											class="h-2.5 w-2.5 shrink-0"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
											><path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
											/></svg
										>
										Tela
									</button>
								{/if}
							{/if}
						</div>
					{/if}

					<!-- Listagem discreta de assinaturas concluídas -->
					{#if concluidosExtra.length > 0}
						<div class="mt-1 pt-2.5 border-t border-surface-200/50 dark:border-surface-700/50">
							<p
								class="text-3xs font-bold uppercase tracking-widest text-surface-400 dark:text-surface-500 mb-1.5 px-0.5"
							>
								Relatórios Assinados
							</p>
							<div class="flex flex-wrap gap-1.5">
								{#each concluidosExtra as ass (ass.seccional_id)}
									<div
										class="flex items-center gap-1.5 px-2 py-1 rounded-md bg-success-500/5 border border-success-500/10 text-3xs"
										title="Assinado por {ass.assinante_nome}"
									>
										<span class="text-success-600 dark:text-success-400">✓</span>
										<span class="font-medium text-surface-600 dark:text-surface-300"
											>{nomeSeccional(ass.seccional_id)}</span
										>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{/if}
		{:else}
			<!-- Desktop layout: Premium row layout -->
			<div class="flex items-center justify-between gap-4 p-3.5 px-4">
				<!-- Parte 1: Status e Título -->
				<div class="flex items-center gap-3 min-w-[250px] shrink-0">
					<div
						class="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg {statusLoteInfo.text ===
							'Todos Assinados' || statusLoteInfo.text === 'Assinados (parcial)'
							? 'bg-success-100 dark:bg-success-900/30'
							: statusLoteInfo.text === 'Todos prontos para ass.' ||
								  statusLoteInfo.text === 'pronto para ass. (parcial)'
								? 'bg-warning-100 dark:bg-warning-900/30'
								: 'bg-surface-100 dark:bg-surface-800'}"
					>
						<svg
							class="w-3.5 h-3.5 {statusLoteInfo.text === 'Todos Assinados' ||
							statusLoteInfo.text === 'Assinados (parcial)'
								? 'text-success-600 dark:text-success-400'
								: statusLoteInfo.text === 'Todos prontos para ass.' ||
									  statusLoteInfo.text === 'pronto para ass. (parcial)'
									? 'text-warning-600 dark:text-warning-400'
									: 'text-surface-400 dark:text-surface-500'}"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							{#if statusLoteInfo.text === 'Todos Assinados' || statusLoteInfo.text === 'Assinados (parcial)'}
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M5 13l4 4L19 7"
								/>
							{:else if statusLoteInfo.text === 'Todos prontos para ass.' || statusLoteInfo.text === 'pronto para ass. (parcial)'}
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
								/>
							{:else}
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
								/>
							{/if}
						</svg>
					</div>
					<div class="min-w-0">
						<span
							class="inline-flex items-center gap-1 rounded-full {statusLoteInfo.class} px-1.5 py-0.5 text-3xs font-bold uppercase"
						>
							{statusLoteInfo.text}
						</span>
						<p class="text-xs font-semibold text-surface-700 dark:text-surface-200 mt-0.5">
							Relatórios em lote
						</p>
					</div>
				</div>

				<!-- Parte 2: Informações/Detalhes -->
				<div
					class="flex-1 min-w-0 text-left border-l border-surface-200/40 dark:border-surface-800/80 pl-4 py-0.5"
				>
					{#if todosAssinados}
						<p class="text-xs font-bold text-surface-800 dark:text-surface-100 break-words">
							{nomesAssinantes || 'Assinado'}
						</p>
					{:else}
						<p class="text-2xs leading-snug text-surface-500 dark:text-surface-400">
							O supervisor poderá assinar os Relatórios de extra das equipes em lote (todos de uma
							vez), ou individualmente, através do quadro de cada seccional.
						</p>
						<p class="text-2xs leading-snug text-surface-500 dark:text-surface-400 mt-0.5">
							<span class="text-error-600 dark:text-error-400 font-medium">Faltando envio de:</span>
							{#if naoIniciou}
								Aguardando início
							{:else}
								{seccionaisFaltantes.length > 0
									? seccionaisFaltantes
											.map((s) => nomeSeccional(s.seccional_id ?? s.id ?? 0))
											.join(', ')
									: 'Nenhum'}
							{/if}
						</p>
						<p class="text-2xs leading-snug text-surface-500 dark:text-surface-400 mt-0.5">
							<span class="text-success-600 dark:text-success-400 font-medium">Assinado de:</span>
							{#if naoIniciou}
								Aguardando início
							{:else}
								{seccionaisAssinadas.length > 0
									? seccionaisAssinadas
											.map((s) => nomeSeccional(s.seccional_id ?? s.id ?? 0))
											.join(', ')
									: 'Nenhum'}
							{/if}
						</p>
					{/if}

					{#if assinandoLote}
						<div class="flex flex-col gap-1.5 mt-2 max-w-md">
							<p
								class="text-3xs font-bold uppercase tracking-widest text-warning-700 dark:text-warning-400 text-center"
							>
								{etapaAssinatura}
							</p>
							<div
								class="w-full bg-surface-200 dark:bg-surface-700 rounded-full h-2 overflow-hidden"
							>
								<div
									class="bg-warning-500 h-full transition-all duration-500 ease-out"
									style="width: {(progressoLote.atual / progressoLote.total) * 100}%"
								></div>
							</div>
							<p class="text-3xs text-surface-500 dark:text-surface-400 text-center">
								{progressoLote.atual} de {progressoLote.total}
							</p>
						</div>
					{/if}

					<!-- Listagem discreta de assinaturas concluídas -->
					{#if concluidosExtra.length > 0}
						<div class="mt-2 pt-2 border-t border-surface-200/40 dark:border-surface-800/80">
							<p
								class="text-3xs font-bold uppercase tracking-widest text-surface-400 dark:text-surface-500 mb-1.5 px-0.5"
							>
								Relatórios Assinados
							</p>
							<div class="flex flex-wrap gap-1.5">
								{#each concluidosExtra as ass (ass.seccional_id)}
									<div
										class="flex items-center gap-1.5 px-2 py-0.5 rounded bg-success-500/5 border border-success-500/10 text-3xs"
										title="Assinado por {ass.assinante_nome}"
									>
										<span class="text-success-600 dark:text-success-400">✓</span>
										<span class="font-medium text-surface-600 dark:text-surface-300"
											>{nomeSeccional(ass.seccional_id)}</span
										>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>

				<!-- Parte 3: Ações -->
				<div
					class="flex items-center gap-1.5 shrink-0 justify-end border-l border-surface-200/40 dark:border-surface-800/80 pl-4 py-0.5"
				>
					{#if todosAssinados}
						{@render botoesDownloadLote(false)}
					{:else}
						<button
							type="button"
							class="btn btn-xs preset-tonal-primary border border-primary-500/30 hover:border-primary-500 px-2.5 py-1.5 text-3xs font-bold rounded-lg flex items-center gap-1 hover:scale-[1.02] transition-all"
							onclick={onConferencia || mostrarOrientaConferencia}
						>
							<svg
								class="h-2.5 w-2.5 shrink-0"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
								/></svg
							>
							Conferência
						</button>
						{#if podeAssinar && !assinandoLote}
							<button
								type="button"
								class="btn btn-xs preset-filled-tertiary-500 border border-tertiary-600/30 px-2.5 py-1.5 text-3xs font-bold rounded-lg hover:border-tertiary-600 disabled:opacity-40 flex items-center gap-1 hover:scale-[1.02] transition-all"
								disabled={loading.active || quantidadePendentes === 0}
								onclick={() => (confirmandoLote = true)}
							>
								<svg
									class="h-2.5 w-2.5 shrink-0"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
									/></svg
								>
								Token
							</button>
						{/if}
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>

<!-- Ciência jurídica antes de disparar a assinatura em lote — o mesmo aviso do
     fluxo individual (Lei 14.063/2020 art. 4º §1º), que o lote não exibia. -->
<Dialog
	open={confirmandoLote}
	onOpenChange={(e) => {
		if (!e.open) confirmandoLote = false;
	}}
>
	<Dialog.Content
		class="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-surface-950/80 backdrop-blur-md overflow-y-auto"
	>
		<div
			class="card-elevated rounded-2xl shadow-2xl w-full max-w-lg p-5 sm:p-8 space-y-5 border border-white/10 max-h-[calc(100dvh-1.5rem)] overflow-y-auto"
		>
			<div class="text-center space-y-2">
				<Dialog.Title class="text-xl sm:text-2xl font-bold text-surface-900 dark:text-surface-50">
					Assinatura Digital em Lote
				</Dialog.Title>
				<Dialog.Description class="text-sm text-surface-500">
					Você está assinando, de uma só vez, os Relatórios de extra pendentes de
					<strong class="text-surface-900 dark:text-surface-50">
						{quantidadePendentes}
						{quantidadePendentes === 1 ? 'equipe' : 'equipes'}
					</strong>.
				</Dialog.Description>
			</div>

			<!-- Aviso jurídico (Lei 14.063/2020 art. 4º §1º) -->
			<p class="text-2xs text-surface-500 dark:text-surface-400 italic leading-snug">
				Ao clicar em <strong>Assinar</strong>, você confirma que leu os documentos e que estas
				assinaturas têm valor jurídico equivalente à manuscrita, conforme o
				<a href="/termo" target="_blank" rel="noopener" class="underline hover:text-primary-600"
					>Termo de Uso</a
				>
				aceito.
			</p>

			<button
				type="button"
				class="btn btn-sm preset-filled-primary-500 font-bold px-4 py-2 rounded-lg shadow-sm hover:scale-[1.02] transition-transform w-full flex items-center justify-center gap-2"
				onclick={confirmarAssinaturaLote}
			>
				<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
					/></svg
				>
				Assinar com Certificado Digital (SERPRO)
			</button>

			<button
				type="button"
				class="w-full btn preset-outlined-surface-500 py-3 rounded-2xl text-sm"
				onclick={() => (confirmandoLote = false)}
			>
				Cancelar e fechar
			</button>
		</div>
	</Dialog.Content>
</Dialog>
