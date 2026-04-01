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

	const minhaSeccional = $derived(
		isSeccional ? gise?.seccionais?.find((s: any) => s.seccional_id === minhaSeccionalId) : null
	);

	const todasSeccionaisPreenchidas = $derived(
		gise?.seccionais?.length > 0 && gise.seccionais.every((s: any) => s.status === 'preenchida')
	);

	let salvando = $state(false);
	let assinando = $state(false);
	let finalizando = $state(false);
	let showFinalizarConfirm = $state(false);

	let isMobile = $state(true);
	$effect(() => {
		if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
			isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || (window.innerWidth <= 800 && navigator.maxTouchPoints > 0);
		}
	});

	// Supervisor (único por escala)
	let editandoSupervisores = $state(false);
	let supervisorId = $state<number | null>(null);

	// Adicionar membro
	let equipeParaAdicionar = $state<number | null>(null);
	let policialParaAdicionar = $state<number | ''>('');
	let cargoParaAdicionar = $state<'OIP' | 'DPC' | null>(null);
	let modoEdicaoSeccional = $state(false);

	// Edição de slots de equipe
	let editandoEquipe = $state<number | null>(null);
	let editSlotsDpc = $state(0);
	let editSlotsOip = $state(0);

	// Reabrir escala
	let reabrindo = $state(false);
	let showReabrirConfirm = $state(false);

	// Editar data/horários
	let editandoDatasHorarios = $state(false);
	let editDataInicio = $state('');
	let editHoraEntrada = $state('');
	let editHoraSaida = $state('');
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

	function diaSemana(iso: string): string {
		if (!iso) return '';
		const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
		return dias[new Date(iso + 'T12:00:00').getDay()];
	}

	const dpcs = $derived(policiais.filter((p: any) => p.cargo === 'DPC'));

	function checkAllSigned(sec: any) {
		const members = (sec.equipes ?? []).flatMap((eq: any) => eq.membros ?? []);
		if (members.length === 0) return false;
		return members.every((m: any) => m.presenca?.entrada_timestamp && m.presenca?.saida_timestamp);
	}

	function getFaltandoRubrica(sec: any) {
		const members = (sec.equipes ?? []).flatMap((eq: any) => eq.membros ?? []);
		const faltantes = members.filter((m: any) => !m.presenca?.entrada_timestamp || !m.presenca?.saida_timestamp);
		if (faltantes.length === 0) return '';
		return 'Faltando rubrica de: ' + faltantes.map((m: any) => m.policial_nome.split(' ')[0]).join(', ');
	}

	async function salvarSupervisores() {
		salvando = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ supervisor_id: supervisorId })
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			toaster.success({ title: 'Supervisor salvo' });
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
						policial_id: Number(policialParaAdicionar)
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

	// Documento assinado
	let documentoAssinadoInfo = $state<any>(null);
	let assinandoSimples = $state(false);
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

	// Rubrica modal
	let showRubricaModal = $state(false);
	let tipoAssinaturaPendente = $state<'simples' | 'webpki' | 'serpro' | null>(null);
	let rubricaCapturada = $state<string | null>(null);
	let selfieCapturada = $state<string | null>(null);

	$effect(() => {
		if (gise?.id) {
			fetch(`/api/gise/${gise.id}/documento-assinado/info`)
				.then(r => r.ok ? r.json() : null)
				.then(info => { documentoAssinadoInfo = info?.existe ? info : null; })
				.catch(() => {});
		}
	});

	function abrirModalRubrica(tipo: 'simples' | 'webpki' | 'serpro') {
		tipoAssinaturaPendente = tipo;
		showRubricaModal = true;
	}

	async function confirmarRubrica(dataUrl: string, lat?: number, lng?: number, selfie?: string | null) {
		rubricaCapturada = dataUrl;
		selfieCapturada = selfie ?? null;
		showRubricaModal = false;

		if (relatorioSendoAssinado) {
			await executarAssinarRelatorio(dataUrl, lat, lng, selfie);
			relatorioSendoAssinado = null;
		} else if (tipoAssinaturaPendente === 'simples') {
			await executarAssinarSimples(lat, lng);
		} else if (tipoAssinaturaPendente === 'webpki') {
			await executarAssinarComWebPKI(lat, lng);
		} else if (tipoAssinaturaPendente === 'serpro') {
			await executarAssinarComSerpro(lat, lng);
		}
	}

	async function executarAssinarSimples(latitude?: number, longitude?: number) {
		assinandoSimples = true;
		try {
			const r = await fetch(`/api/gise/${gise.id}/assinar-simples`, {
				method: 'POST',
				body: JSON.stringify({ rubrica: rubricaCapturada, latitude, longitude, selfieBase64: selfieCapturada })
			});
			if (r.ok) {
				const blob = await r.blob();
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = `gise_${gise.data_inicio}_confirmada.pdf`;
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

	async function executarAssinarComWebPKI(latitude?: number, longitude?: number) {
		if (!certSelecionado) return;
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
					latitude,
					longitude
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
			rubricaCapturada = null;
			etapaAssinatura = '';
		}
	}

	async function executarAssinarComSerpro(latitude?: number, longitude?: number) {
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
					latitude,
					longitude
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
			rubricaCapturada = null;
			etapaAssinatura = '';
		}
	}

	async function finalizarGise(modo: 'clonada' | 'completa' = 'clonada') {
		finalizando = true;
		try {
			const res = await fetch(`/api/gise/${gise.id}/finalizar`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ modo })
			});
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

	// Relatórios extraordinários pendentes de assinatura
	const pendentesExtra = $derived.by(() => {
		if (!isSupervisor) return [];
		const lista: Array<{ seccionalId: number; tipo: 'extraordinario' }> = [];
		for (const sec of (gise?.seccionais || [])) {
			const relAssinado = data.assinaturasRelatorios?.find(
				(a: any) => (a.seccional_id === sec.seccional_id || a.seccional_id === sec.id) && a.tipo === 'extraordinario'
			);
			if (!relAssinado && checkAllSigned(sec)) {
				lista.push({ seccionalId: sec.seccional_id, tipo: 'extraordinario' });
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

	async function executarAssinarRelatorioLotePKI(certSelecionadoLote: string, ltype: 'webpki' | 'serpro') {
		if (pendentesExtra.length === 0) return;
		if (ltype === 'webpki' && !certSelecionadoLote) return;
		assinandoLote = true;
		progressoLote = { atual: 0, total: pendentesExtra.length };
		etapaAssinatura = 'Iniciando assinatura em lote...';

		try {
			const cert = certificados.find(c => c.thumbprint === certSelecionadoLote);
			const signerName = cert?.subjectName ?? serproSignerName;
			const signerCpf = cert?.cpf ?? serproSignerCpf;

			let pki: any = null;
			let clientSerpro: any = null;

			if (ltype === 'webpki') {
				pki = await initWebPKI();
				etapaAssinatura = 'Conectando ao Web PKI...';
			} else {
				clientSerpro = serproClient ?? (await conectarSerpro());
				serproClient = clientSerpro;
			}

			for (let i = 0; i < pendentesExtra.length; i++) {
				const item = pendentesExtra[i];
				progressoLote.atual = i + 1;
				etapaAssinatura = `Preparando PDF ${i + 1} de ${pendentesExtra.length}...`;

				const prepResp = await fetch(`/api/gise/${gise.id}/relatorios/${item.seccionalId}/preparar-assinatura`, {
					method: 'POST',
					body: JSON.stringify({ signerName, signerCpf, rubrica: null })
				});
				if (!prepResp.ok) throw new Error(`Falha no item ${item.seccionalId}: ` + (await prepResp.json()).error);
				const prepData = await prepResp.json();

				etapaAssinatura = `Assinando Relatório ${i + 1} de ${pendentesExtra.length}...`;

				let rawSignature, certificateBase64, serproCms;

				if (ltype === 'webpki') {
					if (i === 0) certificateBase64 = await lerCertificado(pki, certSelecionadoLote);
					rawSignature = await assinarHash(pki, certSelecionadoLote, prepData.signedAttrsHashHex);
				} else {
					const messageDigestBase64 = btoa(
						prepData.messageDigest.match(/.{2}/g)!.map((h: string) => String.fromCharCode(parseInt(h, 16))).join('')
					);
					const serproRes = await clientSerpro.sign(messageDigestBase64);
					serproCms = serproRes.rawSignature;
				}

				etapaAssinatura = `Finalizando PDF ${i + 1} de ${pendentesExtra.length}...`;

				const finResp = await fetch(`/api/gise/${gise.id}/relatorios/${item.seccionalId}/finalizar-assinatura`, {
					method: 'POST',
					body: JSON.stringify({
						preparedPdf: prepData.preparedPdf,
						rawSignature,
						serproCms,
						certificateBase64: certificateBase64 || '',
						messageDigest: prepData.messageDigest,
						signingTimeISO: prepData.signingTimeISO,
						signerName,
						signerCpf,
						verificationHash: prepData.verificationHash
					})
				});

				if (!finResp.ok) throw new Error(`Falha ao finalizar item ${item.seccionalId}: ` + (await finResp.json()).error);
			}

			toaster.success({ title: 'Lote assinado com sucesso!', description: `${pendentesExtra.length} relatórios assinados digitalmente.` });
			await invalidateAll();
		} catch (err: any) {
			toaster.error({ title: 'Erro no lote', description: err.message });
		} finally {
			assinandoLote = false;
			etapaAssinatura = '';
			progressoLote = { atual: 0, total: 0 };
		}
	}

	async function executarAssinarRelatorio(rubrica: string, latitude?: number, longitude?: number, selfieBase64?: string | null) {
		if (!relatorioSendoAssinado) return;
		salvando = true;

		if (relatorioSendoAssinado.lote) {
			assinandoLote = true;
			progressoLote = { atual: 0, total: relatorioSendoAssinado.lote.length };
			try {
				for (let i = 0; i < relatorioSendoAssinado.lote.length; i++) {
					const item = relatorioSendoAssinado.lote[i];
					progressoLote.atual = i + 1;
					etapaAssinatura = `Assinando ${i + 1} de ${relatorioSendoAssinado.lote.length}...`;
					const res = await fetch(`/api/gise/${gise.id}/relatorios/${item.seccionalId}/assinar`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ tipo: item.tipo, rubrica, latitude, longitude, selfieBase64 })
					});
					if (!res.ok) throw new Error((await res.json()).error);
				}
				toaster.success({ title: 'Lote assinado com sucesso!' });
				relatorioSendoAssinado = null;
				await invalidateAll();
			} catch (e: any) {
				toaster.error({ title: 'Erro ao assinar lote', description: e.message });
			} finally {
				salvando = false;
				assinandoLote = false;
				etapaAssinatura = '';
				progressoLote = { atual: 0, total: 0 };
			}
			return;
		}

		try {
			etapaAssinatura = 'Processando assinatura...';
			const res = await fetch(`/api/gise/${gise.id}/relatorios/${relatorioSendoAssinado.seccionalId}/assinar`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ tipo: relatorioSendoAssinado.tipo, rubrica, latitude, longitude, selfieBase64 })
			});
			if (!res.ok) throw new Error((await res.json()).error);
			toaster.success({ title: 'Relatório assinado com sucesso!' });
			relatorioSendoAssinado = null;
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro ao assinar relatório', description: e.message });
		} finally {
			salvando = false;
			etapaAssinatura = '';
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

	async function abrirEdicaoDatasHorarios() {
		editDataInicio = gise.data_inicio;
		editHoraEntrada = gise.hora_entrada ?? '';
		editHoraSaida = gise.hora_saida ?? '';
		editandoDatasHorarios = true;
	}

	async function salvarDatasHorarios() {
		const horas = [editHoraEntrada, editHoraSaida];
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
					hora_entrada: normalizarHora(editHoraEntrada),
					hora_saida: normalizarHora(editHoraSaida)
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
		const horas = [editSecHoraEnt, editSecHoraSai].filter(Boolean);
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
					hora_entrada: normalizarHora(editSecHoraEnt),
					hora_saida: normalizarHora(editSecHoraSai)
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
		const horas = [editEqHoraEnt, editEqHoraSai].filter(Boolean);
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
					hora_entrada: normalizarHora(editEqHoraEnt),
					hora_saida: normalizarHora(editEqHoraSai)
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
	const podeAssinar = $derived(
		isSupervisor &&
		(gise?.status === 'aguardando_assinatura' || gise?.status === 'assinada') &&
		gise?.supervisor_id === data.usuarioAtual?.id &&
		!documentoAssinadoInfo?.existe
	);
	const podeEditar = $derived(gise?.status !== 'finalizada');
	const podeReabrir = $derived(isAdminGeral && (gise?.status === 'assinada' || gise?.status === 'finalizada'));
	const podeDownload = $derived(isAdminGeral || isSeccional || isSupervisor);
	const editaBloqueado = $derived(gise?.status === 'assinada' || gise?.status === 'finalizada');

	function downloadGise(format: string) {
		if (!gise) return;
		window.open(`/api/gise/${gise.id}/download?format=${format}`, '_blank');
	}

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
					Escala GISE — {diaSemana(gise.data_inicio)}, {fmtDate(gise.data_inicio)}
				</h1>
				<div class="flex items-center gap-2 mt-1">
					<span class="text-sm px-2 py-0.5 rounded-full font-semibold {statusColor(gise.status)}">
						{statusLabel(gise.status)}
					</span>
					<span class="text-sm text-surface-500">
						{gise.hora_entrada}h–{gise.hora_saida}h
					</span>
				</div>
			{/if}
		</div>

		<div class="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 mt-1">
			{#if (isAdminGeral || isSeccional) && gise && podeDownload}
				<button
					class="btn btn-sm preset-outlined-success-500 rounded-lg font-semibold"
					onclick={() => downloadGise('xlsx')}
				>
					Baixar XLSX
				</button>
			{/if}
			{#if isAdminGeral && gise}
				{#if gise.status === 'em_preenchimento' && todasSeccionaisPreenchidas}
					<button
						class="btn btn-sm preset-filled-success-500 rounded-lg font-semibold col-span-2 sm:col-auto flex items-center justify-center gap-1.5"
						onclick={solicitarAssinatura}
						disabled={salvando}
					>
						{#if salvando}<Spinner size="xs" />{/if} Solicitar Assinatura
					</button>
				{/if}
				<button
					class="btn btn-sm preset-outlined-primary-500 rounded-lg font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
					onclick={abrirEdicaoDatasHorarios}
					disabled={editaBloqueado}
				>
					Editar Data/Horários
				</button>
				<button
					class="btn btn-sm preset-outlined-error-500 rounded-lg font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
					onclick={() => (showExcluirGiseConfirm = true)}
					disabled={editaBloqueado}
				>
					Excluir GISE
				</button>
			{/if}
			{#if podeReabrir}
				<button
					class="btn btn-sm preset-outlined-warning-500 rounded-lg font-semibold"
					onclick={() => (showReabrirConfirm = true)}
				>
					Reabrir para Edição
				</button>
			{/if}
			{#if podeFinalizar}
				<button
					class="btn btn-sm preset-outlined-error-500 col-span-2 sm:col-auto rounded-lg font-semibold bg-error-500/10 hover:bg-error-500/20 dark:bg-error-500/15"
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
		<!-- Supervisor -->
		<div class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900 p-5">
			<div class="flex flex-wrap items-start gap-y-1 justify-between mb-3">
				<h2 class="font-semibold text-surface-900 dark:text-surface-50">Supervisor</h2>
				{#if isAdminGeral && podeEditar && !editandoSupervisores}
					<button
						class="text-sm px-3 py-1 rounded-lg font-semibold transition-all {!gise.supervisor_id ? 'btn preset-filled-warning-500 animate-pulse' : 'btn preset-outlined-primary-500'}"
						onclick={() => (editandoSupervisores = true)}
					>
						{!gise.supervisor_id ? 'Definir Supervisor' : 'Editar Supervisor'}
					</button>
				{/if}
			</div>

			{#if editandoSupervisores}
				<div class="mb-3">
					<label for="supId" class="text-sm font-medium text-surface-600 dark:text-surface-400 block mb-1">Supervisor (DPC)</label>
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
				<div class="flex gap-2">
					<button
						class="btn preset-filled-primary-500 text-sm px-3 py-1.5 rounded-lg"
						onclick={salvarSupervisores}
						disabled={salvando}
					>
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
				<div class="p-4 rounded-xl bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
					<div class="flex items-center justify-between">
						<p class="font-semibold text-surface-900 dark:text-surface-100">{gise.supervisor_nome ?? 'Não definido'}</p>
						{#if documentoAssinadoInfo?.existe}
							<span class="text-sm px-2 py-0.5 rounded-full bg-success-500/20 text-success-700 dark:text-success-400 font-bold">ASSINADA</span>
						{:else}
							<span class="text-sm px-2 py-0.5 rounded-full bg-warning-500/20 text-warning-700 dark:text-warning-400 font-bold">PENDENTE</span>
						{/if}
					</div>
					{#if documentoAssinadoInfo?.existe}
						<div class="mt-2 text-sm text-surface-500 space-y-1">
							<p>Assinado por: <span class="text-surface-900 dark:text-surface-100 font-medium">{documentoAssinadoInfo.assinante_nome}</span></p>
							<a href={`/api/gise/${gise.id}/documento-assinado`}
								target="_blank" class="text-primary-600 hover:underline font-semibold flex items-center gap-1 mt-1">
								<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
								Baixar PDF Assinado
							</a>
						</div>
					{/if}
					{#if isAdminGeral || isSeccional}
						<a href={`/api/gise/${gise.id}/download?format=pdf`}
							target="_blank" class="text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 hover:underline text-sm flex items-center gap-1 mt-1">
							<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
							PDF sem Assinatura
						</a>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Card de Escala Assinada -->
		{#if documentoAssinadoInfo?.existe}
			<div class="rounded-2xl border border-success-500/30 bg-success-500/10 p-5 flex items-start gap-4 shadow-sm">
				<div class="bg-success-500 text-white p-2 rounded-full mt-1">
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" /></svg>
				</div>
				<div class="flex-1">
					<h3 class="font-bold text-success-800 dark:text-success-400">Escala GISE Assinada</h3>
					<p class="text-sm text-surface-600 dark:text-surface-300 mt-1">
						Assinado por {documentoAssinadoInfo.assinante_nome}.
					</p>
				</div>
			</div>
		{/if}

		<!-- Seção de assinatura (Supervisor) -->
		{#if podeAssinar}
			<div id="secao-assinatura-digital" class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900 p-5 space-y-4">
				<h3 class="font-bold text-surface-900 dark:text-surface-50">Assinar Escala GISE</h3>

				<!-- Assinatura Simples -->
				<div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
					<div>
						<h4 class="font-semibold text-surface-900 dark:text-surface-50 text-sm">Assinar na Tela (Manual)</h4>
						<p class="text-sm text-surface-500 mt-1">Gera o PDF com sua rubrica manual (validade interna).</p>
					</div>
					{#if isMobile}
						<button
							class="btn preset-filled-primary-500 text-sm px-4 py-2 rounded-xl"
							disabled={assinandoSimples}
							onclick={() => abrirModalRubrica('simples')}
						>
							{#if assinandoSimples}<Spinner size="sm" />{/if}
							{assinandoSimples ? 'Gerando PDF...' : 'Assinar na Tela'}
						</button>
					{:else}
						<div class="text-xs text-error-500 max-w-xs text-right italic font-semibold border-l-2 border-error-500 pl-2">
							A assinatura em tela é restrita a dispositivos móveis. Utilize o Token A3 abaixo no computador.
						</div>
					{/if}
				</div>

				<hr class="border-surface-200 dark:border-surface-700" />

				<!-- Assinatura Digital -->
				<h3 class="font-semibold text-surface-900 dark:text-surface-50 text-sm">
					Assinatura Digital (eToken / Certificado A3)
				</h3>

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
						onclick={() => executarAssinarComWebPKI()}
						disabled={assinando || !certSelecionado}
					>
						{#if assinando && certificados.length > 0}
							<span class="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></span>
							{etapaAssinatura}
						{:else}
							Assinar com Web PKI
						{/if}
					</button>

					<button
						class="btn preset-filled-tertiary-500 text-sm px-4 py-2 rounded-xl"
						onclick={() => executarAssinarComSerpro()}
						disabled={assinando || !certSelecionado}
					>
						{#if assinando && serproClient}
							<span class="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></span>
							{etapaAssinatura}
						{:else}
							Assinar com SERPRO
						{/if}
					</button>
				</div>
			</div>
		{/if}

		<!-- Bloco de Lote de Assinaturas Extraordinárias (Supervisor) -->
		{#if pendentesExtra.length > 0}
			<div class="rounded-2xl border border-warning-500/30 bg-warning-50 dark:bg-warning-900/10 p-5 mb-5 shadow-sm space-y-4">
				<div>
					<h3 class="font-bold text-warning-800 dark:text-warning-400 flex items-center gap-2">
						<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
						Assinaturas Pendentes
					</h3>
					<p class="text-sm text-warning-700 dark:text-warning-300 mt-1">
						Você possui <strong>{pendentesExtra.length} relatório(s) extraordinário(s)</strong> aptos para assinatura em lote.
					</p>
				</div>

				{#if assinandoLote}
					<div class="flex flex-col items-center gap-1">
						<div class="text-xs font-bold text-warning-700">{etapaAssinatura}</div>
						<progress class="progress rounded bg-surface-200 dark:bg-surface-700 w-full h-2" value={progressoLote.atual} max={progressoLote.total}></progress>
					</div>
				{:else}
					<button class="btn preset-filled-warning-500 font-bold justify-center w-full sm:w-auto flex items-center gap-2" onclick={() => abrirAssinaturaLote()}>
						<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
						Assinar na Tela (Manual)
					</button>

					<div class="border-t border-warning-200 dark:border-warning-800/40 pt-3 space-y-3">
						<p class="text-xs font-bold text-warning-700 dark:text-warning-400 uppercase tracking-wide">Assinatura Digital em Lote — Token A3 / SERPRO</p>

						{#if !podeAssinar}
							<div class="p-3 bg-white/60 dark:bg-surface-800/60 rounded-xl border border-warning-200 dark:border-warning-800/30 flex flex-col sm:flex-row sm:items-center gap-2">
								<button
									class="btn btn-sm preset-outlined-primary-500 rounded-lg whitespace-nowrap shrink-0"
									onclick={carregarCertificadosLocais}
									disabled={lendoCertificados}
								>
									{#if lendoCertificados}<Spinner size="xs" />{/if}
									{lendoCertificados ? 'Lendo...' : 'Ler Token A3'}
								</button>
								{#if certificados.length > 0}
									<select
										bind:value={certSelecionado}
										onchange={(e) => { const c = certificados.find(x => x.thumbprint === e.currentTarget.value); if (c) { serproSignerName = c.subjectName; serproSignerCpf = c.cpf || ''; } }}
										class="w-full px-3 py-1.5 rounded-lg border border-warning-300 dark:border-warning-700 bg-white dark:bg-surface-800 text-xs"
									>
										<option value="">Selecione o certificado...</option>
										{#each certificados as cert (cert.thumbprint)}
											<option value={cert.thumbprint}>{cert.subjectName}{cert.cpf ? ` (CPF: ${cert.cpf})` : ''}</option>
										{/each}
									</select>
								{:else if tentouLerCertificados}
									<p class="text-xs text-error-500">Nenhum certificado encontrado. Verifique se o token está conectado e a extensão <strong>Web PKI</strong> instalada.</p>
								{:else}
									<p class="text-xs text-surface-500 italic">Clique em "Ler Token A3" para listar os certificados disponíveis.</p>
								{/if}
							</div>
						{/if}

						<div class="flex flex-col sm:flex-row gap-2">
							<button
								class="btn preset-tonal-primary font-bold justify-center flex-1 flex items-center gap-2"
								onclick={() => executarAssinarRelatorioLotePKI(certSelecionado, 'webpki')}
								disabled={!certSelecionado || lendoCertificados}
							>
								<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
								Lote: Token A3 (Web PKI)
							</button>
							<button
								class="btn preset-tonal-secondary font-bold justify-center flex-1"
								onclick={() => executarAssinarRelatorioLotePKI('', 'serpro')}
							>
								Lote: SERPRO Desktop
							</button>
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

			{#each (gise.seccionais ?? []) as sec}
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
										<input type="text" placeholder="08:00" class="w-20 px-2 py-1 text-sm rounded border bg-white dark:bg-surface-900 {editSecHoraEnt && !validarHora(editSecHoraEnt) ? 'border-error-500' : 'border-surface-300 dark:border-surface-600'}" bind:value={editSecHoraEnt} />
										<span class="opacity-30">-</span>
										<input type="text" placeholder="16:00" class="w-20 px-2 py-1 text-sm rounded border bg-white dark:bg-surface-900 {editSecHoraSai && !validarHora(editSecHoraSai) ? 'border-error-500' : 'border-surface-300 dark:border-surface-600'}" bind:value={editSecHoraSai} />
										<button class="btn btn-sm preset-filled-primary-500 text-sm py-1 px-2 rounded" onclick={() => salvarHorariosSec(sec.id)}>✓</button>
										<button class="btn btn-sm preset-outlined-surface text-sm py-1 px-2 rounded" onclick={() => (editandoHorariosSecId = null)}>×</button>
									</div>
								{:else}
									<div class="flex items-center gap-1.5 text-sm text-surface-500 font-medium ml-2">
										<span>{sec.hora_entrada ?? gise.hora_entrada}h-{sec.hora_saida ?? gise.hora_saida}h</span>
										{#if sec.hora_entrada || sec.hora_saida}
											<span class="ml-1 px-1 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold border border-amber-500/20">PERSONALIZADO</span>
										{/if}
									</div>
									{#if isAdminGeral && podeEditar}
										<button
											class="text-sm text-primary-600 hover:underline ml-1 py-0.5"
											onclick={() => {
												editandoHorariosSecId = sec.id;
												editSecHoraEnt = sec.hora_entrada ?? gise.hora_entrada ?? '';
												editSecHoraSai = sec.hora_saida ?? gise.hora_saida ?? '';
											}}
										>Editar Horários</button>
									{/if}
								{/if}
							</div>

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
						</div>

						<!-- Ações Seccional & Downloads -->
						<div class="flex flex-col sm:flex-row sm:items-center gap-4 px-5 pb-3 bg-surface-100 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700">
							{#if podeDownload}
								{@const assRel = data.assinaturasRelatorios?.find((a: any) => (a.seccional_id === sec.seccional_id || a.seccional_id === sec.id) && a.tipo === 'extraordinario')}
								<div class="flex flex-wrap items-center gap-3">
									<button
										class="btn btn-sm preset-tonal-success text-xs font-bold px-3 py-2 rounded-xl flex items-center gap-2 transition-all disabled:opacity-60 dark:disabled:opacity-40 disabled:grayscale-[0.5] w-full sm:w-auto justify-center"
										onclick={() => window.open(`/api/gise/${gise.id}/download?format=produtividade&seccionalId=${sec.seccional_id}`, '_blank')}
										disabled={!sec.temRespostas}
										title={!sec.temRespostas ? 'Aguardando preenchimento do formulário' : 'Baixar Resultados de Produtividade'}
									>
										<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
										<span>Resultados</span>
										{#if !sec.temRespostas}
											<span class="text-[0.6rem] opacity-100 dark:opacity-80 font-normal italic ml-1">(aguardando)</span>
										{/if}
									</button>

									<div class="flex flex-col gap-1 w-full sm:w-auto">
										<button
											class="btn btn-sm text-xs font-bold px-3 py-2 rounded-xl flex items-center gap-2 transition-all disabled:opacity-60 dark:disabled:opacity-40 disabled:grayscale-[0.5] justify-center {assRel ? 'preset-filled-primary-500' : 'preset-tonal-primary'} w-full"
											onclick={() => window.open(`/api/gise/${gise.id}/download?format=extraordinario&seccionalId=${sec.seccional_id}`, '_blank')}
											disabled={!checkAllSigned(sec) || (!assRel && !(isAdminGeral || isSeccional || isSupervisor))}
											title={!checkAllSigned(sec) ? getFaltandoRubrica(sec) : (assRel ? `Assinado por ${assRel.assinante_nome}` : 'Aguardando assinatura do supervisor')}
										>
											<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
											<span class="whitespace-nowrap">Relat. Extraordinário</span>
											{#if !assRel}
												<span class="text-[0.6rem] opacity-100 dark:opacity-80 font-normal italic ml-1">({!checkAllSigned(sec) ? 'não concluído' : 'conferência'})</span>
											{/if}
										</button>
										{#if isSupervisor && !assRel && checkAllSigned(sec)}
											{#if isMobile}
												<button class="btn btn-xs preset-filled-warning-500 text-[0.65rem] py-1 rounded shadow-sm w-full font-bold uppercase transition-all" onclick={() => abrirAssinaturaRelatorio(sec.seccional_id, 'extraordinario')}>
													Assinatura Manual
												</button>
											{:else}
												<div class="text-[0.6rem] text-surface-500 mt-1 italic w-full text-center">Use o Painel de Lote (acima) para Token A3</div>
											{/if}
										{/if}
									</div>
								</div>
							{/if}

							<!-- Ações -->
							<div class="flex items-center gap-2 sm:ml-auto">
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
														<input type="text" placeholder="08:00" class="w-20 px-2 py-1 text-sm rounded border bg-white dark:bg-surface-900 {editEqHoraEnt && !validarHora(editEqHoraEnt) ? 'border-error-500' : 'border-surface-300 dark:border-surface-600'}" bind:value={editEqHoraEnt} />
														<span class="opacity-30">-</span>
														<input type="text" placeholder="16:00" class="w-20 px-2 py-1 text-sm rounded border bg-white dark:bg-surface-900 {editEqHoraSai && !validarHora(editEqHoraSai) ? 'border-error-500' : 'border-surface-300 dark:border-surface-600'}" bind:value={editEqHoraSai} />
														<button class="btn btn-sm preset-filled-primary-500 text-sm py-1 px-2 rounded" onclick={() => salvarHorariosEquipe(equipe.id)}>✓</button>
														<button class="btn btn-sm preset-outlined-surface text-sm py-1 px-2 rounded" onclick={() => (editandoHorariosEquipeId = null)}>×</button>
													</div>
												{:else}
													<div class="flex items-center gap-1.5 text-sm text-surface-400 font-medium ml-2">
														<span>{equipe.hora_entrada ?? sec.hora_entrada ?? gise.hora_entrada}h-{equipe.hora_saida ?? sec.hora_saida ?? gise.hora_saida}h</span>
														{#if equipe.hora_entrada || equipe.hora_saida}
															<span class="ml-1 px-1 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold border border-amber-500/20 uppercase">Horário Equipe</span>
														{/if}
													</div>
													{#if isAdminGeral && podeEditar}
														<button
															class="text-sm text-primary-600 hover:underline ml-1 py-0.5"
															onclick={() => {
																editandoHorariosEquipeId = equipe.id;
																editEqHoraEnt = equipe.hora_entrada ?? sec.hora_entrada ?? gise.hora_entrada ?? '';
																editEqHoraSai = equipe.hora_saida ?? sec.hora_saida ?? gise.hora_saida ?? '';
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

									<!-- Membros -->
									{#if equipe.membros?.length}
										<div class="space-y-1 mb-3">
											{#each equipe.membros as m}
												<div class="flex items-center justify-between text-sm px-3 py-1.5 rounded-lg bg-surface-100 dark:bg-surface-800">
													<div class="flex items-center gap-2">
														<span class="font-semibold text-surface-900 dark:text-surface-100">{m.policial_nome}</span>
														<span class="text-surface-500">{m.policial_cargo} · {m.policial_matricula}</span>
														{#if m.presenca?.entrada_timestamp && m.presenca?.saida_timestamp}
															<span class="text-xs px-1 py-0.5 rounded bg-success-500/20 text-success-700 dark:text-success-400">✓</span>
														{:else if m.presenca?.entrada_timestamp}
															<span class="text-xs px-1 py-0.5 rounded bg-warning-500/20 text-warning-700 dark:text-warning-400">Entrada</span>
														{/if}
													</div>
													{#if podeEditar && (isAdminGeral || (isSeccional && sec.seccional_id === minhaSeccionalId && (modoEdicaoSeccional || sec.status === 'pendente' || sec.status === 'retificada')))}
														<button class="text-error-500 hover:text-error-400 transition-colors p-1.5 -mr-1.5 touch-manipulation" onclick={() => removerMembro(m.id)}>×</button>
													{/if}
												</div>
											{/each}
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
{#if editandoDatasHorarios}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
		<div class="bg-surface-50 dark:bg-surface-900 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
			<h2 class="text-lg font-bold text-surface-900 dark:text-surface-50">Editar Data e Horários</h2>
			{#if gise?.status === 'assinada' || gise?.status === 'finalizada'}
				<div class="rounded-xl bg-warning-500/10 border border-warning-500/30 px-4 py-2 text-sm text-warning-700 dark:text-warning-400">
					⚠️ A assinatura digital será <strong>revogada</strong> ao salvar.
				</div>
			{/if}
			<div>
				<label for="editDataInicio" class="text-sm font-medium text-surface-600 dark:text-surface-400 block mb-1">Data</label>
				<input id="editDataInicio" type="date" bind:value={editDataInicio}
					class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm" />
			</div>
			<div class="rounded-xl border border-surface-200 dark:border-surface-700 p-3 space-y-2">
				<p class="text-sm font-semibold text-surface-600 dark:text-surface-400">Horários</p>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="editHoraEntrada" class="text-sm text-surface-500 block mb-1">Entrada</label>
						<input id="editHoraEntrada" type="text" placeholder="Ex: 08:00" bind:value={editHoraEntrada}
							class="w-full px-3 py-2 rounded-xl border bg-white dark:bg-surface-800 text-sm {editHoraEntrada && !validarHora(editHoraEntrada) ? 'border-error-500' : 'border-surface-300 dark:border-surface-700'}" />
					</div>
					<div>
						<label for="editHoraSaida" class="text-sm text-surface-500 block mb-1">Saída</label>
						<input id="editHoraSaida" type="text" placeholder="Ex: 16:00" bind:value={editHoraSaida}
							class="w-full px-3 py-2 rounded-xl border bg-white dark:bg-surface-800 text-sm {editHoraSaida && !validarHora(editHoraSaida) ? 'border-error-500' : 'border-surface-300 dark:border-surface-700'}" />
					</div>
				</div>
				<p class="text-xs text-surface-400">Formato: HH:MM · ex: 08:00 · 14:30</p>
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

<!-- Modal Confirmar Exclusão GISE -->
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
		<div class="bg-surface-50 dark:bg-surface-900 rounded-3xl shadow-2xl w-full max-w-md p-8 space-y-6 border border-white/10">
			<div class="text-center space-y-2">
				<h2 class="text-2xl font-bold text-surface-900 dark:text-surface-50">Finalizar Escala GISE</h2>
				<p class="text-sm text-surface-500">
					A escala atual será marcada como <span class="font-bold text-surface-900 dark:text-surface-50 uppercase">Finalizada</span>.
					Como deseja abrir a próxima escala?
				</p>
			</div>

			<div class="space-y-3 pt-2">
				<button
					class="w-full btn py-4 rounded-2xl flex flex-col items-center gap-1 group transition-all duration-300 border border-primary-500/30 hover:bg-primary-500/10 text-primary-600 dark:text-primary-400"
					onclick={() => finalizarGise('completa')}
					disabled={finalizando}
				>
					<span class="font-bold text-base">1 — Abrir nova escala completa</span>
					<span class="text-xs opacity-70">Inclui todas as seccionais padrão do sistema</span>
				</button>

				<button
					class="w-full btn py-4 rounded-2xl flex flex-col items-center gap-1 group transition-all duration-300 border border-secondary-500/30 hover:bg-secondary-500/10 text-secondary-600 dark:text-secondary-400"
					onclick={() => finalizarGise('clonada')}
					disabled={finalizando}
				>
					<span class="font-bold text-base">2 — Abrir nos moldes atual</span>
					<span class="text-xs opacity-70">Copia as seccionais e equipes desta escala</span>
				</button>
			</div>

			<div class="pt-2">
				<button
					class="w-full text-sm text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors py-2"
					onclick={() => (showFinalizarConfirm = false)}
					disabled={finalizando}
				>
					Cancelar e voltar
				</button>
			</div>
		</div>
	</div>
{/if}

{#if showRubricaModal}
	<div class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
		<div class="bg-surface-50 dark:bg-surface-900 rounded-3xl shadow-2xl w-full max-w-2xl p-4 sm:p-8 space-y-6 border border-white/10">
			<div class="text-center space-y-2">
				<h2 class="text-2xl font-bold text-surface-900 dark:text-surface-50">Rubrica do Supervisor</h2>
				<p class="text-sm text-surface-500">Desenhe sua rubrica no quadro abaixo para assinar a escala.</p>
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
