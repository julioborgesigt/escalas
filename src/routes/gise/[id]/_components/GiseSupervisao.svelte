<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import PainelAssinaturaToken from '$lib/components/PainelAssinaturaToken.svelte';
	import { loading } from '$lib/loading.svelte';
	import { ShieldCheck, UserRound, Users, FileDown, CheckCircle2, Clock, PenLine } from 'lucide-svelte';
	import {
		estadoMarcadorRodagemSupervisao,
		quadroSupervisaoExtraExigeRelatorio,
		supervisaoExtraRubricasCompletas,
		faltantesSupervisaoExtra,
		FALTANTE_RUBRICA_SUPER_PREFIX
	} from '$lib/gise/gise-supervisao-extra';
	import type { GiseAssinaturaRelatorio } from '$lib/server/schema';

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
		assessor_nome?: string | null;
		seint1_id: number | null;
		seint1_nome?: string | null;
		seint2_id: number | null;
		seint2_nome?: string | null;
	}

	interface Policial {
		id: number;
		nome: string;
		matricula: string;
		cargo: string;
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
		const m = new Map<number, string>();
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
	const faltSup = $derived(faltantesSupervisaoExtra(gise, presencasGise ?? [], nomesSupervisaoPorId));

	const downloadExtraSupHabilitado = $derived(
		extraSupervisaoConfigurado &&
			!!podeDownload &&
			rubSupOk &&
			(assRelSup || isAdminGeral || isSeccional || isSupervisor)
	);
	const assinaturaEscalaHabilitada = $derived(!!podeDownload);
	const assinaturaExtraHabilitada = $derived(!!rubSupOk && !!extraSupervisaoConfigurado);
	const mostrarPainelAssinaturaEscalaReadonly = $derived(
		isAdminGeral && !documentoAssinadoInfo?.existe
	);
</script>

<div
	class="relative overflow-visible rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 shadow-sm transition-all duration-300 hover:shadow-md"
>
	<div
		class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary-500 via-secondary-500 to-tertiary-500 opacity-70"
	></div>

	<div class="p-6">
		<div class="flex flex-wrap items-center justify-between gap-4 mb-5">
			<div class="flex items-center gap-3">
				<div class="p-2 rounded-lg bg-primary-500/10 text-primary-600 dark:text-primary-400">
					<ShieldCheck size={24} />
				</div>
				<h2 class="text-xl font-bold text-surface-900 dark:text-surface-50 tracking-tight">
					Supervisão e apoio
				</h2>
			</div>

			{#if isAdminGeral && podeEditar && modoEdicaoGeral && !editando}
				<button
					type="button"
					class="flex items-center gap-2 text-sm px-4 py-2 rounded-xl font-bold transition-all duration-200 {!gise.supervisor_id
						? 'bg-warning-500 text-white hover:bg-warning-600 shadow-lg shadow-warning-500/20 animate-pulse'
						: 'bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700 border border-surface-200 dark:border-surface-700'}"
					onclick={onEditar}
				>
					<PenLine size={16} />
					{!gise.supervisor_id ? 'Definir Supervisão' : 'Editar Supervisão'}
				</button>
			{/if}
		</div>

		{#if editando}
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
				<div>
					<label
						for="supId"
						class="text-sm font-bold text-surface-600 dark:text-surface-400 block mb-2 px-1"
						>Supervisão e apoio (DPC)</label
					>
					<SearchableSelect
						id="supId"
						bind:value={supervisorId}
						loadOptions={buscarDpcs}
						selectedOption={selectedFromPoliciais(supervisorId)}
						placeholder="Pesquisar Supervisão..."
						class="w-full"
					/>
				</div>
				<div>
					<label
						for="assessorId"
						class="text-sm font-bold text-surface-600 dark:text-surface-400 block mb-2 px-1"
					>
						Assessor (OIP)
					</label>
					<SearchableSelect
						id="assessorId"
						bind:value={assessorId}
						loadOptions={buscarOips}
						selectedOption={selectedFromPoliciais(assessorId)}
						placeholder="Pesquisar Assessor..."
						class="w-full"
					/>
				</div>
				<div>
					<label
						for="seint1Id"
						class="text-sm font-bold text-surface-600 dark:text-surface-400 block mb-2 px-1"
					>
						Inteligência 1 (SEINT - OIP)
					</label>
					<SearchableSelect
						id="seint1Id"
						bind:value={seint1Id}
						loadOptions={buscarOips}
						selectedOption={selectedFromPoliciais(seint1Id)}
						placeholder="Pesquisar SEINT 1..."
						class="w-full"
					/>
				</div>
				<div>
					<label
						for="seint2Id"
						class="text-sm font-bold text-surface-600 dark:text-surface-400 block mb-2 px-1"
					>
						Inteligência 2 (SEINT - OIP)
					</label>
					<SearchableSelect
						id="seint2Id"
						bind:value={seint2Id}
						loadOptions={buscarOips}
						selectedOption={selectedFromPoliciais(seint2Id)}
						placeholder="Pesquisar SEINT 2..."
						class="w-full"
					/>
				</div>
			</div>
			<form
				method="POST"
				action="?/salvarSupervisores"
				use:enhance={onSubmit}
				class="flex gap-2"
			>
				<input type="hidden" name="supervisor_id" value={supervisorId ?? ''} />
				<input type="hidden" name="assessor_id" value={assessorId ?? ''} />
				<input type="hidden" name="seint1_id" value={seint1Id ?? ''} />
				<input type="hidden" name="seint2_id" value={seint2Id ?? ''} />
				<button
					type="submit"
					class="btn preset-filled-primary-500 text-sm px-3 py-1.5 rounded-lg"
					disabled={pendingCrud}
				>
					{pendingCrud ? 'Salvando...' : 'Salvar'}
				</button>
				<button
					type="button"
					class="btn preset-outlined-surface text-sm px-3 py-1.5 rounded-lg"
					onclick={onCancelar}
				>
					Cancelar
				</button>
			</form>
		{:else}
			<div
				class="p-5 rounded-2xl bg-surface-50/50 dark:bg-surface-800/40 border border-surface-200/60 dark:border-surface-700/60 backdrop-blur-sm"
			>
				<div class="flex flex-col md:flex-row md:items-center justify-between gap-6">
					<div class="space-y-4 flex-1">
						<div class="flex items-start gap-4">
							<div
								class="mt-1 flex-shrink-0 w-10 h-10 rounded-full bg-white dark:bg-surface-700 border border-surface-200 dark:border-surface-600 flex items-center justify-center text-primary-600 dark:text-primary-400 shadow-sm"
							>
								<UserRound size={20} />
							</div>
							<div class="min-w-0 flex-1">
								<span
									class="block text-[0.65rem] uppercase tracking-wider font-bold text-surface-500 dark:text-surface-400 mb-0.5"
									>DPC Supervisão</span
								>
								<div class="flex items-center gap-2 flex-wrap">
									<p class="font-bold text-lg text-surface-900 dark:text-white leading-tight">
										{gise.supervisor_nome ?? 'Não definido'}
									</p>
									{#if stSupervisor === 'ok'}
										<span
											class="text-xs px-1 py-0.5 rounded bg-success-500/20 text-success-700 dark:text-success-400 shrink-0"
											title="Entrada e saída confirmadas">✓</span
										>
									{:else if stSupervisor === 'entrada'}
										<span
											class="text-xs px-1 py-0.5 rounded bg-warning-500/20 text-warning-700 dark:text-warning-400 shrink-0"
											title="Aguardando confirmação de saída">Entrada</span
										>
									{/if}
								</div>
							</div>
						</div>

						<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
							{#if gise.assessor_id}
								{@const stAss = marcador('assessor', gise.assessor_id)}
								<div
									class="flex items-center justify-between gap-2 p-2 px-3 rounded-lg bg-white/60 dark:bg-surface-900/40 border border-surface-100 dark:border-surface-700/50"
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
									class="flex items-center justify-between gap-2 p-2 px-3 rounded-lg bg-indigo-500/5 dark:bg-indigo-500/10 border border-indigo-500/10 dark:border-indigo-500/20"
								>
									<div class="flex items-center gap-2.5 min-w-0">
										<div class="text-indigo-600/70 dark:text-indigo-400/70 shrink-0">
											<Users size={14} />
										</div>
										<div class="overflow-hidden min-w-0">
											<span
												class="block text-[0.6rem] uppercase font-bold text-indigo-500/80 dark:text-indigo-400/80"
												>SEINT OIP</span
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
									class="flex items-center justify-between gap-2 p-2 px-3 rounded-lg bg-indigo-500/5 dark:bg-indigo-500/10 border border-indigo-500/10 dark:border-indigo-500/20"
								>
									<div class="flex items-center gap-2.5 min-w-0">
										<div class="text-indigo-600/70 dark:text-indigo-400/70 shrink-0">
											<Users size={14} />
										</div>
										<div class="overflow-hidden min-w-0">
											<span
												class="block text-[0.6rem] uppercase font-bold text-indigo-500/80 dark:text-indigo-400/80"
												>SEINT OIP</span
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

					{#if !documentoAssinadoInfo?.existe}
						<div class="flex flex-col items-end gap-3 min-w-[140px]">
							<div class="flex flex-col items-end">
								<span
									class="flex items-center gap-1.5 px-3 py-1 rounded-full bg-warning-500 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-warning-500/20"
								>
									<Clock size={12} />
									Ass. Escala Pend.
								</span>
							</div>
						</div>
					{/if}
				</div>

				{#if documentoAssinadoInfo?.existe}
					<section
						class="mt-6 pt-4 border-t border-surface-200/60 dark:border-surface-700/60 space-y-2"
					>
						<p
							class="text-[0.65rem] font-bold uppercase tracking-wider text-surface-500 dark:text-surface-400"
						>
							Escala GISE
						</p>
						<div
							class="rounded-xl border border-surface-200/80 dark:border-surface-700/80 bg-white/70 dark:bg-surface-900/50 p-4 flex flex-wrap items-center justify-between gap-4"
						>
							<div class="flex items-center gap-2 text-xs text-surface-500 dark:text-surface-400 min-w-0 flex-1">
								<div
									class="w-8 h-8 rounded-lg bg-surface-100 dark:bg-surface-700 flex items-center justify-center shrink-0"
								>
									<ShieldCheck size={16} />
								</div>
								<div class="min-w-0">
									<p>Escala assinada digitalmente por:</p>
									<p class="font-bold text-surface-900 dark:text-surface-100">
										{documentoAssinadoInfo.assinante_nome}
									</p>
								</div>
							</div>

							<div class="flex flex-wrap items-center justify-end gap-3 shrink-0 w-full sm:w-auto">
								<span
									class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-success-500 text-white font-bold text-[0.65rem] uppercase tracking-wider shadow-lg shadow-success-500/20 text-center leading-tight whitespace-nowrap"
								>
									<CheckCircle2 size={12} class="shrink-0" />
									Escala assinada
								</span>
								<a
									href={`/api/gise/${gise.id}/documento-assinado`}
									target="_blank"
									class="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold transition-all shadow-lg shadow-primary-500/20 active:scale-95"
								>
									<FileDown size={18} />
									Baixar PDF Assinado
								</a>
							</div>
						</div>
					</section>
				{/if}

				{#if mostrarPainelAssinaturaEscala || mostrarPainelAssinaturaEscalaReadonly}
					<section
						class="mt-6 pt-4 border-t border-surface-200/60 dark:border-surface-700/60 space-y-2"
					>
						<p
							class="text-[0.65rem] font-bold uppercase tracking-wider text-surface-500 dark:text-surface-400"
						>
							Assinatura da escala GISE
						</p>
						<div
							class="rounded-xl border border-surface-200/80 dark:border-surface-700/80 bg-white/70 dark:bg-surface-900/50 p-4"
						>
							<div class="flex flex-wrap items-center justify-between gap-4">
								<div
									class="flex items-center gap-2 text-xs text-surface-500 dark:text-surface-400 min-w-0 flex-1"
								>
									<div
										class="w-8 h-8 rounded-lg bg-surface-100 dark:bg-surface-700 flex items-center justify-center shrink-0"
									>
										<ShieldCheck size={16} />
									</div>
									<div class="min-w-0">
										<p>Assinatura da escala GISE</p>
										<p class="text-surface-600 dark:text-surface-400 text-[0.7rem] leading-snug mt-0.5">
											O supervisor fará a assinatura na tela ou com certificado digital (token) no computador.
										</p>
									</div>
								</div>
								<div class="flex flex-wrap items-center justify-end gap-2 sm:gap-3 shrink-0 w-full sm:w-auto">
									<a
										class="btn text-xs font-bold px-3 py-2 sm:px-4 sm:py-2 rounded-xl border-2 flex items-center justify-center gap-2 transition-all no-underline {assinaturaEscalaHabilitada
											? 'preset-tonal-primary border-primary-500/30 hover:border-primary-500'
											: 'pointer-events-none opacity-60 border-transparent'}"
										href="/api/gise/{gise.id}/download?format=pdf"
										target="_blank"
										title="Baixar PDF da escala para conferência (sem assinatura digital)"
									>
										<svg
											class="w-3.5 h-3.5 shrink-0"
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
										<span class="whitespace-nowrap">Escala GISE (conferência)</span>
									</a>
									{#if mostrarPainelAssinaturaEscala && (isMobile || !restringirSmartphone)}
										<button
											type="button"
											class="btn btn-xs preset-filled-warning-500 border-2 border-warning-600/30 hover:border-warning-600 text-[0.65rem] py-1 shadow-sm font-bold uppercase rounded-xl"
											disabled={loading.active || !assinaturaEscalaHabilitada}
											onclick={() => onAbrirAssinaturaEscalaManual()}
										>
											Ass. tela
										</button>
									{/if}
									{#if mostrarPainelAssinaturaEscala && !isMobile}
										<button
											type="button"
											class="btn btn-xs preset-filled-tertiary-500 border-2 border-tertiary-600/30 hover:border-tertiary-600 text-[0.65rem] py-1 shadow-sm font-bold uppercase rounded-xl"
											disabled={loading.active || !assinaturaEscalaHabilitada}
											onclick={() => painelTokenGise?.assinarComSerpro()}
										>
											Ass. token
										</button>
									{/if}
								</div>
							</div>
						</div>
						{#if mostrarPainelAssinaturaEscala}
							<!-- Montado fora da tela: expõe `assinarComSerpro` para o botão Ass. token. -->
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
									disabled={loading.active}
									onSuccess={onAssinaturaEscalaDigitalSuccess}
								/>
							</div>
						{/if}
					</section>
				{/if}

				{#if mostrarBlocoExtraSupervisao}
					<section
						class="{documentoAssinadoInfo?.existe ||
						mostrarPainelAssinaturaEscala ||
						mostrarPainelAssinaturaEscalaReadonly
							? 'mt-6 pt-4 border-t border-surface-200/60 dark:border-surface-700/60'
							: 'mt-5 pt-4 border-t border-surface-200/60 dark:border-surface-700/60'} space-y-2"
					>
						<p
							class="text-[0.65rem] font-bold uppercase tracking-wider text-surface-500 dark:text-surface-400"
						>
							Relatório de extra (Supervisão e apoio)
						</p>
						<div
							class="rounded-xl border border-surface-200/80 dark:border-surface-700/80 bg-white/70 dark:bg-surface-900/50 p-4"
						>
							{#if !extraSupervisaoConfigurado}
								<p
									class="text-xs text-warning-700 dark:text-warning-400 bg-warning-500/10 border border-warning-500/20 rounded-lg px-3 py-2"
								>
									O relatório de extra do quadro ainda não está disponível: falta a unidade sintética
									no banco (migração). Peça ao administrador para executar as migrações.
								</p>
							{:else}
								<div
									class="flex flex-wrap items-center justify-between gap-4"
								>
									<div
										class="flex items-center gap-2 text-xs text-surface-500 dark:text-surface-400 min-w-0 flex-1"
									>
										<div
											class="w-8 h-8 rounded-lg bg-surface-100 dark:bg-surface-700 flex items-center justify-center shrink-0"
										>
											<ShieldCheck size={16} />
										</div>
										<div class="min-w-0">
											{#if assRelSup}
												<p>Rel. extra assinado digitalmente por:</p>
												<p class="font-bold text-surface-900 dark:text-surface-100">
													{assRelSup.assinante_nome}
												</p>
											{:else}
												<p>Relatório de extra do quadro de supervisão (disponível após rúbricas)</p>
												<p class="text-surface-600 dark:text-surface-400 text-[0.7rem] leading-snug mt-0.5">
													{#if !rubSupOk}
														{#if faltSup?.startsWith(FALTANTE_RUBRICA_SUPER_PREFIX)}
															<span class="font-medium text-error-600 dark:text-error-400"
																>Faltando rubrica de:</span
															>
															{' '}{faltSup.slice(FALTANTE_RUBRICA_SUPER_PREFIX.length)}
														{:else}
															{faltSup ?? 'Aguardando rubricas do quadro de supervisão.'}
														{/if}
													{:else}
														Conferência disponível; aguardando assinatura do supervisor.
													{/if}
												</p>
											{/if}
										</div>
									</div>

									<div
										class="flex flex-wrap items-center justify-end gap-3 shrink-0 w-full sm:w-auto"
									>
										{#if assRelSup}
											<span
												class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-success-500 text-white font-bold text-[0.65rem] uppercase tracking-wider shadow-lg shadow-success-500/20 text-center leading-tight whitespace-nowrap"
											>
												<CheckCircle2 size={12} class="shrink-0" />
												Rel. extra assinado
											</span>
										{/if}
										{#if assRelSup}
											<a
												href="/api/gise/{gise.id}/download?format=extraordinario&seccionalId={supervisaoExtraUnidadeId}"
												target="_blank"
												title={`Assinado por ${assRelSup.assinante_nome}`}
												class="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold transition-all shadow-lg shadow-primary-500/20 active:scale-95 no-underline {!downloadExtraSupHabilitado
													? 'pointer-events-none opacity-60'
													: ''}"
											>
												<FileDown size={18} />
												Baixar PDF Assinado
											</a>
										{:else}
											<a
												class="btn text-xs font-bold px-3 py-2 sm:px-4 sm:py-2 rounded-xl border-2 flex items-center justify-center gap-2 transition-all no-underline preset-tonal-primary border-primary-500/30 {!downloadExtraSupHabilitado
													? 'pointer-events-none cursor-not-allowed opacity-60'
													: 'hover:border-primary-500'}"
												href="/api/gise/{gise.id}/download?format=extraordinario&seccionalId={supervisaoExtraUnidadeId}"
												target="_blank"
												title={!rubSupOk
													? faltSup || 'Aguardando rubricas do quadro de supervisão'
													: 'Baixar PDF para conferência (sem assinatura)'}
											>
												<svg
													class="w-3.5 h-3.5 shrink-0"
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
												<span class="whitespace-nowrap">Relat. Extra (conferência)</span>
												
											</a>
										{/if}
										{#if isSupervisor && !assRelSup && extraSupervisaoConfigurado}
											<div class="flex flex-wrap items-center justify-end gap-2">
												{#if isMobile || !restringirSmartphone}
													<button
														type="button"
														class="btn btn-xs preset-filled-warning-500 border-2 border-warning-600/30 hover:border-warning-600 text-[0.65rem] py-1 shadow-sm font-bold uppercase rounded-xl"
														disabled={!assinaturaExtraHabilitada}
														onclick={() => onAssinarExtraSupervisaoManual?.()}
													>
														Ass. tela
													</button>
												{/if}
												{#if !isMobile}
													<button
														type="button"
														class="btn btn-xs preset-filled-tertiary-500 border-2 border-tertiary-600/30 hover:border-tertiary-600 text-[0.65rem] py-1 shadow-sm font-bold uppercase rounded-xl"
														disabled={!assinaturaExtraHabilitada}
														onclick={() => onAssinarExtraSupervisaoDigital?.()}
													>
														Ass. token
													</button>
												{/if}
											</div>
										{/if}
									</div>
								</div>
							{/if}
						</div>
					</section>
				{/if}
			</div>
		{/if}
	</div>
</div>
