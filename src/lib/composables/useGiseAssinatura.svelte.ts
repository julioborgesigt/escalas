/**
 * Hook de assinatura digital para página GISE detalhada.
 * Centraliza WebPKI, SERPRO, assinatura simples, relatórios e lotes.
 */

import { invalidateAll } from '$app/navigation';
import { toaster } from '$lib/toast';
import { csrfHeaders } from '$lib/csrf';
import { conectarSerpro, type SerproSignerClient } from '$lib/serpro';

export interface UseGiseAssinaturaParams {
	getGiseId: () => number;
}

export function useGiseAssinatura({ getGiseId }: UseGiseAssinaturaParams) {
	// Estados de assinatura
	let assinandoSimples = $state(false);
	let assinandoLote = $state(false);
	let progressoLote = $state({ atual: 0, total: 0 });
	let etapaAssinatura = $state('');
	let rubricaCapturada = $state<string | null>(null);
	let selfieCapturada = $state<string | null>(null);
	let tipoAssinaturaPendente = $state<'simples' | 'serpro' | null>(null);
	let showRubricaModal = $state(false);
	let documentoAssinadoInfo = $state<any>(null);

	// SERPRO
	let serproClient = $state<SerproSignerClient | null>(null);
	let serproSignerName = $state('');
	let serproSignerCpf = $state('');
	let painelTokenGise = $state<any>(null);

	// Relatório sendo assinado
	let relatorioSendoAssinado = $state<{
		lote?: Array<{ seccionalId: number; tipo: 'extraordinario' }>;
		seccionalId?: number;
		tipo?: 'extraordinario' | 'produtividade';
	} | null>(null);

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

	async function executarAssinarSimples(latitude?: number, longitude?: number, codigoValidação?: string, desafioId?: string) {
		assinandoSimples = true;
		try {
			const r = await fetch(`/api/gise/${getGiseId()}/assinar-simples`, {
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
				a.download = `gise_${getGiseId()}_confirmada.pdf`;
				a.click();
				toaster.success({ title: 'Escala confirmada com sucesso' });
				await invalidateAll();
			} else {
				const j = await r.json();
				toaster.error({ title: j.error || 'Erro ao assinar' });
			}
		} catch {
			toaster.error({ title: 'Erro de conexão' });
		} finally {
			assinandoSimples = false;
			rubricaCapturada = null;
		}
	}

	async function executarAssinarComSerpro(_lat?: number, _lng?: number) {
		await painelTokenGise?.assinarComSerpro();
	}

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

	async function executarAssinarRelatorioLoteSERPRO(pendentesExtra: any[]) {
		if (pendentesExtra.length === 0) return;
		assinandoLote = true;
		progressoLote = { atual: 0, total: pendentesExtra.length };
		etapaAssinatura = 'Iniciando assinatura em lote...';

		try {
			let clientSerpro = serproClient ?? (await conectarSerpro());
			serproClient = clientSerpro;

			for (let i = 0; i < pendentesExtra.length; i++) {
				const item = pendentesExtra[i];
				progressoLote.atual = i + 1;
				etapaAssinatura = `Preparando PDF ${i + 1} de ${pendentesExtra.length}...`;

				const prepResp = await fetch(
					`/api/gise/${getGiseId()}/relatorios/${item.seccionalId}/preparar-assinatura`,
					{
						method: 'POST',
						headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
						body: JSON.stringify({ signerName: serproSignerName, signerCpf: serproSignerCpf, rubrica: null })
					}
				);
				if (!prepResp.ok) throw new Error(`Falha no item ${item.seccionalId}: ` + (await prepResp.json()).error);
				const prepData = await prepResp.json();

				etapaAssinatura = `Assinando Relatório ${i + 1} de ${pendentesExtra.length}...`;
				const messageDigestBase64 = btoa(prepData.messageDigest.match(/.{2}/g)!.map((h: string) => String.fromCharCode(parseInt(h, 16))).join(''));
				const serproRes = await clientSerpro.sign(messageDigestBase64);

				etapaAssinatura = `Finalizando PDF ${i + 1} de ${pendentesExtra.length}...`;
				const finResp = await fetch(
					`/api/gise/${getGiseId()}/relatorios/${item.seccionalId}/finalizar-assinatura`,
					{
						method: 'POST',
						headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
						body: JSON.stringify({
							preparedPdf: prepData.preparedPdf,
							serproCms: serproRes.rawSignature,
							messageDigest: prepData.messageDigest,
							signingTimeISO: prepData.signingTimeISO,
							signerName: serproSignerName,
							signerCpf: serproSignerCpf,
							verificationHash: prepData.verificationHash
						})
					}
				);
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

	async function executarAssinarRelatorio(
		rubrica: string,
		latitude?: number,
		longitude?: number,
		selfieBase64?: string | null,
		codigoValidação?: string,
		desafioId?: string
	) {
		if (!relatorioSendoAssinado) return;
		// Implementation continues...
	}

	function abrirAssinaturaLote(pendentesExtra: any[]) {
		relatorioSendoAssinado = { lote: pendentesExtra };
		abrirModalRubrica('simples');
	}

	function abrirAssinaturaRelatorio(seccionalId: number, tipo: 'extraordinario' | 'produtividade') {
		relatorioSendoAssinado = { seccionalId, tipo };
		abrirModalRubrica('simples');
	}

	async function finalizarGise() {
		try {
			const res = await fetch(`/api/gise/${getGiseId()}/finalizar`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...csrfHeaders() }
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error);
			toaster.success({ title: 'Escala finalizada!' });
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		}
	}

	function resetRubrica() {
		rubricaCapturada = null;
		selfieCapturada = null;
		showRubricaModal = false;
		tipoAssinaturaPendente = null;
	}

	return {
		get assinandoSimples() { return assinandoSimples; },
		get assinandoLote() { return assinandoLote; },
		get progressoLote() { return progressoLote; },
		get etapaAssinatura() { return etapaAssinatura; },
		get rubricaCapturada() { return rubricaCapturada; },
		get selfieCapturada() { return selfieCapturada; },
		get showRubricaModal() { return showRubricaModal; },
		get documentoAssinadoInfo() { return documentoAssinadoInfo; },
		get serproSignerName() { return serproSignerName; },
		get serproSignerCpf() { return serproSignerCpf; },
		get painelTokenGise() { return painelTokenGise; },
		set painelTokenGise(v: any) { painelTokenGise = v; },
		get relatorioSendoAssinado() { return relatorioSendoAssinado; },
		abrirModalRubrica,
		confirmarRubrica,
		executarAssinarSimples,
		executarAssinarComSerpro,
		prepararSerproLote,
		executarAssinarRelatorioLoteSERPRO,
		abrirAssinaturaLote,
		abrirAssinaturaRelatorio,
		finalizarGise,
		resetRubrica
	};
}
