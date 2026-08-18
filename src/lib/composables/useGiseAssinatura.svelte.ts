/**
 * Hook que concentra todos os fluxos de assinatura da página GISE detalhada:
 *   - Modal de rubrica (captura + roteamento de destino)
 *   - Assinatura simples da escala GISE (fetch + download do PDF)
 *   - Assinatura com token SERPRO (escala + relatórios extraordinários)
 *   - Assinatura em lote de relatórios (manual e digital via SERPRO)
 *
 * Os estados `painelTokenGise`, `painelTokenRelatorio`, `serproSigner*`,
 * `rubricaCapturada` são expostos com getters/setters para funcionar com
 * `bind:` nas props dos componentes filho (`GiseSupervisao`,
 * `ModalRelatorioDigital`).
 */

import { invalidateShared } from '$lib/cross-tab-invalidate';
import { toaster } from '$lib/toast';
import { baixarBlob } from '$lib/utils/download';
import { loading } from '$lib/loading.svelte';
import { apiFetch, apiFetchResponse } from '$lib/api-fetch';
import { digestHexParaBase64, executarFluxoAssinaturaToken } from '$lib/assinatura-token';
import { assinarGiseComPasskey, assinarExtraComPasskey } from '$lib/assinatura-passkey';
import { ehErroReauthAssinatura } from '$lib/assinatura-reauth';
import { page } from '$app/state';
import { conectarSerpro, type SerproSignerClient } from '$lib/serpro';
import type { SignaturePadConfirmPayload } from '$lib/components/SignaturePadTypes';
import { mensagemDeErro } from '$lib/utils/erro';

type PendenteExtra = {
	seccionalId: number;
	tipo: 'extraordinario';
};

type PainelToken = {
	assinarComSerpro: () => Promise<void>;
} | null;

type RelatorioSendoAssinado = {
	lote?: PendenteExtra[];
	seccionalId?: number;
	tipo?: 'extraordinario' | 'produtividade';
} | null;

interface UseGiseAssinaturaParams {
	getGiseId: () => number;
	/** Usado para nomear o arquivo PDF baixado após `assinar-simples`. */
	getGiseDataInicio: () => string | undefined;
	/** Lista de relatórios extraordinários pendentes (derivada na página). */
	getPendentesExtra: () => PendenteExtra[];
	/** Nome inicial do signatário (usuário logado). */
	initialSignerName?: string;
	/** CPF inicial do signatário (usuário logado). */
	initialSignerCpf?: string;
}

