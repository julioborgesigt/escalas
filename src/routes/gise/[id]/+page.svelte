<script lang="ts">
	import { goto, invalidate, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { toaster } from '$lib/toast';
	import { enhance } from '$app/forms';
	import type { ActionResult } from '@sveltejs/kit';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import { AlertCircle } from 'lucide-svelte';
	import { conectarSerpro, type SerproSignerClient } from '$lib/serpro';
	import { csrfHeaders } from '$lib/csrf';
	import { useGiseEstado, useGiseAssinatura } from '$lib/composables/gise';
	import { loading } from '$lib/loading.svelte';
	import type { Policial, Unidade, GiseAssinaturaRelatorio } from '$lib/server/schema';
	import type { GiseUnidadeSlot, GiseEquipeComMembros } from '$lib/db/gise';

	function messageFromUnknown(e: unknown): string {
		return e instanceof Error ? e.message : String(e);
	}
	import {
		checkAllSigned,
		filtrarDelegacias,
		filtrarSeccionaisDisponiveis,
		getFaltandoRubrica,
		getSeccionalColorClass
	} from '$lib/gise/gise-page-helpers';
	import {
		quadroSupervisaoExtraExigeRelatorio,
		supervisaoExtraRubricasCompletas
	} from '$lib/gise/gise-supervisao-extra';
	import GiseCabecalho from './_components/GiseCabecalho.svelte';
	import GiseSupervisao from './_components/GiseSupervisao.svelte';
	import GiseBannersAssinaturas from './_components/GiseBannersAssinaturas.svelte';
	import GiseLoteAssinaturas from './_components/GiseLoteAssinaturas.svelte';
	import GiseStatusAvisos from './_components/GiseStatusAvisos.svelte';
	import ModalExcluirGise from './_components/modais/ModalExcluirGise.svelte';
	import ModalReabrir from './_components/modais/ModalReabrir.svelte';
	import ModalFinalizar from './_components/modais/ModalFinalizar.svelte';
	import ModalDatasHoras from './_components/modais/ModalDatasHoras.svelte';
	import ModalRubrica from './_components/modais/ModalRubrica.svelte';
	import ModalRelatorioDigital from './_components/modais/ModalRelatorioDigital.svelte';
	import ModalRemoverSeccional from './_components/modais/ModalRemoverSeccional.svelte';

	let { data } = $props();

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

	// Hook de assinatura
	const assinatura = useGiseAssinatura({ getGiseId: () => gise?.id ?? 0 });

	// Estados locais (não extraídos)
	let showFinalizarConfirm = $state(false);
	let dialogRemoverSeccionalAberto = $state(false);
	let formRemoverSeccionalPendente = $state<HTMLFormElement | null>(null);
	let editandoSupervisores = $state(false);
	let supervisorId = $state<number | null>(null);
	let assessorId = $state<number | null>(null);
	let seint1Id = $state<number | null>(null);
	let seint2Id = $state<number | null>(null);
	let equipeParaAdicionar = $state<number | null>(null);
	let policialParaAdicionar = $state<number | ''>('');
	let cargoParaAdicionar = $state<'OIP' | 'DPC' | null>(null);
	let modoEdicaoSeccional = $state(false);
	let showDigitalModalRelatorio = $state(false);
	let relatorioDigitalInfo = $state<{
		seccionalId: number;
		tipo: 'extraordinario' | 'produtividade';
		seccionalNome: string;
	} | null>(null);

	// Edição de slots de equipe
	let editandoEquipe = $state<number | null>(null);
	let editSlotsDpc = $state(0);
	let editSlotsOip = $state(0);

	// Reabrir escala
	let showReabrirConfirm = $state(false);

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
	let editDataInicio = $state('');
	let editHoraEntrada = $state('');
	let editHoraSaida = $state('');
	let showExcluirGiseConfirm = $state(false);
	let removendoEquipeId = $state<number | null>(null);
	let supervisorExpandiuQuadroSeccionais = $state(false);
	const supervisorSomente = $derived(isSupervisor && !isAdminGeral && !isSeccional);
	const exibirQuadroSeccionais = $derived(!supervisorSomente || supervisorExpandiuQuadroSeccionais);

	// Adicionar equipe
	let adicionandoEquipeSec = $state<number | null>(null);
	let novaEquipeTipo = $state<'operacional' | 'seint'>('operacional');
	let novaEquipeDpc = $state(1);
	let novaEquipeOip = $state(3);

	// Slot de unidade: Admin Seccional seleciona a unidade para um slot em branco
	let selecionandoUnidadeSlotId = $state<number | null>(null);
	let slotUnidadeId = $state<number | ''>('');

	// Admin Geral: adicionar slot de unidade a uma seccional
	let adicionandoSlotSecId = $state<number | null>(null);
	let novoSlotUnidadeId = $state<number | ''>('');

	// Admin Geral: adicionar equipe — qual slot está recebendo a equipe
	let adicionandoEquipeSlotId = $state<number | null>(null);

	// Gerenciamento de seccionais (Admin Geral) — derivado dos dados já carregados
	const seccionaisDisponiveis = $derived(
		filtrarSeccionaisDisponiveis(gise, todasUnidades as Unidade[])
	);
	let adicionandoSeccional = $state(false);
	let seccionalParaAdicionarIdx = $state<number | ''>('');
	let pendingCrud = $state(false);

	// Horários customizados por equipe
	let editandoHorariosEquipeId = $state<number | null>(null);
	let editEqHoraEnt = $state('');
	let editEqHoraSai = $state('');

	$effect(() => {
		if (gise) {
			supervisorId = gise.supervisor_id ?? null;
			assessorId = gise.assessor_id ?? null;
			seint1Id = gise.seint1_id ?? null;
			seint2Id = gise.seint2_id ?? null;
		}
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
			const params = new URLSearchParams({ cargo, limit: '50' });
			if (query) params.set('q', query);
			const res = await fetch(`/api/policiais/search?${params}`, { signal });
			if (!res.ok) {
				const err = await res.json().catch(() => ({ error: 'Erro na busca' }));
				throw new Error(err.error ?? 'Erro na busca');
			}
			const data = (await res.json()) as { policiais: { id: number; nome: string; matricula: string }[] };
			return data.policiais.map((p) => ({
				value: p.id,
				label: `${p.nome} (${p.matricula})`
			}));
		};
	}
	const buscarDpcs = buscarPorCargo('DPC');
	const buscarOips = buscarPorCargo('OIP');
	/** Estabiliza a referência conforme `cargoParaAdicionar` muda — evita re-runs do effect interno do SearchableSelect a cada render do pai. */
	const buscarMembroAdicional = $derived(
		cargoParaAdicionar ? buscarPorCargo(cargoParaAdicionar) : undefined
	);

	function handleSalvarSupervisores() {
		pendingCrud = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingCrud = false;
			if (result.type === 'success') {
				await invalidate('gise:detail');
				toaster.success({ title: 'Supervisor salvo' });
				editandoSupervisores = false;
			} else {
				const d =
					'data' in result ? (result.data as Record<string, unknown> | undefined) : undefined;
				toaster.error({ title: (d?.error as string) || 'Erro ao salvar' });
			}
		};
	}

	function handleSelecionarUnidade() {
		pendingCrud = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingCrud = false;
			if (result.type === 'success') {
				await invalidate('gise:detail');
				toaster.success({ title: 'Unidade selecionada' });
				selecionandoUnidadeSlotId = null;
				slotUnidadeId = '';
			} else {
				const d =
					'data' in result ? (result.data as Record<string, unknown> | undefined) : undefined;
				toaster.error({ title: (d?.error as string) || 'Erro ao selecionar' });
			}
		};
	}

	function handleAdicionarSeccional({ cancel }: { cancel(): void }) {
		if (seccionalParaAdicionarIdx === '') {
			cancel();
			return;
		}
		pendingCrud = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingCrud = false;
			if (result.type === 'success') {
				await invalidate('gise:detail');
				toaster.success({ title: 'Seccional adicionada' });
				adicionandoSeccional = false;
				seccionalParaAdicionarIdx = '';
			} else {
				const d =
					'data' in result ? (result.data as Record<string, unknown> | undefined) : undefined;
				toaster.error({ title: (d?.error as string) || 'Erro ao adicionar' });
			}
		};
	}

	function handleRemoverSeccional({
		cancel,
		formElement
	}: {
		cancel(): void;
		formElement: HTMLFormElement;
	}) {
		// Sempre cancela o submit padrão para mostrar o diálogo de confirmação
		cancel();
		formRemoverSeccionalPendente = formElement;
		dialogRemoverSeccionalAberto = true;
	}

	async function confirmarRemoverSeccional() {
		dialogRemoverSeccionalAberto = false;
		if (!formRemoverSeccionalPendente) return;
		pendingCrud = true;
		const formData = new FormData(formRemoverSeccionalPendente);
		try {
			const res = await fetch(formRemoverSeccionalPendente.action, {
				method: 'POST',
				body: formData,
				headers: csrfHeaders()
			});
			if (res.ok) {
				await invalidate('gise:detail');
				toaster.success({ title: 'Seccional removida' });
			} else {
				const data = (await res.json().catch(() => ({}))) as { error?: string };
				toaster.error({ title: String(data?.error || 'Erro ao remover') });
			}
		} catch {
			toaster.error({ title: 'Erro ao remover seccional' });
		} finally {
			pendingCrud = false;
			formRemoverSeccionalPendente = null;
		}
	}

	function handleAdicionarMembro() {
		pendingCrud = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingCrud = false;
			if (result.type === 'success') {
				await invalidate('gise:detail');
				toaster.success({ title: 'Membro adicionado' });
				equipeParaAdicionar = null;
				policialParaAdicionar = '';
				cargoParaAdicionar = null;
			} else {
				const d =
					'data' in result ? (result.data as Record<string, unknown> | undefined) : undefined;
				toaster.error({ title: (d?.error as string) || 'Erro ao adicionar membro' });
			}
		};
	}

	function handleRemoverMembro() {
		pendingCrud = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingCrud = false;
			if (result.type === 'success') {
				removendoMembroId = null;
				await invalidate('gise:detail');
				toaster.success({ title: 'Membro removido' });
			} else {
				const d =
					'data' in result ? (result.data as Record<string, unknown> | undefined) : undefined;
				toaster.error({ title: (d?.error as string) || 'Erro ao remover membro' });
			}
		};
	}

	function handleRemoverEquipe() {
		pendingCrud = true;
		return async ({ result }: { result: ActionResult }) => {
			if (result.type === 'success') {
				await invalidate('gise:detail');
				toaster.success({ title: 'Equipe removida' });
			} else {
				const d =
					'data' in result ? (result.data as Record<string, unknown> | undefined) : undefined;
				toaster.error({ title: (d?.error as string) || 'Erro ao remover' });
			}
			removendoEquipeId = null;
			pendingCrud = false;
		};
	}

	let removendoMembroId = $state<number | null>(null);

	function handleFinalizarSeccional() {
		pendingCrud = true;
		return async ({ result }: { result: ActionResult }) => {
			if (result.type === 'success') {
				await invalidate('gise:detail');
				const d = result.data as Record<string, unknown>;
				if (d?.gise_status === 'aguardando_assinatura') {
					toaster.success({
						title: 'Todas as seccionais finalizadas!',
						description: 'Escala aguardando assinatura do Supervisor.'
					});
				} else {
					toaster.success({
						title: 'Seccional finalizada',
						description: 'Aguardando demais seccionais.'
					});
				}
				modoEdicaoSeccional = false;
			} else {
				const d =
					'data' in result ? (result.data as Record<string, unknown> | undefined) : undefined;
				toaster.error({ title: (d?.error as string) || 'Erro ao finalizar' });
			}
			pendingCrud = false;
		};
	}

	function handleAdicionarUnidade() {
		pendingCrud = true;
		return async ({ result }: { result: ActionResult }) => {
			if (result.type === 'success') {
				novoSlotUnidadeId = '';
				adicionandoSlotSecId = null;
				await invalidate('gise:detail');
				toaster.success({ title: 'Unidade adicionada' });
			} else {
				const d =
					'data' in result ? (result.data as Record<string, unknown> | undefined) : undefined;
				toaster.error({ title: (d?.error as string) || 'Erro ao adicionar unidade' });
			}
			pendingCrud = false;
		};
	}

	function handleRemoverUnidade() {
		pendingCrud = true;
		return async ({ result }: { result: ActionResult }) => {
			if (result.type === 'success') {
				await invalidate('gise:detail');
			} else {
				const d =
					'data' in result ? (result.data as Record<string, unknown> | undefined) : undefined;
				toaster.error({ title: (d?.error as string) || 'Erro ao remover DP' });
			}
			pendingCrud = false;
		};
	}

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
	// SERPRO — usado pelo bloco de assinatura em LOTE de relatórios
	let etapaAssinatura = $state('');

	// Componente PainelAssinaturaToken (GISE principal)
	let painelTokenGise = $state<{ assinarComSerpro: () => Promise<void> } | null>(null);
	let serproSignerName = $state(untrack(() => data.usuarioAtual?.nome ?? ''));
	let serproSignerCpf = $state(untrack(() => data.usuarioAtual?.cpf ?? ''));

	let serproClient = $state<SerproSignerClient | null>(null);

	// Componente PainelAssinaturaToken (relatório extraordinário por seccional)
	let painelTokenRelatorio = $state<{ assinarComSerpro: () => Promise<void> } | null>(null);
	let relatorioSignerName = $state(untrack(() => data.usuarioAtual?.nome ?? ''));
	let relatorioSignerCpf = $state(untrack(() => data.usuarioAtual?.cpf ?? ''));

	// Rubrica modal
	let showRubricaModal = $state(false);
	let tipoAssinaturaPendente = $state<'simples' | 'serpro' | null>(null);
	let rubricaCapturada = $state<string | null>(null);
	let selfieCapturada = $state<string | null>(null);

	function abrirModalRubrica(tipo: 'simples' | 'serpro') {
		tipoAssinaturaPendente = tipo;
		showRubricaModal = true;
	}

	async function confirmarRubrica(
		dataUrl: string,
		lat?: number,
		lng?: number,
		selfie?: string | null,
		codigoValidação?: string,
		desafioId?: string
	) {
		rubricaCapturada = dataUrl;
		selfieCapturada = selfie ?? null;
		showRubricaModal = false;

		if (relatorioSendoAssinado) {
			await executarAssinarRelatorio(dataUrl, lat, lng, selfie, codigoValidação, desafioId);
			relatorioSendoAssinado = null;
		} else if (tipoAssinaturaPendente === 'simples') {
			await executarAssinarSimples(lat, lng, codigoValidação, desafioId);
		} else if (tipoAssinaturaPendente === 'serpro') {
			await executarAssinarComSerpro(lat, lng);
		}
	}

	async function executarAssinarSimples(
		latitude?: number,
		longitude?: number,
		codigoValidação?: string,
		desafioId?: string
	) {
		loading.show('Assinando e gerando PDF...');
		try {
			const r = await fetch(`/api/gise/${gise.id}/assinar-simples`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...csrfHeaders()
				},
				body: JSON.stringify({
					rubrica: rubricaCapturada,
					latitude,
					longitude,
					selfieBase64: selfieCapturada,
					codigoValidação,
					desafioId
				})
			});
			if (r.ok) {
				const blob = await r.blob();
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = `gise_${gise.data_inicio}_confirmada.pdf`;
				a.click();
				toaster.success({ title: 'Escala confirmada com sucesso' });
				await invalidate('gise:detail');
			} else {
				const j = await r.json();
				toaster.error({ title: j.error || 'Erro ao assinar' });
			}
		} catch (err) {
			toaster.error({ title: 'Erro de conexão' });
		} finally {
			loading.hide();
			rubricaCapturada = null;
		}
	}

	async function executarAssinarComSerpro(_lat?: number, _lng?: number) {
		await painelTokenGise?.assinarComSerpro();
	}

	/** Carrega cliente SERPRO para o bloco de assinatura em LOTE */
	async function prepararSerproLote() {
		try {
			if (!serproClient) {
				serproClient = await conectarSerpro();
			}
		} catch (err) {
			toaster.error({
				title: err instanceof Error ? err.message : 'Erro ao conectar ao SERPRO'
			});
		}
	}

	function handleFinalizarGise() {
		pendingCrud = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingCrud = false;
			if (result.type === 'success') {
				toaster.success({ title: 'Escala finalizada!' });
				showFinalizarConfirm = false;
				goto('/gise');
			} else {
				const d =
					'data' in result ? (result.data as Record<string, unknown> | undefined) : undefined;
				toaster.error({ title: (d?.error as string) || 'Erro ao finalizar' });
			}
		};
	}

	function handleSalvarSlotsEquipe() {
		pendingCrud = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingCrud = false;
			if (result.type === 'success') {
				toaster.success({ title: 'Vagas atualizadas' });
				editandoEquipe = null;
				await invalidate('gise:detail');
			} else {
				const d =
					'data' in result ? (result.data as Record<string, unknown> | undefined) : undefined;
				toaster.error({ title: (d?.error as string) || 'Erro ao atualizar' });
			}
		};
	}

	function handleSolicitarAssinatura() {
		pendingCrud = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingCrud = false;
			if (result.type === 'success') {
				toaster.success({
					title: 'Edição finalizada',
					description: 'Escala enviada para assinatura do Supervisor.'
				});
				await invalidate('gise:detail');
			} else {
				const d =
					'data' in result ? (result.data as Record<string, unknown> | undefined) : undefined;
				toaster.error({ title: (d?.error as string) || 'Erro ao enviar' });
			}
		};
	}

	function handleRevogarPedidoAssinatura() {
		pendingCrud = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingCrud = false;
			if (result.type === 'success') {
				toaster.success({
					title: 'Solicitação revogada',
					description: 'Escala retornada para edição.'
				});
				await invalidate('gise:detail');
			} else {
				const d =
					'data' in result ? (result.data as Record<string, unknown> | undefined) : undefined;
				toaster.error({ title: (d?.error as string) || 'Erro ao revogar' });
			}
		};
	}

	function handleEnviarPlanilha() {
		pendingCrud = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingCrud = false;
			if (result.type === 'success') {
				const d =
					'data' in result ? (result.data as Record<string, unknown> | undefined) : undefined;
				const n = typeof d?.linhas === 'number' ? d.linhas : undefined;
				toaster.success({
					title: 'Dados enviados para a planilha',
					description: n != null ? `${n} linha(s) na Base_Equipe.` : undefined
				});
			} else {
				const d =
					'data' in result ? (result.data as Record<string, unknown> | undefined) : undefined;
				toaster.error({ title: (d?.error as string) || 'Falha ao enviar para a planilha' });
			}
		};
	}

	// Relatórios extraordinários pendentes de assinatura
	const nomesSupervisaoPorId = $derived.by(() => {
		const m = new Map<number, string>();
		if (!gise) return m;
		if (gise.supervisor_id && gise.supervisor_nome) m.set(gise.supervisor_id, gise.supervisor_nome);
		if (gise.assessor_id && gise.assessor_nome) m.set(gise.assessor_id, gise.assessor_nome);
		if (gise.seint1_id && gise.seint1_nome) m.set(gise.seint1_id, gise.seint1_nome);
		if (gise.seint2_id && gise.seint2_nome) m.set(gise.seint2_id, gise.seint2_nome);
		return m;
	});

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

	let assinandoLote = $state(false);
	let progressoLote = $state({ atual: 0, total: 0 });

	let relatorioSendoAssinado = $state<{
		lote?: Array<{ seccionalId: number; tipo: 'extraordinario' }>;
		seccionalId?: number;
		tipo?: 'extraordinario' | 'produtividade';
	} | null>(null);

	function abrirAssinaturaLote() {
		relatorioSendoAssinado = { lote: pendentesExtra };
		abrirModalRubrica('simples');
	}

	function abrirAssinaturaRelatorio(seccionalId: number, tipo: 'extraordinario' | 'produtividade') {
		relatorioSendoAssinado = { seccionalId, tipo };
		abrirModalRubrica('simples');
	}

	function abrirAssinaturaRelatorioDigital(
		seccionalId: number,
		tipo: 'extraordinario' | 'produtividade',
		seccionalNome: string
	) {
		relatorioDigitalInfo = { seccionalId, tipo, seccionalNome };
		showDigitalModalRelatorio = true;
	}

	async function executarAssinarRelatorioLoteSERPRO() {
		if (pendentesExtra.length === 0) return;
		assinandoLote = true;
		progressoLote = { atual: 0, total: pendentesExtra.length };
		etapaAssinatura = 'Iniciando assinatura em lote...';

		try {
			const signerName = serproSignerName;
			const signerCpf = serproSignerCpf;

			let clientSerpro = serproClient ?? (await conectarSerpro());
			serproClient = clientSerpro;

			for (let i = 0; i < pendentesExtra.length; i++) {
				const item = pendentesExtra[i];
				progressoLote.atual = i + 1;
				etapaAssinatura = `Preparando PDF ${i + 1} de ${pendentesExtra.length}...`;

				const prepResp = await fetch(
					`/api/gise/${gise.id}/relatorios/${item.seccionalId}/preparar-assinatura`,
					{
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							...csrfHeaders()
						},
						body: JSON.stringify({
							signerName,
							signerCpf,
							rubrica: null
						})
					}
				);
				if (!prepResp.ok)
					throw new Error(`Falha no item ${item.seccionalId}: ` + (await prepResp.json()).error);
				const prepData = await prepResp.json();

				etapaAssinatura = `Assinando Relatório ${i + 1} de ${pendentesExtra.length}...`;

				const messageDigestBase64 = btoa(
					prepData.messageDigest
						.match(/.{2}/g)!
						.map((h: string) => String.fromCharCode(parseInt(h, 16)))
						.join('')
				);
				const serproRes = await clientSerpro.sign(messageDigestBase64);
				const serproCms = serproRes.rawSignature;

				etapaAssinatura = `Finalizando PDF ${i + 1} de ${pendentesExtra.length}...`;

				const finResp = await fetch(
					`/api/gise/${gise.id}/relatorios/${item.seccionalId}/finalizar-assinatura`,
					{
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							...csrfHeaders()
						},
						body: JSON.stringify({
							preparedPdf: prepData.preparedPdf,
							serproCms,
							messageDigest: prepData.messageDigest,
							signingTimeISO: prepData.signingTimeISO,
							signerName,
							signerCpf,
							verificationHash: prepData.verificationHash
						})
					}
				);

				if (!finResp.ok)
					throw new Error(
						`Falha ao finalizar item ${item.seccionalId}: ` + (await finResp.json()).error
					);
			}

			toaster.success({
				title: 'Lote assinado com sucesso!',
				description: `${pendentesExtra.length} relatórios assinados digitalmente.`
			});
			await invalidate('gise:detail');
		} catch (err: unknown) {
			toaster.error({ title: 'Erro no lote', description: messageFromUnknown(err) });
		} finally {
			assinandoLote = false;
			etapaAssinatura = '';
			progressoLote = { atual: 0, total: 0 };
		}
	}

	async function executarAssinarRelatorio(
		rubrica: string,
		latitude?: number,
		longitude?: number,
		selfieBase64?: string | null,
		codigoValidação?: string,
		desafioId?: string
	) {
		if (!relatorioSendoAssinado) return;
		loading.show('Iniciando assinatura...');

		if (relatorioSendoAssinado.lote) {
			assinandoLote = true;
			progressoLote = {
				atual: 0,
				total: relatorioSendoAssinado.lote.length
			};
			try {
				for (let i = 0; i < relatorioSendoAssinado.lote.length; i++) {
					const item = relatorioSendoAssinado.lote[i];
					progressoLote.atual = i + 1;
					etapaAssinatura = `Assinando ${i + 1} de ${relatorioSendoAssinado.lote.length}...`;
					const res = await fetch(`/api/gise/${gise.id}/relatorios/${item.seccionalId}/assinar`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							...csrfHeaders()
						},
						body: JSON.stringify({
							tipo: item.tipo,
							rubrica,
							latitude,
							longitude,
							selfieBase64,
							codigoValidação,
							desafioId
						})
					});
					if (!res.ok) throw new Error((await res.json()).error);
				}
				toaster.success({ title: 'Lote assinado com sucesso!' });
				relatorioSendoAssinado = null;
				await invalidate('gise:detail');
			} catch (e: unknown) {
				toaster.error({
					title: 'Erro ao assinar lote',
					description: messageFromUnknown(e)
				});
			} finally {
				loading.hide();
				assinandoLote = false;
				etapaAssinatura = '';
				progressoLote = { atual: 0, total: 0 };
			}
			return;
		}

		try {
			etapaAssinatura = 'Processando assinatura...';
			const res = await fetch(
				`/api/gise/${gise.id}/relatorios/${relatorioSendoAssinado.seccionalId}/assinar`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						...csrfHeaders()
					},
					body: JSON.stringify({
						tipo: relatorioSendoAssinado.tipo,
						rubrica,
						latitude,
						longitude,
						selfieBase64,
						codigoValidação,
						desafioId
					})
				}
			);
			if (!res.ok) throw new Error((await res.json()).error);
			toaster.success({ title: 'Relatório assinado com sucesso!' });
			relatorioSendoAssinado = null;
			await invalidate('gise:detail');
		} catch (e: unknown) {
			toaster.error({
				title: 'Erro ao assinar relatório',
				description: messageFromUnknown(e)
			});
		} finally {
			loading.hide();
			etapaAssinatura = '';
		}
	}

	function handleReabrirEscala() {
		pendingCrud = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingCrud = false;
			if (result.type === 'success') {
				toaster.success({
					title: 'Escala reaberta',
					description: 'A assinatura foi revogada. A escala pode ser editada novamente.'
				});
				showReabrirConfirm = false;
				await invalidate('gise:detail');
			} else {
				const d =
					'data' in result ? (result.data as Record<string, unknown> | undefined) : undefined;
				toaster.error({ title: (d?.error as string) || 'Erro ao reabrir' });
			}
		};
	}

	async function abrirEdicaoDatasHorarios() {
		editDataInicio = gise.data_inicio;
		editHoraEntrada = gise.hora_entrada ?? '';
		editHoraSaida = gise.hora_saida ?? '';
		showModalDataHoras = true;
	}

	function handleSalvarDatasHorarios({ cancel }: { cancel(): void }) {
		const horas = [editHoraEntrada, editHoraSaida];
		if (horas.some((h) => !h)) {
			toaster.error({ title: 'Preencha todos os horários' });
			cancel();
			return;
		}
		if (horas.some((h) => !validarHora(h))) {
			toaster.error({ title: 'Formato inválido', description: 'Use o formato HH:MM, ex: 14:00' });
			cancel();
			return;
		}
		pendingCrud = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingCrud = false;
			if (result.type === 'success') {
				const d = result.data as Record<string, unknown>;
				if (d?.assinatura_revogada) {
					toaster.warning({
						title: 'Datas/horários atualizados',
						description: 'A assinatura digital foi revogada. Será necessário assinar novamente.'
					});
				} else {
					toaster.success({ title: 'Datas/horários atualizados' });
				}
				showModalDataHoras = false;
				await invalidate('gise:detail');
			} else {
				const d =
					'data' in result ? (result.data as Record<string, unknown> | undefined) : undefined;
				toaster.error({ title: (d?.error as string) || 'Erro ao salvar' });
			}
		};
	}

	function normalizarHora(v: string): string | null {
		if (!v) return null;
		return v.replace(/[.,]/g, ':');
	}

	function validarHora(v: string): boolean {
		if (!v) return true;
		return /^\d{1,2}:\d{2}$/.test(normalizarHora(v) ?? '');
	}

	function handleSalvarHorariosEquipe({ cancel }: { cancel(): void }) {
		const horas = [editEqHoraEnt, editEqHoraSai].filter(Boolean);
		if (horas.some((h) => !validarHora(h))) {
			toaster.error({ title: 'Formato inválido', description: 'Use o formato HH:MM, ex: 14:00' });
			cancel();
			return;
		}
		pendingCrud = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingCrud = false;
			if (result.type === 'success') {
				toaster.success({ title: 'Horários da equipe atualizados' });
				editandoHorariosEquipeId = null;
				await invalidate('gise:detail');
			} else {
				const d =
					'data' in result ? (result.data as Record<string, unknown> | undefined) : undefined;
				toaster.error({ title: (d?.error as string) || 'Erro ao salvar' });
			}
		};
	}

	function handleExcluirGise() {
		pendingCrud = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingCrud = false;
			if (result.type === 'success') {
				toaster.success({ title: 'Escala GISE excluída' });
				showExcluirGiseConfirm = false;
				goto('/gise');
			} else {
				const d =
					'data' in result ? (result.data as Record<string, unknown> | undefined) : undefined;
				toaster.error({ title: (d?.error as string) || 'Erro ao excluir' });
			}
		};
	}

	function handleAdicionarEquipe() {
		pendingCrud = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingCrud = false;
			if (result.type === 'success') {
				toaster.success({ title: 'Equipe adicionada' });
				adicionandoEquipeSec = null;
				await invalidate('gise:detail');
			} else {
				const d =
					'data' in result ? (result.data as Record<string, unknown> | undefined) : undefined;
				toaster.error({ title: (d?.error as string) || 'Erro ao adicionar' });
			}
		};
	}

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

	const delegacias = $derived(filtrarDelegacias(todasUnidades as Unidade[]));
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

