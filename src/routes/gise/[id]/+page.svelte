<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { untrack } from 'svelte';
	import { toaster } from '$lib/toast';
	import { initWebPKI, listarCertificados, assinarHash, lerCertificado, type WebPKICertificate } from '$lib/webpki';
	import { conectarSerpro, type SerproSignerClient } from '$lib/serpro';

	import SignaturePad from '$lib/components/SignaturePad.svelte';
	import Spinner from '$lib/components/Spinner.svelte';

	let { data } = $props();

	const gise = $derived(data.gise);
	const policiais = $derived(data.policiais ?? []);
	const todasUnidades = $derived(data.todasUnidades ?? []);
	const papelGise = $derived(data.papelGise);
	const minhaSeccionalId = $derived(data.minhaSeccionalId);

	const isAdminGeral = $derived(papelGise === 'admin_geral');
	const isSeccional = $derived(papelGise === 'admin_seccional');
	const isSupervisor = $derived(papelGise === 'supervisor');

	// Minha seccional (para Admin Seccional)
	const minhaSeccional = $derived(
		isSeccional ? gise?.seccionais?.find((s: any) => s.seccional_id === minhaSeccionalId) : null
	);

	const todasSeccionaisPreenchidas = $derived(
		gise?.seccionais?.length > 0 && gise.seccionais.every((s: any) => s.status === 'preenchida')
	);

	// Estado de UI
	let salvando = $state(false);
	let assinando = $state(false);
	let finalizando = $state(false);
	let showFinalizarConfirm = $state(false);

	// Edição de supervisores (Admin Geral / Admin Seccional)
	let editandoSupervisores = $state(false);
	let supSabadoId = $state<number | null>(null);
	let supDomingoId = $state<number | null>(null);

	// Equipe selecionada para adicionar membro
	let equipeParaAdicionar = $state<number | null>(null);
	let policialParaAdicionar = $state<number | ''>('');
	let diaParaAdicionar = $state<'sabado' | 'domingo' | 'ambos'>('ambos');
	let cargoParaAdicionar = $state<'OIP' | 'DPC' | null>(null);
	let modoEdicaoSeccional = $state(false);

	// Edição de slots de equipe
	let editandoEquipe = $state<number | null>(null);
	let editSlotsDpc = $state(0);
	let editSlotsOip = $state(0);

	// Reabrir escala
	let reabrindo = $state(false);
	let showReabrirConfirm = $state(false);

	// Feature 5: Editar datas/horários e excluir GISE (Admin Geral)
	let editandoDatasHorarios = $state(false);
	let editDataInicio = $state('');
	let editDataFim = $state('');
	let editHoraEntradaSabado = $state('');
	let editHoraSaidaSabado = $state('');
	let editHoraEntradaDomingo = $state('');
	let editHoraSaidaDomingo = $state('');
	let showExcluirGiseConfirm = $state(false);
	let excluindo = $state(false);

	// Adicionar equipe
	let adicionandoEquipeSec = $state<number | null>(null);
	let novaEquipeTipo = $state<'operacional' | 'seint'>('operacional');
	let novaEquipeDpc = $state(1);
	let novaEquipeOip = $state(3);

	// Unidade operacional (Admin Seccional)
	let unidadeOperacionalId = $state<number | null>(null);
	let editandoUnidade = $state(false);

	// Gerenciamento de seccionais (Admin Geral)
	let seccionaisDisponiveis = $state<any[]>([]);
	let adicionandoSeccional = $state(false);
	let seccionalParaAdicionarIdx = $state<number | ''>('');

	// Feature: Horários customizados
	let editandoHorariosSecId = $state<number | null>(null);
	let editSecHoraEntSab = $state('');
	let editSecHoraSaiSab = $state('');
	let editSecHoraEntDom = $state('');
	let editSecHoraSaiDom = $state('');

	let editandoHorariosEquipeId = $state<number | null>(null);
	let editEqHoraEntSab = $state('');
	let editEqHoraSaiSab = $state('');
	let editEqHoraEntDom = $state('');
	let editEqHoraSaiDom = $state('');

	$effect(() => {
		if (gise) {
			supSabadoId = gise.supervisor_sabado_id ?? null;
			supDomingoId = gise.supervisor_domingo_id ?? null;
			if (minhaSeccional) {
				unidadeOperacionalId = minhaSeccional.unidade_operacional_id ?? null;
			}
		}
	});

	function statusLabel(status: string) {
		const m: Record<string, string> = {
			em_preenchimento: 'Em Preenchimento',
			aguardando_assinatura: 'Aguardando Assinatura',
			assinada: 'Assinada',
			finalizada: 'Finalizada',
			retificada: 'Preenchida (Retificada)'
		};
		return m[status] ?? status;
	}
	function statusColor(status: string) {
		const m: Record<string, string> = {
			em_preenchimento: 'bg-warning-500/15 text-warning-700 dark:text-warning-400',
			aguardando_assinatura: 'bg-primary-500/15 text-primary-700 dark:text-primary-400',
			assinada: 'bg-success-500/15 text-success-700 dark:text-success-400',
			finalizada: 'bg-surface-500/15 text-surface-600 dark:text-surface-400'
		};
		return m[status] ?? '';
	}
	function fmtDate(iso: string) {
		const [y, m, d] = iso.split('-');
		return `${d}/${m}/${y}`;
	}

	const dpcs = $derived(policiais.filter((p: any) => p.cargo === 'DPC'));

	function checkAllSigned(sec: any, diaTarget: 'sabado' | 'domingo') {
		const members = (sec.equipes ?? []).flatMap((eq: any) => eq.membros ?? []);
		const relevantMembers = members.filter((m: any) => m.dia === 'ambos' || m.dia === diaTarget);
		if (relevantMembers.length === 0) return false;
		return relevantMembers.every((m: any) => {
			const presenca = m.presencas?.find((p: any) => p.dia === diaTarget);
			return presenca?.entrada_timestamp && presenca?.saida_timestamp;
		});
	}

	function getFaltandoRubrica(sec: any, diaTarget: 'sabado' | 'domingo') {
		const members = (sec.equipes ?? []).flatMap((eq: any) => eq.membros ?? []);
		const relevantMembers = members.filter((m: any) => m.dia === 'ambos' || m.dia === diaTarget);
		const faltantes = relevantMembers.filter((m: any) => {
			const p = m.presencas?.find((pr: any) => pr.dia === diaTarget);
			return !p?.entrada_timestamp || !p?.saida_timestamp;
		});
		if (faltantes.length === 0) return '';
		return 'Faltando rubrica de: ' + faltantes.map((m: any) => m.policial_nome.split(' ')[0]).join(', '); // Use first name to keep it compact
	}

	async function salvarSupervisores() {
		salvando = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					supervisor_sabado_id: supSabadoId,
					supervisor_domingo_id: supDomingoId
				})
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			toaster.success({ title: 'Supervisores salvos' });
			editandoSupervisores = false;
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			salvando = false;
		}
	}

	async function salvarUnidadeOperacional(secId: number) {
		salvando = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}/seccionais/${secId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ unidade_operacional_id: unidadeOperacionalId })
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			toaster.success({ title: 'Unidade operacional salva' });
			editandoUnidade = false;
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			salvando = false;
		}
	}

	async function buscarSeccionaisDisponiveis() {
		try {
			const res = await fetch(`/api/gise/${gise.id}/seccionais`);
			if (res.ok) {
				seccionaisDisponiveis = await res.json();
				adicionandoSeccional = true;
			}
		} catch (e) {
			toaster.error({ title: 'Erro ao buscar seccionais' });
		}
	}

	async function adicionarSeccional() {
		if (seccionalParaAdicionarIdx === '') return;
		salvando = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}/seccionais`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ seccionalId: seccionalParaAdicionarIdx })
			});
			if (!res.ok) {
				const j = await res.json();
				throw new Error(j.error);
			}
			toaster.success({ title: 'Seccional adicionada' });
			adicionandoSeccional = false;
			seccionalParaAdicionarIdx = '';
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			salvando = false;
		}
	}

	async function removerSeccional(secId: number) {
		if (!confirm('Tem certeza que deseja remover esta seccional da escala? Todos os policiais escalados nela serão removidos.')) return;
		salvando = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}/seccionais/${secId}`, { method: 'DELETE' });
			if (!res.ok) {
				const j = await res.json();
				throw new Error(j.error);
			}
			toaster.success({ title: 'Seccional removida' });
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			salvando = false;
		}
	}

	async function adicionarMembro(secId: number) {
		if (!equipeParaAdicionar || !policialParaAdicionar) return;
		salvando = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}/seccionais/${secId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					adicionar_membro: {
						equipe_id: equipeParaAdicionar,
						policial_id: Number(policialParaAdicionar),
						dia: diaParaAdicionar
					}
				})
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			toaster.success({ title: 'Membro adicionado' });
			equipeParaAdicionar = null;
			policialParaAdicionar = '';
			cargoParaAdicionar = null;
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			salvando = false;
		}
	}

	async function removerMembro(memId: number) {
		try {
			const res = await fetch(`/api/gise/${gise.id}/membros/${memId}`, { method: 'DELETE' });
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		}
	}

	async function finalizarSeccional(secId: number) {
		salvando = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}/seccionais/${secId}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: '{}'
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			if (json.gise_status === 'aguardando_assinatura') {
				toaster.success({ title: 'Todas as seccionais finalizadas!', description: 'Escala aguardando assinatura do Supervisor.' });
			} else {
				toaster.success({ title: 'Seccional finalizada', description: 'Aguardando demais seccionais.' });
			}
			modoEdicaoSeccional = false;
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			salvando = false;
		}
	}

	// === Documento assinado ===
	let documentoAssinadoInfo = $state<any>(null);
	let documentosAssinados = $state<Record<string, any>>({});
	let assinandoSimples = $state(false);
	// assinando is already declared above
	let etapaAssinatura = $state('');

	// Web PKI
	let certificados = $state<WebPKICertificate[]>([]);
	let certSelecionado = $state('');
	let lendoCertificados = $state(false);
	let tentouLerCertificados = $state(false);
	let pkInstance = $state<any>(null);

	// SERPRO
	let serproClient = $state<SerproSignerClient | null>(null);
	let serproSignerName = $state(untrack(() => data.usuarioAtual?.nome ?? ''));
	let serproSignerCpf = $state('');

	// Feature 5: Signature Rubric
	let showRubricaModal = $state(false);
	let diaSendoAssinado = $state<'sabado' | 'domingo' | 'ambos' | null>(null);
	let tipoAssinaturaPendente = $state<'simples' | 'webpki' | 'serpro' | null>(null);
	let rubricaCapturada = $state<string | null>(null);

	// Carregar info do documento ao montar
	$effect(() => {
		if (gise?.id) {
			fetch(`/api/gise/${gise.id}/documento-assinado/info`)
				.then(r => r.ok ? r.json() : null)
				.then(info => {
					if (info?.existe) {
						documentoAssinadoInfo = info;
						documentosAssinados = info.documentos || {};
					} else {
						documentoAssinadoInfo = null;
						documentosAssinados = {};
					}
				})
				.catch(() => {});
		}
	});

	function abrirModalRubrica(dia: 'sabado' | 'domingo' | 'ambos', tipo: 'simples' | 'webpki' | 'serpro') {
		diaSendoAssinado = dia;
		tipoAssinaturaPendente = tipo;
		showRubricaModal = true;
	}

	async function confirmarRubrica(dataUrl: string) {
		rubricaCapturada = dataUrl;
		showRubricaModal = false;
		
		if (tipoAssinaturaPendente === 'simples') {
			await executarAssinarSimples();
		} else if (tipoAssinaturaPendente === 'webpki') {
			await executarAssinarComWebPKI();
		} else if (tipoAssinaturaPendente === 'serpro') {
			await executarAssinarComSerpro();
		}
	}

	async function executarAssinarSimples() {
		if (!diaSendoAssinado) return;
		assinandoSimples = true;
		try {
			const r = await fetch(`/api/gise/${gise.id}/assinar-simples`, {
				method: 'POST',
				body: JSON.stringify({ dia: diaSendoAssinado, rubrica: rubricaCapturada })
			});
			if (r.ok) {
				const blob = await r.blob();
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				const diaSuffix = diaSendoAssinado === 'ambos' ? '' : `_${diaSendoAssinado}`;
				a.download = `gise_${gise.data_inicio}${diaSuffix}_confirmada.pdf`;
				a.click();
				toaster.success({ title: 'Escala confirmada com sucesso' });
				await invalidateAll();
			} else {
				const j = await r.json();
				toaster.error({ title: j.error || 'Erro ao assinar' });
			}
		} catch (err) {
			toaster.error({ title: 'Erro de conexão' });
		} finally {
			assinandoSimples = false;
			diaSendoAssinado = null;
			rubricaCapturada = null;
		}
	}

	async function carregarCertificadosLocais() {
		lendoCertificados = true;
		tentouLerCertificados = false;
		try {
			const pki = pkInstance || (await initWebPKI());
			pkInstance = pki;
			certificados = await listarCertificados(pki);
			if (certificados.length === 1) {
				certSelecionado = certificados[0].thumbprint;
				serproSignerName = certificados[0].subjectName;
				serproSignerCpf = certificados[0].cpf || '';
			}
		} catch (err) {
			toaster.error({ title: err instanceof Error ? err.message : 'Erro ao inicializar Web PKI' });
		} finally {
			lendoCertificados = false;
			tentouLerCertificados = true;
		}
	}

	async function executarAssinarComWebPKI() {
		if (!diaSendoAssinado || !certSelecionado) return;
		assinando = true;
		etapaAssinatura = 'Preparando PDF...';

		try {
			const pki = await initWebPKI();
			const cert = certificados.find(c => c.thumbprint === certSelecionado);
			
			const prepResp = await fetch(`/api/gise/${gise.id}/preparar-assinatura`, {
				method: 'POST',
				body: JSON.stringify({
					signerName: cert?.subjectName ?? serproSignerName,
					signerCpf: cert?.cpf ?? serproSignerCpf,
					dia: diaSendoAssinado,
					rubrica: rubricaCapturada
				})
			});
			if (!prepResp.ok) throw new Error((await prepResp.json()).error);
			const { preparedPdf, signedAttrsHashHex, messageDigest, signingTimeISO, verificationHash } = await prepResp.json();

			etapaAssinatura = 'Lendo certificado e assinando (digite o PIN)...';
			const certificateBase64 = await lerCertificado(pki, certSelecionado);
			const signature = await assinarHash(pki, certSelecionado, signedAttrsHashHex);

			etapaAssinatura = 'Finalizando...';
			const finResp = await fetch(`/api/gise/${gise.id}/finalizar-assinatura`, {
				method: 'POST',
				body: JSON.stringify({
					preparedPdf,
					rawSignature: signature,
					certificateBase64,
					messageDigest,
					signingTimeISO,
					signerName: cert?.subjectName ?? serproSignerName,
					signerCpf: cert?.cpf ?? serproSignerCpf,
					verificationHash,
					dia: diaSendoAssinado
				})
			});

			if (!finResp.ok) throw new Error((await finResp.json()).error);
			
			const blob = await finResp.blob();
			const url = URL.createObjectURL(blob);
			window.open(url, '_blank');

			toaster.success({ title: 'Escala assinada com sucesso!' });
			await invalidateAll();
		} catch (err: any) {
			toaster.error({ title: 'Erro na assinatura Web PKI', description: err.message });
		} finally {
			assinando = false;
			diaSendoAssinado = null;
			rubricaCapturada = null;
			etapaAssinatura = '';
		}
	}

	async function executarAssinarComSerpro() {
		if (!diaSendoAssinado) return;
		assinando = true;
		etapaAssinatura = 'Iniciando SERPRO...';

		try {
			const client = serproClient ?? (await conectarSerpro());
			serproClient = client;

			etapaAssinatura = 'Gerando PDF e preparando assinatura...';
			const prepResp = await fetch(`/api/gise/${gise.id}/preparar-assinatura`, {
				method: 'POST',
				body: JSON.stringify({
					signerName: serproSignerName,
					signerCpf: serproSignerCpf,
					dia: diaSendoAssinado,
					rubrica: rubricaCapturada
				})
			});
			if (!prepResp.ok) throw new Error((await prepResp.json()).error);
			const { preparedPdf, messageDigest: messageDigestHex, verificationHash } = await prepResp.json();

			const messageDigestBase64 = btoa(
				messageDigestHex.match(/.{2}/g)!.map((h: string) => String.fromCharCode(parseInt(h, 16))).join('')
			);

			etapaAssinatura = 'Assinando no SERPRO...';
			const result = await client.sign(messageDigestBase64);
			const serproCms = result.rawSignature;

			etapaAssinatura = 'Finalizando...';
			const finResp = await fetch(`/api/gise/${gise.id}/finalizar-assinatura`, {
				method: 'POST',
				body: JSON.stringify({
					preparedPdf,
					serproCms,
					signerName: serproSignerName,
					signerCpf: serproSignerCpf,
					verificationHash,
					dia: diaSendoAssinado
				})
			});

			if (!finResp.ok) throw new Error((await finResp.json()).error);
			
			const blob = await finResp.blob();
			const url = URL.createObjectURL(blob);
			window.open(url, '_blank');

			toaster.success({ title: 'Escala assinada com sucesso!' });
			await invalidateAll();
		} catch (err: any) {
			toaster.error({ title: 'Erro na assinatura SERPRO', description: err.message });
		} finally {
			assinando = false;
			diaSendoAssinado = null;
			rubricaCapturada = null;
			etapaAssinatura = '';
		}
	}

	function assinarSimples() { abrirModalRubrica('ambos', 'simples'); }
	function assinarComWebPKI() { abrirModalRubrica('ambos', 'webpki'); }
	function assinarComSerpro() { abrirModalRubrica('ambos', 'serpro'); }

	async function finalizarGise() {
		finalizando = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}/finalizar`, { method: 'POST' });
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			toaster.success({ title: 'Escala finalizada!', description: `Nova escala criada (ID ${json.nova_gise_id})` });
			showFinalizarConfirm = false;
			goto(`/gise/${json.nova_gise_id}`);
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			finalizando = false;
		}
	}

	async function salvarSlotsEquipe(equipeId: number) {
		salvando = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}/equipes/${equipeId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ slots_dpc: editSlotsDpc, slots_oip: editSlotsOip })
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			toaster.success({ title: 'Vagas atualizadas' });
			editandoEquipe = null;
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			salvando = false;
		}
	}

	async function solicitarAssinatura() {
		salvando = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: 'aguardando_assinatura' })
			});
			if (!res.ok) throw new Error((await res.json()).error);
			toaster.success({ title: 'Edição finalizada', description: 'Escala enviada para assinatura do Supervisor.' });
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			salvando = false;
		}
	}

	async function reabrirEscala() {
		reabrindo = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}/reabrir`, { method: 'POST' });
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			toaster.success({ title: 'Escala reaberta', description: 'A assinatura foi revogada. A escala pode ser editada novamente.' });
			showReabrirConfirm = false;
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			reabrindo = false;
		}
	}

	// Feature 5: Editar datas/horários da GISE (com revogação de assinatura se necessário)
	async function abrirEdicaoDatasHorarios() {
		editDataInicio = gise.data_inicio;
		editDataFim = gise.data_fim;
		editHoraEntradaSabado = gise.hora_entrada_sabado ?? gise.hora_entrada;
		editHoraSaidaSabado = gise.hora_saida_sabado ?? gise.hora_saida;
		editHoraEntradaDomingo = gise.hora_entrada_domingo ?? gise.hora_entrada;
		editHoraSaidaDomingo = gise.hora_saida_domingo ?? gise.hora_saida;
		editandoDatasHorarios = true;
	}

	async function salvarDatasHorarios() {
		const horas = [editHoraEntradaSabado, editHoraSaidaSabado, editHoraEntradaDomingo, editHoraSaidaDomingo];
		if (horas.some(h => !h)) {
			toaster.error({ title: 'Preencha todos os horários' });
			return;
		}
		if (horas.some(h => !validarHora(h))) {
			toaster.error({ title: 'Formato inválido', description: 'Use o formato HH:MM, ex: 14:00' });
			return;
		}
		salvando = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					data_inicio: editDataInicio,
					data_fim: editDataFim,
					hora_entrada: normalizarHora(editHoraEntradaSabado),
					hora_saida: normalizarHora(editHoraSaidaSabado),
					hora_entrada_sabado: normalizarHora(editHoraEntradaSabado),
					hora_saida_sabado: normalizarHora(editHoraSaidaSabado),
					hora_entrada_domingo: normalizarHora(editHoraEntradaDomingo),
					hora_saida_domingo: normalizarHora(editHoraSaidaDomingo)
				})
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			if (json.assinatura_revogada) {
				toaster.warning({ title: 'Datas/horários atualizados', description: 'A assinatura digital foi revogada. Será necessário assinar novamente.' });
			} else {
				toaster.success({ title: 'Datas/horários atualizados' });
			}
			editandoDatasHorarios = false;
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			salvando = false;
		}
	}
 
	function normalizarHora(v: string): string | null {
		if (!v) return null;
		return v.replace(/[.,]/g, ':');
	}
	function validarHora(v: string): boolean {
		if (!v) return true;
		return /^\d{1,2}:\d{2}$/.test(normalizarHora(v) ?? '');
	}

	async function salvarHorariosSec(secId: number) {
		const horas = [editSecHoraEntSab, editSecHoraSaiSab, editSecHoraEntDom, editSecHoraSaiDom].filter(Boolean);
		if (horas.some(h => !validarHora(h))) {
			toaster.error({ title: 'Formato inválido', description: 'Use o formato HH:MM, ex: 14:00' });
			return;
		}
		salvando = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}/seccionais/${secId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					hora_entrada_sabado: normalizarHora(editSecHoraEntSab),
					hora_saida_sabado: normalizarHora(editSecHoraSaiSab),
					hora_entrada_domingo: normalizarHora(editSecHoraEntDom),
					hora_saida_domingo: normalizarHora(editSecHoraSaiDom)
				})
			});
			if (!res.ok) throw new Error((await res.json()).error);
			toaster.success({ title: 'Horários da seccional atualizados' });
			editandoHorariosSecId = null;
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			salvando = false;
		}
	}
 
	async function salvarHorariosEquipe(eqId: number) {
		const horas = [editEqHoraEntSab, editEqHoraSaiSab, editEqHoraEntDom, editEqHoraSaiDom].filter(Boolean);
		if (horas.some(h => !validarHora(h))) {
			toaster.error({ title: 'Formato inválido', description: 'Use o formato HH:MM, ex: 14:00' });
			return;
		}
		salvando = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}/equipes/${eqId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					hora_entrada_sabado: normalizarHora(editEqHoraEntSab),
					hora_saida_sabado: normalizarHora(editEqHoraSaiSab),
					hora_entrada_domingo: normalizarHora(editEqHoraEntDom),
					hora_saida_domingo: normalizarHora(editEqHoraSaiDom)
				})
			});
			if (!res.ok) throw new Error((await res.json()).error);
			toaster.success({ title: 'Horários da equipe atualizados' });
			editandoHorariosEquipeId = null;
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			salvando = false;
		}
	}

	// Feature 5: Excluir GISE (mesmo finalizada)
	async function excluirGise() {
		excluindo = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}`, { method: 'DELETE' });
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			toaster.success({ title: 'Escala GISE excluída' });
			showExcluirGiseConfirm = false;
			goto('/gise');
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			excluindo = false;
		}
	}

	async function adicionarEquipe(secId: number) {
		salvando = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}/seccionais/${secId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					adicionar_equipe: {
						tipo: novaEquipeTipo,
						slots_dpc: novaEquipeDpc,
						slots_oip: novaEquipeOip
					}
				})
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			toaster.success({ title: 'Equipe adicionada' });
			adicionandoEquipeSec = null;
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			salvando = false;
		}
	}

	const podeFinalizar = $derived(isAdminGeral && gise?.status === 'assinada');
	const temDiaPendente = $derived(
		(gise?.supervisor_sabado_id === data.usuarioAtual?.id && !(documentosAssinados.sabado || documentosAssinados.ambos)) ||
		(gise?.supervisor_domingo_id === data.usuarioAtual?.id && !(documentosAssinados.domingo || documentosAssinados.ambos))
	);
	const podeAssinar = $derived(
		isSupervisor &&
		(gise?.status === 'aguardando_assinatura' || gise?.status === 'assinada') &&
		temDiaPendente
	);
	// Admin Geral: pode editar sempre (via modal de datas/horários)
	// Admin Seccional: pode editar exceto quando finalizada (Feature 4: pode alterar mesmo assinada → vira 'retificada')
	const podeEditar = $derived(
		isAdminGeral
			? gise?.status !== 'finalizada'  // Admin geral só não edita conteúdo se finalizada (usa o modal de datas para editar)
			: gise?.status !== 'finalizada'   // Seccional: pode editar em qualquer status exceto finalizada (gerará retificação)
	);
	const podeReabrir = $derived(
		isAdminGeral && (gise?.status === 'assinada' || gise?.status === 'finalizada')
	);
	const podeDownload = $derived(
		(isAdminGeral || isSeccional) &&
		(gise?.status === 'assinada' || gise?.status === 'finalizada')
	);
	const editaBloqueado = $derived(
		gise?.status === 'assinada' || gise?.status === 'finalizada'
	);

	function downloadGise(format: string) {
		if (!gise) return;
		window.open(`/api/gise/${gise.id}/download?format=${format}`, '_blank');
	}

	// Filtra delegacias (unidades tipo delegacia) para unidade operacional
	const delegacias = $derived(todasUnidades.filter((u: any) => u.tipo === 'delegacia'));
</script>

<div class="space-y-6">
	<!-- Cabeçalho -->
	<div class="flex items-start justify-between flex-wrap gap-3">
		<div>
			<button
				class="btn btn-sm mb-4 preset-outlined-surface-500 hover:bg-surface-50 dark:hover:bg-surface-900 px-3 py-1.5 rounded-xl transition-all flex items-center gap-2 group"
				onclick={() => goto('/gise')}
			>
				<svg class="w-4 h-4 transition-transform group-hover:-translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
				</svg>
				<span class="text-sm font-bold uppercase tracking-wider">Voltar</span>
			</button>
			{#if gise}
				<h1 class="text-2xl font-bold text-surface-900 dark:text-surface-50">
					Escala GISE — {fmtDate(gise.data_inicio)} a {fmtDate(gise.data_fim)}
				</h1>
				<div class="flex items-center gap-2 mt-1">
					<span class="text-sm px-2 py-0.5 rounded-full font-semibold {statusColor(gise.status)}">
						{statusLabel(gise.status)}
					</span>
					<span class="text-sm text-surface-500">
						Sáb: {gise.hora_entrada_sabado ?? gise.hora_entrada}h–{gise.hora_saida_sabado ?? gise.hora_saida}h
						· Dom: {gise.hora_entrada_domingo ?? gise.hora_entrada}h–{gise.hora_saida_domingo ?? gise.hora_saida}h
					</span>
				</div>
			{/if}
		</div>

		<div class="flex items-center gap-1.5 flex-wrap">
			{#if (isAdminGeral || isSeccional) && gise}
					{#if podeDownload}
					<button
						class="btn preset-outlined-success-500 text-sm px-3 py-1.5 rounded-lg"
						onclick={() => downloadGise('xlsx')}
					>
						Baixar XLSX
					</button>
				{/if}
			{/if}
			{#if isAdminGeral && gise}
				<div class="flex items-center gap-2">
					{#if gise.status === 'em_preenchimento' && todasSeccionaisPreenchidas}
						<button
							class="btn preset-filled-success-500 text-sm px-3 py-1.5 rounded-lg shadow-sm"
							onclick={solicitarAssinatura}
							disabled={salvando}
						>
							{#if salvando}<Spinner size="xs" />{/if} Solicitar Assinatura
						</button>
					{/if}
					<button
						class="btn preset-outlined-primary-500 text-sm px-3 py-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
						onclick={abrirEdicaoDatasHorarios}
						disabled={editaBloqueado}
					>
						Editar Datas/Horários
					</button>
				</div>
				<button
				class="btn preset-outlined-error-500 text-sm px-3 py-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
				onclick={() => (showExcluirGiseConfirm = true)}
				disabled={editaBloqueado}
			>
				Excluir GISE
			</button>
			{/if}
			{#if podeReabrir}
				<button
					class="btn preset-outlined-warning-500 text-sm px-3 py-1.5 rounded-lg"
					onclick={() => (showReabrirConfirm = true)}
				>
					Reabrir para Edição
				</button>
			{/if}
			{#if podeFinalizar}
				<button
					class="btn preset-filled-error-500 text-sm px-3 py-1.5 rounded-lg"
					onclick={() => (showFinalizarConfirm = true)}
				>
					Marcar como Finalizada
				</button>
			{/if}
		</div>
	</div>

	{#if !gise}
		<p class="text-surface-500">Escala não encontrada.</p>
	{:else}
		<!-- Supervisores -->
		<div class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900 p-5">
			<div class="flex flex-wrap items-start gap-y-1 justify-between mb-3">
				<h2 class="font-semibold text-surface-900 dark:text-surface-50">Supervisores</h2>
				{#if isAdminGeral && podeEditar && !editandoSupervisores}
					<button
						class="text-sm px-3 py-1 rounded-lg font-semibold transition-all {!gise.supervisor_sabado_id || !gise.supervisor_domingo_id ? 'btn preset-filled-warning-500 animate-pulse' : 'btn preset-outlined-primary-500'}"
						onclick={() => (editandoSupervisores = true)}
					>
						{!gise.supervisor_sabado_id || !gise.supervisor_domingo_id ? 'Definir Supervisores' : 'Editar Supervisores'}
					</button>
				{/if}
			</div>

			{#if editandoSupervisores}
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
					<div>
						<label for="supSabado" class="text-sm font-medium text-surface-600 dark:text-surface-400 block mb-1">Supervisor Sábado (DPC)</label>
						<select
							id="supSabado"
							bind:value={supSabadoId}
							class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
						>
							<option value={null}>Não definido</option>
							{#each dpcs as p}
								<option value={p.id}>{p.nome} ({p.matricula})</option>
							{/each}
						</select>
					</div>
					<div>
						<label for="supDomingo" class="text-sm font-medium text-surface-600 dark:text-surface-400 block mb-1">Supervisor Domingo (DPC)</label>
						<select
							id="supDomingo"
							bind:value={supDomingoId}
							class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
						>
							<option value={null}>Não definido</option>
							{#each dpcs as p}
								<option value={p.id}>{p.nome} ({p.matricula})</option>
							{/each}
						</select>
					</div>
				</div>
				<div class="flex gap-2">
					<button
						class="btn preset-filled-primary-500 text-sm px-3 py-1.5 rounded-lg"
						onclick={salvarSupervisores}
						disabled={salvando}
					>
						{#if salvando}<Spinner size="sm" />{/if}
						{#if salvando}<Spinner size="sm" />{/if}
					{salvando ? 'Salvando...' : 'Salvar'}
					</button>
					<button
						class="btn preset-outlined-surface text-sm px-3 py-1.5 rounded-lg"
						onclick={() => (editandoSupervisores = false)}
					>
						Cancelar
					</button>
				</div>
			{:else}
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
					<!-- Sábado -->
					<div class="space-y-3">
						<div class="flex items-center justify-between">
							<p class="text-sm font-bold text-surface-500 uppercase tracking-wider">Sábado</p>
							{#if documentosAssinados.sabado || documentosAssinados.ambos}
								<span class="text-sm px-2 py-0.5 rounded-full bg-success-500/20 text-success-700 dark:text-success-400 font-bold">ASSINADA</span>
							{:else}
								<span class="text-sm px-2 py-0.5 rounded-full bg-warning-500/20 text-warning-700 dark:text-warning-400 font-bold">PENDENTE</span>
							{/if}
						</div>
						
						<div class="p-4 rounded-xl bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
							<p class="font-semibold text-surface-900 dark:text-surface-100">{gise.supervisor_sabado_nome ?? 'Não definido'}</p>
							{#if documentosAssinados.sabado || documentosAssinados.ambos}
								<div class="mt-2 text-sm text-surface-500 space-y-1">
									<p>Assinado por: <span class="text-surface-900 dark:text-surface-100 font-medium">{(documentosAssinados.sabado || documentosAssinados.ambos).assinante_nome}</span></p>
									<a href={`/api/gise/${gise.id}/documento-assinado?dia=${documentosAssinados.sabado ? 'sabado' : 'ambos'}`} 
										target="_blank" class="text-primary-600 hover:underline font-semibold flex items-center gap-1 mt-1">
										<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
										Baixar PDF Sábado
									</a>
								</div>
							{/if}
					{#if isAdminGeral || isSeccional}
						<a href={`/api/gise/${gise.id}/download?format=pdf&dia=sabado`}
							target="_blank" class="text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 hover:underline text-sm flex items-center gap-1 mt-1">
							<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
							PDF sem Assinatura (Sáb)
						</a>
					{/if}
						</div>
					</div>

					<!-- Domingo -->
					<div class="space-y-3">
						<div class="flex items-center justify-between">
							<p class="text-sm font-bold text-surface-500 uppercase tracking-wider">Domingo</p>
							{#if documentosAssinados.domingo || documentosAssinados.ambos}
								<span class="text-sm px-2 py-0.5 rounded-full bg-success-500/20 text-success-700 dark:text-success-400 font-bold">ASSINADA</span>
							{:else}
								<span class="text-sm px-2 py-0.5 rounded-full bg-warning-500/20 text-warning-700 dark:text-warning-400 font-bold">PENDENTE</span>
							{/if}
						</div>
						
						<div class="p-4 rounded-xl bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
							<p class="font-semibold text-surface-900 dark:text-surface-100">{gise.supervisor_domingo_nome ?? 'Não definido'}</p>
							{#if documentosAssinados.domingo || documentosAssinados.ambos}
								<div class="mt-2 text-sm text-surface-500 space-y-1">
									<p>Assinado por: <span class="text-surface-900 dark:text-surface-100 font-medium">{(documentosAssinados.domingo || documentosAssinados.ambos).assinante_nome}</span></p>
									<a href={`/api/gise/${gise.id}/documento-assinado?dia=${documentosAssinados.domingo ? 'domingo' : 'ambos'}`} 
										target="_blank" class="text-primary-600 hover:underline font-semibold flex items-center gap-1 mt-1">
										<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
										Baixar PDF Domingo
									</a>
								</div>
							{/if}
					{#if isAdminGeral || isSeccional}
						<a href={`/api/gise/${gise.id}/download?format=pdf&dia=domingo`}
							target="_blank" class="text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 hover:underline text-sm flex items-center gap-1 mt-1">
							<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
							PDF sem Assinatura (Dom)
						</a>
					{/if}
						</div>
					</div>
				</div>
			{/if}
		</div>

		<!-- Card de Escala Totalmente Assinada -->
		{#if documentosAssinados.sabado || documentosAssinados.domingo || documentosAssinados.ambos}
			<div class="rounded-2xl border border-success-500/30 bg-success-500/10 p-5 flex items-start gap-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-500">
				<div class="bg-success-500 text-white p-2 rounded-full mt-1">
					<svg class="w-5 h-5 font-bold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" /></svg>
				</div>
				<div class="flex-1">
					<h3 class="font-bold text-success-800 dark:text-success-400">
						Escala GISE Assinada
					</h3>
					<p class="text-sm text-surface-600 dark:text-surface-300 mt-1">
						{#if documentosAssinados.sabado && documentosAssinados.domingo}
							Escala totalmente assinada (Sábado e Domingo).
						{:else if documentosAssinados.ambos}
							Escala assinada (formato unificado).
						{:else if documentosAssinados.sabado}
							Sábado assinado. Aguardando supervisor de Domingo.
						{:else if documentosAssinados.domingo}
							Domingo assinado. Aguardando supervisor de Sábado.
						{:else}
							Aguardando assinatura do supervisor restante.
						{/if}
					</p>
				</div>
			</div>
		{/if}


		<!-- Seção de assinatura (Supervisor) -->
		{#if podeAssinar}
			<div id="secao-assinatura-digital" class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900 p-5 space-y-4">
				<div class="flex items-center gap-2 mb-2">
					<h3 class="font-bold text-surface-900 dark:text-surface-50">Assinar Escala GISE</h3>
					{#if diaSendoAssinado}
						<span class="text-sm px-2 py-0.5 rounded bg-primary-500/20 text-primary-700 dark:text-primary-400 font-bold uppercase transition-all">
							Dia: {diaSendoAssinado}
						</span>
					{/if}
				</div>

				{#if !diaSendoAssinado}
					<p class="text-sm font-semibold text-surface-600 dark:text-surface-400 mb-3">Selecione o dia para assinar:</p>
					<div class="flex gap-3 flex-wrap">
						{#if gise.supervisor_sabado_id === data.usuarioAtual?.id && !(documentosAssinados.sabado || documentosAssinados.ambos)}
							<button class="btn preset-filled-primary-500 text-sm px-5 py-2 rounded-xl font-bold"
								onclick={() => (diaSendoAssinado = 'sabado')}>
								Assinar Sábado
							</button>
						{/if}
						{#if gise.supervisor_domingo_id === data.usuarioAtual?.id && !(documentosAssinados.domingo || documentosAssinados.ambos)}
							<button class="btn preset-filled-primary-500 text-sm px-5 py-2 rounded-xl font-bold"
								onclick={() => (diaSendoAssinado = 'domingo')}>
								Assinar Domingo
							</button>
						{/if}
					</div>
				{:else}
					<!-- Assinatura Simples (Confirmação) -->
					<div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
						<div>
							<h4 class="font-semibold text-surface-900 dark:text-surface-50 text-sm">Assinar na Tela (Manual)</h4>
							<p class="text-sm text-surface-500 mt-1">Gera o PDF com sua rubrica manual (validade interna).</p>
						</div>
						<button
							class="btn preset-filled-primary-500 text-sm px-4 py-2 rounded-xl"
							disabled={assinandoSimples}
							onclick={() => abrirModalRubrica(diaSendoAssinado!, 'simples')}
						>
							{#if assinandoSimples}<Spinner size="sm" />{/if}
							{assinandoSimples ? 'Gerando PDF...' : `Assinar na Tela (${diaSendoAssinado === 'sabado' ? 'Sábado' : 'Domingo'})`}
						</button>
					</div>

				<hr class="border-surface-200 dark:border-surface-700" />

				<!-- Assinatura Digital -->
				<h3 class="font-semibold text-surface-900 dark:text-surface-50 text-sm">
					Assinatura Digital (eToken / Certificado A3)
				</h3>

				<!-- Seletor de certificados -->
				<div class="p-4 bg-surface-100/50 dark:bg-surface-800/50 rounded-xl border border-surface-200 dark:border-white/10">
					<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
						<h4 class="font-semibold text-sm flex items-center gap-2">
							<svg class="w-4 h-4 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
							</svg>
							Leitura de Tokens
						</h4>
						<button
							class="btn text-sm preset-outlined-primary-500 px-3 py-1.5 rounded-lg"
							onclick={carregarCertificadosLocais}
							disabled={lendoCertificados}
						>
							{#if lendoCertificados}<Spinner size="sm" />{/if}
						{lendoCertificados ? 'Lendo tokens...' : 'Ler Tokens Plugados'}
						</button>
					</div>

					{#if certificados.length > 0}
						<select
							bind:value={certSelecionado}
							onchange={(e) => { const c = certificados.find(x => x.thumbprint === e.currentTarget.value); if (c) { serproSignerName = c.subjectName; serproSignerCpf = c.cpf || ''; } }}
							class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm mt-2"
						>
							<option value="">Selecione...</option>
							{#each certificados as cert (cert.thumbprint)}
								<option value={cert.thumbprint}>
									{cert.subjectName}{cert.cpf ? ` (CPF: ${cert.cpf})` : ''} - Emissor: {cert.issuerName}
								</option>
							{/each}
						</select>
					{:else if tentouLerCertificados}
						<p class="text-sm text-error-500 mt-2 bg-error-500/10 p-2 rounded">
							Nenhum certificado encontrado. Verifique se o token está conectado e a extensão <strong>Lacuna Web PKI</strong> está instalada.
						</p>
					{:else}
						<p class="text-sm text-surface-500 mt-1">
							Clique no botão para listar os certificados disponíveis.
						</p>
					{/if}
				</div>

				<div class="flex gap-2 items-center flex-wrap">
					<button
						class="btn preset-filled-success-500 text-sm px-4 py-2 rounded-xl"
						onclick={() => abrirModalRubrica(diaSendoAssinado!, 'webpki')}
						disabled={assinando || !certSelecionado}
					>
						{#if assinando && certificados.length > 0}
							<span class="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></span>
							{etapaAssinatura}
						{:else}
							Assinar {diaSendoAssinado === 'sabado' ? 'Sábado' : 'Domingo'} com Web PKI
						{/if}
					</button>

					<button
						class="btn preset-filled-tertiary-500 text-sm px-4 py-2 rounded-xl"
						onclick={() => abrirModalRubrica(diaSendoAssinado!, 'serpro')}
						disabled={assinando || !certSelecionado}
					>
						{#if assinando && serproClient}
							<span class="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></span>
							{etapaAssinatura}
						{:else}
							Assinar {diaSendoAssinado === 'sabado' ? 'Sábado' : 'Domingo'} com SERPRO
						{/if}
					</button>
				</div>
				{/if}
			</div>
		{/if}

		<!-- Seccionais -->
		<div>
			<h2 class="font-semibold text-surface-900 dark:text-surface-50 mb-3">
				Seccionais ({gise.seccionais?.length ?? 0})
			</h2>

			{#each (gise.seccionais ?? []) as sec}
				<!-- Mostrar só a seccional do Admin Seccional, ou todas para Admin Geral / Supervisor -->
				{#if isAdminGeral || isSupervisor || sec.seccional_id === minhaSeccionalId}
					<div class="rounded-2xl border border-surface-200 dark:border-surface-800 mb-4 overflow-hidden">
						<!-- Cabeçalho da seccional -->
						<div class="flex flex-wrap items-start gap-y-2 justify-between px-5 py-3 bg-surface-100 dark:bg-surface-800">
							<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
								<span class="font-semibold text-surface-900 dark:text-surface-50 text-sm">
									{sec.seccional_nome}
								</span>
								<span class="text-sm px-1.5 py-0.5 rounded-full font-bold {sec.status === 'preenchida' || sec.status === 'preenchida_retificada' ? 'bg-success-500/20 text-success-700 dark:text-success-400' : sec.status === 'retificada' ? 'bg-warning-500/20 text-warning-600 dark:text-warning-400 border border-warning-500/40' : 'bg-surface-500/20 text-surface-600 dark:text-surface-400'}">
									{sec.status === 'preenchida' ? 'Preenchida' : sec.status === 'preenchida_retificada' ? 'Preenchida (Retificada)' : sec.status === 'retificada' ? 'Preenchida (Retificada)' : 'Pendente'}
								</span>
															{#if editandoHorariosSecId === sec.id}
								<div class="flex flex-wrap items-center gap-2">
									<span class="text-sm font-semibold opacity-50 uppercase">Sáb:</span>
									<input type="text" placeholder="08:00" class="w-20 px-2 py-1 text-sm rounded border bg-white dark:bg-surface-900 {editSecHoraEntSab && !validarHora(editSecHoraEntSab) ? 'border-error-500' : 'border-surface-300 dark:border-surface-600'}" bind:value={editSecHoraEntSab} />
									<span class="opacity-30">-</span>
									<input type="text" placeholder="16:00" class="w-20 px-2 py-1 text-sm rounded border bg-white dark:bg-surface-900 {editSecHoraSaiSab && !validarHora(editSecHoraSaiSab) ? 'border-error-500' : 'border-surface-300 dark:border-surface-600'}" bind:value={editSecHoraSaiSab} />
									<span class="opacity-30 mx-1">|</span>
									<span class="text-sm font-semibold opacity-50 uppercase">Dom:</span>
									<input type="text" placeholder="08:00" class="w-20 px-2 py-1 text-sm rounded border bg-white dark:bg-surface-900 {editSecHoraEntDom && !validarHora(editSecHoraEntDom) ? 'border-error-500' : 'border-surface-300 dark:border-surface-600'}" bind:value={editSecHoraEntDom} />
									<span class="opacity-30">-</span>
									<input type="text" placeholder="16:00" class="w-20 px-2 py-1 text-sm rounded border bg-white dark:bg-surface-900 {editSecHoraSaiDom && !validarHora(editSecHoraSaiDom) ? 'border-error-500' : 'border-surface-300 dark:border-surface-600'}" bind:value={editSecHoraSaiDom} />
									<button class="btn btn-sm preset-filled-primary-500 text-sm py-1 px-2 rounded" onclick={() => salvarHorariosSec(sec.id)}>✓</button>
									<button class="btn btn-sm preset-outlined-surface text-sm py-1 px-2 rounded" onclick={() => (editandoHorariosSecId = null)}>×</button>
								</div>
							{:else}
								<div class="flex items-center gap-1.5 text-sm text-surface-500 font-medium ml-2">
									<span>Sáb: {sec.hora_entrada_sabado ?? gise.hora_entrada_sabado}h-{sec.hora_saida_sabado ?? gise.hora_saida_sabado}h</span>
									<span class="opacity-30">|</span>
									<span>Dom: {sec.hora_entrada_domingo ?? gise.hora_entrada_domingo}h-{sec.hora_saida_domingo ?? gise.hora_saida_domingo}h</span>
									{#if (sec.hora_entrada_sabado || sec.hora_saida_sabado || sec.hora_entrada_domingo || sec.hora_saida_domingo)}
										<span class="ml-1 px-1 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold border border-amber-500/20">PERSONALIZADO</span>
									{/if}
								</div>
								{#if isAdminGeral && podeEditar}
									<button
										class="text-sm text-primary-600 hover:underline ml-1 py-0.5"
										onclick={() => {
											editandoHorariosSecId = sec.id;
											editSecHoraEntSab = sec.hora_entrada_sabado ?? gise.hora_entrada_sabado ?? '';
											editSecHoraSaiSab = sec.hora_saida_sabado ?? gise.hora_saida_sabado ?? '';
											editSecHoraEntDom = sec.hora_entrada_domingo ?? gise.hora_entrada_domingo ?? '';
											editSecHoraSaiDom = sec.hora_saida_domingo ?? gise.hora_saida_domingo ?? '';
										}}
									>Editar Horários</button>
								{/if}
							{/if}
							</div>

										<!-- Ações Seccional (Admin Seccional) -->
							<div class="flex items-center gap-2">
								{#if isSeccional && sec.seccional_id === minhaSeccionalId && podeEditar}
									{#if sec.status === 'preenchida' && !modoEdicaoSeccional}
										<button
											class="text-sm btn preset-filled-primary-500 px-4 py-1.5 rounded-lg shadow-sm"
											onclick={() => (modoEdicaoSeccional = true)}
										>Editar Escala</button>
									{:else}
										<button
											class="text-sm btn preset-filled-success-500 px-4 py-1.5 rounded-lg shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
											onclick={() => finalizarSeccional(sec.id)}
											disabled={salvando || !sec.unidade_operacional_id || !(sec.equipes ?? []).some(eq => (eq.membros ?? []).length > 0)}
											title={!sec.unidade_operacional_id ? 'Preencha a unidade operacional antes de finalizar' : !(sec.equipes ?? []).some(eq => (eq.membros ?? []).length > 0) ? 'Adicione pelo menos 1 policial antes de finalizar' : ''}
										>
											{#if salvando}<Spinner size="xs" />{/if}
											{sec.status === 'preenchida' ? 'Finalizar edição' : (sec.status === 'retificada' ? 'Confirmar retificação' : 'Finalizar envio')}
										</button>
										
										{#if modoEdicaoSeccional}
											<button
												class="text-sm btn preset-outlined-surface px-3 py-1.5 rounded-lg"
												onclick={() => { modoEdicaoSeccional = false; editandoUnidade = false; equipeParaAdicionar = null; cargoParaAdicionar = null; }}
											>Cancelar</button>
										{/if}
									{/if}
								{/if}
								
								{#if isAdminGeral && podeEditar}
									<button
										class="text-sm btn preset-outlined-error-500 px-2 py-1 rounded-lg flex items-center gap-1"
										onclick={() => removerSeccional(sec.id)}
										disabled={salvando}
										title="Excluir seccional desta escala"
									>
										<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
										Excluir
									</button>
								{/if}
								{#if podeDownload}
									<div class="flex flex-wrap items-center gap-3 self-center border-l border-surface-300 dark:border-surface-600 pl-4 ml-2">
										<!-- Sábado -->
										<div class="flex items-center gap-2">
											<button
												class="btn btn-sm preset-tonal-success text-xs font-bold px-3 py-2 rounded-xl flex items-center gap-2 transition-all hover:scale-105 disabled:opacity-30"
												onclick={() => window.open(`/api/gise/${gise.id}/download?format=produtividade&dia=sabado&seccionalId=${sec.seccional_id}`, '_blank')}
												disabled={!sec.temRespostasSabado}
												title={!sec.temRespostasSabado ? 'Aguardando preenchimento do formulário' : 'Baixar Resultados de Sábado'}
											>
												<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
												<span>Resultados Sáb</span>
												{#if !sec.temRespostasSabado}
													<span class="text-[0.6rem] opacity-70 font-normal italic ml-1">(aguardando)</span>
												{/if}
											</button>
											<button
												class="btn btn-sm preset-tonal-primary text-xs font-bold px-3 py-2 rounded-xl flex items-center gap-2 transition-all hover:scale-105 disabled:opacity-30"
												onclick={() => window.open(`/api/gise/${gise.id}/download?format=extraordinario&dia=sabado&seccionalId=${sec.seccional_id}`, '_blank')}
												disabled={!checkAllSigned(sec, 'sabado')}
												title={!checkAllSigned(sec, 'sabado') ? getFaltandoRubrica(sec, 'sabado') : 'Baixar Relatório de Sábado'}
											>
												<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
												<span>Relat. Extra Sáb</span>
												{#if !checkAllSigned(sec, 'sabado')}
													<span class="text-[0.6rem] opacity-70 font-normal italic ml-1">(aguardando)</span>
												{/if}
											</button>
										</div>

										<div class="w-px h-6 bg-surface-300 dark:bg-surface-600 mx-1 hidden lg:block"></div>

										<!-- Domingo -->
										<div class="flex items-center gap-2">
											<button
												class="btn btn-sm preset-tonal-success text-xs font-bold px-3 py-2 rounded-xl flex items-center gap-2 transition-all hover:scale-105 disabled:opacity-30"
												onclick={() => window.open(`/api/gise/${gise.id}/download?format=produtividade&dia=domingo&seccionalId=${sec.seccional_id}`, '_blank')}
												disabled={!sec.temRespostasDomingo}
												title={!sec.temRespostasDomingo ? 'Aguardando preenchimento do formulário' : 'Baixar Resultados de Domingo'}
											>
												<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
												<span>Resultados Dom</span>
												{#if !sec.temRespostasDomingo}
													<span class="text-[0.6rem] opacity-70 font-normal italic ml-1">(aguardando)</span>
												{/if}
											</button>
											<button
												class="btn btn-sm preset-tonal-primary text-xs font-bold px-3 py-2 rounded-xl flex items-center gap-2 transition-all hover:scale-105 disabled:opacity-30"
												onclick={() => window.open(`/api/gise/${gise.id}/download?format=extraordinario&dia=domingo&seccionalId=${sec.seccional_id}`, '_blank')}
												disabled={!checkAllSigned(sec, 'domingo')}
												title={!checkAllSigned(sec, 'domingo') ? getFaltandoRubrica(sec, 'domingo') : 'Baixar Relatório de Domingo'}
											>
												<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
												<span>Relat. Extra Dom</span>
												{#if !checkAllSigned(sec, 'domingo')}
													<span class="text-[0.6rem] opacity-70 font-normal italic ml-1">(aguardando)</span>
												{/if}
											</button>
										</div>
									</div>
								{/if}
							</div>
						</div>

						<div class="p-5 space-y-4">
							<!-- Unidade Operacional -->
							{#if isSeccional && sec.seccional_id === minhaSeccionalId && podeEditar && (modoEdicaoSeccional || sec.status === 'pendente' || sec.status === 'retificada')}
								<div>
									<label for="unidadeOperacional" class="text-sm font-medium text-surface-600 dark:text-surface-400 block mb-1">
										Unidade Operacional
									</label>
									{#if sec.unidade_operacional_nome && !editandoUnidade}
										<!-- Modo exibição -->
										<div class="flex flex-wrap items-center gap-2">
											<span class="text-sm font-semibold text-surface-900 dark:text-surface-100">{sec.unidade_operacional_nome}</span>
											<button
												class="btn preset-outlined-primary-500 text-sm px-3 py-1 rounded-xl"
												onclick={() => (editandoUnidade = true)}
											>
												Editar
											</button>
										</div>
									{:else}
										<!-- Modo edição -->
										<div class="flex flex-wrap gap-2">
											<select
												id="unidadeOperacional"
												bind:value={unidadeOperacionalId}
												class="flex-1 min-w-0 px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
											>
												<option value={null}>Selecionar unidade...</option>
												{#each delegacias as u}
													<option value={u.id}>{u.nome}</option>
												{/each}
											</select>
											<div class="flex gap-2 shrink-0">
												<button
													class="btn preset-filled-primary-500 text-sm px-3 py-1.5 rounded-xl"
													onclick={() => salvarUnidadeOperacional(sec.id)}
													disabled={salvando}
												>
													Salvar
												</button>
												{#if sec.unidade_operacional_nome}
													<button
														class="btn preset-outlined-surface text-sm px-3 py-1.5 rounded-xl"
														onclick={() => (editandoUnidade = false)}
													>
														Cancelar
													</button>
												{/if}
											</div>
										</div>
									{/if}
								</div>
							{:else if sec.unidade_operacional_nome}
								<p class="text-sm text-surface-500">
									Unidade Operacional: <span class="font-semibold text-surface-900 dark:text-surface-100">{sec.unidade_operacional_nome}</span>
								</p>
							{/if}

							<!-- Equipes -->
							{#each (sec.equipes ?? []) as equipe}
								<div class="rounded-xl border border-surface-200 dark:border-surface-700 p-4">
									<div class="flex flex-wrap items-start gap-y-1 justify-between mb-3">
										<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
											<span class="text-sm font-semibold text-surface-900 dark:text-surface-100 capitalize">
												Equipe {equipe.tipo === 'operacional' ? 'Operacional' : 'SEINT'}
											</span>
											{#if editandoEquipe === equipe.id}
												<div class="flex items-center gap-1.5">
													<label for="edit-dpc-{equipe.id}" class="text-sm text-surface-500">DPC:</label>
													<input id="edit-dpc-{equipe.id}" type="number" min="0" max="20" bind:value={editSlotsDpc}
														class="w-14 px-2 py-1 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm text-center" />
													<label for="edit-oip-{equipe.id}" class="text-sm text-surface-500">OIP:</label>
													<input id="edit-oip-{equipe.id}" type="number" min="0" max="20" bind:value={editSlotsOip}
														class="w-14 px-2 py-1 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm text-center" />
													<button
														class="btn preset-filled-primary-500 text-sm px-2 py-1 rounded-lg"
														onclick={() => salvarSlotsEquipe(equipe.id)}
														disabled={salvando}
													>Salvar</button>
													<button
														class="btn preset-outlined-surface text-sm px-2 py-1 rounded-lg"
														onclick={() => (editandoEquipe = null)}
													>×</button>
												</div>
											{:else}
												<span class="text-sm text-surface-500">
													{equipe.slots_dpc} DPC + {equipe.slots_oip} OIP
												</span>
												{#if editandoHorariosEquipeId === equipe.id}
													<div class="flex flex-wrap items-center gap-2">
														<span class="text-sm font-semibold opacity-50 uppercase">Sáb:</span>
														<input type="text" placeholder="08:00" class="w-20 px-2 py-1 text-sm rounded border bg-white dark:bg-surface-900 {editEqHoraEntSab && !validarHora(editEqHoraEntSab) ? 'border-error-500' : 'border-surface-300 dark:border-surface-600'}" bind:value={editEqHoraEntSab} />
														<span class="opacity-30">-</span>
														<input type="text" placeholder="16:00" class="w-20 px-2 py-1 text-sm rounded border bg-white dark:bg-surface-900 {editEqHoraSaiSab && !validarHora(editEqHoraSaiSab) ? 'border-error-500' : 'border-surface-300 dark:border-surface-600'}" bind:value={editEqHoraSaiSab} />
														<span class="opacity-30 mx-1">|</span>
														<span class="text-sm font-semibold opacity-50 uppercase">Dom:</span>
														<input type="text" placeholder="08:00" class="w-20 px-2 py-1 text-sm rounded border bg-white dark:bg-surface-900 {editEqHoraEntDom && !validarHora(editEqHoraEntDom) ? 'border-error-500' : 'border-surface-300 dark:border-surface-600'}" bind:value={editEqHoraEntDom} />
														<span class="opacity-30">-</span>
														<input type="text" placeholder="16:00" class="w-20 px-2 py-1 text-sm rounded border bg-white dark:bg-surface-900 {editEqHoraSaiDom && !validarHora(editEqHoraSaiDom) ? 'border-error-500' : 'border-surface-300 dark:border-surface-600'}" bind:value={editEqHoraSaiDom} />
														<button class="btn btn-sm preset-filled-primary-500 text-sm py-1 px-2 rounded" onclick={() => salvarHorariosEquipe(equipe.id)}>✓</button>
														<button class="btn btn-sm preset-outlined-surface text-sm py-1 px-2 rounded" onclick={() => (editandoHorariosEquipeId = null)}>×</button>
													</div>
												{:else}
													<div class="flex items-center gap-1.5 text-sm text-surface-400 font-medium ml-2">
													<span>Sáb: {equipe.hora_entrada_sabado ?? sec.hora_entrada_sabado ?? gise.hora_entrada_sabado}h-{equipe.hora_saida_sabado ?? sec.hora_saida_sabado ?? gise.hora_saida_sabado}h</span>
													<span class="opacity-30">|</span>
													<span>Dom: {equipe.hora_entrada_domingo ?? sec.hora_entrada_domingo ?? gise.hora_entrada_domingo}h-{equipe.hora_saida_domingo ?? sec.hora_saida_domingo ?? gise.hora_saida_domingo}h</span>
													{#if (equipe.hora_entrada_sabado || equipe.hora_saida_sabado || equipe.hora_entrada_domingo || equipe.hora_saida_domingo)}
														<span class="ml-1 px-1 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold border border-amber-500/20 uppercase">Horário Equipe</span>
													{/if}
												</div>
													{#if isAdminGeral && podeEditar}
														<button
															class="text-sm text-primary-600 hover:underline ml-1 py-0.5"
															onclick={() => {
																editandoHorariosEquipeId = equipe.id;
																editEqHoraEntSab = equipe.hora_entrada_sabado ?? sec.hora_entrada_sabado ?? gise.hora_entrada_sabado ?? '';
																editEqHoraSaiSab = equipe.hora_saida_sabado ?? sec.hora_saida_sabado ?? gise.hora_saida_sabado ?? '';
																editEqHoraEntDom = equipe.hora_entrada_domingo ?? sec.hora_entrada_domingo ?? gise.hora_entrada_domingo ?? '';
																editEqHoraSaiDom = equipe.hora_saida_domingo ?? sec.hora_saida_domingo ?? gise.hora_saida_domingo ?? '';
															}}
														>Editar Horários</button>
													{/if}
												{/if}
												{#if isAdminGeral && podeEditar}
													<button
														class="text-sm text-primary-600 hover:text-primary-500 transition-colors"
														onclick={() => { editandoEquipe = equipe.id; editSlotsDpc = equipe.slots_dpc; editSlotsOip = equipe.slots_oip; }}
													>
														Editar vagas
													</button>
												{/if}
											{/if}
										</div>
										{#if isAdminGeral && podeEditar}
											<button
												class="text-sm text-error-600 hover:text-error-500 p-1"
												onclick={async () => {
													const r = await fetch(`/api/gise/${gise.id}/equipes/${equipe.id}`, { method: 'DELETE' });
													if (r.ok) { toaster.success({ title: 'Equipe removida' }); await invalidateAll(); }
													else { const j = await r.json(); toaster.error({ title: j.error }); }
												}}
											>
												Remover equipe
											</button>
										{/if}
									</div>

									<!-- Feature 3: Membros separados por dia (sábado/domingo) -->
									{#if equipe.membros?.length}
										{@const memsSab = equipe.membros.filter((m: any) => m.dia === 'sabado' || m.dia === 'ambos')}
										{@const memsDom = equipe.membros.filter((m: any) => m.dia === 'domingo' || m.dia === 'ambos')}
										<div class="space-y-2 mb-3">
											<div>
												<p class="text-sm font-bold text-surface-500 uppercase tracking-wide mb-1">Sábado</p>
												{#if memsSab.length}
													<div class="space-y-1">
														{#each memsSab as m}
															<div class="flex items-center justify-between text-sm px-3 py-1.5 rounded-lg bg-surface-100 dark:bg-surface-800">
																<div class="flex items-center gap-2">
																	<span class="font-semibold text-surface-900 dark:text-surface-100">{m.policial_nome}</span>
																	<span class="text-surface-500">{m.policial_cargo} · {m.policial_matricula}</span>
																	{#if m.dia === 'ambos'}<span class="text-sm px-1 py-0.5 rounded bg-primary-200 dark:bg-primary-900 text-primary-700 dark:text-primary-300">Sáb+Dom</span>{/if}
																</div>
																{#if podeEditar && (isAdminGeral || (isSeccional && sec.seccional_id === minhaSeccionalId && (modoEdicaoSeccional || sec.status === 'pendente' || sec.status === 'retificada')))}
																	<button class="text-error-500 hover:text-error-400 transition-colors p-1.5 -mr-1.5 touch-manipulation" onclick={() => removerMembro(m.id)}>×</button>
																{/if}
															</div>
														{/each}
													</div>
												{:else}
													<p class="text-sm text-surface-400 italic">Nenhum escalado</p>
												{/if}
											</div>
											<div>
												<p class="text-sm font-bold text-surface-500 uppercase tracking-wide mb-1">Domingo</p>
												{#if memsDom.length}
													<div class="space-y-1">
														{#each memsDom as m}
															<div class="flex items-center justify-between text-sm px-3 py-1.5 rounded-lg bg-surface-100 dark:bg-surface-800">
																<div class="flex items-center gap-2">
																	<span class="font-semibold text-surface-900 dark:text-surface-100">{m.policial_nome}</span>
																	<span class="text-surface-500">{m.policial_cargo} · {m.policial_matricula}</span>
																	{#if m.dia === 'ambos'}<span class="text-sm px-1 py-0.5 rounded bg-primary-200 dark:bg-primary-900 text-primary-700 dark:text-primary-300">Sáb+Dom</span>{/if}
																</div>
																{#if podeEditar && (isAdminGeral || (isSeccional && sec.seccional_id === minhaSeccionalId && (modoEdicaoSeccional || sec.status === 'pendente' || sec.status === 'retificada')))}
																	<button class="text-error-500 hover:text-error-400 transition-colors p-1.5 -mr-1.5 touch-manipulation" onclick={() => removerMembro(m.id)}>×</button>
																{/if}
															</div>
														{/each}
													</div>
												{:else}
													<p class="text-sm text-surface-400 italic">Nenhum escalado</p>
												{/if}
											</div>
										</div>
									{:else}
										<p class="text-sm text-surface-400 italic mb-3">Nenhum membro alocado</p>
									{/if}

									<!-- Adicionar membro -->
									{#if podeEditar && (isAdminGeral || (isSeccional && sec.seccional_id === minhaSeccionalId && (modoEdicaoSeccional || sec.status === 'pendente' || sec.status === 'retificada')))}
										{#if equipeParaAdicionar === equipe.id}
											<div class="flex flex-wrap gap-2 items-end">
												<div class="flex-1 min-w-32">
													<select
														bind:value={policialParaAdicionar}
														class="w-full px-2 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
													>
														<option value="">Selecionar {cargoParaAdicionar}...</option>
														{#each policiais.filter(p => p.cargo === cargoParaAdicionar) as p}
															<option value={p.id}>{p.nome} ({p.matricula})</option>
														{/each}
													</select>
												</div>
												<select
													bind:value={diaParaAdicionar}
													class="px-2 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
												>
													<option value="ambos">Sáb + Dom</option>
													<option value="sabado">Só Sáb</option>
													<option value="domingo">Só Dom</option>
												</select>
												<button
													class="btn preset-filled-primary-500 text-sm px-2 py-1.5 rounded-lg"
													onclick={() => adicionarMembro(sec.id)}
													disabled={!policialParaAdicionar || salvando}
												>Adicionar</button>
												<button
													class="btn preset-outlined-surface text-sm px-2 py-1.5 rounded-lg"
													onclick={() => { equipeParaAdicionar = null; policialParaAdicionar = ''; cargoParaAdicionar = null; }}
												>×</button>
											</div>
										{:else}
											<div class="flex gap-3">
												<button
													class="text-sm text-primary-600 hover:text-primary-500 transition-colors"
													onclick={() => { equipeParaAdicionar = equipe.id; cargoParaAdicionar = 'OIP'; policialParaAdicionar = ''; }}
												>
													+ Adicionar OIP
												</button>
												{#if equipe.slots_dpc > 0}
													<button
														class="text-sm text-primary-600 hover:text-primary-500 transition-colors"
														onclick={() => { equipeParaAdicionar = equipe.id; cargoParaAdicionar = 'DPC'; policialParaAdicionar = ''; }}
													>
														+ Adicionar DPC
													</button>
												{/if}
											</div>
										{/if}
									{/if}
								</div>
							{/each}

							<!-- Adicionar equipe (Admin Geral) -->
							{#if isAdminGeral && podeEditar}
								{#if adicionandoEquipeSec === sec.id}
									<div class="flex flex-wrap gap-2 items-end mt-3 p-3 rounded-xl border border-dashed border-surface-300 dark:border-surface-600">
										<div>
											<label for="novaEquipeTipo-{sec.id}" class="text-sm font-medium text-surface-600 dark:text-surface-400 block mb-1">Tipo</label>
											<select id="novaEquipeTipo-{sec.id}" bind:value={novaEquipeTipo}
												onchange={() => { if (novaEquipeTipo === 'operacional') { novaEquipeDpc = 1; novaEquipeOip = 3; } else { novaEquipeDpc = 0; novaEquipeOip = 2; } }}
												class="px-2 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm">
												<option value="operacional">Operacional</option>
												<option value="seint">SEINT</option>
											</select>
										</div>
										<div>
											<label for="novaEquipeDpc-{sec.id}" class="text-sm font-medium text-surface-600 dark:text-surface-400 block mb-1">DPC</label>
											<input id="novaEquipeDpc-{sec.id}" type="number" min="0" max="20" bind:value={novaEquipeDpc}
												class="w-14 px-2 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm text-center" />
										</div>
										<div>
											<label for="novaEquipeOip-{sec.id}" class="text-sm font-medium text-surface-600 dark:text-surface-400 block mb-1">OIP</label>
											<input id="novaEquipeOip-{sec.id}" type="number" min="0" max="20" bind:value={novaEquipeOip}
												class="w-14 px-2 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm text-center" />
										</div>
										<button
											class="btn preset-filled-primary-500 text-sm px-3 py-1.5 rounded-lg"
											onclick={() => adicionarEquipe(sec.id)}
											disabled={salvando}
										>Adicionar</button>
										<button
											class="btn preset-outlined-surface text-sm px-2 py-1.5 rounded-lg"
											onclick={() => (adicionandoEquipeSec = null)}
										>Cancelar</button>
									</div>
								{:else}
									<button
										class="text-sm text-primary-600 hover:text-primary-500 transition-colors mt-2"
										onclick={() => { adicionandoEquipeSec = sec.id; novaEquipeTipo = 'operacional'; novaEquipeDpc = 1; novaEquipeOip = 3; }}
									>
										+ Adicionar equipe
									</button>
								{/if}
							{/if}
						</div>
					</div>
				{/if}
			{/each}

			{#if isAdminGeral && podeEditar}
				{#if adicionandoSeccional}
					<div class="mt-4 p-5 rounded-2xl border border-dashed border-primary-500/50 bg-primary-500/5 flex flex-wrap items-end gap-3">
						<div class="flex-1 min-w-[200px]">
							<label for="novaSeccional" class="text-sm font-medium text-surface-600 dark:text-surface-400 block mb-1">Adicionar Seccional</label>
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
						<div class="flex gap-2">
							<button
								class="btn preset-filled-primary-500 text-sm px-4 py-2 rounded-xl"
								onclick={adicionarSeccional}
								disabled={!seccionalParaAdicionarIdx || salvando}
							>
								{salvando ? 'Adicionando...' : 'Confirmar'}
							</button>
							<button
								class="btn preset-outlined-surface text-sm px-4 py-2 rounded-xl"
								onclick={() => (adicionandoSeccional = false)}
							>
								Cancelar
							</button>
						</div>
					</div>
				{:else}
					<button
						class="btn preset-outlined-primary-500 text-sm px-4 py-2 rounded-xl border-dashed mt-4 flex items-center gap-2"
						onclick={buscarSeccionaisDisponiveis}
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
						Adicionar Seccional
					</button>
				{/if}
			{/if}
		</div>


		<!-- Feature 4: Aviso para Admin Seccional sobre retificação -->
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

<!-- Feature 5: Modal Editar Datas/Horários -->
{#if editandoDatasHorarios}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
		<div class="bg-surface-50 dark:bg-surface-900 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
			<h2 class="text-lg font-bold text-surface-900 dark:text-surface-50">Editar Datas e Horários</h2>
			{#if gise?.status === 'assinada' || gise?.status === 'finalizada'}
				<div class="rounded-xl bg-warning-500/10 border border-warning-500/30 px-4 py-2 text-sm text-warning-700 dark:text-warning-400">
					⚠️ A assinatura digital será <strong>revogada</strong> ao salvar.
				</div>
			{/if}
			<div class="grid grid-cols-2 gap-3">
				<div>
					<label for="editDataInicio" class="text-sm font-medium text-surface-600 dark:text-surface-400 block mb-1">Sábado (data)</label>
					<input id="editDataInicio" type="date" bind:value={editDataInicio}
						class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm" />
				</div>
				<div>
					<label for="editDataFim" class="text-sm font-medium text-surface-600 dark:text-surface-400 block mb-1">Domingo (data)</label>
					<input id="editDataFim" type="date" bind:value={editDataFim}
						class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm" />
				</div>
			</div>
			<div class="rounded-xl border border-surface-200 dark:border-surface-700 p-3 space-y-2">
				<p class="text-sm font-semibold text-surface-600 dark:text-surface-400">Horários — Sábado</p>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="editHoraEntradaSabado" class="text-sm text-surface-500 block mb-1">Entrada (h)</label>
						<input id="editHoraEntradaSabado" type="text" placeholder="Ex: 08:00" bind:value={editHoraEntradaSabado}
							class="w-full px-3 py-2 rounded-xl border bg-white dark:bg-surface-800 text-sm {editHoraEntradaSabado && !validarHora(editHoraEntradaSabado) ? 'border-error-500' : 'border-surface-300 dark:border-surface-700'}" />
					</div>
					<div>
						<label for="editHoraSaidaSabado" class="text-sm text-surface-500 block mb-1">Saída (h)</label>
						<input id="editHoraSaidaSabado" type="text" placeholder="Ex: 16:00" bind:value={editHoraSaidaSabado}
							class="w-full px-3 py-2 rounded-xl border bg-white dark:bg-surface-800 text-sm {editHoraSaidaSabado && !validarHora(editHoraSaidaSabado) ? 'border-error-500' : 'border-surface-300 dark:border-surface-700'}" />
					</div>
				</div>
				<p class="text-xs text-surface-400">Formato: HH:MM &nbsp;·&nbsp; ex: 08:00 · 14:30</p>
			</div>
			<div class="rounded-xl border border-surface-200 dark:border-surface-700 p-3 space-y-2">
				<p class="text-sm font-semibold text-surface-600 dark:text-surface-400">Horários — Domingo</p>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="editHoraEntradaDomingo" class="text-sm text-surface-500 block mb-1">Entrada (h)</label>
						<input id="editHoraEntradaDomingo" type="text" placeholder="Ex: 08:00" bind:value={editHoraEntradaDomingo}
							class="w-full px-3 py-2 rounded-xl border bg-white dark:bg-surface-800 text-sm {editHoraEntradaDomingo && !validarHora(editHoraEntradaDomingo) ? 'border-error-500' : 'border-surface-300 dark:border-surface-700'}" />
					</div>
					<div>
						<label for="editHoraSaidaDomingo" class="text-sm text-surface-500 block mb-1">Saída (h)</label>
						<input id="editHoraSaidaDomingo" type="text" placeholder="Ex: 16:00" bind:value={editHoraSaidaDomingo}
							class="w-full px-3 py-2 rounded-xl border bg-white dark:bg-surface-800 text-sm {editHoraSaidaDomingo && !validarHora(editHoraSaidaDomingo) ? 'border-error-500' : 'border-surface-300 dark:border-surface-700'}" />
					</div>
				</div>
				<p class="text-xs text-surface-400">Formato: HH:MM &nbsp;·&nbsp; ex: 08:00 · 14:30</p>
			</div>
			<div class="flex justify-end gap-3">
				<button class="btn preset-outlined-surface text-sm px-4 py-2 rounded-xl" onclick={() => (editandoDatasHorarios = false)}>Cancelar</button>
				<button class="btn preset-filled-primary-500 text-sm px-4 py-2 rounded-xl" onclick={salvarDatasHorarios} disabled={salvando}>
					{salvando ? 'Salvando...' : 'Salvar'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Feature 5: Modal Confirmar Exclusão GISE -->
{#if showExcluirGiseConfirm}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
		<div class="bg-surface-50 dark:bg-surface-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
			<h2 class="text-lg font-bold text-surface-900 dark:text-surface-50">Excluir Escala GISE</h2>
			<p class="text-sm text-surface-600 dark:text-surface-400">
				Esta ação é <strong>irreversível</strong>. Todos os dados desta escala GISE serão permanentemente removidos, incluindo equipes, membros e assinatura digital.
			</p>
			<div class="flex justify-end gap-3">
				<button class="btn preset-outlined-surface text-sm px-4 py-2 rounded-xl" onclick={() => (showExcluirGiseConfirm = false)}>Cancelar</button>
				<button class="btn preset-filled-error-500 text-sm px-4 py-2 rounded-xl" onclick={excluirGise} disabled={excluindo}>
					{#if excluindo}<Spinner size="sm" />{/if}
					{excluindo ? 'Excluindo...' : 'Confirmar Exclusão'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Confirmar Reabrir -->
{#if showReabrirConfirm}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
		<div class="bg-surface-50 dark:bg-surface-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
			<h2 class="text-lg font-bold text-surface-900 dark:text-surface-50">Reabrir Escala GISE</h2>
			<p class="text-sm text-surface-600 dark:text-surface-400">
				A assinatura digital será <strong>revogada</strong> e todas as seccionais voltarão ao status pendente.
				Será necessário que as seccionais reenviem e o supervisor assine novamente.
			</p>
			<div class="flex justify-end gap-3">
				<button class="btn preset-outlined-surface text-sm px-4 py-2 rounded-xl" onclick={() => (showReabrirConfirm = false)}>
					Cancelar
				</button>
				<button
					class="btn preset-filled-warning-500 text-sm px-4 py-2 rounded-xl"
					onclick={reabrirEscala}
					disabled={reabrindo}
				>
					{#if reabrindo}<Spinner size="sm" />{/if}
					{reabrindo ? 'Reabrindo...' : 'Confirmar Reabertura'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Confirmar Finalizar -->
{#if showFinalizarConfirm}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
		<div class="bg-surface-50 dark:bg-surface-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
			<h2 class="text-lg font-bold text-surface-900 dark:text-surface-50">Finalizar Escala GISE</h2>
			<p class="text-sm text-surface-600 dark:text-surface-400">
				A escala será marcada como <strong>Finalizada</strong> e o sistema criará automaticamente a escala do próximo final de semana.
			</p>
			<div class="flex justify-end gap-3">
				<button class="btn preset-outlined-surface text-sm px-4 py-2 rounded-xl" onclick={() => (showFinalizarConfirm = false)}>
					Cancelar
				</button>
				<button
					class="btn preset-filled-error-500 text-sm px-4 py-2 rounded-xl"
					onclick={finalizarGise}
					disabled={finalizando}
				>
					{#if finalizando}<Spinner size="sm" />{/if}
					{finalizando ? 'Finalizando...' : 'Confirmar'}
				</button>
			</div>
		</div>
	</div>
{/if}
{#if showRubricaModal}
	<div class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
		<div class="bg-surface-50 dark:bg-surface-900 rounded-3xl shadow-2xl w-full max-w-lg p-8 space-y-6 border border-white/10">
			<div class="text-center space-y-2">
				<h2 class="text-2xl font-bold text-surface-900 dark:text-surface-50">Rubrica do Supervisor</h2>
				<p class="text-sm text-surface-500">Desenhe sua rubrica no quadro abaixo para assinar a escala de <span class="font-bold text-primary-500 uppercase">{diaSendoAssinado === 'sabado' ? 'Sábado' : 'Domingo'}</span>.</p>
			</div>

			<SignaturePad 
				onConfirm={confirmarRubrica} 
				onCancel={() => (showRubricaModal = false)} 
			/>
			
			<p class="text-sm text-surface-400 text-center italic">
				Esta rubrica será anexada permanentemente ao documento PDF desta escala.
			</p>
		</div>
	</div>
{/if}
