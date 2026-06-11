<script lang="ts">
	 
	import { goto, invalidate, invalidateAll, replaceState } from '$app/navigation';
	import type { PageData } from './$types';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { toaster } from '$lib/toast';
	import { enhance } from '$app/forms';
	import { useGiseEstado, useGiseAssinatura } from '$lib/composables/gise';
	import { loading } from '$lib/loading.svelte';
	import type { Policial, Unidade, GiseAssinaturaRelatorio } from '$lib/server/schema';
	import { checkAllSigned, filtrarSeccionaisDisponiveis } from '$lib/gise/gise-page-helpers';
	import {
		quadroSupervisaoExtraExigeRelatorio,
		supervisaoExtraRubricasCompletas
	} from '$lib/gise/gise-supervisao-extra';
	import { makeEnhanceHandler } from '$lib/enhance-handler';
	import GiseCabecalho from './_components/GiseCabecalho.svelte';
	import GiseSupervisao from './_components/GiseSupervisao.svelte';
	import GiseLoteAssinaturas from './_components/GiseLoteAssinaturas.svelte';
	import GiseStatusAvisos from './_components/GiseStatusAvisos.svelte';
	import GiseSeccional from './_components/GiseSeccional.svelte';
	import ModalExcluirGise from './_components/modais/ModalExcluirGise.svelte';
	import ModalReabrir from './_components/modais/ModalReabrir.svelte';
	import ModalFinalizar from './_components/modais/ModalFinalizar.svelte';
	import ModalDatasHoras from './_components/modais/ModalDatasHoras.svelte';
	import ModalRubrica from './_components/modais/ModalRubrica.svelte';
	import ModalRelatorioDigital from './_components/modais/ModalRelatorioDigital.svelte';
	import ModalBreveRelatorio from './_components/modais/ModalBreveRelatorio.svelte';
	import ModalDownloadExtras from '../_components/ModalDownloadExtras.svelte';

	const { data }: { data: PageData } = $props();

	// Hook de estados derivados e permissões
	const giseEstado = useGiseEstado({ getData: () => data });
	const isAdminGeral = $derived(giseEstado.isAdminGeral);
	const isSeccional = $derived(giseEstado.isSeccional);
	const isSupervisor = $derived(giseEstado.isSupervisor);
	const minhaSeccional = $derived(giseEstado.minhaSeccional);
	const minhaSeccionalId = $derived(giseEstado.minhaSeccionalId);
	const todasSeccionaisPreenchidas = $derived(giseEstado.todasSeccionaisPreenchidas);
	const editaBloqueado = $derived(giseEstado.editaBloqueado);
	const podeDownload = $derived(giseEstado.podeDownload);
	const podeEditar = $derived(giseEstado.podeEditar);
	const isMobile = $derived(giseEstado.isMobile);
	const { statusLabel, statusColor, fmtDate, diaSemana } = giseEstado;

	const gise = $derived(giseEstado.gise);
	const policiais = $derived(giseEstado.policiais);
	const todasUnidades = $derived(giseEstado.todasUnidades);

	// Relatórios extraordinários pendentes de assinatura (usado pelo hook de assinatura e pelo template)
	const pendentesExtra = $derived.by(() => {
		if (!isSupervisor) return [];
		const lista: Array<{ seccionalId: number; tipo: 'extraordinario' }> = [];
		const supId = data.supervisaoExtraUnidadeId;
		if (
			supId &&
			gise &&
			quadroSupervisaoExtraExigeRelatorio(gise) &&
			supervisaoExtraRubricasCompletas(gise, data.presencasGise ?? [])
		) {
			const relSup = data.assinaturasRelatorios?.find(
				(a: GiseAssinaturaRelatorio) => a.seccional_id === supId && a.tipo === 'extraordinario'
			);
			if (!relSup) {
				lista.push({ seccionalId: supId, tipo: 'extraordinario' });
			}
		}
		for (const sec of gise?.seccionais || []) {
			const relAssinado = data.assinaturasRelatorios?.find(
				(a: GiseAssinaturaRelatorio) =>
					(a.seccional_id === sec.seccional_id || a.seccional_id === sec.id) &&
					a.tipo === 'extraordinario'
			);
			if (!relAssinado && checkAllSigned(sec)) {
				lista.push({
					seccionalId: sec.seccional_id,
					tipo: 'extraordinario'
				});
			}
		}
		return lista;
	});

	const nomesSupervisaoPorId = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const m = new Map<number, string>();
		if (!gise) return m;
		if (gise.supervisor_id && gise.supervisor_nome) m.set(gise.supervisor_id, gise.supervisor_nome);
		if (gise.assessor_id && gise.assessor_nome) m.set(gise.assessor_id, gise.assessor_nome);
		if (gise.seint1_id && gise.seint1_nome) m.set(gise.seint1_id, gise.seint1_nome);
		if (gise.seint2_id && gise.seint2_nome) m.set(gise.seint2_id, gise.seint2_nome);
		return m;
	});

	// Hook de assinatura (captura de rubrica, assinatura simples/SERPRO, lote de relatórios)
	const assinatura = useGiseAssinatura({
		getGiseId: () => gise?.id ?? 0,
		getGiseDataInicio: () => gise?.data_inicio,
		getPendentesExtra: () => pendentesExtra,
		initialSignerName: untrack(() => data.usuarioAtual?.nome ?? ''),
		initialSignerCpf: untrack(() => data.usuarioAtual?.cpf ?? '')
	});

	// Estados locais (não extraídos)
	let showFinalizarConfirm = $state(false);
	let editandoSupervisores = $state(false);
	let supervisorId = $state<number | null>(null);
	let assessorId = $state<number | null>(null);
	/** E-mail do assessor para avisos quando seccionais enviam a GISE (formulário de supervisão). */
	let assessorEmailNotificacao = $state('');
	let prevAssessorParaEmail = $state<number | null>(null);
	let seint1Id = $state<number | null>(null);
	let seint2Id = $state<number | null>(null);
	let showDigitalModalRelatorio = $state(false);
	let relatorioDigitalInfo = $state<{
		seccionalId: number;
		tipo: 'extraordinario' | 'produtividade';
		seccionalNome: string;
	} | null>(null);

	// Reabrir escala
	let showReabrirConfirm = $state(false);

	let showDownloadExtrasModal = $state(false);

	const giseParaDownload = $derived.by(() => {
		if (!gise) return null;
		return {
			id: gise.id,
			status: gise.status,
			data_inicio: gise.data_inicio,
			supervisor_id: gise.supervisor_id,
			assessor_id: gise.assessor_id,
			seint1_id: gise.seint1_id,
			seint2_id: gise.seint2_id,
			assinaturasRelatorioExtraIds: (data.assinaturasRelatorios ?? [])
				.filter((a) => a.tipo === 'extraordinario')
				.map((a) => a.seccional_id),
			seccionais: (gise.seccionais ?? []).map((sec: { seccional_id: number; seccional_nome: string }) => ({
				id: sec.seccional_id,
				nome: sec.seccional_nome
			}))
		};
	});

	// Modo Edição Geral (Admin Geral)
	let modoEdicaoGeral = $state(false);
	$effect(() => {
		if (page.url.searchParams.get('edit') === 'true') {
			modoEdicaoGeral = true;
			// Remove the flag from URL to avoid re-activating on refresh
			const url = new URL(page.url);
			url.searchParams.delete('edit');
			replaceState(url, {});
		}
	});
	let showModalDataHoras = $state(false);
	let showModalBreveRelatorio = $state(false);
	let showExcluirGiseConfirm = $state(false);
	let supervisorExpandiuQuadroSeccionais = $state(false);
	const seccionaisRecolhidas = $state<Record<number, boolean>>({});
	const supervisorSomente = $derived(isSupervisor && !isAdminGeral && !isSeccional);
	const exibirQuadroSeccionais = $derived(!supervisorSomente || supervisorExpandiuQuadroSeccionais);

	function toggleRecolherSeccional(id: number) {
		seccionaisRecolhidas[id] = !seccionaisRecolhidas[id];
	}

	// Gerenciamento de seccionais (Admin Geral) — derivado dos dados já carregados
	const seccionaisDisponiveis = $derived(
		filtrarSeccionaisDisponiveis(gise, todasUnidades as Unidade[])
	);
	let adicionandoSeccional = $state(false);
	let seccionalParaAdicionarIdx = $state<number | ''>('');
	let pendingCrud = $state(false);
	/** Último envio com sucesso à planilha Base_Equipe (persistido em `gise.planilha_base_equipe_alimentada_em`). */
	const planilhaBaseEquipeAlimentadaOk = $derived(!!gise?.planilha_base_equipe_alimentada_em);

	$effect(() => {
		if (gise) {
			supervisorId = gise.supervisor_id ?? null;
			assessorId = gise.assessor_id ?? null;
			seint1Id = gise.seint1_id ?? null;
			seint2Id = gise.seint2_id ?? null;
		}
	});

	function emailSugeridoAssessor(id: number | null): string {
		if (id == null) return '';
		const p = policiais.find((x: Policial) => x.id === id);
		if (!p) return '';
		return (p.email_pessoal?.trim() || p.email?.trim() || '') ?? '';
	}

	/**
	 * Quem veio da busca (`/api/policiais/search`) não está na lista enxuta do load (sem e-mails).
	 * Admin geral: busca e-mails via endpoint dedicado.
	 */
	async function preencherEmailAssessorSugerido(id: number | null) {
		if (id == null) {
			assessorEmailNotificacao = '';
			return;
		}
		const local = emailSugeridoAssessor(id);
		if (local) {
			assessorEmailNotificacao = local;
			return;
		}
		/** Vem do load: consulta direta ao assessor da GISE (evita lista só com `ativo=1` e dispensa fetch). */
		const doLoad = id === gise?.assessor_id ? (data.assessorEmailSugerido?.trim() ?? '') : '';
		if (doLoad) {
			assessorEmailNotificacao = doLoad;
			return;
		}
		try {
			const res = await fetch(`/api/policiais/${id}/email-aviso`);
			if (!res.ok) return;
			const d = (await res.json()) as { email_pessoal?: string | null; email?: string | null };
			if (assessorId !== id) return;
			assessorEmailNotificacao = (d.email_pessoal?.trim() || d.email?.trim() || '') ?? '';
		} catch {
			/* ignora falha de rede */
		}
	}

	$effect(() => {
		if (!editandoSupervisores) {
			prevAssessorParaEmail = null;
			return;
		}
		const cur = assessorId;
		if (cur !== prevAssessorParaEmail) {
			void preencherEmailAssessorSugerido(cur);
		}
		prevAssessorParaEmail = cur;
	});

	/**
	 * `data.policiais` agora contém APENAS os supports já vinculados (≤ 4 registros)
	 * para servir de label-resolver dos selects abaixo. A busca de novos nomes vai
	 * para `/api/policiais/search` sob demanda. Antes: até 10 000 linhas no load.
	 */
	function selectedFromPoliciais(id: number | null) {
		if (id == null) return null;
		const p = (policiais as Policial[]).find((x) => x.id === id);
		return p ? { value: p.id, label: `${p.nome} (${p.matricula})` } : null;
	}

	/** Factory de `loadOptions` parametrizado por cargo. Usa AbortSignal para cancelar. */
	function buscarPorCargo(cargo: 'DPC' | 'OIP') {
		return async (query: string, signal: AbortSignal) => {
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			const params = new URLSearchParams({ cargo, limit: '50' });
			if (query) params.set('q', query);
			const res = await fetch(`/api/policiais/search?${params}`, { signal });
			if (!res.ok) {
				const err = await res.json().catch(() => ({ error: 'Erro na busca' }));
				throw new Error(err.error ?? 'Erro na busca');
			}
			const data = (await res.json()) as {
				policiais: { id: number; nome: string; matricula: string }[];
			};
			return data.policiais.map((p) => ({
				value: p.id,
				label: `${p.nome} (${p.matricula})`
			}));
		};
	}
	const buscarDpcs = buscarPorCargo('DPC');
	const buscarOips = buscarPorCargo('OIP');
	const setPending = (p: boolean) => (pendingCrud = p);

	const handleSalvarSupervisores = makeEnhanceHandler({
		setPending,
		successTitle: 'Supervisor salvo',
		errorTitle: 'Erro ao salvar',
		onSuccess: () => {
			editandoSupervisores = false;
		}
	});

	const handleSalvarBreveRelatorio = makeEnhanceHandler({
		setPending,
		successTitle: 'Textos do breve relatório salvos',
		errorTitle: 'Erro ao salvar',
		onSuccess: () => {
			showModalBreveRelatorio = false;
		}
	});

	const handleAdicionarSeccional = makeEnhanceHandler({
		setPending,
		beforeSubmit: () => seccionalParaAdicionarIdx !== '',
		successTitle: 'Seccional adicionada',
		errorTitle: 'Erro ao adicionar',
		onSuccess: () => {
			adicionandoSeccional = false;
			seccionalParaAdicionarIdx = '';
		}
	});

	// Documento assinado
	const documentoAssinadoInfo = $derived(
		gise?.documento
			? {
					existe: true,
					assinante_nome: gise.documento.assinante_nome,
					assinante_cpf: gise.documento.assinante_cpf ?? '',
					data: gise.documento.created_at,
					verificacao_hash: gise.documento.verificacao_hash
				}
			: null
	);

	const handleFinalizarGise = makeEnhanceHandler({
		setPending,
		invalidateKey: false,
		successTitle: 'Escala finalizada!',
		errorTitle: 'Erro ao finalizar',
		onSuccess: () => {
			showFinalizarConfirm = false;
			goto('/gise');
		}
	});

	const handleSolicitarAssinatura = makeEnhanceHandler({
		setPending,
		successTitle: 'Edição finalizada',
		successDescription: 'Escala enviada para assinatura do Supervisor.',
		errorTitle: 'Erro ao enviar'
	});

	const handleRevogarPedidoAssinatura = makeEnhanceHandler({
		setPending,
		successTitle: 'Solicitação revogada',
		successDescription: 'Escala retornada para edição.',
		errorTitle: 'Erro ao revogar'
	});

	const handleEnviarPlanilha = makeEnhanceHandler<{ linhas?: number }>({
		setPending,
		successTitle: 'Dados enviados para a planilha',
		successDescription: (d) =>
			typeof d?.linhas === 'number' ? `${d.linhas} linha(s) na Base_Equipe.` : undefined,
		errorTitle: 'Falha ao enviar para a planilha'
	});

	function abrirAssinaturaRelatorioDigital(
		seccionalId: number,
		tipo: 'extraordinario' | 'produtividade',
		seccionalNome: string
	) {
		relatorioDigitalInfo = { seccionalId, tipo, seccionalNome };
		showDigitalModalRelatorio = true;
	}

	const handleReabrirEscala = makeEnhanceHandler({
		setPending,
		successTitle: 'Escala reaberta',
		successDescription: 'A assinatura foi revogada. A escala pode ser editada novamente.',
		errorTitle: 'Erro ao reabrir',
		onSuccess: () => {
			showReabrirConfirm = false;
		}
	});

	const handleSalvarDatasHorarios = makeEnhanceHandler<{ assinatura_revogada?: boolean }>({
		setPending,
		errorTitle: 'Erro ao salvar',
		onSuccess: (d) => {
			if (d?.assinatura_revogada) {
				toaster.warning({
					title: 'Datas/horários atualizados',
					description: 'A assinatura digital foi revogada. Será necessário assinar novamente.'
				});
			} else {
				toaster.success({ title: 'Datas/horários atualizados' });
			}
			showModalDataHoras = false;
		}
	});

	const handleExcluirGise = makeEnhanceHandler({
		setPending,
		invalidateKey: false,
		successTitle: 'Escala GISE excluída',
		errorTitle: 'Erro ao excluir',
		onSuccess: () => {
			showExcluirGiseConfirm = false;
			goto('/gise');
		}
	});

	const podeFinalizar = $derived(
		isAdminGeral && (gise?.status === 'pronta_para_finalizar' || gise?.status === 'em_andamento')
	);
	const podeAssinar = $derived(
		isSupervisor &&
			gise?.status === 'aguardando_assinatura' &&
			gise?.supervisor_id === data.usuarioAtual?.id &&
			!documentoAssinadoInfo?.existe
	);
	const podeReabrir = $derived(
		isAdminGeral &&
			(gise?.status === 'em_andamento' ||
				gise?.status === 'aguardando_relatorios' ||
				gise?.status === 'aguardando_assinatura_relat' ||
				gise?.status === 'pronta_para_finalizar' ||
				gise?.status === 'finalizada')
	);
