<script lang="ts">
	import { goto, invalidate, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { toaster } from '$lib/toast';
	import { enhance } from '$app/forms';
	import type { ActionResult } from '@sveltejs/kit';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import PainelAssinaturaToken from '$lib/components/PainelAssinaturaToken.svelte';
	import { conectarSerpro, type SerproSignerClient } from '$lib/serpro';
	import SignaturePad from '$lib/components/SignaturePad.svelte';
	import { csrfHeaders } from '$lib/csrf';
	import { useGiseEstado, useGiseAssinatura } from '$lib/composables/gise';
	import { loading } from '$lib/loading.svelte';

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
	let equipeParaAdicionar = $state<number | null>(null);
	let policialParaAdicionar = $state<number | ''>('');
	let cargoParaAdicionar = $state<'OIP' | 'DPC' | null>(null);
	let modoEdicaoSeccional = $state(false);
	let expandirManual = $state(false);
	let expandirDigital = $state(false);
	let expandirLoteManual = $state(false);
	let expandirLoteDigital = $state(false);
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
		todasUnidades.filter(
			(u: any) =>
				u.tipo === 'seccional' && !gise?.seccionais.some((s: any) => s.seccional_id === u.id)
		)
	);
	let adicionandoSeccional = $state(false);
	let seccionalParaAdicionarIdx = $state<number | ''>('');
	let pendingCrud = $state(false);

	// Horários customizados por seccional
	let editandoHorariosSecId = $state<number | null>(null);
	let editSecHoraEnt = $state('');
	let editSecHoraSai = $state('');

	// Horários customizados por equipe
	let editandoHorariosEquipeId = $state<number | null>(null);
	let editEqHoraEnt = $state('');
	let editEqHoraSai = $state('');

	$effect(() => {
		if (gise) {
			supervisorId = gise.supervisor_id ?? null;
		}
	});

	const dpcs = $derived(policiais.filter((p: any) => p.cargo === 'DPC'));

	function getMembrosFromSec(sec: any): any[] {
		return (sec.unidades ?? []).flatMap((u: any) =>
			(u.equipes ?? []).flatMap((eq: any) => eq.membros ?? [])
		);
	}

	function checkAllSigned(sec: any) {
		const members = getMembrosFromSec(sec);
		if (members.length === 0) return false;
		return members.every((m: any) => m.presenca?.entrada_timestamp && m.presenca?.saida_timestamp);
	}

	function getFaltandoRubrica(sec: any) {
		const members = getMembrosFromSec(sec);
		const faltantes = members.filter(
			(m: any) => !m.presenca?.entrada_timestamp || !m.presenca?.saida_timestamp
		);
		if (faltantes.length === 0) return '';
		return (
			'Faltando rubrica de: ' + faltantes.map((m: any) => m.policial_nome.split(' ')[0]).join(', ')
		);
	}

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
				const data = await res.json().catch(() => ({}));
				toaster.error({ title: String((data as any)?.error || 'Erro ao remover') });
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
				toaster.error({ title: (d?.error as string) || 'Erro ao remover unidade' });
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
		loading.show('Confirmando escala e gerando PDF...');
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
				await invalidate(page.url.href);
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

	// Relatórios extraordinários pendentes de assinatura
	const pendentesExtra = $derived.by(() => {
		if (!isSupervisor) return [];
		const lista: Array<{ seccionalId: number; tipo: 'extraordinario' }> = [];
		for (const sec of gise?.seccionais || []) {
			const relAssinado = data.assinaturasRelatorios?.find(
				(a: any) =>
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
			await invalidate(page.url.href);
		} catch (err: any) {
			toaster.error({ title: 'Erro no lote', description: err.message });
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
			} catch (e: any) {
				toaster.error({
					title: 'Erro ao assinar lote',
					description: e.message
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
		} catch (e: any) {
			toaster.error({
				title: 'Erro ao assinar relatório',
				description: e.message
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
				await invalidate(page.url.href);
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

	function handleSalvarHorariosSec({ cancel }: { cancel(): void }) {
		const horas = [editSecHoraEnt, editSecHoraSai].filter(Boolean);
		if (horas.some((h) => !validarHora(h))) {
			toaster.error({ title: 'Formato inválido', description: 'Use o formato HH:MM, ex: 14:00' });
			cancel();
			return;
		}
		pendingCrud = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingCrud = false;
			if (result.type === 'success') {
				toaster.success({ title: 'Horários da seccional atualizados' });
				editandoHorariosSecId = null;
				await invalidate(page.url.href);
			} else {
				const d =
					'data' in result ? (result.data as Record<string, unknown> | undefined) : undefined;
				toaster.error({ title: (d?.error as string) || 'Erro ao salvar' });
			}
		};
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
				await invalidate(page.url.href);
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

	const delegacias = $derived(todasUnidades.filter((u: any) => u.tipo === 'delegacia'));
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
	onclick?: any,
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
	class="relative transition-all duration-500 {loading.active
		? 'pointer-events-none opacity-40 blur-[3px]'
		: 'opacity-100 blur-0'} space-y-6"
>
	<!-- Cabeçalho -->
	<div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
		<div class="min-w-0">
			<button
				type="button"
				class="btn btn-sm mb-4 preset-outlined-surface-500 hover:bg-surface-50 dark:hover:bg-surface-900 px-3 py-1.5 rounded-xl transition-all flex items-center gap-2 group"
				onclick={() => goto('/gise')}
			>
				<svg
					class="w-4 h-4 transition-transform group-hover:-translate-x-1"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2.5"
						d="M10 19l-7-7m0 0l7-7m-7 7h18"
					/>
				</svg>
				<span class="text-sm font-bold uppercase tracking-wider">Voltar</span>
			</button>
			{#if gise}
				<h1 class="text-2xl font-bold text-surface-900 dark:text-surface-50">
					Escala GISE #{gise.id} — {diaSemana(gise.data_inicio)}, {fmtDate(gise.data_inicio)}
				</h1>
				<div class="flex items-center gap-2 mt-1">
					{@render statusBadge(gise.status)}
					<span class="text-sm text-surface-500 flex items-center gap-2">
						{gise.hora_entrada}h–{gise.hora_saida}h
						{#if isAdminGeral && podeEditar && modoEdicaoGeral}
							<button
								type="button"
								class="btn btn-xs preset-filled-surface-500 rounded p-1"
								onclick={abrirEdicaoDatasHorarios}
								title="Editar Data/Horários"
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
					</span>
				</div>
			{/if}
		</div>

		<div class="flex flex-wrap gap-2 sm:justify-end sm:shrink-0">
			{#if (isAdminGeral || isSeccional) && gise && podeDownload}
				{@render actionButton(
					'Baixar XLSX',
					undefined,
					'success',
					'outlined',
					undefined,
					`/api/gise/${gise.id}/download?format=xlsx`
				)}
			{/if}
			{#if isAdminGeral && gise}
				{@render actionButton(
					modoEdicaoGeral ? 'Concluir Edição' : 'Editar escala',
					undefined,
					'primary',
					modoEdicaoGeral ? 'filled' : 'outlined',
					() => (modoEdicaoGeral = !modoEdicaoGeral),
					undefined,
					editaBloqueado,
					false,
					modoEdicaoGeral
						? 'border-2 border-primary-600 shadow-xl'
						: 'border-2 border-primary-500/30 hover:border-primary-500'
				)}
				{#if gise.status === 'em_preenchimento' && todasSeccionaisPreenchidas}
					<form
						method="POST"
						action="?/solicitarAssinatura"
						use:enhance={handleSolicitarAssinatura}
						class="contents"
					>
						{@render actionButton(
							'Solicitar Nova Assinatura',
							undefined,
							'success',
							'filled',
							undefined,
							undefined,
							loading.active || modoEdicaoGeral,
							false,
							'border-2 border-success-600/30 hover:border-success-600',
							'submit'
						)}
					</form>
				{/if}
				{#if gise.status === 'aguardando_assinatura' && !documentoAssinadoInfo?.existe}
					<form
						method="POST"
						action="?/revogarPedidoAssinatura"
						use:enhance={handleRevogarPedidoAssinatura}
						class="contents"
					>
						{@render actionButton(
							'Revogar solicitação de ass.',
							undefined,
							'warning',
							'outlined',
							undefined,
							undefined,
							loading.active,
							false,
							'border-2 border-warning-500/30 hover:border-warning-500',
							'submit'
						)}
					</form>
				{/if}
				{@render actionButton(
					'Excluir GISE',
					undefined,
					'error',
					'outlined',
					() => (showExcluirGiseConfirm = true),
					undefined,
					editaBloqueado,
					false,
					'border-2 border-error-500/30 hover:border-error-500'
				)}
			{/if}
			{#if podeReabrir}
				{@render actionButton(
					'Reabrir para Edição',
					undefined,
					'warning',
					'outlined',
					() => (showReabrirConfirm = true),
					undefined,
					false,
					false,
					'border-2 border-warning-500/30 hover:border-warning-500'
				)}
			{/if}
			{#if podeFinalizar}
				{@render actionButton(
					'Marcar como Finalizada',
					undefined,
					'error',
					'outlined',
					() => (showFinalizarConfirm = true),
					undefined,
					false,
					false,
					'border-2 border-error-600/30 hover:border-error-600 bg-error-500/10 hover:bg-error-500/20 dark:bg-error-500/15'
				)}
			{/if}
		</div>
	</div>

	{#if !gise}
		<p class="text-surface-500">Escala não encontrada.</p>
	{:else}
		<!-- Supervisor -->
		<div
			class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900 p-5"
		>
			<div class="flex flex-wrap items-start gap-y-1 justify-between mb-3">
				<h2 class="font-semibold text-surface-900 dark:text-surface-50">Supervisor</h2>
				{#if isAdminGeral && podeEditar && modoEdicaoGeral && !editandoSupervisores}
					<button
						type="button"
						class="text-sm px-3 py-1 rounded-lg font-semibold transition-all {!gise.supervisor_id
							? 'btn preset-filled-warning-500 animate-pulse'
							: 'btn preset-outlined-primary-500'}"
						onclick={() => (editandoSupervisores = true)}
					>
						{!gise.supervisor_id ? 'Definir Supervisor' : 'Editar Supervisor'}
					</button>
				{/if}
			</div>

			{#if editandoSupervisores}
				<div class="mb-3">
					<label
						for="supId"
						class="text-sm font-medium text-surface-600 dark:text-surface-400 block mb-1"
						>Supervisor (DPC)</label
					>
					<select
						id="supId"
						bind:value={supervisorId}
						class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
					>
						<option value={null}>Não definido</option>
						{#each dpcs as p}
							<option value={p.id}>{p.nome} ({p.matricula})</option>
						{/each}
					</select>
				</div>
				<form
					method="POST"
					action="?/salvarSupervisores"
					use:enhance={handleSalvarSupervisores}
					class="flex gap-2"
				>
					<input type="hidden" name="supervisor_id" value={supervisorId ?? ''} />
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
						onclick={() => (editandoSupervisores = false)}
					>
						Cancelar
					</button>
				</form>
			{:else}
				<div
					class="p-4 rounded-xl bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700"
				>
					<div class="flex items-center justify-between">
						<p class="font-semibold text-surface-900 dark:text-surface-100">
							{gise.supervisor_nome ?? 'Não definido'}
						</p>
						{#if documentoAssinadoInfo?.existe}
							<span
								class="text-sm px-2 py-0.5 rounded-full bg-success-500/20 text-success-700 dark:text-success-400 font-bold"
								>ASSINADA</span
							>
						{:else}
							<span
								class="text-sm px-2 py-0.5 rounded-full bg-warning-500/20 text-warning-700 dark:text-warning-400 font-bold"
								>PENDENTE</span
							>
						{/if}
					</div>
					{#if documentoAssinadoInfo?.existe}
						<div class="mt-2 text-sm text-surface-500 space-y-1">
							<p>
								Assinado por: <span class="text-surface-900 dark:text-surface-100 font-medium"
									>{documentoAssinadoInfo.assinante_nome}</span
								>
							</p>
							<a
								href={`/api/gise/${gise.id}/documento-assinado`}
								target="_blank"
								class="text-primary-600 hover:underline font-semibold flex items-center gap-1 mt-1"
							>
								<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
									/></svg
								>
								Baixar PDF Assinado
							</a>
						</div>
					{/if}
					{#if isAdminGeral || isSeccional}
						<a
							href={`/api/gise/${gise.id}/download?format=pdf`}
							target="_blank"
							class="text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 hover:underline text-sm flex items-center gap-1 mt-1"
						>
							<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
								/></svg
							>
							PDF sem Assinatura
						</a>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Banners de Sucesso (Assinaturas) -->
		<div class="space-y-3">
			<!-- Card de Escala Assinada -->
			{#if documentoAssinadoInfo?.existe}
				<div
					class="rounded-2xl border border-success-500/30 bg-success-500/10 p-5 flex items-start gap-4 shadow-sm"
				>
					<div class="bg-success-500 text-white p-2 rounded-full mt-1">
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="3"
								d="M5 13l4 4L19 7"
							/></svg
						>
					</div>
					<div class="flex-1">
						<h3 class="font-bold text-success-800 dark:text-success-400 uppercase tracking-tight">
							Escala GISE Assinada
						</h3>
						<p class="text-sm text-surface-600 dark:text-surface-300 mt-1 font-medium">
							Assinado por {documentoAssinadoInfo.assinante_nome}.
						</p>
					</div>
				</div>
			{/if}

			<!-- Relatórios Extraordinários Assinados -->
			{#if data.assinaturasRelatorios?.length > 0}
				{#each data.assinaturasRelatorios.filter((a: any) => a.tipo === 'extraordinario') as assRel}
					<div
						class="rounded-2xl border border-success-500/30 bg-success-500/10 p-5 flex items-start gap-4 shadow-sm"
					>
						<div class="bg-success-500 text-white p-2 rounded-full mt-1">
							<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="3"
									d="M5 13l4 4L19 7"
								/></svg
							>
						</div>
						<div class="flex-1">
							<h3 class="font-bold text-success-800 dark:text-success-400 uppercase tracking-tight">
								Relatório Extraordinário Assinado
							</h3>
							<p class="text-sm text-surface-600 dark:text-surface-300 mt-1 font-medium">
								Assinado por {assRel.assinante_nome}.
							</p>
						</div>
					</div>
				{/each}
			{/if}
		</div>

		<!-- Seção de assinatura (Supervisor) -->
		{#if podeAssinar}
			<div id="secao-assinatura-digital" class="space-y-6">
				<h3
					class="flex items-center gap-2 text-lg font-bold uppercase tracking-widest text-primary-500"
				>
					<svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
						/></svg
					>
					Assinar Escala GISE
				</h3>

				<div class="grid grid-cols-1 gap-6">
					<!-- 1. ASSINATURA MANUAL (TELA/MOBILE) -->
					<div
						class="card p-5 bg-surface-100/50 dark:bg-surface-800/40 border-2 {isMobile ||
						!data.restringirSmartphone
							? 'border-primary-500/30'
							: 'border-surface-200 dark:border-white/5 opacity-60'} rounded-3xl flex flex-col justify-start gap-5 shadow-xl transition-all"
					>
						<button
							type="button"
							class="w-full text-left flex flex-col gap-2"
							onclick={() => (expandirManual = !expandirManual)}
						>
							<div class="flex items-center justify-between">
								<h4
									class="font-bold text-sm flex items-center gap-2 text-surface-900 dark:text-surface-50"
								>
									<svg
										class="w-5 h-5 {isMobile || !data.restringirSmartphone
											? 'text-primary-500'
											: 'text-surface-400'}"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
										/>
									</svg>
									Assinar na Tela (Manual)
								</h4>
								<div class="flex items-center gap-3">
									{#if isMobile || !data.restringirSmartphone}
										<span
											class="badge preset-filled-primary-500 text-[0.6rem] uppercase font-black px-2 py-0.5"
											>Disponível</span
										>
									{:else}
										<span
											class="badge bg-surface-200 dark:bg-surface-700 text-surface-500 text-[0.6rem] uppercase font-black px-2 py-0.5"
											>Indisponível no PC</span
										>
									{/if}
									<svg
										class="w-4 h-4 text-surface-400 transition-transform duration-300 {expandirManual
											? 'rotate-180'
											: ''}"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M19 9l-7 7-7-7"
										/>
									</svg>
								</div>
							</div>
							<p class="text-xs text-surface-500 leading-relaxed">
								Gera o PDF com sua rubrica manual desenhada diretamente na tela do seu dispositivo. <strong
									>Ideal para tablets e smartphones.</strong
								>
							</p>
						</button>

						{#if expandirManual}
							<div class="pt-4 border-t border-surface-200 dark:border-white/5 flex flex-col gap-5">
								{#if isMobile || !data.restringirSmartphone}
									<button
										type="button"
										class="btn preset-filled-primary-500 w-full py-3 rounded-2xl font-bold uppercase text-xs shadow-lg shadow-primary-500/20 hover:scale-[1.02] active:scale-95 transition-all"
										disabled={loading.active}
										onclick={() => abrirModalRubrica('simples')}
									>
										Abrir Painel de Rubrica
									</button>
								{:else}
									<div class="flex-1 flex items-center">
										<div class="bg-error-500/10 p-3 rounded-xl border border-error-500/20 w-full">
											<p
												class="text-[0.7rem] text-error-600 dark:text-error-400 font-bold uppercase text-center leading-tight"
											>
												A assinatura em tela é restrita a dispositivos móveis. Utilize o Token A3 no
												computador.
											</p>
										</div>
									</div>
								{/if}
							</div>
						{/if}
					</div>

					<!-- 2. ASSINATURA DIGITAL (TOKEN A3) -->
					<div
						class="card p-5 bg-surface-100/50 dark:bg-surface-800/40 border-2 {!isMobile &&
						data.restringirSmartphone
							? 'border-tertiary-500/30'
							: 'border-surface-200 dark:border-white/5'} rounded-3xl flex flex-col justify-start gap-5 shadow-xl transition-all"
					>
						<button
							type="button"
							class="w-full text-left flex flex-col gap-2"
							onclick={() => (expandirDigital = !expandirDigital)}
						>
							<div class="flex items-center justify-between">
								<h4
									class="font-bold text-sm flex items-center gap-2 text-surface-900 dark:text-surface-50"
								>
									<svg
										class="w-5 h-5 {!isMobile || data.restringirSmartphone
											? 'text-tertiary-500'
											: 'text-surface-400'}"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
										/>
									</svg>
									Assinatura Digital (Token A3)
								</h4>
								<div class="flex items-center gap-3">
									{#if !isMobile}
										<span
											class="badge preset-filled-tertiary-500 text-[0.6rem] uppercase font-black px-2 py-0.5"
											>Recomendado</span
										>
									{:else}
										<span
											class="badge bg-surface-200 dark:bg-surface-700 text-surface-500 text-[0.6rem] uppercase font-black px-2 py-0.5"
											>Apenas Desktop</span
										>
									{/if}
									<svg
										class="w-4 h-4 text-surface-400 transition-transform duration-300 {expandirDigital
											? 'rotate-180'
											: ''}"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M19 9l-7 7-7-7"
										/>
									</svg>
								</div>
							</div>
							<p class="text-xs text-surface-500 leading-relaxed">
								Assinatura com validade <strong>Qualificada (ICP-Brasil)</strong> usando seu certificado
								digital físico. Requer o Assinador Desktop instalado no computador.
							</p>
						</button>

						{#if expandirDigital}
							<div class="pt-4 border-t border-surface-200 dark:border-white/5 flex flex-col gap-5">
								<PainelAssinaturaToken
									bind:control={painelTokenGise}
									bind:signerName={serproSignerName}
									bind:signerCpf={serproSignerCpf}
									signerEmail={data.usuarioAtual?.email ?? undefined}
									prepararUrl="/api/gise/{gise.id}/preparar-assinatura"
									finalizarUrl="/api/gise/{gise.id}/finalizar-assinatura"
									nomeArquivo="gise_{gise.data_inicio}_assinada.pdf"
									extraPayload={{ rubrica: rubricaCapturada }}
									disabled={loading.active}
									onSuccess={async () => {
										rubricaCapturada = null;
										await invalidate(page.url.href);
									}}
								/>

								{#if isMobile}
									<div
										class="bg-surface-200 dark:bg-surface-700/30 p-3 rounded-xl border border-surface-300 dark:border-surface-600/30"
									>
										<p
											class="text-[0.65rem] text-surface-500 font-bold uppercase text-center leading-tight"
										>
											Certificados físicos (USB/Token/Cartão) só podem ser lidos em computadores.
										</p>
									</div>
								{/if}
							</div>
						{/if}
					</div>
				</div>
			</div>
		{/if}

		<!-- Bloco de Lote de Assinaturas Extraordinárias (Supervisor) -->
		{#if pendentesExtra.length > 0}
			<div
				class="rounded-2xl border border-warning-500/30 bg-warning-50 dark:bg-warning-900/10 p-5 mb-5 shadow-sm space-y-4"
			>
				<div>
					<h3 class="font-bold text-warning-800 dark:text-warning-400 flex items-center gap-2">
						<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
							/></svg
						>
						Assinaturas Pendentes
					</h3>
					<p class="text-sm text-warning-700 dark:text-warning-300 mt-1">
						Você possui <strong>{pendentesExtra.length} relatório(s) extraordinário(s)</strong> aptos
						para assinatura em lote.
					</p>
				</div>

				{#if assinandoLote}
					<div
						class="flex flex-col items-center gap-1 bg-white/50 dark:bg-surface-800/50 p-6 rounded-3xl border border-warning-500/20 shadow-xl"
					>
						<div class="text-xs font-bold text-warning-700 uppercase tracking-widest mb-2">
							{etapaAssinatura}
						</div>
						<div
							class="w-full bg-surface-200 dark:bg-surface-700 rounded-full h-3 overflow-hidden shadow-inner"
						>
							<div
								class="bg-warning-500 h-full transition-all duration-500 ease-out flex items-center justify-center text-[0.5rem] text-white font-bold"
								style="width: {(progressoLote.atual / progressoLote.total) * 100}%"
							>
								{Math.round((progressoLote.atual / progressoLote.total) * 100)}%
							</div>
						</div>
						<div class="mt-2 text-[0.6rem] text-surface-500 font-medium">
							Item {progressoLote.atual} de {progressoLote.total}
						</div>
					</div>
				{:else}
					<div class="flex flex-col gap-4">
						<!-- Lote Manual -->
						<div
							class="card p-4 bg-white/40 dark:bg-surface-800/40 border border-warning-500/20 rounded-2xl flex flex-col gap-3 shadow-sm"
						>
							<button
								type="button"
								class="w-full text-left flex items-center justify-between"
								onclick={() => (expandirLoteManual = !expandirLoteManual)}
							>
								<div class="flex items-center gap-2">
									<div class="p-1.5 bg-warning-500/10 rounded-lg text-warning-600">
										<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
											/>
										</svg>
									</div>
									<h4
										class="font-bold text-xs text-warning-800 dark:text-warning-400 uppercase tracking-tight"
									>
										Assinatura Manual (Lote - Tela)
									</h4>
								</div>
								<svg
									class="w-4 h-4 text-warning-400 transition-transform duration-300 {expandirLoteManual
										? 'rotate-180'
										: ''}"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M19 9l-7 7-7-7"
									/>
								</svg>
							</button>

							{#if expandirLoteManual}
								<div class="pt-3 border-t border-warning-500/10 flex flex-col gap-3">
									<p class="text-[0.65rem] text-surface-500 leading-tight">
										Aplica sua rubrica manual em todos os relatórios extraordinários pendentes de
										uma só vez.
									</p>
									{#if isMobile || !data.restringirSmartphone}
										<button
											type="button"
											class="btn btn-sm preset-filled-warning-500 font-bold w-full flex items-center justify-center gap-2 py-2 rounded-xl"
											onclick={() => abrirAssinaturaLote()}
										>
											<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
												><path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
												/></svg
											>
											Assinar Agora
										</button>
									{:else}
										<div class="bg-error-500/5 p-2 rounded-lg border border-error-500/10">
											<p class="text-[0.6rem] text-error-600 font-bold uppercase text-center">
												Indisponível no PC. Use o Token A3.
											</p>
										</div>
									{/if}
								</div>
							{/if}
						</div>

						<!-- Lote Digital -->
						<div
							class="card p-4 bg-white/40 dark:bg-surface-800/40 border border-warning-500/20 rounded-2xl flex flex-col gap-3 shadow-sm"
						>
							<button
								type="button"
								class="w-full text-left flex items-center justify-between"
								onclick={() => (expandirLoteDigital = !expandirLoteDigital)}
							>
								<div class="flex items-center gap-2">
									<div class="p-1.5 bg-tertiary-500/10 rounded-lg text-tertiary-600">
										<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
											/>
										</svg>
									</div>
									<h4
										class="font-bold text-xs text-tertiary-700 dark:text-tertiary-400 uppercase tracking-tight"
									>
										Assinatura Digital (Lote - Token A3)
									</h4>
								</div>
								<svg
									class="w-4 h-4 text-tertiary-400 transition-transform duration-300 {expandirLoteDigital
										? 'rotate-180'
										: ''}"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M19 9l-7 7-7-7"
									/>
								</svg>
							</button>

							{#if expandirLoteDigital}
								<div class="pt-3 border-t border-warning-500/10 flex flex-col gap-3">
									<p class="text-[0.65rem] text-surface-500 leading-tight">
										Assine todos os relatórios digitalmente usando seu Token A3 através do assinador
										SERPRO.
									</p>
									{#if !isMobile}
										<div class="flex flex-col gap-2">
											<button
												type="button"
												class="btn btn-sm preset-filled-tertiary-500 font-bold w-full flex items-center justify-center gap-2 py-2 rounded-xl"
												onclick={() => executarAssinarRelatorioLoteSERPRO()}
												disabled={loading.active}
											>
												Assinar Lote com SERPRO
											</button>
											<p class="text-[0.55rem] text-surface-400 italic text-center">
												Requer o <a
													href="https://www.serpro.gov.br/links-fixos-superiores/assinador-digital/assinador-serpro"
													target="_blank"
													class="underline">Assinador Desktop</a
												> instalado e aberto.
											</p>
										</div>
									{:else}
										<div
											class="bg-surface-200 dark:bg-surface-700/30 p-2 rounded-xl border border-surface-300 dark:border-surface-600/30"
										>
											<p
												class="text-[0.6rem] text-surface-500 font-bold uppercase text-center leading-tight"
											>
												Certificados físicos só podem ser lidos em computadores.
											</p>
										</div>
									{/if}
								</div>
							{/if}
						</div>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Seccionais -->
		<div>
			<h2 class="font-semibold text-surface-900 dark:text-surface-50 mb-3">
				Seccionais ({gise.seccionais?.length ?? 0})
			</h2>

			{#each gise.seccionais ?? [] as sec}
				{#if isAdminGeral || isSupervisor || sec.seccional_id === minhaSeccionalId}
					<div
						class="rounded-2xl border border-surface-200 dark:border-surface-800 mb-4 overflow-hidden"
					>
						<!-- Cabeçalho da seccional -->
						<div
							class="flex flex-wrap items-start gap-y-2 justify-between px-5 py-3 bg-surface-100 dark:bg-surface-800"
						>
							<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
								<span class="font-semibold text-surface-900 dark:text-surface-50 text-sm">
									{sec.seccional_nome}
								</span>
								{@render statusBadge(sec.status, true)}
								{#if editandoHorariosSecId === sec.id}
									<div class="flex flex-wrap items-center gap-2">
										<input
											type="text"
											placeholder="08:00"
											class="w-20 px-2 py-1 text-sm rounded border bg-white dark:bg-surface-900 {editSecHoraEnt &&
											!validarHora(editSecHoraEnt)
												? 'border-error-500'
												: 'border-surface-300 dark:border-surface-600'}"
											bind:value={editSecHoraEnt}
										/>
										<span class="opacity-30">-</span>
										<input
											type="text"
											placeholder="16:00"
											class="w-20 px-2 py-1 text-sm rounded border bg-white dark:bg-surface-900 {editSecHoraSai &&
											!validarHora(editSecHoraSai)
												? 'border-error-500'
												: 'border-surface-300 dark:border-surface-600'}"
											bind:value={editSecHoraSai}
										/>
										<form
											method="POST"
											action="?/salvarHorariosSec"
											use:enhance={handleSalvarHorariosSec}
											class="contents"
										>
											<input type="hidden" name="secId" value={sec.id} />
											<input
												type="hidden"
												name="hora_entrada"
												value={normalizarHora(editSecHoraEnt) ?? ''}
											/>
											<input
												type="hidden"
												name="hora_saida"
												value={normalizarHora(editSecHoraSai) ?? ''}
											/>
											<button
												type="submit"
												class="btn btn-sm preset-filled-primary-500 text-sm py-1 px-2 rounded"
												>✓</button
											>
										</form>
										<button
											type="button"
											class="btn btn-sm preset-outlined-surface text-sm py-1 px-2 rounded"
											onclick={() => (editandoHorariosSecId = null)}>×</button
										>
									</div>
								{:else}
									<div class="flex items-center gap-1.5 text-sm text-surface-500 font-medium ml-2">
										<span
											>{sec.hora_entrada ?? gise.hora_entrada}h-{sec.hora_saida ??
												gise.hora_saida}h</span
										>
										{#if sec.hora_entrada || sec.hora_saida}
											<span
												class="ml-1 px-1 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold border border-amber-500/20"
												>PERSONALIZADO</span
											>
										{/if}
									</div>
									{#if isAdminGeral && podeEditar && modoEdicaoGeral}
										<button
											type="button"
											class="btn btn-sm border border-violet-500 hover:bg-violet-500/10 dark:border-violet-400 dark:hover:bg-violet-400/10 w-full sm:w-auto flex items-center justify-center gap-1 whitespace-nowrap transition-all"
											onclick={() => {
												editandoHorariosSecId = sec.id;
												editSecHoraEnt = sec.hora_entrada ?? gise.hora_entrada ?? '';
												editSecHoraSai = sec.hora_saida ?? gise.hora_saida ?? '';
											}}
										>
											<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
												><path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
												/></svg
											>
											Editar horários desta seccional
										</button>
									{/if}
								{/if}
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
										Excluir
									</button>
								</form>
							{/if}
						</div>

						<!-- Ações Seccional & Downloads -->
						<div
							class="flex flex-col sm:flex-row sm:items-center gap-4 px-5 pb-3 bg-surface-100 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700"
						>
							{#if podeDownload}
								{@const assRel = data.assinaturasRelatorios?.find(
									(a: any) =>
										(a.seccional_id === sec.seccional_id || a.seccional_id === sec.id) &&
										a.tipo === 'extraordinario'
								)}
								<div class="flex flex-col sm:flex-row gap-2 sm:gap-3">
									{#each [...new Set((sec.equipes ?? []).map((eq: any) => eq.tipo))] as tipo}
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
												? 'pointer-events-none opacity-60 border-transparent'
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
														'Ass. Indiv.',
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
														'Ass. Digital',
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
													(sec.unidades ?? []).some((s: any) => s.unidade_id === null) ||
													(sec.unidades ?? []).some(
														(s: any) =>
															!(s.equipes ?? []).some((eq: any) => (eq.membros ?? []).length > 0)
													)}
												title={(sec.unidades ?? []).length === 0
													? 'Adicione ao menos uma unidade antes de finalizar'
													: (sec.unidades ?? []).some((s: any) => s.unidade_id === null)
														? 'Todos os slots devem ter uma unidade selecionada'
														: (sec.unidades ?? []).some(
																	(s: any) =>
																		!(s.equipes ?? []).some(
																			(eq: any) => (eq.membros ?? []).length > 0
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

						<div class="p-5 space-y-4">
							<!-- ===== Slots de Unidade ===== -->
							{#each sec.unidades ?? [] as slot (slot.id)}
								<div
									class="rounded-xl border border-primary-300/50 dark:border-primary-700/40 bg-primary-500/5 overflow-hidden"
								>
									<!-- Cabeçalho do slot: nome da unidade ou seleção -->
									<div
										class="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-primary-300/30 dark:border-primary-700/30"
									>
										<div class="flex items-center gap-2 min-w-0">
											{#if slot.nome}
												<span
													class="font-semibold text-sm text-surface-900 dark:text-surface-100 truncate"
													>{slot.nome}</span
												>
											{:else if isSeccional && sec.seccional_id === minhaSeccionalId && podeEditar && (modoEdicaoSeccional || sec.status === 'pendente' || sec.status === 'retificada')}
												<!-- Admin Seccional seleciona a unidade para este slot -->
												{#if selecionandoUnidadeSlotId === slot.id}
													<div class="flex flex-wrap gap-2 items-center">
														<select
															bind:value={slotUnidadeId}
															class="flex-1 min-w-40 px-2 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
														>
															<option value="">Selecionar unidade...</option>
															{#each todasUnidades.filter((d: any) => d.tipo === 'delegacia' && d.seccional_id === sec.seccional_id && !(sec.unidades ?? []).some((s: any) => s.unidade_id === d.id && s.id !== slot.id)) as d}
																<option value={d.id}>{d.nome}</option>
															{/each}
														</select>
														<form
															method="POST"
															action="?/selecionarUnidade"
															use:enhance={handleSelecionarUnidade}
															class="flex gap-2 shrink-0"
														>
															<input type="hidden" name="slotId" value={slot.id} />
															<input type="hidden" name="unidadeId" value={slotUnidadeId} />
															<button
																type="submit"
																class="btn preset-filled-primary-500 text-sm px-3 py-1.5 rounded-xl"
																disabled={!slotUnidadeId || pendingCrud}
															>
																{pendingCrud ? 'Salvando...' : 'Confirmar'}
															</button>
														</form>
														<button
															type="button"
															class="btn preset-outlined-surface text-sm px-3 py-1.5 rounded-xl"
															onclick={() => {
																selecionandoUnidadeSlotId = null;
																slotUnidadeId = '';
															}}
														>
															Cancelar
														</button>
													</div>
												{:else}
													<button
														type="button"
														class="btn preset-outlined-warning-500 text-sm px-3 py-1.5 rounded-xl flex items-center gap-1.5"
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
														Selecionar unidade
													</button>
												{/if}
											{:else}
												<span class="text-sm text-surface-400 italic">Unidade não definida</span>
											{/if}
										</div>

										<!-- Admin Geral: remover slot -->
										{#if isAdminGeral && podeEditar && modoEdicaoGeral}
											<form
												method="POST"
												action="?/removerUnidade"
												use:enhance={handleRemoverUnidade}
												class="shrink-0"
											>
												<input type="hidden" name="secId" value={sec.id} />
												<input type="hidden" name="linkId" value={slot.id} />
												<button
													type="submit"
													class="btn btn-sm preset-outlined-error-500 text-sm px-2 py-1 rounded-lg flex items-center gap-1 whitespace-nowrap"
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
													Remover slot
												</button>
											</form>
										{/if}
									</div>

									<!-- Equipes do slot -->
									<div class="p-4 space-y-3">
										{#each slot.equipes ?? [] as equipe}
											<div
												class="rounded-xl border border-surface-300 dark:border-surface-600 p-4 bg-surface-50 dark:bg-surface-900/80 shadow-sm"
											>
												<div class="flex flex-wrap items-start gap-y-1 justify-between mb-3">
													<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
														<span
															class="text-sm font-semibold text-surface-900 dark:text-surface-100 capitalize"
														>
															Equipe {equipe.tipo === 'operacional' ? 'Operacional' : 'SEINT'}
														</span>
														{#if editandoEquipe === equipe.id}
															<div class="flex items-center gap-1.5">
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
																		class="btn preset-filled-primary-500 text-sm px-2 py-1 rounded-lg"
																		disabled={pendingCrud}
																		>{pendingCrud ? 'Salvando...' : 'Salvar'}</button
																	>
																</form>
																<button
																	type="button"
																	class="btn preset-outlined-surface text-sm px-2 py-1 rounded-lg"
																	onclick={() => (editandoEquipe = null)}>×</button
																>
															</div>
														{:else}
															<span class="text-sm text-surface-500"
																>{equipe.slots_dpc} DPC + {equipe.slots_oip} OIP</span
															>
															{#if editandoHorariosEquipeId === equipe.id}
																<div class="flex flex-wrap items-center gap-2">
																	<input
																		type="text"
																		placeholder="08:00"
																		class="w-20 px-2 py-1 text-sm rounded border bg-white dark:bg-surface-900 {editEqHoraEnt &&
																		!validarHora(editEqHoraEnt)
																			? 'border-error-500'
																			: 'border-surface-300 dark:border-surface-600'}"
																		bind:value={editEqHoraEnt}
																	/>
																	<span class="opacity-30">-</span>
																	<input
																		type="text"
																		placeholder="16:00"
																		class="w-20 px-2 py-1 text-sm rounded border bg-white dark:bg-surface-900 {editEqHoraSai &&
																		!validarHora(editEqHoraSai)
																			? 'border-error-500'
																			: 'border-surface-300 dark:border-surface-600'}"
																		bind:value={editEqHoraSai}
																	/>
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
																		class="btn btn-sm preset-outlined-surface text-sm py-1 px-2 rounded"
																		onclick={() => (editandoHorariosEquipeId = null)}>×</button
																	>
																</div>
															{:else}
																<div
																	class="flex items-center gap-1.5 text-sm text-surface-400 font-medium ml-2"
																>
																	<span
																		>{equipe.hora_entrada ??
																			sec.hora_entrada ??
																			gise.hora_entrada}h-{equipe.hora_saida ??
																			sec.hora_saida ??
																			gise.hora_saida}h</span
																	>
																	{#if equipe.hora_entrada || equipe.hora_saida}
																		<span
																			class="ml-1 px-1 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold border border-amber-500/20 uppercase"
																			>Horário Equipe</span
																		>
																	{/if}
																</div>
																{#if isAdminGeral && podeEditar && modoEdicaoGeral}
																	<button
																		type="button"
																		class="btn btn-sm border border-violet-500 hover:bg-violet-500/10 dark:border-violet-400 dark:hover:bg-violet-400/10 w-full sm:w-auto flex items-center justify-center gap-1 whitespace-nowrap transition-all"
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
																				d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
																			/></svg
																		>
																		Editar horários desta equipe
																	</button>
																{/if}
															{/if}
															{#if isAdminGeral && podeEditar && modoEdicaoGeral}
																<button
																	type="button"
																	class="btn btn-sm preset-outlined-warning-500 w-full sm:w-auto flex items-center justify-center gap-1 whitespace-nowrap"
																	onclick={() => {
																		editandoEquipe = equipe.id;
																		editSlotsDpc = equipe.slots_dpc;
																		editSlotsOip = equipe.slots_oip;
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
																			d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
																		/></svg
																	>
																	Editar vagas desta equipe
																</button>
															{/if}
														{/if}
													</div>
													{#if isAdminGeral && podeEditar && modoEdicaoGeral}
														<form
															method="POST"
															action="?/removerEquipe"
															use:enhance={handleRemoverEquipe}
															class="w-full sm:w-auto"
														>
															<input type="hidden" name="equipeId" value={equipe.id} />
															<button
																type="submit"
																class="btn btn-sm preset-outlined-error-500 w-full sm:w-auto flex items-center justify-center gap-1 whitespace-nowrap"
																disabled={pendingCrud}
															>
																{pendingCrud ? 'Removendo...' : 'Remover equipe'}
															</button>
														</form>
													{/if}
												</div>

												<!-- Membros -->
												{#if equipe.membros?.length}
													<div class="space-y-1 mb-3">
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
																	>
																		<input type="hidden" name="memId" value={m.id} />
																		<button
																			type="submit"
																			class="text-error-500 hover:text-error-400 transition-colors p-1.5 -mr-1.5 touch-manipulation"
																			disabled={removendoMembroId === m.id}
																			>{pendingCrud ? '...' : '×'}</button
																		>
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
															<div class="flex flex-wrap gap-2 items-end">
																<div class="flex-1 min-w-32">
																	<select
																		bind:value={policialParaAdicionar}
																		class="w-full px-2 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
																	>
																		<option value="">Selecionar {cargoParaAdicionar}...</option>
																		{#each policiais.filter((p: any) => p.cargo === cargoParaAdicionar) as p}
																			<option value={p.id}>{p.nome} ({p.matricula})</option>
																		{/each}
																	</select>
																</div>
																<button
																	type="submit"
																	class="btn preset-filled-primary-500 text-sm px-2 py-1.5 rounded-lg"
																	disabled={!policialParaAdicionar || pendingCrud}>Adicionar</button
																>
																<button
																	type="button"
																	class="btn preset-outlined-surface text-sm px-2 py-1.5 rounded-lg"
																	onclick={() => {
																		equipeParaAdicionar = null;
																		policialParaAdicionar = '';
																		cargoParaAdicionar = null;
																	}}>×</button
																>
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
												{#each todasUnidades.filter((d: any) => d.tipo === 'delegacia' && d.seccional_id === sec.seccional_id && !(sec.unidades ?? []).some((s: any) => s.unidade_id === d.id)) as d}
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
										+ Adicionar unidade
									</button>
								{/if}
							{/if}
						</div>
					</div>
				{/if}
			{/each}

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

		<!-- Aviso para Admin Seccional sobre retificação -->
		{#if isSeccional && minhaSeccional?.status === 'retificada'}
			<div class="rounded-2xl border border-warning-500/40 bg-warning-500/10 p-4 text-sm">
				<p class="font-semibold text-warning-700 dark:text-warning-400">⚠️ Seccional Retificada</p>
				<p class="text-warning-600 dark:text-warning-300 mt-1 text-sm">
					Você realizou alterações após o envio. A assinatura digital da escala foi revogada.
					Finalize o envio novamente para prosseguir com a assinatura.
				</p>
			</div>
		{/if}

		<!-- Aviso: Supervisor aguardando seccionais -->
		{#if isSupervisor && gise.status === 'em_preenchimento'}
			<div class="rounded-2xl border border-warning-500/30 bg-warning-500/5 p-5 text-center">
				<p class="text-warning-700 dark:text-warning-400 text-sm font-medium">
					A escala ainda não está concluída pelas seccionais.
				</p>
			</div>
		{/if}
	{/if}
</div>

<!-- Modal Editar Data/Horários -->
{#if showModalDataHoras}
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
					bind:value={editDataInicio}
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
							bind:value={editHoraEntrada}
							class="w-full px-3 py-2 rounded-xl border bg-white dark:bg-surface-800 text-sm {editHoraEntrada &&
							!validarHora(editHoraEntrada)
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
							bind:value={editHoraSaida}
							class="w-full px-3 py-2 rounded-xl border bg-white dark:bg-surface-800 text-sm {editHoraSaida &&
							!validarHora(editHoraSaida)
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
					onclick={() => (showModalDataHoras = false)}>Cancelar</button
				>
				<form
					method="POST"
					action="?/salvarDatasHorarios"
					use:enhance={handleSalvarDatasHorarios}
					class="contents"
				>
					<input type="hidden" name="data_inicio" value={editDataInicio} />
					<input type="hidden" name="hora_entrada" value={normalizarHora(editHoraEntrada) ?? ''} />
					<input type="hidden" name="hora_saida" value={normalizarHora(editHoraSaida) ?? ''} />
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

<!-- Modal Confirmar Exclusão GISE -->
{#if showExcluirGiseConfirm}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
		<div
			class="bg-surface-50 dark:bg-surface-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4"
		>
			<h2 class="text-lg font-bold text-surface-900 dark:text-surface-50">Excluir Escala GISE</h2>
			<p class="text-sm text-surface-600 dark:text-surface-400">
				Esta ação é <strong>irreversível</strong>. Todos os dados desta escala GISE serão
				permanentemente removidos, incluindo equipes, membros e assinatura digital.
			</p>
			<div class="flex justify-end gap-3">
				<button
					type="button"
					class="btn preset-outlined-surface text-sm px-4 py-2 rounded-xl"
					onclick={() => (showExcluirGiseConfirm = false)}>Cancelar</button
				>
				<form method="POST" action="?/excluirGise" use:enhance={handleExcluirGise} class="contents">
					<button
						type="submit"
						class="btn preset-filled-error-500 text-sm px-4 py-2 rounded-xl"
						disabled={pendingCrud}
					>
						{pendingCrud ? 'Excluindo...' : 'Confirmar Exclusão'}
					</button>
				</form>
			</div>
		</div>
	</div>
{/if}

<!-- Confirmar Reabrir -->
{#if showReabrirConfirm}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
		<div
			class="bg-surface-50 dark:bg-surface-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4"
		>
			<h2 class="text-lg font-bold text-surface-900 dark:text-surface-50">Reabrir Escala GISE</h2>
			<p class="text-sm text-surface-600 dark:text-surface-400">
				A assinatura digital será <strong>revogada</strong> e será necessário que o supervisor assine
				novamente.
			</p>
			<div class="flex justify-end gap-3">
				<button
					type="button"
					class="btn preset-outlined-surface text-sm px-4 py-2 rounded-xl"
					onclick={() => (showReabrirConfirm = false)}>Cancelar</button
				>
				<form
					method="POST"
					action="?/reabrirEscala"
					use:enhance={handleReabrirEscala}
					class="contents"
				>
					<button
						type="submit"
						class="btn preset-filled-warning-500 text-sm px-4 py-2 rounded-xl"
						disabled={pendingCrud}
					>
						{pendingCrud ? 'Reabrindo...' : 'Confirmar Reabertura'}
					</button>
				</form>
			</div>
		</div>
	</div>
{/if}

<!-- Confirmar Finalizar -->
{#if showFinalizarConfirm}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
		<div
			class="bg-surface-50 dark:bg-surface-900 rounded-3xl shadow-2xl w-full max-w-md p-8 space-y-6 border border-white/10"
		>
			<div class="text-center space-y-2">
				<h2 class="text-2xl font-bold text-surface-900 dark:text-surface-50">
					Finalizar Escala GISE
				</h2>
				<p class="text-sm text-surface-500">
					A escala atual será marcada como <span
						class="font-bold text-surface-900 dark:text-surface-50 uppercase">Finalizada</span
					>. Esta ação não poderá ser desfeita e a escala sairá da lista de escalas ativas.
				</p>
			</div>

			<div class="pt-2">
				<form
					method="POST"
					action="?/finalizarGise"
					use:enhance={handleFinalizarGise}
					class="contents"
				>
					<button
						type="submit"
						class="w-full btn py-4 rounded-2xl flex items-center justify-center gap-2 group transition-all duration-300 bg-error-500 hover:bg-error-600 text-white font-bold"
						disabled={pendingCrud}
					>
						Finalizar Agora
					</button>
				</form>

				<button
					type="button"
					class="w-full text-sm text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors py-4 mt-2"
					onclick={() => (showFinalizarConfirm = false)}
					disabled={pendingCrud}
				>
					Cancelar e voltar
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Modal Assinatura Digital Individual de Relatório -->
{#if showDigitalModalRelatorio && relatorioDigitalInfo}
	<div
		class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md"
	>
		<div
			class="bg-surface-50 dark:bg-surface-900 rounded-3xl shadow-2xl w-full max-w-lg p-8 space-y-6 border border-white/10"
		>
			<div class="text-center space-y-2">
				<h2 class="text-2xl font-bold text-surface-900 dark:text-surface-50">
					Assinatura Digital Individual
				</h2>
				<p class="text-sm text-surface-500">
					Você está assinando o Relatório Extraordinário da seccional: <br />
					<strong class="text-surface-900 dark:text-surface-50"
						>{relatorioDigitalInfo.seccionalNome}</strong
					>
				</p>
			</div>

			<PainelAssinaturaToken
				bind:control={painelTokenRelatorio}
				bind:signerName={relatorioSignerName}
				bind:signerCpf={relatorioSignerCpf}
				signerEmail={data.usuarioAtual?.email ?? undefined}
				prepararUrl="/api/gise/{gise.id}/relatorios/{relatorioDigitalInfo.seccionalId}/preparar-assinatura"
				finalizarUrl="/api/gise/{gise.id}/relatorios/{relatorioDigitalInfo.seccionalId}/finalizar-assinatura"
				nomeArquivo="relatorio_extraordinario_{relatorioDigitalInfo.seccionalNome}.pdf"
				disabled={loading.active}
				onSuccess={async () => {
					showDigitalModalRelatorio = false;
					relatorioDigitalInfo = null;
					await invalidate(page.url.href);
				}}
			/>

			<button
				type="button"
				class="w-full btn preset-outlined-surface py-3 rounded-2xl text-sm"
				onclick={() => {
					showDigitalModalRelatorio = false;
					relatorioDigitalInfo = null;
				}}
				disabled={loading.active}
			>
				Cancelar e fechar
			</button>
		</div>
	</div>
{/if}

{#if showRubricaModal}
	<div
		class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md"
	>
		<div
			class="bg-surface-50 dark:bg-surface-900 rounded-3xl shadow-2xl w-full max-w-2xl p-4 sm:p-8 space-y-6 border border-white/10"
		>
			<div class="text-center space-y-2">
				<h2 class="text-2xl font-bold text-surface-900 dark:text-surface-50">
					Rubrica do Supervisor
				</h2>
				<p class="text-sm text-surface-500">
					Desenhe sua rubrica no quadro abaixo para assinar a escala.
				</p>
			</div>

			<SignaturePad
				onConfirm={confirmarRubrica}
				onCancel={() => (showRubricaModal = false)}
				exigirFoto={page.data.exigirFotoAssinatura ?? true}
				exigirGps={page.data.exigirGpsAssinatura ?? true}
				exigirCodigoEmail={page.data.exigirCodigoEmailAssinatura ?? false}
			/>

			<p class="text-sm text-surface-400 text-center italic">
				Esta rubrica será anexada permanentemente ao documento PDF desta escala.
			</p>
		</div>
	</div>
{/if}

<!-- Diálogo de confirmação para remover seccional -->
<Dialog
	open={dialogRemoverSeccionalAberto}
	onOpenChange={(e) => (dialogRemoverSeccionalAberto = e.open)}
>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm"
	>
		<div
			class="card p-6 max-w-sm w-full bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10"
		>
			<Dialog.Title class="text-lg font-bold mb-2">Remover seccional?</Dialog.Title>
			<Dialog.Description class="text-sm text-surface-600 dark:text-surface-300 mb-6">
				Todos os policiais escalados nesta seccional serão removidos. Esta ação não pode ser
				desfeita.
			</Dialog.Description>
			<div class="flex justify-end gap-3">
				<Dialog.CloseTrigger class="btn preset-outlined-surface-500">Cancelar</Dialog.CloseTrigger>
				<button
					type="button"
					class="btn preset-filled-error-500"
					onclick={confirmarRemoverSeccional}
				>
					Remover
				</button>
			</div>
		</div>
	</Dialog.Content>
</Dialog>
