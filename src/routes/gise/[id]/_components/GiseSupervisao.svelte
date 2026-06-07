<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { Snippet } from 'svelte';
	import { slide } from 'svelte/transition';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import PainelAssinaturaToken from '$lib/components/PainelAssinaturaToken.svelte';
	import { loading } from '$lib/loading.svelte';
	import {
		ShieldCheck,
		UserRound,
		Users,
		FileDown,
		CheckCircle2,
		Clock,
		PenLine
	} from 'lucide-svelte';
	import {
		estadoMarcadorRodagemSupervisao,
		quadroSupervisaoExtraExigeRelatorio,
		supervisaoExtraRubricasCompletas,
		faltantesSupervisaoExtra,
		FALTANTE_RUBRICA_SUPER_PREFIX
	} from '$lib/gise/gise-supervisao-extra';
	import type { GiseAssinaturaRelatorio } from '$lib/server/schema';
	import { SvelteMap } from 'svelte/reactivity';

	type PresencaGiseLinha = {
		policial_id: number;
		entrada_timestamp: string | null;
		saida_timestamp: string | null;
	};

	interface Gise {
		id: number;
		data_inicio: string;
		supervisor_id: number | null;
		supervisor_nome: string | null;
		assessor_id: number | null;
		assessor_email_notificacao?: string | null;
		assessor_nome?: string | null;
		seint1_id: number | null;
		seint1_nome?: string | null;
		seint2_id: number | null;
		seint2_nome?: string | null;
		status: string;
		seccionais?: { status: string; seccional_nome: string }[];
	}

	interface Policial {
		id: number;
		nome: string;
		matricula: string;
		cargo: string;
		email?: string | null;
		email_pessoal?: string | null;
	}

	interface DocumentoAssinadoInfo {
		existe: boolean;
		assinante_nome: string;
	}

	type LoadOptionsFn = (
		query: string,
		signal: AbortSignal
	) => Promise<{ value: number | null; label: string }[]>;

	type SelectedOption = { value: number | null; label: string } | null;

	interface Props {
		gise: Gise;
		policiais: Policial[];
		isAdminGeral: boolean;
		isSeccional: boolean;
		podeEditar: boolean;
		modoEdicaoGeral: boolean;
		editando: boolean;
		documentoAssinadoInfo: DocumentoAssinadoInfo | null;
		pendingCrud: boolean;
		buscarDpcs: LoadOptionsFn;
		buscarOips: LoadOptionsFn;
		selectedFromPoliciais: (id: number | null) => SelectedOption;
		supervisorId: number | null;
		assessorId: number | null;
		/** E-mail onde o assessor recebe aviso quando uma seccional envia a GISE (confirmado pelo Admin Geral). */
		assessorEmailNotificacao?: string;
		seint1Id: number | null;
		seint2Id: number | null;
		/** Presenças da GISE (entrada/saída) para marcadores do quadro. */
		presencasGise?: PresencaGiseLinha[] | null;
		/** Policiais SEINT do quadro que já enviaram relatório SEINT (sem `equipe_id`). */
		seintSupervisaoComRelatorio?: number[];
		/** Relatório de extra do quadro (unidade sintética). */
		supervisaoExtraUnidadeId?: number | null;
		assinaturasRelatorios?: GiseAssinaturaRelatorio[] | null;
		podeDownload?: boolean;
		isSupervisor?: boolean;
		isMobile?: boolean;
		restringirSmartphone?: boolean;
		onAssinarExtraSupervisaoManual?: () => void;
		onAssinarExtraSupervisaoDigital?: () => void;
		/** Exibe o painel de assinatura da escala (supervisor) dentro deste card, antes do relatório de extra. */
		mostrarPainelAssinaturaEscala?: boolean;
		assinaturaEscalaSignerEmail?: string;
		rubricaCapturada?: string | null | undefined;
		painelTokenGise?: { assinarComSerpro: () => Promise<void> } | null | undefined;
		serproSignerName?: string | undefined;
		serproSignerCpf?: string | undefined;
		onAbrirAssinaturaEscalaManual: () => void;
		onAssinaturaEscalaDigitalSuccess: () => Promise<void>;
		loteSection?: Snippet;
		onEditar: () => void;
		onCancelar: () => void;
		onSubmit: SubmitFunction;
	}

	let {
		gise,
		policiais,
		isAdminGeral,
		isSeccional,
		podeEditar,
		modoEdicaoGeral,
		editando,
		documentoAssinadoInfo,
		pendingCrud,
		buscarDpcs,
		buscarOips,
		selectedFromPoliciais,
		supervisorId = $bindable(),
		assessorId = $bindable(),
		assessorEmailNotificacao = $bindable(''),
		seint1Id = $bindable(),
		seint2Id = $bindable(),
		presencasGise = null,
		seintSupervisaoComRelatorio = [],
		supervisaoExtraUnidadeId = null,
		assinaturasRelatorios = null,
		podeDownload = false,
		isSupervisor = false,
		isMobile = false,
		restringirSmartphone = false,
		onAssinarExtraSupervisaoManual,
		onAssinarExtraSupervisaoDigital,
		mostrarPainelAssinaturaEscala = false,
		assinaturaEscalaSignerEmail = undefined,
		rubricaCapturada = $bindable(null),
		painelTokenGise = $bindable(null),
		serproSignerName = $bindable(''),
		serproSignerCpf = $bindable(''),
		onAbrirAssinaturaEscalaManual,
		onAssinaturaEscalaDigitalSuccess,
		loteSection,
		onEditar,
		onCancelar,
		onSubmit
	}: Props = $props();

	const seintRelatorioSet = $derived(new Set(seintSupervisaoComRelatorio ?? []));

	function marcador(
		papel: 'supervisor' | 'assessor' | 'seint',
		policialId: number | null | undefined
	) {
		return estadoMarcadorRodagemSupervisao(
			papel,
			policialId,
			presencasGise ?? [],
			seintRelatorioSet
		);
	}

	const stSupervisor = $derived(marcador('supervisor', gise.supervisor_id));

	const nomesSupervisaoPorId = $derived.by(() => {
		const m = new SvelteMap<number, string>();
		if (gise.supervisor_id && gise.supervisor_nome) m.set(gise.supervisor_id, gise.supervisor_nome);
		if (gise.assessor_id && gise.assessor_nome) m.set(gise.assessor_id, gise.assessor_nome);
		if (gise.seint1_id && gise.seint1_nome) m.set(gise.seint1_id, gise.seint1_nome);
		if (gise.seint2_id && gise.seint2_nome) m.set(gise.seint2_id, gise.seint2_nome);
		for (const p of policiais) {
			if (!m.has(p.id)) m.set(p.id, p.nome);
		}
		return m;
	});

	/** Sempre que existir quadro de supervisão com extra — não depende de `podeDownload` (evita sumir para o DPC). */
	const mostrarBlocoExtraSupervisao = $derived(quadroSupervisaoExtraExigeRelatorio(gise));

	const extraSupervisaoConfigurado = $derived(supervisaoExtraUnidadeId != null);

	const assRelSup = $derived(
		supervisaoExtraUnidadeId == null
			? undefined
			: assinaturasRelatorios?.find(
					(a) => a.seccional_id === supervisaoExtraUnidadeId && a.tipo === 'extraordinario'
				)
	);
	const rubSupOk = $derived(supervisaoExtraRubricasCompletas(gise, presencasGise ?? []));
	const faltSup = $derived(
		faltantesSupervisaoExtra(gise, presencasGise ?? [], nomesSupervisaoPorId)
	);

	const downloadExtraSupHabilitado = $derived(
		extraSupervisaoConfigurado &&
			!!podeDownload &&
			rubSupOk &&
			(assRelSup || isAdminGeral || isSeccional || isSupervisor)
	);
	const downloadExtraSupConferenciaHabilitado = $derived(
		extraSupervisaoConfigurado && (isAdminGeral || isSupervisor)
	);
	const assinaturaEscalaHabilitada = $derived(!!podeDownload);
	const assinaturaExtraHabilitada = $derived(!!rubSupOk && !!extraSupervisaoConfigurado);
	const mostrarPainelAssinaturaEscalaReadonly = $derived(
		isAdminGeral && !documentoAssinadoInfo?.existe
	);
	const seccionaisPendentes = $derived(
		gise.seccionais?.filter(
			(s) => s.status !== 'preenchida' && s.status !== 'preenchida_retificada'
		) || []
	);

	let expandirEscala = $state(false);
	let expandirExtra = $state(false);