</script>

<svelte:head>
	{#if gise}
		<title
			>{diaSemana(gise.data_inicio)}, {fmtDate(gise.data_inicio)} — {statusLabel(
				gise.status
			)}</title
		>
	{:else}
		<title>Carregando GISE... — Portal de Escalas</title>
	{/if}
</svelte:head>

<div
	class="relative min-w-0 transition-all duration-500 {loading.active
		? 'pointer-events-none opacity-40 blur-[3px]'
		: 'opacity-100 blur-0'} space-y-6"
>
	{#if gise}
		<GiseCabecalho
			{gise}
			{statusLabel}
			{statusColor}
			{diaSemana}
			{fmtDate}
			{isAdminGeral}
			{isSeccional}
			{podeDownload}
			{podeEditar}
			{podeReabrir}
			{podeFinalizar}
			{editaBloqueado}
			{modoEdicaoGeral}
			{todasSeccionaisPreenchidas}
			documentoAssinadoExiste={documentoAssinadoInfo?.existe ?? false}
			{pendingCrud}
			{isMobile}
			onToggleEdit={() => (modoEdicaoGeral = !modoEdicaoGeral)}
			onAbrirDataHoras={() => (showModalDataHoras = true)}
			onAbrirExcluir={() => (showExcluirGiseConfirm = true)}
			onAbrirReabrir={() => (showReabrirConfirm = true)}
			onAbrirFinalizar={() => (showFinalizarConfirm = true)}
			onSolicitarAssinatura={handleSolicitarAssinatura}
			onRevogarPedido={handleRevogarPedidoAssinatura}
			onEnviarPlanilha={isAdminGeral ? handleEnviarPlanilha : undefined}
			{planilhaBaseEquipeAlimentadaOk}
			onAbrirBreveRelatorio={isAdminGeral ? () => (showModalBreveRelatorio = true) : undefined}
		/>
	{/if}

	{#if !gise}
		<p class="text-surface-500">Escala não encontrada.</p>
	{:else}
		{#if !isSeccional || isSupervisor}
			<GiseSupervisao
				{gise}
				{policiais}
				{isAdminGeral}
				{isSeccional}
				{podeEditar}
				{modoEdicaoGeral}
				editando={editandoSupervisores}
				{documentoAssinadoInfo}
				{pendingCrud}
				{buscarDpcs}
				{buscarOips}
				{selectedFromPoliciais}
				presencasGise={data.presencasGise}
				seintSupervisaoComRelatorio={data.seintSupervisaoComRelatorio ?? []}
				bind:supervisorId
				bind:assessorId
				bind:assessorEmailNotificacao
				bind:seint1Id
				bind:seint2Id
				onEditar={() => {
					editandoSupervisores = true;
					prevAssessorParaEmail = assessorId;
					if (assessorId != null) {
						const salvo = gise?.assessor_email_notificacao?.trim();
						if (salvo) assessorEmailNotificacao = salvo;
						else void preencherEmailAssessorSugerido(assessorId);
					} else {
						assessorEmailNotificacao = '';
					}
				}}
				onCancelar={() => {
					editandoSupervisores = false;
					prevAssessorParaEmail = null;
				}}
				onSubmit={handleSalvarSupervisores}
				supervisaoExtraUnidadeId={data.supervisaoExtraUnidadeId}
				assinaturasRelatorios={data.assinaturasRelatorios}
				{podeDownload}
				{isSupervisor}
				{isMobile}
				restringirSmartphone={data.restringirSmartphone}
				onAssinarExtraSupervisaoManual={() => {
					const id = data.supervisaoExtraUnidadeId;
					if (id) assinatura.abrirAssinaturaRelatorio(id, 'extraordinario');
				}}
				onAssinarExtraSupervisaoDigital={() => {
					const id = data.supervisaoExtraUnidadeId;
					if (id) abrirAssinaturaRelatorioDigital(id, 'extraordinario', 'Supervisão GISE');
				}}
				mostrarPainelAssinaturaEscala={podeAssinar}
				assinaturaEscalaSignerEmail={data.usuarioAtual?.email ?? undefined}
				bind:rubricaCapturada={assinatura.rubricaCapturada}
				bind:painelTokenGise={assinatura.painelTokenGise}
				bind:serproSignerName={assinatura.serproSignerName}
				bind:serproSignerCpf={assinatura.serproSignerCpf}
				onAbrirAssinaturaEscalaManual={() => assinatura.abrirModalRubrica('simples')}
				onAssinaturaEscalaDigitalSuccess={async () => {
					assinatura.rubricaCapturada = null;
					await invalidate('gise:detail');
				}}
			>
				{#snippet loteSection()}
					{#if isSupervisor || isAdminGeral}
						<GiseLoteAssinaturas
							quantidadePendentes={pendentesExtra.length}
							assinandoLote={assinatura.assinandoLote}
							etapaAssinatura={assinatura.etapaAssinatura}
							progressoLote={assinatura.progressoLote}
							{isMobile}
							restringirSmartphone={data.restringirSmartphone}
							onAssinarManualLote={assinatura.abrirAssinaturaLote}
							onAssinarDigitalLote={assinatura.executarAssinarRelatorioLoteSERPRO}
							assinaturasRelatorios={data.assinaturasRelatorios}
							seccionais={gise.seccionais}
							supervisaoExtraUnidadeId={data.supervisaoExtraUnidadeId}
							podeAssinar={isSupervisor}
							giseStatus={gise.status}
							onConferencia={() => (showDownloadExtrasModal = true)}
						/>
					{/if}
				{/snippet}
			</GiseSupervisao>
		{/if}

		<div class="flex items-center gap-3 my-6">
			<hr class="flex-1 border-surface-200 dark:border-white/10" />
			<span
				class="text-xs font-semibold text-surface-400 dark:text-surface-500 uppercase tracking-wider"
				>Seccionais Participantes</span
			>
			<hr class="flex-1 border-surface-200 dark:border-white/10" />
		</div>

		<!-- Seccionais -->
		<div>
			{#if !isSeccional}
				<div
					class="mb-3 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50/60 dark:bg-surface-800/40 p-3"
				>
					<div class="flex items-center justify-between gap-2">
						<h2 class="font-semibold text-surface-900 dark:text-surface-50">
							Seccionais ({gise.seccionais?.length ?? 0})
						</h2>
						{#if supervisorSomente}
							<button
								type="button"
								class="btn btn-sm preset-filled-primary-500 text-xs px-3 py-1.5 rounded-lg font-bold shadow-sm active:scale-95 transition-all"
								onclick={() =>
									(supervisorExpandiuQuadroSeccionais = !supervisorExpandiuQuadroSeccionais)}
							>
								{exibirQuadroSeccionais ? 'Ocultar participantes' : 'Exibir participantes'}
							</button>
						{/if}
					</div>
				</div>
			{/if}

			{#if exibirQuadroSeccionais}
				{#each gise.seccionais ?? [] as sec (sec.id)}
					{#if isAdminGeral || isSupervisor || sec.seccional_id === minhaSeccionalId}
						<GiseSeccional
							{sec}
							{gise}
							todasUnidades={todasUnidades as Unidade[]}
							{isAdminGeral}
							{isSeccional}
							{isSupervisor}
							{podeEditar}
							{podeDownload}
							{isMobile}
							{minhaSeccionalId}
							{modoEdicaoGeral}
							assinaturasRelatorios={data.assinaturasRelatorios}
							restringirSmartphone={data.restringirSmartphone}
							recolhida={seccionaisRecolhidas[sec.id] ??
								(sec.status === 'preenchida' || sec.status === 'preenchida_retificada')}
							onToggleRecolher={() => toggleRecolherSeccional(sec.id)}
							onAssinarRelatorioManual={(seccionalId) =>
								assinatura.abrirAssinaturaRelatorio(seccionalId, 'extraordinario')}
							onAssinarRelatorioDigital={(seccionalId, tipo, nome) =>
								abrirAssinaturaRelatorioDigital(seccionalId, tipo, nome)}
							onFinalizarSuccess={() => {
								seccionaisRecolhidas[sec.id] = true;
							}}
						/>
					{/if}
				{/each}
			{/if}

			{#if isAdminGeral && podeEditar && modoEdicaoGeral}
				{#if adicionandoSeccional}
					<div
						class="mt-4 p-4 sm:p-5 rounded-2xl border border-dashed border-primary-500/50 bg-primary-500/5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
					>
						<div class="w-full sm:flex-1 sm:min-w-[200px]">
							<label
								for="novaSeccional"
								class="text-sm font-medium text-surface-600 dark:text-surface-400 block mb-1"
								>Adicionar Seccional</label
							>
							<select
								id="novaSeccional"
								bind:value={seccionalParaAdicionarIdx}
								class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
							>
								<option value="">Selecione a seccional...</option>
								{#each seccionaisDisponiveis as s (s.id)}
									<option value={s.id}>{s.nome}</option>
								{/each}
							</select>
						</div>
						<form
							method="POST"
							action="?/adicionarSeccional"
							use:enhance={handleAdicionarSeccional}
							class="flex w-full gap-2 sm:w-auto"
						>
							<input type="hidden" name="seccionalId" value={seccionalParaAdicionarIdx} />
							<button
								type="submit"
								class="btn preset-filled-primary-500 text-sm px-4 py-2 rounded-xl flex-1 sm:flex-none active:scale-95 transition-all"
								disabled={!seccionalParaAdicionarIdx || pendingCrud}
							>
								{pendingCrud ? 'Adicionando...' : 'Confirmar'}
							</button>
							<button
								type="button"
								class="btn preset-outlined-surface-500 text-sm px-4 py-2 rounded-xl flex-1 sm:flex-none"
								onclick={() => (adicionandoSeccional = false)}
							>
								Cancelar
							</button>
						</form>
					</div>
				{:else}
					<button
						type="button"
						class="btn preset-outlined-success-500 text-sm px-4 py-2 rounded-xl border-dashed mt-4 flex items-center gap-2"
						onclick={() => (adicionandoSeccional = true)}
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 4v16m8-8H4"
							/></svg
						>
						Adicionar Seccional
					</button>
				{/if}
			{/if}
		</div>

		<!-- Avisos contextuais de status (retificação seccional, aguardando conclusão) -->
		<GiseStatusAvisos
			{isSeccional}
			{isSupervisor}
			minhaSeccionalRetificada={minhaSeccional?.status === 'retificada'}
			giseEmPreenchimento={gise.status === 'em_preenchimento'}
		/>
	{/if}
</div>

{#if gise}
	<ModalDatasHoras
		open={showModalDataHoras}
		{pendingCrud}
		{editaBloqueado}
		{gise}
		onClose={() => (showModalDataHoras = false)}
		onSubmit={handleSalvarDatasHorarios}
	/>
{/if}

{#if gise}
	<ModalBreveRelatorio
		open={showModalBreveRelatorio}
		{gise}
		global={data.breveRelatorioEnv}
		{pendingCrud}
		onClose={() => (showModalBreveRelatorio = false)}
		onSubmit={handleSalvarBreveRelatorio}
	/>
{/if}

<ModalExcluirGise
	open={showExcluirGiseConfirm}
	{pendingCrud}
	onClose={() => (showExcluirGiseConfirm = false)}
	onSubmit={handleExcluirGise}
/>

<ModalReabrir
	open={showReabrirConfirm}
	{pendingCrud}
	onClose={() => (showReabrirConfirm = false)}
	onSubmit={handleReabrirEscala}
/>

<ModalFinalizar
	open={showFinalizarConfirm}
	{pendingCrud}
	onClose={() => (showFinalizarConfirm = false)}
	onSubmit={handleFinalizarGise}
/>

{#if showDigitalModalRelatorio && relatorioDigitalInfo && gise}
	<ModalRelatorioDigital
		open={showDigitalModalRelatorio}
		giseId={gise.id}
		seccionalId={relatorioDigitalInfo.seccionalId}
		seccionalNome={relatorioDigitalInfo.seccionalNome}
		signerEmail={data.usuarioAtual?.email ?? undefined}
		disabled={false}
		bind:control={assinatura.painelTokenRelatorio}
		bind:signerName={assinatura.relatorioSignerName}
		bind:signerCpf={assinatura.relatorioSignerCpf}
		onSuccess={async () => {
			showDigitalModalRelatorio = false;
			relatorioDigitalInfo = null;
			await invalidate('gise:detail');
		}}
		onClose={() => {
			showDigitalModalRelatorio = false;
			relatorioDigitalInfo = null;
		}}
	/>
{/if}

<ModalRubrica
	open={assinatura.showRubricaModal}
	exigirFoto={page.data.exigirFotoAssinatura ?? true}
	exigirGps={page.data.exigirGpsAssinatura ?? true}
	exigirCodigoEmail={page.data.exigirCodigoEmailAssinatura ?? false}
	onConfirm={assinatura.confirmarRubrica}
	onCancel={assinatura.fecharModalRubrica}
/>

<ModalDownloadExtras
	bind:open={showDownloadExtrasModal}
	gise={giseParaDownload}
	supervisaoExtraUnidadeId={data.supervisaoExtraUnidadeId}
/>