export function useGiseAssinatura({
	getGiseId,
	getGiseDataInicio,
	getPendentesExtra,
	initialSignerName = '',
	initialSignerCpf = ''
}: UseGiseAssinaturaParams) {
	let etapaAssinatura = $state('');
	let assinandoLote = $state(false);
	let progressoLote = $state({ atual: 0, total: 0 });

	// Modal de rubrica
	let showRubricaModal = $state(false);
	let tipoAssinaturaPendente = $state<'simples' | 'serpro' | null>(null);
	let rubricaCapturada = $state<string | null>(null);
	let selfieCapturada = $state<string | null>(null);

	// SERPRO — escala GISE principal
	let serproClient = $state<SerproSignerClient | null>(null);
	let painelTokenGise = $state<PainelToken>(null);
	let serproSignerName = $state(initialSignerName);
	let serproSignerCpf = $state(initialSignerCpf);

	// SERPRO — relatórios extraordinários (modal separado)
	let painelTokenRelatorio = $state<PainelToken>(null);
	let relatorioSignerName = $state(initialSignerName);
	let relatorioSignerCpf = $state(initialSignerCpf);

	// Relatório alvo (lote ou singular) quando o usuário aciona "Assinar em tela"
	let relatorioSendoAssinado = $state<RelatorioSendoAssinado>(null);

	function abrirModalRubrica(tipo: 'simples' | 'serpro') {
		tipoAssinaturaPendente = tipo;
		showRubricaModal = true;
	}

	function fecharModalRubrica() {
		showRubricaModal = false;
	}

	async function confirmarRubrica(payload: SignaturePadConfirmPayload) {
		const {
			rubrica: dataUrl,
			lat,
			lng,
			selfie,
			codigoEmail: codigoValidação,
			desafioId,
			liveness: livenessChallenge,
			reauthId
		} = payload;
		rubricaCapturada = dataUrl;
		selfieCapturada = selfie ?? null;

		try {
			if (relatorioSendoAssinado) {
				await executarAssinarRelatorio(
					dataUrl,
					lat,
					lng,
					selfie,
					codigoValidação,
					desafioId,
					livenessChallenge,
					reauthId
				);
				relatorioSendoAssinado = null;
			} else if (tipoAssinaturaPendente === 'simples') {
				await executarAssinarSimples(
					lat,
					lng,
					codigoValidação,
					desafioId,
					livenessChallenge,
					reauthId
				);
			} else if (tipoAssinaturaPendente === 'serpro') {
				await executarAssinarComSerpro(lat, lng);
			}
			showRubricaModal = false;
		} catch (e: unknown) {
			if (ehErroReauthAssinatura(e)) throw e;
			toaster.error({ title: 'Erro ao assinar', description: mensagemDeErro(e) });
			showRubricaModal = false;
		}
	}

	async function executarAssinarSimples(
		latitude?: number,
		longitude?: number,
		codigoValidação?: string,
		desafioId?: string,
		livenessChallenge?: unknown,
		reauthId?: string
	) {
		const giseId = getGiseId();
		const evidencias = {
			rubrica: rubricaCapturada ?? '',
			latitude,
			longitude,
			selfieBase64: selfieCapturada,
			codigoValidação,
			desafioId,
			livenessChallenge,
			reauthId
		};
		try {
			if (page.data.exigirPasskeyAssinatura) {
				loading.show('Assinando com a chave...');
				await assinarGiseComPasskey(giseId, evidencias, (rotulo) => loading.show(rotulo));
			} else {
				loading.show('Assinando e gerando PDF...');
				const r = await apiFetchResponse(`/api/gise/${giseId}/assinar-simples`, {
					method: 'POST',
					body: JSON.stringify(evidencias)
				});
				baixarBlob(await r.blob(), `gise_${getGiseDataInicio() ?? giseId}_confirmada.pdf`);
			}
			toaster.success({ title: 'Escala confirmada com sucesso' });
			await invalidateShared('gise:detail');
		} catch (e: unknown) {
			if (ehErroReauthAssinatura(e)) throw e;
			toaster.error({ title: 'Erro ao assinar', description: mensagemDeErro(e) });
		} finally {
			loading.hide();
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
				title: mensagemDeErro(err, 'Erro ao conectar ao SERPRO')
			});
		}
	}

	function abrirAssinaturaLote() {
		relatorioSendoAssinado = { lote: getPendentesExtra() };
		abrirModalRubrica('simples');
	}

	function abrirAssinaturaRelatorio(seccionalId: number, tipo: 'extraordinario' | 'produtividade') {
		relatorioSendoAssinado = { seccionalId, tipo };
		abrirModalRubrica('simples');
	}

	async function executarAssinarRelatorioLoteSERPRO() {
		const pendentesExtra = getPendentesExtra();
		if (pendentesExtra.length === 0) return;
		assinandoLote = true;
		progressoLote = { atual: 0, total: pendentesExtra.length };
		etapaAssinatura = 'Iniciando assinatura em lote...';

		try {
			const signerName = serproSignerName;
			const signerCpf = serproSignerCpf;

			const clientSerpro = serproClient ?? (await conectarSerpro());
			serproClient = clientSerpro;
			const giseId = getGiseId();

			for (let i = 0; i < pendentesExtra.length; i++) {
				const item = pendentesExtra[i];
				progressoLote.atual = i + 1;
				etapaAssinatura = `Preparando PDF ${i + 1} de ${pendentesExtra.length}...`;

				try {
					await executarFluxoAssinaturaToken({
						prepararUrl: `/api/gise/${giseId}/relatorios/${item.seccionalId}/preparar-assinatura`,
						finalizarUrl: `/api/gise/${giseId}/relatorios/${item.seccionalId}/finalizar-assinatura`,
						payloadPreparar: { signerName, signerCpf, rubrica: null },
						obterAssinatura: async (prep) => {
							etapaAssinatura = `Assinando Relatório ${i + 1} de ${pendentesExtra.length}...`;
							const serproRes = await clientSerpro.sign(digestHexParaBase64(prep.messageDigest));
							return { serproCms: serproRes.rawSignature };
						},
						payloadFinalizar: { signerName, signerCpf },
						onFinalizando: () => {
							etapaAssinatura = `Finalizando PDF ${i + 1} de ${pendentesExtra.length}...`;
						}
					});
				} catch (e: unknown) {
					throw new Error(`Falha no item ${item.seccionalId}: ${mensagemDeErro(e)}`, {
						cause: e
					});
				}
			}

			toaster.success({
				title: 'Lote assinado com sucesso!',
				description: `${pendentesExtra.length} relatórios assinados digitalmente.`
			});
			await invalidateShared('gise:detail');
		} catch (err: unknown) {
			toaster.error({ title: 'Erro no lote', description: mensagemDeErro(err) });
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
		desafioId?: string,
		livenessChallenge?: unknown,
		reauthId?: string
	) {
		if (!relatorioSendoAssinado) return;
		loading.show('Iniciando assinatura...');
		const giseId = getGiseId();

		if (relatorioSendoAssinado.lote) {
			const lote = relatorioSendoAssinado.lote;
			assinandoLote = true;
			progressoLote = { atual: 0, total: lote.length };
			try {
				for (let i = 0; i < lote.length; i++) {
					const item = lote[i];
					progressoLote.atual = i + 1;
					etapaAssinatura = `Assinando ${i + 1} de ${lote.length}...`;
					const body = {
						tipo: item.tipo,
						rubrica,
						latitude,
						longitude,
						selfieBase64,
						codigoValidação,
						desafioId,
						livenessChallenge,
						reauthId
					};
					if (page.data.exigirPasskeyAssinatura) {
						await assinarExtraComPasskey(giseId, item.seccionalId, body, (rotulo) => {
							etapaAssinatura = rotulo;
						});
					} else {
						await apiFetch(`/api/gise/${giseId}/relatorios/${item.seccionalId}/assinar`, {
							method: 'POST',
							body: JSON.stringify(body)
						});
					}
				}
				toaster.success({ title: 'Lote assinado com sucesso!' });
				relatorioSendoAssinado = null;
				await invalidateShared('gise:detail');
			} catch (e: unknown) {
				if (ehErroReauthAssinatura(e)) throw e;
				toaster.error({
					title: 'Erro ao assinar lote',
					description: mensagemDeErro(e)
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
			const body = {
				tipo: relatorioSendoAssinado.tipo,
				rubrica,
				latitude,
				longitude,
				selfieBase64,
				codigoValidação,
				desafioId,
				livenessChallenge,
				reauthId
			};
			if (page.data.exigirPasskeyAssinatura) {
				const secId = relatorioSendoAssinado.seccionalId;
				if (secId == null) {
					toaster.error({ title: 'Erro ao assinar', description: 'Seccional não identificada.' });
					return;
				}
				await assinarExtraComPasskey(giseId, secId, body, (rotulo) => (etapaAssinatura = rotulo));
			} else {
				await apiFetch(
					`/api/gise/${giseId}/relatorios/${relatorioSendoAssinado.seccionalId}/assinar`,
					{ method: 'POST', body: JSON.stringify(body) }
				);
			}
			toaster.success({ title: 'Relatório assinado com sucesso!' });
			relatorioSendoAssinado = null;
			await invalidateShared('gise:detail');
		} catch (e: unknown) {
			if (ehErroReauthAssinatura(e)) throw e;
			toaster.error({
				title: 'Erro ao assinar relatório',
				description: mensagemDeErro(e)
			});
		} finally {
			loading.hide();
			etapaAssinatura = '';
		}
	}

	return {
		get etapaAssinatura() {
			return etapaAssinatura;
		},
		set etapaAssinatura(v: string) {
			etapaAssinatura = v;
		},

		get assinandoLote() {
			return assinandoLote;
		},
		get progressoLote() {
			return progressoLote;
		},

		get showRubricaModal() {
			return showRubricaModal;
		},
		set showRubricaModal(v: boolean) {
			showRubricaModal = v;
		},

		get tipoAssinaturaPendente() {
			return tipoAssinaturaPendente;
		},

		get rubricaCapturada() {
			return rubricaCapturada;
		},
		set rubricaCapturada(v: string | null) {
			rubricaCapturada = v;
		},

		get selfieCapturada() {
			return selfieCapturada;
		},
		set selfieCapturada(v: string | null) {
			selfieCapturada = v;
		},

		get serproClient() {
			return serproClient;
		},

		get painelTokenGise() {
			return painelTokenGise;
		},
		set painelTokenGise(v: PainelToken) {
			painelTokenGise = v;
		},

		get serproSignerName() {
			return serproSignerName;
		},
		set serproSignerName(v: string) {
			serproSignerName = v;
		},

		get serproSignerCpf() {
			return serproSignerCpf;
		},
		set serproSignerCpf(v: string) {
			serproSignerCpf = v;
		},

		get painelTokenRelatorio() {
			return painelTokenRelatorio;
		},
		set painelTokenRelatorio(v: PainelToken) {
			painelTokenRelatorio = v;
		},

		get relatorioSignerName() {
			return relatorioSignerName;
		},
		set relatorioSignerName(v: string) {
			relatorioSignerName = v;
		},

		get relatorioSignerCpf() {
			return relatorioSignerCpf;
		},
		set relatorioSignerCpf(v: string) {
			relatorioSignerCpf = v;
		},

		get relatorioSendoAssinado() {
			return relatorioSendoAssinado;
		},
		set relatorioSendoAssinado(v: RelatorioSendoAssinado) {
			relatorioSendoAssinado = v;
		},

		abrirModalRubrica,
		fecharModalRubrica,
		confirmarRubrica,
		executarAssinarSimples,
		executarAssinarComSerpro,
		prepararSerproLote,
		executarAssinarRelatorioLoteSERPRO,
		executarAssinarRelatorio,
		abrirAssinaturaLote,
		abrirAssinaturaRelatorio
	};
}