{#snippet statusBadge(status: string, isSeccional = false)}
	{#if isSeccional}
		<span
			class="text-sm px-1.5 py-0.5 rounded-full font-bold {status === 'preenchida' ||
			status === 'preenchida_retificada'
				? 'bg-success-500/20 text-success-700 dark:text-success-400'
				: status === 'retificada'
					? 'bg-warning-500/20 text-warning-600 dark:text-warning-400 border border-warning-500/40'
					: 'bg-surface-500/20 text-surface-600 dark:text-surface-400'}"
		>
			{status === 'preenchida'
				? 'Preenchida'
				: status === 'preenchida_retificada'
					? 'Preenchida (Retificada)'
					: status === 'retificada'
						? 'Preenchida (Retificada)'
						: 'Pendente'}
		</span>
	{:else}
		<span class="text-sm px-2 py-0.5 rounded-full font-semibold {statusColor(status)}">
			{statusLabel(status)}
		</span>
	{/if}
{/snippet}

{#snippet btnIcon(path: string)}
	<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
		<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={path} />
	</svg>
{/snippet}

{#snippet actionButton(
	label: string,
	iconPath?: string,
	variant = 'primary',
	type = 'outlined',
	onclick?: () => void,
	href?: string,
	disabled = false,
	isLoadingLoc = false,
	classes = '',
	btnType: 'button' | 'submit' = 'button',
	size = 'sm'
)}
	{@const baseClass = `btn btn-${size} preset-${type}-${variant}-500 rounded-lg font-semibold whitespace-nowrap transition-all flex items-center justify-center gap-1.5 ${classes}`}
	{#if href}
		<a class="{baseClass} no-underline" {href} target="_blank">
			{#if iconPath}{@render btnIcon(iconPath)}{/if}
			{label}
		</a>
	{:else}
		<button
			class={baseClass}
			{onclick}
			disabled={disabled || loading.active || pendingCrud || isLoadingLoc}
			type={btnType}
		>
			{#if iconPath}
				{@render btnIcon(iconPath)}
			{/if}
			{label}
		</button>
	{/if}
{/snippet}

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
			onToggleEdit={() => (modoEdicaoGeral = !modoEdicaoGeral)}
			onAbrirDataHoras={abrirEdicaoDatasHorarios}
			onAbrirExcluir={() => (showExcluirGiseConfirm = true)}
			onAbrirReabrir={() => (showReabrirConfirm = true)}
			onAbrirFinalizar={() => (showFinalizarConfirm = true)}
			onSolicitarAssinatura={handleSolicitarAssinatura}
			onRevogarPedido={handleRevogarPedidoAssinatura}
			onEnviarPlanilha={isAdminGeral ? handleEnviarPlanilha : undefined}
		/>
	{/if}

	{#if !gise}
		<p class="text-surface-500">Escala não encontrada.</p>
	{:else}
		{#if !isSeccional}
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
				bind:seint1Id
				bind:seint2Id
				onEditar={() => (editandoSupervisores = true)}
				onCancelar={() => (editandoSupervisores = false)}
				onSubmit={handleSalvarSupervisores}
				supervisaoExtraUnidadeId={data.supervisaoExtraUnidadeId}
				assinaturasRelatorios={data.assinaturasRelatorios}
				{podeDownload}
				{isSupervisor}
				{isMobile}
				restringirSmartphone={data.restringirSmartphone}
				onAssinarExtraSupervisaoManual={() => {
					const id = data.supervisaoExtraUnidadeId;
					if (id) abrirAssinaturaRelatorio(id, 'extraordinario');
				}}
				onAssinarExtraSupervisaoDigital={() => {
					const id = data.supervisaoExtraUnidadeId;
					if (id) abrirAssinaturaRelatorioDigital(id, 'extraordinario', 'Supervisão GISE');
				}}
				mostrarPainelAssinaturaEscala={podeAssinar}
				assinaturaEscalaSignerEmail={data.usuarioAtual?.email ?? undefined}
				bind:rubricaCapturada
				bind:painelTokenGise
				bind:serproSignerName
				bind:serproSignerCpf
				onAbrirAssinaturaEscalaManual={() => abrirModalRubrica('simples')}
				onAssinaturaEscalaDigitalSuccess={async () => {
					rubricaCapturada = null;
					await invalidate('gise:detail');
				}}
			/>
		{/if}

		<GiseBannersAssinaturas
			assinaturasRelatorios={data.assinaturasRelatorios}
			supervisaoExtraUnidadeId={data.supervisaoExtraUnidadeId}
			seccionais={gise.seccionais}
		/>

		{#if pendentesExtra.length > 0}
			<GiseLoteAssinaturas
				quantidadePendentes={pendentesExtra.length}
				{assinandoLote}
				{etapaAssinatura}
				{progressoLote}
				{isMobile}
				restringirSmartphone={data.restringirSmartphone}
				onAssinarManualLote={abrirAssinaturaLote}
				onAssinarDigitalLote={executarAssinarRelatorioLoteSERPRO}
			/>
		{/if}

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
								class="btn btn-sm preset-filled-primary-500 text-xs px-3 py-1.5 rounded-lg font-bold shadow-sm"
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
				{#each gise.seccionais ?? [] as sec}
				{#if isAdminGeral || isSupervisor || sec.seccional_id === minhaSeccionalId}
					<div
						class="rounded-2xl border border-surface-200 dark:border-surface-800 mb-4 overflow-visible"
					>
						<!-- Cabeçalho da seccional -->
						<div
							class="flex flex-wrap items-start gap-y-2 justify-between px-5 py-3 {getSeccionalColorClass(
								sec.seccional_id
							)}"
						>
							<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
								<span class="font-semibold text-surface-900 dark:text-surface-50 text-sm">
									{sec.seccional_nome}
								</span>
								{@render statusBadge(sec.status, true)}
								<div class="flex items-center gap-1.5 text-sm text-surface-500 font-medium ml-2">
									<span>{sec.hora_entrada ?? gise.hora_entrada}h-{sec.hora_saida ?? gise.hora_saida}h</span>
									{#if sec.hora_entrada || sec.hora_saida}
										<span
											class="ml-1 px-1 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold border border-amber-500/20"
											>H. Personalizado</span
										>
									{/if}
								</div>
							</div>

							{#if isAdminGeral && podeEditar && modoEdicaoGeral}
								<form
									method="POST"
									action="?/removerSeccional"
									use:enhance={handleRemoverSeccional}
									class="contents"
								>
									<input type="hidden" name="secId" value={sec.id} />
									<button
										type="submit"
										class="btn btn-sm preset-outlined-error-500 w-full sm:w-auto flex items-center justify-center gap-1 whitespace-nowrap"
										disabled={pendingCrud}
										title="Excluir seccional desta escala"
									>
										<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
											><path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
											/></svg
										>
										Excluir seccional
									</button>
								</form>
							{/if}
						</div>

						<!-- Ações Seccional & Downloads -->
						<div
							class="flex flex-col sm:flex-row sm:items-center gap-4 px-5 pb-3 {getSeccionalColorClass(
								sec.seccional_id
							)} border-b border-surface-200 dark:border-surface-700"
						>
							{#if podeDownload}
								{@const assRel = data.assinaturasRelatorios?.find(
									(a: GiseAssinaturaRelatorio) =>
										(a.seccional_id === sec.seccional_id || a.seccional_id === sec.id) &&
										a.tipo === 'extraordinario'
								)}
								<div class="flex flex-col sm:flex-row gap-2 sm:gap-3">
									{#each [...new Set((sec.equipes ?? []).map((eq: GiseEquipeComMembros) => eq.tipo))] as tipo}
										<a
											class="btn text-xs preset-tonal-success w-full sm:w-auto justify-center {!sec.temRespostas
												? 'pointer-events-none opacity-60'
												: 'no-underline'}"
											href={`/api/gise/${gise.id}/download?format=produtividade&seccionalId=${sec.seccional_id}&equipeType=${tipo}`}
											target="_blank"
											title={!sec.temRespostas
												? 'Aguardando preenchimento do formulário'
												: `Baixar Produtividade ${tipo === 'seint' ? 'SEINT' : 'Operacional'}`}
										>
											<svg
												class="w-4 h-4 shrink-0"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
												><path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
												/></svg
											>
											<span>{tipo === 'seint' ? 'Prod. SEINT' : 'Prod. Operacional'}</span>
											{#if !sec.temRespostas}
												<span
													class="text-[0.6rem] opacity-100 dark:opacity-80 font-normal italic ml-1"
													>(aguardando)</span
												>
											{/if}
										</a>
									{/each}

									<div class="flex flex-wrap items-center gap-2 w-full sm:w-auto">
										<a
											class="btn text-xs font-bold px-3 py-2 rounded-xl border-2 flex items-center justify-center gap-2 transition-all w-full sm:w-auto {!(
												checkAllSigned(sec) &&
												(assRel || isAdminGeral || isSeccional || isSupervisor)
											)
												? 'pointer-events-none opacity-60 border-primary-500/30'
												: 'no-underline'} {assRel
												? 'preset-filled-primary-500 border-primary-600/30 hover:border-primary-600'
												: 'preset-tonal-primary border-primary-500/30 hover:border-primary-500'}"
											href={`/api/gise/${gise.id}/download?format=extraordinario&seccionalId=${sec.seccional_id}`}
											target="_blank"
											title={!checkAllSigned(sec)
												? getFaltandoRubrica(sec)
												: assRel
													? `Assinado por ${assRel.assinante_nome}`
													: 'Aguardando assinatura do supervisor'}
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
											<span class="whitespace-nowrap">Relat. Extraordinário</span>
											{#if !assRel}
												<span
													class="text-[0.6rem] opacity-100 dark:opacity-80 font-normal italic ml-1"
													>({!checkAllSigned(sec) ? 'não concluído' : 'conferência'})</span
												>
											{/if}
										</a>
										{#if isSupervisor && !assRel && checkAllSigned(sec)}
											<div class="flex items-center gap-2">
												{#if isMobile || !data.restringirSmartphone}
													{@render actionButton(
														'Ass. tela',
														undefined,
														'warning',
														'filled',
														() => abrirAssinaturaRelatorio(sec.seccional_id, 'extraordinario'),
														undefined,
														false,
														false,
														'border-2 border-warning-600/30 hover:border-warning-600 text-[0.65rem] py-1 shadow-sm font-bold uppercase',
														'button',
														'xs'
													)}
												{/if}

												{#if !isMobile}
													{@render actionButton(
														'Ass. token',
														'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
														'tertiary',
														'filled',
														() =>
															abrirAssinaturaRelatorioDigital(
																sec.seccional_id,
																'extraordinario',
																sec.seccional_nome
															),
														undefined,
														false,
														false,
														'border-2 border-tertiary-600/30 hover:border-tertiary-600 text-[0.65rem] py-1 shadow-sm font-bold uppercase',
														'button',
														'xs'
													)}
												{/if}
											</div>
										{/if}
									</div>
								</div>
							{/if}

							<!-- Ações -->
							<div
								class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto sm:ml-auto"
							>
								{#if isSeccional && sec.seccional_id === minhaSeccionalId && podeEditar}
									{#if sec.status === 'preenchida' && !modoEdicaoSeccional}
										{@render actionButton(
											'Editar Escala',
											undefined,
											'primary',
											'filled',
											() => (modoEdicaoSeccional = true),
											undefined,
											false,
											false,
											'border-2 border-primary-600/30 hover:border-primary-600 px-4 py-1.5 shadow-sm text-sm w-full'
										)}
									{:else}
										<form
											method="POST"
											action="?/finalizarSeccional"
											use:enhance={handleFinalizarSeccional}
											class="contents"
										>
											<input type="hidden" name="secId" value={sec.id} />
											<button
												type="submit"
												class="text-sm btn preset-filled-success-500 border-2 border-success-600/30 hover:border-success-600 px-4 py-1.5 rounded-lg shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all font-bold w-full"
												disabled={pendingCrud ||
													(sec.unidades ?? []).length === 0 ||
													(sec.unidades ?? []).some((s: GiseUnidadeSlot) => s.unidade_id === null) ||
													(sec.unidades ?? []).some(
														(s: GiseUnidadeSlot) =>
															!(s.equipes ?? []).some(
																(eq: GiseEquipeComMembros) => (eq.membros ?? []).length > 0
															)
													)}
												title={(sec.unidades ?? []).length === 0
													? 'Adicione ao menos uma unidade antes de finalizar'
													: (sec.unidades ?? []).some((s: GiseUnidadeSlot) => s.unidade_id === null)
														? 'Todos os slots devem ter uma unidade selecionada'
														: (sec.unidades ?? []).some(
																	(s: GiseUnidadeSlot) =>
																		!(s.equipes ?? []).some(
																			(eq: GiseEquipeComMembros) =>
																				(eq.membros ?? []).length > 0
																		)
															  )
															? 'Cada unidade deve ter pelo menos 1 policial alocado'
															: ''}
											>
												{sec.status === 'preenchida'
													? 'Finalizar edição'
													: sec.status === 'retificada'
														? 'Confirmar retificação'
														: 'Finalizar envio'}
											</button>
										</form>

										{#if modoEdicaoSeccional}
											<button
												type="button"
												class="text-sm btn preset-outlined-surface px-3 py-1.5 rounded-lg w-full sm:w-auto"
												onclick={() => {
													modoEdicaoSeccional = false;
													selecionandoUnidadeSlotId = null;
													equipeParaAdicionar = null;
													cargoParaAdicionar = null;
												}}>Cancelar</button
											>
										{/if}
									{/if}
								{/if}
							</div>
						</div>

						<div class="p-4 space-y-3">
							<!-- ===== Slots de Unidade ===== -->
							{#each sec.unidades ?? [] as slot (slot.id)}
								<div
									class="rounded-xl border border-primary-300/50 dark:border-primary-700/40 bg-primary-500/5 overflow-visible"
								>
									<!-- Cabeçalho do slot: nome da unidade ou seleção -->
									<div
										class="flex flex-col gap-2 px-4 py-3 border-b border-primary-300/30 dark:border-primary-700/30"
									>
										{#if slot.nome}
											<div class="flex items-center gap-2 min-w-0">
												<span
													class="font-semibold text-sm text-surface-900 dark:text-surface-100 truncate"
													>{slot.nome}</span
												>
											</div>
										{:else if (isSeccional && sec.seccional_id === minhaSeccionalId && (modoEdicaoSeccional || sec.status === 'pendente' || sec.status === 'retificada')) || (isAdminGeral && podeEditar && modoEdicaoGeral)}
											<!-- Admin Seccional seleciona a unidade para este slot -->
											{#if selecionandoUnidadeSlotId === slot.id}
												<div class="flex flex-col gap-2 w-full min-w-0">
													<select
														bind:value={slotUnidadeId}
														class="w-full px-2 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
													>
														<option value="">Selecionar unidade...</option>
														{#each todasUnidades.filter((d: Unidade) => d.tipo === 'delegacia' && d.seccional_id === sec.seccional_id && !(sec.unidades ?? []).some((s: GiseUnidadeSlot) => s.unidade_id === d.id && s.id !== slot.id)) as d}
															<option value={d.id}>{d.nome}</option>
														{/each}
													</select>
													<div class="flex gap-2 w-full">
														<form
															method="POST"
															action="?/selecionarUnidade"
															use:enhance={handleSelecionarUnidade}
															class="flex-1 min-w-0"
														>
															<input type="hidden" name="slotId" value={slot.id} />
															<input type="hidden" name="unidadeId" value={slotUnidadeId} />
															<button
																type="submit"
																class="btn preset-filled-primary-500 text-sm px-3 py-1.5 rounded-xl w-full"
																disabled={!slotUnidadeId || pendingCrud}
															>
																{pendingCrud ? 'Salvando...' : 'Confirmar'}
															</button>
														</form>
														<button
															type="button"
															class="btn preset-outlined-primary-500 text-sm px-3 py-1.5 rounded-xl flex-1 min-w-0 w-full"
															onclick={() => {
																selecionandoUnidadeSlotId = null;
																slotUnidadeId = '';
															}}
														>
															Cancelar
														</button>
													</div>
													{#if isAdminGeral && podeEditar && modoEdicaoGeral}
														<form
															method="POST"
															action="?/removerUnidade"
															use:enhance={handleRemoverUnidade}
															class="w-full sm:ml-auto sm:w-auto sm:flex sm:justify-end"
														>
															<input type="hidden" name="secId" value={sec.id} />
															<input type="hidden" name="linkId" value={slot.id} />
															<button
																type="submit"
																class="btn btn-sm preset-outlined-error-500 w-full sm:w-auto text-sm px-2 py-1 rounded-lg flex items-center justify-center gap-1 whitespace-nowrap"
																disabled={pendingCrud}
															>
																<svg
																	class="w-3.5 h-3.5"
																	fill="none"
																	stroke="currentColor"
																	viewBox="0 0 24 24"
																	><path
																		stroke-linecap="round"
																		stroke-linejoin="round"
																		stroke-width="2"
																		d="M6 18L18 6M6 6l12 12"
																	/></svg
																>
																Remover DP
															</button>
														</form>
													{/if}
												</div>
											{:else}
												<div
													class="flex flex-col sm:flex-row sm:justify-end sm:items-stretch gap-2 w-full min-w-0"
												>
													<button
														type="button"
														class="btn preset-outlined-warning-500 w-full sm:w-auto shrink-0 text-sm px-3 py-1.5 rounded-xl flex items-center justify-center gap-1.5"
														onclick={() => {
															selecionandoUnidadeSlotId = slot.id;
															slotUnidadeId = '';
														}}
													>
														<svg
															class="w-3.5 h-3.5"
															fill="none"
															stroke="currentColor"
															viewBox="0 0 24 24"
															><path
																stroke-linecap="round"
																stroke-linejoin="round"
																stroke-width="2"
																d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
															/></svg
														>
														Definir DP
													</button>
													{#if isAdminGeral && podeEditar && modoEdicaoGeral}
														<form
															method="POST"
															action="?/removerUnidade"
															use:enhance={handleRemoverUnidade}
															class="w-full sm:w-auto sm:min-w-0"
														>
															<input type="hidden" name="secId" value={sec.id} />
															<input type="hidden" name="linkId" value={slot.id} />
															<button
																type="submit"
																class="btn btn-sm preset-outlined-error-500 w-full sm:w-auto text-sm px-2 py-1 rounded-lg flex items-center justify-center gap-1 whitespace-nowrap"
																disabled={pendingCrud}
															>
																<svg
																	class="w-3.5 h-3.5"
																	fill="none"
																	stroke="currentColor"
																	viewBox="0 0 24 24"
																	><path
																		stroke-linecap="round"
																		stroke-linejoin="round"
																		stroke-width="2"
																		d="M6 18L18 6M6 6l12 12"
																	/></svg
																>
																Remover DP
															</button>
														</form>
													{/if}
												</div>
											{/if}
										{:else}
											<span class="text-sm text-surface-400 italic">Unidade não definida</span>
										{/if}

										<!-- Admin Geral: remover slot (quando já há unidade definida) -->
										{#if slot.nome && isAdminGeral && podeEditar && modoEdicaoGeral}
											<form
												method="POST"
												action="?/removerUnidade"
												use:enhance={handleRemoverUnidade}
												class="w-full sm:ml-auto sm:w-auto sm:flex sm:justify-end"
											>
												<input type="hidden" name="secId" value={sec.id} />
												<input type="hidden" name="linkId" value={slot.id} />
												<button
													type="submit"
													class="btn btn-sm preset-outlined-error-500 w-full sm:w-auto text-sm px-2 py-1 rounded-lg flex items-center justify-center gap-1 whitespace-nowrap"
													disabled={pendingCrud}
												>
													<svg
														class="w-3.5 h-3.5"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
														><path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M6 18L18 6M6 6l12 12"
														/></svg
													>
													Remover DP
												</button>
											</form>
										{/if}

									</div>

									<!-- Equipes do slot -->
									<div class="p-3 space-y-2.5">
										{#each slot.equipes ?? [] as equipe}
											<div
												class="rounded-xl border border-surface-300 dark:border-surface-600 p-4 bg-surface-50 dark:bg-surface-900/80 shadow-sm"
											>
												<div
													class="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-4"
												>
													{#if isAdminGeral && podeEditar && modoEdicaoGeral}
														<form
															id="remover-equipe-form-{equipe.id}"
															method="POST"
															action="?/removerEquipe"
															use:enhance={handleRemoverEquipe}
															class="hidden"
															aria-hidden="true"
														>
															<input type="hidden" name="equipeId" value={equipe.id} />
														</form>
													{/if}

													<div
														class="flex min-w-0 items-center justify-between gap-2 lg:contents"
													>
														<span
															class="min-w-0 shrink text-sm font-semibold capitalize text-surface-900 dark:text-surface-100 lg:shrink-0"
														>
															Equipe {equipe.tipo === 'operacional' ? 'Operacional' : 'SEINT'}
														</span>
														{#if isAdminGeral && podeEditar && modoEdicaoGeral}
															<button
																type="submit"
																form="remover-equipe-form-{equipe.id}"
																class="btn btn-sm preset-outlined-error-500 inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap px-2 py-1 text-xs lg:hidden"
																disabled={pendingCrud}
															>
																{pendingCrud ? 'Removendo...' : 'Remover equipe'}
															</button>
														{/if}
													</div>

													<div
														class="flex min-w-0 flex-1 gap-2 lg:flex-row lg:flex-wrap lg:items-center lg:justify-end lg:gap-x-3 lg:gap-y-2 {editandoEquipe ===
														equipe.id || editandoHorariosEquipeId === equipe.id
															? 'flex-col'
															: 'flex-row flex-wrap items-center'}"
													>
													{#if editandoEquipe === equipe.id}
														<div class="flex flex-wrap items-center gap-1.5">
															<label for="edit-dpc-{equipe.id}" class="text-sm text-surface-500"
																>DPC:</label
															>
															<input
																id="edit-dpc-{equipe.id}"
																type="number"
																min="0"
																max="20"
																bind:value={editSlotsDpc}
																class="w-14 px-2 py-1 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm text-center"
															/>
															<label for="edit-oip-{equipe.id}" class="text-sm text-surface-500"
																>OIP:</label
															>
															<input
																id="edit-oip-{equipe.id}"
																type="number"
																min="0"
																max="20"
																bind:value={editSlotsOip}
																class="w-14 px-2 py-1 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm text-center"
															/>
															<div class="flex items-center gap-2 shrink-0">
																<form
																	method="POST"
																	action="?/salvarSlotsEquipe"
																	use:enhance={handleSalvarSlotsEquipe}
																	class="contents"
																>
																	<input type="hidden" name="equipeId" value={equipe.id} />
																	<input type="hidden" name="slots_dpc" value={editSlotsDpc} />
																	<input type="hidden" name="slots_oip" value={editSlotsOip} />
																	<button
																		type="submit"
																		class="btn btn-sm preset-filled-primary-500 text-sm py-1 px-2 rounded"
																		disabled={pendingCrud}
																		aria-label="Salvar vagas"
																		title="Confirmar"
																		>{pendingCrud ? '…' : '✓'}</button
																	>
																</form>
																<button
																	type="button"
																	class="btn btn-sm preset-outlined-primary-500 text-sm py-1 px-2 rounded"
																	onclick={() => (editandoEquipe = null)}
																	aria-label="Cancelar edição de vagas"
																	title="Cancelar">×</button
																>
															</div>
														</div>
													{:else}
														<div class="flex flex-wrap items-center gap-2 min-w-0">
															<span class="text-sm text-surface-500"
																>{equipe.slots_dpc} DPC + {equipe.slots_oip} OIP</span
															>
															{#if isAdminGeral && podeEditar && modoEdicaoGeral}
																<button
																	type="button"
																	class="btn btn-xs preset-filled-surface-500 rounded p-1 shrink-0"
																	onclick={() => {
																		editandoEquipe = equipe.id;
																		editSlotsDpc = equipe.slots_dpc;
																		editSlotsOip = equipe.slots_oip;
																	}}
																	title="Editar vagas da equipe"
																>
																	<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"
																		><path
																			stroke-linecap="round"
																			stroke-linejoin="round"
																			stroke-width="2"
																			d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
																		/></svg
																	>
																</button>
															{/if}
														</div>
													{/if}

													{#if editandoHorariosEquipeId === equipe.id}
														<div class="flex flex-wrap items-center gap-2">
															<input
																type="text"
																placeholder="08:00"
																class="w-16 px-2 py-1 text-sm rounded border bg-white dark:bg-surface-900 {editEqHoraEnt &&
																!validarHora(editEqHoraEnt)
																	? 'border-error-500'
																	: 'border-surface-300 dark:border-surface-600'}"
																bind:value={editEqHoraEnt}
															/>
															<span class="opacity-30">-</span>
															<input
																type="text"
																placeholder="16:00"
																class="w-16 px-2 py-1 text-sm rounded border bg-white dark:bg-surface-900 {editEqHoraSai &&
																!validarHora(editEqHoraSai)
																	? 'border-error-500'
																	: 'border-surface-300 dark:border-surface-600'}"
																bind:value={editEqHoraSai}
															/>
															<div class="flex items-center gap-2 shrink-0">
																<form
																	method="POST"
																	action="?/salvarHorariosEquipe"
																	use:enhance={handleSalvarHorariosEquipe}
																	class="contents"
																>
																	<input type="hidden" name="eqId" value={equipe.id} />
																	<input
																		type="hidden"
																		name="hora_entrada"
																		value={normalizarHora(editEqHoraEnt) ?? ''}
																	/>
																	<input
																		type="hidden"
																		name="hora_saida"
																		value={normalizarHora(editEqHoraSai) ?? ''}
																	/>
																	<button
																		type="submit"
																		class="btn btn-sm preset-filled-primary-500 text-sm py-1 px-2 rounded"
																		>✓</button
																	>
																</form>
																<button
																	type="button"
																	class="btn btn-sm preset-outlined-primary-500 text-sm py-1 px-2 rounded"
																	onclick={() => (editandoHorariosEquipeId = null)}>×</button
																>
															</div>
														</div>
													{:else}
														<div class="flex flex-wrap items-center gap-2 min-w-0">
															<div class="flex flex-wrap items-center gap-1.5 text-sm text-surface-400 font-medium min-w-0">
																<span
																	>{equipe.hora_entrada ??
																		sec.hora_entrada ??
																		gise.hora_entrada}h-{equipe.hora_saida ??
																		sec.hora_saida ??
																		gise.hora_saida}h</span
																>
																{#if equipe.hora_entrada || equipe.hora_saida}
																	<span
																		class="px-1 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold border border-amber-500/20 uppercase"
																		>H. Personalizado</span
																	>
																{/if}
															</div>
															{#if isAdminGeral && podeEditar && modoEdicaoGeral}
																<button
																	type="button"
																	class="btn btn-xs preset-filled-surface-500 rounded p-1 shrink-0"
																	onclick={() => {
																		editandoHorariosEquipeId = equipe.id;
																		editEqHoraEnt =
																			equipe.hora_entrada ??
																			sec.hora_entrada ??
																			gise.hora_entrada ??
																			'';
																		editEqHoraSai =
																			equipe.hora_saida ??
																			sec.hora_saida ??
																			gise.hora_saida ??
																			'';
																	}}
																	title="Editar horários da equipe"
																>
																	<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"
																		><path
																			stroke-linecap="round"
																			stroke-linejoin="round"
																			stroke-width="2"
																			d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
																		/></svg
																	>
																</button>
															{/if}
														</div>
													{/if}

													{#if isAdminGeral && podeEditar && modoEdicaoGeral}
														<button
															type="submit"
															form="remover-equipe-form-{equipe.id}"
															class="btn btn-sm preset-outlined-error-500 hidden w-full items-center justify-center gap-1 whitespace-nowrap lg:inline-flex lg:w-auto"
															disabled={pendingCrud}
														>
															{pendingCrud ? 'Removendo...' : 'Remover equipe'}
														</button>
													{/if}
													</div>
												</div>

												<!-- Membros -->
												{#if equipe.membros?.length}
													<div class="space-y-1 mb-2">
														{#each equipe.membros as m}
															<div
																class="flex items-center justify-between text-sm px-3 py-1.5 rounded-lg bg-surface-100 dark:bg-surface-800"
															>
																<div class="flex items-center gap-2">
																	<span class="font-semibold text-surface-900 dark:text-surface-100"
																		>{m.policial_nome}</span
																	>
																	<span class="text-surface-500"
																		>{m.policial_cargo} · {m.policial_matricula}</span
																	>
																	{#if m.presenca?.entrada_timestamp && m.presenca?.saida_timestamp}
																		<span
																			class="text-xs px-1 py-0.5 rounded bg-success-500/20 text-success-700 dark:text-success-400"
																			>✓</span
																		>
																	{:else if m.presenca?.entrada_timestamp}
																		<span
																			class="text-xs px-1 py-0.5 rounded bg-warning-500/20 text-warning-700 dark:text-warning-400"
																			>Entrada</span
																		>
																	{/if}
																</div>
																{#if podeEditar && ((isAdminGeral && modoEdicaoGeral) || (isSeccional && sec.seccional_id === minhaSeccionalId && (modoEdicaoSeccional || sec.status === 'pendente' || sec.status === 'retificada')))}
																	<form
																		method="POST"
																		action="?/removerMembro"
																		use:enhance={handleRemoverMembro}
																		class="ml-2"
																	>
																		<input type="hidden" name="memId" value={m.id} />
																		<button
																			type="submit"
																			class="inline-flex items-center justify-center w-5 h-9 rounded-md border border-error-500/35 bg-error-500/10 text-error-600 hover:bg-error-500/20 hover:text-error-700 dark:text-error-400 dark:hover:text-error-300 transition-colors touch-manipulation -mr-1"
																			disabled={removendoMembroId === m.id}
																			aria-label="Remover policial da equipe"
																			title="Remover policial"
																		>
																			{pendingCrud ? '...' : '×'}
																		</button>
																	</form>
																{/if}
															</div>
														{/each}
													</div>
												{:else}
													<p class="text-sm text-surface-400 italic mb-3">Nenhum membro alocado</p>
												{/if}

												<!-- Adicionar membro -->
												{#if podeEditar && ((isAdminGeral && modoEdicaoGeral) || (isSeccional && sec.seccional_id === minhaSeccionalId && (modoEdicaoSeccional || sec.status === 'pendente' || sec.status === 'retificada')))}
													{#if equipeParaAdicionar === equipe.id}
														<form
															method="POST"
															action="?/adicionarMembro"
															use:enhance={handleAdicionarMembro}
														>
															<input type="hidden" name="secId" value={sec.id} />
															<input type="hidden" name="equipe_id" value={equipeParaAdicionar} />
															<input
																type="hidden"
																name="policial_id"
																value={policialParaAdicionar}
															/>
															<div class="flex flex-col sm:flex-row gap-2 sm:items-end">
																<div class="w-full flex-1 min-w-32">
																	{#key cargoParaAdicionar}
																		<SearchableSelect
																			bind:value={policialParaAdicionar}
																			loadOptions={buscarMembroAdicional}
																			placeholder={`Pesquisar ${cargoParaAdicionar}...`}
																			class="w-full"
																		/>
																	{/key}
																</div>
																<div class="w-full sm:w-auto flex gap-2">
																	<button
																		type="submit"
																		class="btn preset-filled-primary-500 text-sm px-3 py-1.5 rounded-lg flex-1 sm:flex-none"
																		disabled={!policialParaAdicionar || pendingCrud}>Adicionar</button
																	>
																	<button
																		type="button"
																		class="btn preset-outlined-primary-500 text-sm px-3 py-1.5 rounded-lg flex-1 sm:flex-none"
																		onclick={() => {
																			equipeParaAdicionar = null;
																			policialParaAdicionar = '';
																			cargoParaAdicionar = null;
																		}}>Fechar</button
																	>
																</div>
															</div>
														</form>
													{:else if !isAdminGeral}
														<div class="flex flex-wrap gap-2">
															<button
																type="button"
																class="btn btn-sm preset-outlined-success-500 w-full sm:w-auto flex items-center justify-center gap-1 whitespace-nowrap"
																onclick={() => {
																	equipeParaAdicionar = equipe.id;
																	cargoParaAdicionar = 'OIP';
																	policialParaAdicionar = '';
																}}
															>
																<svg
																	class="w-3.5 h-3.5"
																	fill="none"
																	stroke="currentColor"
																	viewBox="0 0 24 24"
																	><path
																		stroke-linecap="round"
																		stroke-linejoin="round"
																		stroke-width="2"
																		d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
																	/></svg
																>
																+ Adicionar OIP
															</button>
															{#if equipe.slots_dpc > 0}
																<button
																	type="button"
																	class="btn btn-sm preset-outlined-success-500 w-full sm:w-auto flex items-center justify-center gap-1 whitespace-nowrap"
																	onclick={() => {
																		equipeParaAdicionar = equipe.id;
																		cargoParaAdicionar = 'DPC';
																		policialParaAdicionar = '';
																	}}
																>
																	<svg
																		class="w-3.5 h-3.5"
																		fill="none"
																		stroke="currentColor"
																		viewBox="0 0 24 24"
																		><path
																			stroke-linecap="round"
																			stroke-linejoin="round"
																			stroke-width="2"
																			d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
																		/></svg
																	>
																	+ Adicionar DPC
																</button>
															{/if}
														</div>
													{/if}
												{/if}
											</div>
										{/each}

										<!-- Admin Geral: adicionar equipe a este slot -->
										{#if isAdminGeral && podeEditar && modoEdicaoGeral}
											{#if adicionandoEquipeSec === sec.id && adicionandoEquipeSlotId === slot.id}
												<div
													class="flex flex-wrap gap-2 items-end mt-2 p-3 rounded-xl border border-dashed border-surface-300 dark:border-surface-600"
												>
													<div>
														<label
															for="novaEquipeTipo-{slot.id}"
															class="text-sm font-medium text-surface-600 dark:text-surface-400 block mb-1"
															>Tipo</label
														>
														<select
															id="novaEquipeTipo-{slot.id}"
															bind:value={novaEquipeTipo}
															onchange={() => {
																if (novaEquipeTipo === 'operacional') {
																	novaEquipeDpc = 1;
																	novaEquipeOip = 3;
																} else {
																	novaEquipeDpc = 0;
																	novaEquipeOip = 2;
																}
															}}
															class="px-2 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
														>
															<option value="operacional">Operacional</option>
															<option value="seint">SEINT</option>
														</select>
													</div>
													<div>
														<label
															for="novaEquipeDpc-{slot.id}"
															class="text-sm font-medium text-surface-600 dark:text-surface-400 block mb-1"
															>DPC</label
														>
														<input
															id="novaEquipeDpc-{slot.id}"
															type="number"
															min="0"
															max="20"
															bind:value={novaEquipeDpc}
															class="w-14 px-2 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm text-center"
														/>
													</div>
													<div>
														<label
															for="novaEquipeOip-{slot.id}"
															class="text-sm font-medium text-surface-600 dark:text-surface-400 block mb-1"
															>OIP</label
														>
														<input
															id="novaEquipeOip-{slot.id}"
															type="number"
															min="0"
															max="20"
															bind:value={novaEquipeOip}
															class="w-14 px-2 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm text-center"
														/>
													</div>
													<form
														method="POST"
														action="?/adicionarEquipe"
														use:enhance={handleAdicionarEquipe}
														class="contents"
													>
														<input type="hidden" name="secId" value={sec.id} />
														<input type="hidden" name="unidadeId" value={slot.id} />
														<input type="hidden" name="tipo" value={novaEquipeTipo} />
														<input type="hidden" name="slots_dpc" value={novaEquipeDpc} />
														<input type="hidden" name="slots_oip" value={novaEquipeOip} />
														<button
															type="submit"
															class="btn preset-filled-primary-500 text-sm px-3 py-1.5 rounded-lg"
															disabled={pendingCrud}
															>{pendingCrud ? 'Adicionando...' : 'Adicionar'}</button
														>
													</form>
													<button
														type="button"
														class="btn preset-outlined-surface text-sm px-2 py-1.5 rounded-lg"
														onclick={() => {
															adicionandoEquipeSec = null;
															adicionandoEquipeSlotId = null;
														}}>Cancelar</button
													>
												</div>
											{:else}
												<button
													type="button"
													class="btn btn-sm preset-outlined-success-500 w-full sm:w-auto flex items-center justify-center gap-1 whitespace-nowrap mt-1"
													onclick={() => {
														adicionandoEquipeSec = sec.id;
														adicionandoEquipeSlotId = slot.id;
														novaEquipeTipo = 'operacional';
														novaEquipeDpc = 1;
														novaEquipeOip = 3;
													}}
												>
													<svg
														class="w-3.5 h-3.5"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
														><path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
														/></svg
													>
													+ Adicionar equipe
												</button>
											{/if}
										{/if}
									</div>
								</div>
							{/each}

							<!-- Admin Geral: adicionar slot de unidade -->
							{#if isAdminGeral && podeEditar && modoEdicaoGeral}
								{#if adicionandoSlotSecId === sec.id}
									<div
										class="flex flex-wrap gap-2 items-end p-3 rounded-xl border border-dashed border-primary-400/50 bg-primary-500/5"
									>
										<div class="flex-1 min-w-40">
											<label
												for="novo-slot-unidade"
												class="text-xs font-medium text-surface-600 dark:text-surface-400 block mb-1"
												>Unidade (opcional — pode deixar em branco)</label
											>
											<select
												id="novo-slot-unidade"
												bind:value={novoSlotUnidadeId}
												class="w-full px-2 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
											>
												<option value="">Slot em branco (Adm Seccional preenche depois)</option>
												{#each todasUnidades.filter((d: Unidade) => d.tipo === 'delegacia' && d.seccional_id === sec.seccional_id && !(sec.unidades ?? []).some((s: GiseUnidadeSlot) => s.unidade_id === d.id)) as d}
													<option value={d.id}>{d.nome}</option>
												{/each}
											</select>
										</div>
										<form
											method="POST"
											action="?/adicionarUnidade"
											use:enhance={handleAdicionarUnidade}
											class="flex gap-2 shrink-0"
										>
											<input type="hidden" name="secId" value={sec.id} />
											<input type="hidden" name="unidadeId" value={novoSlotUnidadeId} />
											<button
												type="submit"
												class="btn preset-filled-primary-500 text-sm px-3 py-1.5 rounded-xl"
												disabled={pendingCrud}
												>{pendingCrud ? 'Adicionando...' : 'Confirmar'}</button
											>
										</form>
										<button
											type="button"
											class="btn preset-outlined-surface text-sm px-3 py-1.5 rounded-xl"
											onclick={() => {
												adicionandoSlotSecId = null;
												novoSlotUnidadeId = '';
											}}>Cancelar</button
										>
									</div>
								{:else}
									<button
										type="button"
										class="btn preset-outlined-primary-500 text-sm px-3 py-1.5 rounded-xl border-dashed flex items-center gap-2"
										onclick={() => {
											adicionandoSlotSecId = sec.id;
											novoSlotUnidadeId = '';
										}}
									>
										<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
											><path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
											/></svg
										>
										+ Adicionar outra DP	
									</button>
								{/if}
							{/if}
						</div>
					</div>
				{/if}
				{/each}
			{/if}

			{#if isAdminGeral && podeEditar && modoEdicaoGeral}
				{#if adicionandoSeccional}
					<div
						class="mt-4 p-5 rounded-2xl border border-dashed border-primary-500/50 bg-primary-500/5 flex flex-wrap items-end gap-3"
					>
						<div class="flex-1 min-w-[200px]">
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
								{#each seccionaisDisponiveis as s}
									<option value={s.id}>{s.nome}</option>
								{/each}
							</select>
						</div>
						<form
							method="POST"
							action="?/adicionarSeccional"
							use:enhance={handleAdicionarSeccional}
							class="flex gap-2"
						>
							<input type="hidden" name="seccionalId" value={seccionalParaAdicionarIdx} />
							<button
								type="submit"
								class="btn preset-filled-primary-500 text-sm px-4 py-2 rounded-xl"
								disabled={!seccionalParaAdicionarIdx || pendingCrud}
							>
								{pendingCrud ? 'Adicionando...' : 'Confirmar'}
							</button>
							<button
								type="button"
								class="btn preset-outlined-surface text-sm px-4 py-2 rounded-xl"
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

<ModalDatasHoras
	open={showModalDataHoras}
	{pendingCrud}
	{editaBloqueado}
	bind:dataInicio={editDataInicio}
	bind:horaEntrada={editHoraEntrada}
	bind:horaSaida={editHoraSaida}
	onClose={() => (showModalDataHoras = false)}
	onSubmit={handleSalvarDatasHorarios}
	{normalizarHora}
	{validarHora}
/>

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
		disabled={loading.active}
		bind:control={painelTokenRelatorio}
		bind:signerName={relatorioSignerName}
		bind:signerCpf={relatorioSignerCpf}
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
	open={showRubricaModal}
	exigirFoto={page.data.exigirFotoAssinatura ?? true}
	exigirGps={page.data.exigirGpsAssinatura ?? true}
	exigirCodigoEmail={page.data.exigirCodigoEmailAssinatura ?? false}
	onConfirm={confirmarRubrica}
	onCancel={() => (showRubricaModal = false)}
/>

<ModalRemoverSeccional
	open={dialogRemoverSeccionalAberto}
	onOpenChange={(open) => (dialogRemoverSeccionalAberto = open)}
	onConfirm={confirmarRemoverSeccional}
/>