</script>

<div
	class="relative overflow-visible rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 shadow-sm transition-all duration-300 hover:shadow-md"
>
	<div
		class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary-500 via-secondary-500 to-tertiary-500 opacity-70"
	></div>

	<div class="p-3 sm:p-5 md:p-6">
		<div class="mb-3 sm:mb-5 flex flex-wrap items-center justify-between gap-2 sm:gap-4">
			<div class="flex min-w-0 items-center gap-2 sm:gap-3">
				<div class="p-2 rounded-lg bg-primary-500/10 text-primary-600 dark:text-primary-400">
					<ShieldCheck size={24} />
				</div>
				<h2 class="text-xl font-bold text-surface-900 dark:text-surface-50 tracking-tight">
					Supervisão e apoio
				</h2>
			</div>

			<div class="flex w-full sm:w-auto flex-wrap items-center justify-end gap-2 sm:gap-3">
				{#if !editando && !documentoAssinadoInfo?.existe && mostrarBlocoExtraSupervisao && !(mostrarPainelAssinaturaEscala || mostrarPainelAssinaturaEscalaReadonly)}
					<span
						class="inline-flex items-center gap-1.5 rounded-full bg-warning-500 px-3 py-1 text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-warning-500/20"
					>
						<Clock size={12} class="shrink-0" />
						Ass. Escala Pend.
					</span>
				{/if}
				{#if isAdminGeral && podeEditar && modoEdicaoGeral && !editando}
					<button
						type="button"
						class="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all duration-200 {!gise.supervisor_id
							? 'animate-pulse bg-warning-500 text-white shadow-lg shadow-warning-500/20 hover:bg-warning-600'
							: 'border border-surface-200 bg-surface-100 text-surface-700 hover:bg-surface-200 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-300 dark:hover:bg-surface-700'}"
						onclick={onEditar}
					>
						<PenLine size={16} />
						{!gise.supervisor_id
							? isMobile
								? 'Definir supervisor'
								: 'Definir Supervisão'
							: 'Editar'}
					</button>
				{/if}
			</div>
		</div>

		{#if editando}
			<form method="POST" action="?/salvarSupervisores" use:enhance={onSubmit} class="space-y-4">
				<!-- Seção: Comando (DPC + Assessor) -->
				<div>
					<p
						class="text-[0.65rem] font-bold uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-2 px-0.5"
					>
						Comando
					</p>
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
						<div class="flex flex-col gap-1.5">
							<label
								for="supId"
								class="text-xs font-semibold text-surface-600 dark:text-surface-400 px-0.5"
								>Supervisão e apoio (DPC)</label
							>
							<SearchableSelect
								id="supId"
								bind:value={supervisorId}
								loadOptions={buscarDpcs}
								selectedOption={selectedFromPoliciais(supervisorId)}
								placeholder="Pesquisar DPC..."
								minSearchChars={2}
								showTrigger={false}
								class="w-full"
							/>
						</div>
						<div class="flex flex-col gap-1.5">
							<label
								for="assessorId"
								class="text-xs font-semibold text-surface-600 dark:text-surface-400 px-0.5"
							>
								Assessor (OIP)
							</label>
							<SearchableSelect
								id="assessorId"
								bind:value={assessorId}
								loadOptions={buscarOips}
								selectedOption={selectedFromPoliciais(assessorId)}
								placeholder="Pesquisar Assessor..."
								minSearchChars={2}
								showTrigger={false}
								class="w-full"
							/>
						</div>
					</div>
				</div>

				<!-- Bloco de e-mail do assessor: largura total, aparece logo abaixo quando há assessor -->
				{#if assessorId != null}
					<div
						class="rounded-xl border border-primary-400/25 bg-primary-500/5 dark:bg-primary-500/10 p-4 space-y-3"
					>
						<div class="flex items-start gap-2.5">
							<div
								class="mt-0.5 shrink-0 w-7 h-7 rounded-lg bg-primary-500/15 flex items-center justify-center text-primary-600 dark:text-primary-400"
							>
								<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
									/>
								</svg>
							</div>
							<div class="min-w-0">
								<p class="text-xs font-bold text-surface-700 dark:text-surface-200 mb-0.5">
									Avisos de preenchimento
								</p>
								<p class="text-xs text-surface-500 dark:text-surface-400 leading-snug">
									Quando uma seccional finalizar o envio da escala, o sistema envia um e-mail com
									resumo para o endereço abaixo. Confira ou edite o e-mail pessoal do assessor.
								</p>
							</div>
						</div>
						<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
							<div class="flex flex-col gap-1.5">
								<label
									for="assessorEmailNotif"
									class="text-xs font-semibold text-surface-600 dark:text-surface-400"
									>E-mail do assessor (avisos GISE)</label
								>
								<input
									id="assessorEmailNotif"
									type="email"
									name="assessor_email_notificacao"
									autocomplete="email"
									bind:value={assessorEmailNotificacao}
									class="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-sm focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-400/30 transition-colors"
									placeholder="nome@provedor.com"
								/>
							</div>
							<label class="flex items-start gap-2.5 cursor-pointer sm:pb-0.5">
								<input
									type="checkbox"
									name="confirmar_email_assessor"
									value="1"
									class="mt-0.5 shrink-0 rounded border-surface-400"
									required
								/>
								<span class="text-xs text-surface-600 dark:text-surface-300 leading-snug"
									>Confirmo que este e-mail está correto para receber os avisos das seccionais.</span
								>
							</label>
						</div>
					</div>
				{/if}

				<!-- Seção: Inteligência (SEINT) -->
				<div>
					<p
						class="text-[0.65rem] font-bold uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-2 px-0.5"
					>
						Inteligência (SEINT)
					</p>
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
						<div class="flex flex-col gap-1.5">
							<label
								for="seint1Id"
								class="text-xs font-semibold text-surface-600 dark:text-surface-400 px-0.5"
							>
								SEINT 1 (OIP)
							</label>
							<SearchableSelect
								id="seint1Id"
								bind:value={seint1Id}
								loadOptions={buscarOips}
								selectedOption={selectedFromPoliciais(seint1Id)}
								placeholder="Pesquisar SEINT 1..."
								minSearchChars={2}
								showTrigger={false}
								class="w-full"
							/>
						</div>
						<div class="flex flex-col gap-1.5">
							<label
								for="seint2Id"
								class="text-xs font-semibold text-surface-600 dark:text-surface-400 px-0.5"
							>
								SEINT 2 (OIP)
							</label>
							<SearchableSelect
								id="seint2Id"
								bind:value={seint2Id}
								loadOptions={buscarOips}
								selectedOption={selectedFromPoliciais(seint2Id)}
								placeholder="Pesquisar SEINT 2..."
								minSearchChars={2}
								showTrigger={false}
								class="w-full"
							/>
						</div>
					</div>
				</div>

				<input type="hidden" name="supervisor_id" value={supervisorId ?? ''} />
				<input type="hidden" name="assessor_id" value={assessorId ?? ''} />
				<input type="hidden" name="seint1_id" value={seint1Id ?? ''} />
				<input type="hidden" name="seint2_id" value={seint2Id ?? ''} />

				<div
					class="flex justify-end gap-2 pt-1 border-t border-surface-200/60 dark:border-surface-700/60"
				>
					<button
						type="submit"
						class="btn preset-filled-primary-500 text-sm px-4 py-2 rounded-lg font-semibold"
						disabled={pendingCrud}
					>
						{pendingCrud ? 'Salvando...' : 'Salvar'}
					</button>
					<button
						type="button"
						class="btn preset-outlined-surface-500 text-sm px-4 py-2 rounded-lg"
						onclick={onCancelar}
					>
						Cancelar
					</button>
				</div>
			</form>
		{:else}
			<div
				class="p-3 sm:p-4 md:p-5 rounded-2xl bg-surface-100/70 dark:bg-surface-950/40 border border-surface-200 dark:border-surface-800/80 backdrop-blur-sm"
			>
				<div class="space-y-2.5 sm:space-y-4">
					<div class="flex items-start gap-2.5 sm:gap-4">
						<div
							class="mt-1 flex-shrink-0 w-10 h-10 rounded-full bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 flex items-center justify-center text-primary-600 dark:text-primary-400 shadow-sm"
						>
							<UserRound size={20} />
						</div>
						<div class="min-w-0 flex-1">
							<span
								class="block text-[0.65rem] uppercase tracking-wider font-bold text-surface-500 dark:text-surface-400 mb-0.5"
								>DPC Supervisão</span
							>
							<div class="flex min-w-0 items-center gap-2">
								<p
									class="min-w-0 shrink font-bold text-lg leading-tight text-surface-900 dark:text-white truncate"
								>
									{gise.supervisor_nome ?? 'Não definido'}
								</p>
								<div class="flex shrink-0 items-center">
									{#if stSupervisor === 'ok'}
										<span
											class="text-xs px-1 py-0.5 rounded bg-success-500/20 text-success-700 dark:text-success-400"
											title="Entrada e saída confirmadas">✓</span
										>
									{:else if stSupervisor === 'entrada'}
										<span
											class="text-xs px-1 py-0.5 rounded bg-warning-500/20 text-warning-700 dark:text-warning-400"
											title="Aguardando confirmação de saída">Entrada</span
										>
									{/if}
								</div>
							</div>
						</div>
					</div>

					<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3 pt-1.5 sm:pt-2">
						{#if gise.assessor_id}
							{@const stAss = marcador('assessor', gise.assessor_id)}
							<div
								class="flex items-center justify-between gap-2 p-2.5 px-3 rounded-xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 shadow-sm hover:shadow transition-all duration-200"
							>
								<div class="flex items-center gap-2.5 min-w-0">
									<div class="text-surface-400 dark:text-surface-500 shrink-0">
										<Users size={14} />
									</div>
									<div class="overflow-hidden min-w-0">
										<span
											class="block text-[0.6rem] uppercase font-bold text-surface-400 dark:text-surface-500"
											>Assessor</span
										>
										<p
											class="text-sm font-semibold text-surface-700 dark:text-surface-200 truncate"
										>
											{policiais.find((p) => p.id === gise.assessor_id)?.nome ?? 'Carregando...'}
										</p>
										{#if gise.assessor_email_notificacao}
											<p
												class="text-[0.65rem] text-surface-500 dark:text-surface-400 truncate mt-0.5"
												title="E-mail para avisos de seccionais"
											>
												Avisos: {gise.assessor_email_notificacao}
											</p>
										{/if}
									</div>
								</div>
								<div class="shrink-0 flex items-center">
									{#if stAss === 'ok'}
										<span
											class="text-xs px-1 py-0.5 rounded bg-success-500/20 text-success-700 dark:text-success-400"
											title="Entrada e saída confirmadas">✓</span
										>
									{:else if stAss === 'entrada'}
										<span
											class="text-xs px-1 py-0.5 rounded bg-warning-500/20 text-warning-700 dark:text-warning-400"
											title="Aguardando confirmação de saída">Entrada</span
										>
									{/if}
								</div>
							</div>
						{/if}

						{#if gise.seint1_id}
							{@const stS1 = marcador('seint', gise.seint1_id)}
							<div
								class="flex items-center justify-between gap-2 p-2.5 px-3 rounded-xl bg-white dark:bg-surface-900 border border-secondary-500/20 dark:border-secondary-500/35 shadow-sm hover:shadow transition-all duration-200"
							>
								<div class="flex items-center gap-2.5 min-w-0">
									<div class="text-secondary-600/70 dark:text-secondary-400/70 shrink-0">
										<Users size={14} />
									</div>
									<div class="overflow-hidden min-w-0">
										<span
											class="block text-[0.6rem] uppercase font-bold text-secondary-500/80 dark:text-secondary-400/80"
											>NUIP OIP</span
										>
										<p
											class="text-sm font-semibold text-surface-700 dark:text-surface-200 truncate"
										>
											{policiais.find((p) => p.id === gise.seint1_id)?.nome ?? 'Carregando...'}
										</p>
									</div>
								</div>
								<div class="shrink-0 flex flex-col items-end gap-0.5">
									{#if stS1 === 'ok'}
										<span
											class="text-xs px-1 py-0.5 rounded bg-success-500/20 text-success-700 dark:text-success-400"
											title="Entrada, relatório SEINT e saída concluídos">✓</span
										>
									{:else if stS1 === 'falta_relatorio'}
										<span
											class="text-xs px-1 py-0.5 rounded bg-warning-500/20 text-warning-700 dark:text-warning-400"
											title="Falta enviar o relatório SEINT (entrada e saída já confirmadas)"
											>Relatório</span
										>
									{:else if stS1 === 'entrada'}
										<span
											class="text-xs px-1 py-0.5 rounded bg-warning-500/20 text-warning-700 dark:text-warning-400"
											title="Aguardando confirmação de saída">Entrada</span
										>
									{/if}
								</div>
							</div>
						{/if}

						{#if gise.seint2_id}
							{@const stS2 = marcador('seint', gise.seint2_id)}
							<div
								class="flex items-center justify-between gap-2 p-2.5 px-3 rounded-xl bg-white dark:bg-surface-900 border border-secondary-500/20 dark:border-secondary-500/35 shadow-sm hover:shadow transition-all duration-200"
							>
								<div class="flex items-center gap-2.5 min-w-0">
									<div class="text-secondary-600/70 dark:text-secondary-400/70 shrink-0">
										<Users size={14} />
									</div>
									<div class="overflow-hidden min-w-0">
										<span
											class="block text-[0.6rem] uppercase font-bold text-secondary-500/80 dark:text-secondary-400/80"
											>NUIP OIP</span
										>
										<p
											class="text-sm font-semibold text-surface-700 dark:text-surface-200 truncate"
										>
											{policiais.find((p) => p.id === gise.seint2_id)?.nome ?? 'Carregando...'}
										</p>
									</div>
								</div>
								<div class="shrink-0 flex flex-col items-end gap-0.5">
									{#if stS2 === 'ok'}
										<span
											class="text-xs px-1 py-0.5 rounded bg-success-500/20 text-success-700 dark:text-success-400"
											title="Entrada, relatório SEINT e saída concluídos">✓</span
										>
									{:else if stS2 === 'falta_relatorio'}
										<span
											class="text-xs px-1 py-0.5 rounded bg-warning-500/20 text-warning-700 dark:text-warning-400"
											title="Falta enviar o relatório SEINT (entrada e saída já confirmadas)"
											>Relatório</span
										>
									{:else if stS2 === 'entrada'}
										<span
											class="text-xs px-1 py-0.5 rounded bg-warning-500/20 text-warning-700 dark:text-warning-400"
											title="Aguardando confirmação de saída">Entrada</span
										>
									{/if}
								</div>
							</div>
						{/if}
					</div>
				</div>

				{#if documentoAssinadoInfo?.existe || mostrarPainelAssinaturaEscala || mostrarPainelAssinaturaEscalaReadonly || mostrarBlocoExtraSupervisao || loteSection || isSupervisor}
					{@const mostrarColEscala =
						!!documentoAssinadoInfo?.existe ||
						mostrarPainelAssinaturaEscala ||
						mostrarPainelAssinaturaEscalaReadonly ||
						isSupervisor}
					{@const mostrarColExtra = mostrarBlocoExtraSupervisao}
					{@const colCount =
						(mostrarColEscala ? 1 : 0) + (mostrarColExtra ? 1 : 0) + (loteSection ? 1 : 0)}
					<div class="border-t border-surface-200/60 dark:border-surface-700/60 pt-3 mt-4 sm:mt-5">
						<div
							class="grid grid-cols-1 gap-3 sm:gap-4 {colCount === 3
								? 'sm:grid-cols-2 lg:grid-cols-3'
								: colCount === 2
									? 'md:grid-cols-2'
									: ''}"
						>
							{#if mostrarColEscala}
								<section class="flex flex-col gap-1.5 h-full">
									<p
										class="text-[0.6rem] font-bold uppercase tracking-wider text-surface-400 dark:text-surface-500"
									>
										{documentoAssinadoInfo?.existe ? 'Escala GISE' : 'Assinatura da escala GISE'}
									</p>
									<div
										class="flex-1 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden flex flex-col shadow-sm hover:shadow-md transition-shadow duration-300"
									>
										<!-- Header: sempre visível, clicável no mobile -->
										<button
											type="button"
											class="flex w-full items-center gap-2 p-3 text-left {isMobile
												? 'cursor-pointer active:bg-surface-100/60 dark:active:bg-surface-700/40'
												: 'pointer-events-none'}"
											onclick={() => {
												if (isMobile) expandirEscala = !expandirEscala;
											}}
										>
											<div
												class="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg bg-surface-100 dark:bg-surface-700"
											>
												<ShieldCheck size={14} />
											</div>
											<div class="min-w-0 flex-1">
												{#if documentoAssinadoInfo?.existe}
													<span
														class="inline-flex items-center gap-1 rounded-full bg-success-500/15 px-1.5 py-0.5 text-[0.58rem] font-bold uppercase text-success-700 dark:text-success-400"
													>
														<CheckCircle2 size={9} />Assinada
													</span>
													<p
														class="text-xs font-semibold text-surface-700 dark:text-surface-200 mt-0.5"
													>
														Escala assinada digitalmente
													</p>
												{:else}
													{#if gise.status === 'aguardando_assinatura'}
														<span
															class="inline-flex items-center gap-1 rounded-full bg-warning-500/15 px-1.5 py-0.5 text-[0.58rem] font-bold uppercase text-warning-700 dark:text-warning-400"
														>
															<Clock size={9} />ass. Pendente
														</span>
													{:else}
														<span
															class="inline-flex items-center gap-1 rounded-full bg-surface-500/15 px-1.5 py-0.5 text-[0.58rem] font-bold uppercase text-surface-700 dark:text-surface-400"
														>
															<Clock size={9} />em preenchimento
														</span>
													{/if}
													<p
														class="text-xs font-semibold text-surface-700 dark:text-surface-200 mt-0.5"
													>
														Assinatura da escala GISE
													</p>
												{/if}
											</div>
											{#if isMobile}
												<svg
													class="h-4 w-4 shrink-0 text-surface-400 transition-transform duration-200 {expandirEscala
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
											{/if}
										</button>
										<!-- Body: sempre visível no desktop, expansível no mobile -->
										{#if !isMobile || expandirEscala}
											<div
												transition:slide={{ duration: 200 }}
												class="px-3 pb-3 pt-2.5 border-t border-surface-200/50 dark:border-surface-700/50 flex-1 flex flex-col justify-between gap-2.5"
											>
												<div class="space-y-2">
													{#if documentoAssinadoInfo?.existe}
														<p
															class="text-xs font-bold text-surface-800 dark:text-surface-100 break-words"
														>
															{documentoAssinadoInfo.assinante_nome}
														</p>
													{:else}
														<p
															class="text-[0.68rem] leading-snug text-surface-500 dark:text-surface-400"
														>
															O supervisor poderá assinar a escala quando todas as seccionais
															enviarem a escala.
														</p>
														<p
															class="text-[0.68rem] leading-snug text-surface-500 dark:text-surface-400"
														>
															<span class="text-error-600 dark:text-error-400 font-medium"
																>Faltando envio de:</span
															>
															{#if !gise.seccionais || gise.seccionais.length === 0}
																a escalar
															{:else if seccionaisPendentes.length === 0}
																Nenhum
															{:else}
																{seccionaisPendentes.map((s) => s.seccional_nome).join(', ')}
															{/if}
														</p>
													{/if}
												</div>
												<div class="flex items-center gap-1.5 flex-wrap justify-end">
													{#if documentoAssinadoInfo?.existe}
														<a
															href="/api/gise/{gise.id}/documento-assinado"
															target="_blank"
															class="btn btn-xs preset-filled-primary-500 px-3 py-1.5 text-xs font-bold rounded-lg no-underline flex items-center gap-1.5"
														>
															<FileDown size={13} class="shrink-0" />
															Baixar PDF
														</a>
													{:else}
														{#if isSupervisor || isAdminGeral}
															<a
																class="btn btn-xs text-[0.65rem] px-2.5 py-1.5 rounded-lg font-semibold no-underline flex items-center gap-1 {assinaturaEscalaHabilitada
																	? 'preset-tonal-primary border border-primary-500/30 hover:border-primary-500'
																	: 'preset-tonal-surface opacity-50 pointer-events-none'}"
																href="/api/gise/{gise.id}/download?format=pdf"
																target="_blank"
																title="Conferência (sem assinatura digital)"
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
															</a>
														{/if}
														{#if isSupervisor}
															{#if isMobile}
																<button
																	type="button"
																	class="btn btn-xs preset-filled-warning-500 border border-warning-600/30 px-2.5 py-1.5 text-[0.65rem] font-bold rounded-lg hover:border-warning-600 disabled:opacity-40 flex items-center gap-1"
																	disabled={!mostrarPainelAssinaturaEscala}
																	onclick={() => onAbrirAssinaturaEscalaManual()}
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
															{:else}
																<button
																	type="button"
																	class="btn btn-xs preset-filled-tertiary-500 border border-tertiary-600/30 px-2.5 py-1.5 text-[0.65rem] font-bold rounded-lg hover:border-tertiary-600 disabled:opacity-40 flex items-center gap-1"
																	disabled={!mostrarPainelAssinaturaEscala}
																	onclick={() => painelTokenGise?.assinarComSerpro()}
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
													{/if}
												</div>
											</div>
										{/if}
									</div>
									{#if mostrarPainelAssinaturaEscala}
										<div class="sr-only" aria-hidden="true">
											<PainelAssinaturaToken
												bind:control={painelTokenGise}
												bind:signerName={serproSignerName}
												bind:signerCpf={serproSignerCpf}
												signerEmail={assinaturaEscalaSignerEmail ?? ''}
												prepararUrl="/api/gise/{gise.id}/preparar-assinatura"
												finalizarUrl="/api/gise/{gise.id}/finalizar-assinatura"
												nomeArquivo="gise_{gise.data_inicio}_assinada.pdf"
												extraPayload={{ rubrica: rubricaCapturada }}
												disabled={false}
												onSuccess={onAssinaturaEscalaDigitalSuccess}
											/>
										</div>
									{/if}
								</section>
							{/if}

							{#if mostrarBlocoExtraSupervisao}
								<section class="flex flex-col gap-1.5 h-full">
									<p
										class="text-[0.6rem] font-bold uppercase tracking-wider text-surface-400 dark:text-surface-500"
									>
										Relatório de extra (Supervisão e apoio)
									</p>
									<div
										class="flex-1 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden flex flex-col shadow-sm hover:shadow-md transition-shadow duration-300"
									>
										{#if !extraSupervisaoConfigurado}
											<p
												class="text-xs text-warning-700 dark:text-warning-400 bg-warning-500/10 border border-warning-500/20 rounded-lg m-3 px-3 py-2"
											>
												O relatório de extra do quadro ainda não está disponível. Peça ao
												administrador para executar as migrações.
											</p>
										{:else}
											<!-- Header -->
											<button
												type="button"
												class="flex w-full items-center gap-2 p-3 text-left {isMobile
													? 'cursor-pointer active:bg-surface-100/60 dark:active:bg-surface-700/40'
													: 'pointer-events-none'}"
												onclick={() => {
													if (isMobile) expandirExtra = !expandirExtra;
												}}
											>
												<div
													class="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg bg-surface-100 dark:bg-surface-700"
												>
													<ShieldCheck size={14} />
												</div>
												<div class="min-w-0 flex-1">
													{#if assRelSup}
														<span
															class="inline-flex items-center gap-1 rounded-full bg-success-500/15 px-1.5 py-0.5 text-[0.58rem] font-bold uppercase text-success-700 dark:text-success-400"
														>
															<CheckCircle2 size={9} />Assinado
														</span>
														<p
															class="text-xs font-semibold text-surface-700 dark:text-surface-200 mt-0.5"
														>
															Relatório de extra — supervisão e apoio
														</p>
													{:else if rubSupOk}
														<span
															class="inline-flex items-center gap-1 rounded-full bg-warning-500/15 px-1.5 py-0.5 text-[0.58rem] font-bold uppercase text-warning-700 dark:text-warning-400"
														>
															<Clock size={9} />pronto para assinar
														</span>
														<p
															class="text-xs font-semibold text-surface-700 dark:text-surface-200 mt-0.5"
														>
															Relatório de extra — supervisão e apoio
														</p>
													{:else}
														<span
															class="inline-flex items-center gap-1 rounded-full bg-surface-500/15 px-1.5 py-0.5 text-[0.58rem] font-bold uppercase text-surface-700 dark:text-surface-400"
														>
															<Clock size={9} />Aguardando rubricas
														</span>
														<p
															class="text-xs font-semibold text-surface-700 dark:text-surface-200 mt-0.5"
														>
															Relatório de extra — supervisão e apoio
														</p>
													{/if}
												</div>
												{#if isMobile}
													<svg
														class="h-4 w-4 shrink-0 text-surface-400 transition-transform duration-200 {expandirExtra
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
												{/if}
											</button>
											<!-- Body -->
											{#if !isMobile || expandirExtra}
												<div
													transition:slide={{ duration: 200 }}
													class="px-3 pb-3 pt-2.5 border-t border-surface-200/50 dark:border-surface-700/50 flex-1 flex flex-col justify-between gap-2.5"
												>
													<div class="space-y-2">
														{#if assRelSup}
															<p
																class="text-xs font-bold text-surface-800 dark:text-surface-100 break-words"
															>
																{assRelSup.assinante_nome}
															</p>
														{:else}
															<p
																class="text-[0.68rem] leading-snug text-surface-500 dark:text-surface-400"
															>
																O supervisor poderá assinar o relatório de extra do quadro de
																supervisão quando todos os integrantes confirmarem sua saída.
															</p>
															{#if !rubSupOk}
																<p
																	class="text-[0.68rem] leading-snug text-surface-500 dark:text-surface-400"
																>
																	{#if faltSup?.startsWith(FALTANTE_RUBRICA_SUPER_PREFIX)}
																		<span class="text-error-600 dark:text-error-400 font-medium"
																			>Faltando rúbrica de:</span
																		>{faltSup.slice(FALTANTE_RUBRICA_SUPER_PREFIX.length)}
																	{:else}
																		{faltSup ?? 'Aguardando rúbricas do quadro de supervisão.'}
																	{/if}
																</p>
															{:else}
																<p
																	class="text-[0.68rem] leading-snug text-surface-500 dark:text-surface-400"
																>
																	Disponível para conferência. Aguardando assinatura.
																</p>
															{/if}
														{/if}
													</div>
													<div class="flex items-center gap-1.5 flex-wrap justify-end">
														{#if assRelSup}
															<a
																href="/api/gise/{gise.id}/download?format=extraordinario&seccionalId={supervisaoExtraUnidadeId}"
																target="_blank"
																class="btn btn-xs preset-filled-primary-500 px-3 py-1.5 text-xs font-bold rounded-lg no-underline flex items-center gap-1.5 {!downloadExtraSupHabilitado
																	? 'pointer-events-none opacity-60'
																	: ''}"
															>
																<FileDown size={13} class="shrink-0" />
																Baixar PDF
															</a>
														{:else}
															<a
																class="btn btn-xs text-[0.65rem] px-2.5 py-1.5 rounded-lg font-semibold no-underline flex items-center gap-1 {downloadExtraSupConferenciaHabilitado
																	? 'preset-tonal-primary border border-primary-500/30 hover:border-primary-500'
																	: 'preset-tonal-surface opacity-50 pointer-events-none'}"
																href="/api/gise/{gise.id}/download?format=extraordinario&seccionalId={supervisaoExtraUnidadeId}"
																target="_blank"
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
															</a>
															{#if isSupervisor && extraSupervisaoConfigurado}
																{#if isMobile}
																	<button
																		type="button"
																		class="btn btn-xs preset-filled-warning-500 border border-warning-600/30 px-2.5 py-1.5 text-[0.65rem] font-bold rounded-lg hover:border-warning-600 disabled:opacity-40 flex items-center gap-1"
																		disabled={!assinaturaExtraHabilitada}
																		onclick={() => onAssinarExtraSupervisaoManual?.()}
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
																{:else}
																	<button
																		type="button"
																		class="btn btn-xs preset-filled-tertiary-500 border border-tertiary-600/30 px-2.5 py-1.5 text-[0.65rem] font-bold rounded-lg hover:border-tertiary-600 disabled:opacity-40 flex items-center gap-1"
																		disabled={!assinaturaExtraHabilitada}
																		onclick={() => onAssinarExtraSupervisaoDigital?.()}
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
														{/if}
													</div>
												</div>
											{/if}
										{/if}
									</div>
								</section>
							{/if}
							{@render loteSection?.()}
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>
