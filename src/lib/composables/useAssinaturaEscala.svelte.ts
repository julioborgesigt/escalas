/**
 * Hook de assinatura de escala (SERPRO, simples).
 * Centraliza toda a lógica de assinatura para reutilização.
 */

import { untrack } from 'svelte';
import { toaster } from '$lib/toast';
import { conectarSerpro, type SerproSignerClient } from '$lib/serpro';
import type { UsuarioLogado } from '$lib/auth';
import { loading } from '$lib/loading.svelte';
import { apiFetch } from '$lib/api-fetch';
import { digestHexParaBase64, executarFluxoAssinaturaToken } from '$lib/assinatura-token';
import { assinarEscalaComPasskey } from '$lib/assinatura-passkey';
import { page } from '$app/state';
import { logger } from '$lib/logger';

interface UseAssinaturaParams {
	getParams: () => {
		escalaId: string;
		isFDS: boolean;
		policiaisCount: number;
		usuario: UsuarioLogado | null;
	};
	onDocumentoAssinado?: (info: unknown) => void;
}

export function useAssinaturaEscala({ getParams, onDocumentoAssinado }: UseAssinaturaParams) {
	const escalaId = $derived(getParams().escalaId);
	const usuario = $derived(getParams().usuario);
	// Estados de assinatura
	let dialogSignOpen = $state(false);

	// SERPRO
	let serproClient = $state<SerproSignerClient | null>(null);
	let serproSignerName = $state('');
	let serproSignerCpf = $state('');

	$effect(() => {
		if (usuario?.nome) {
			untrack(() => {
				if (!serproSignerName) {
					serproSignerName = usuario.nome;
				}
			});
		}
	});

	// Rubrica/Selfie/GPS
	let rubricaCapturada = $state<string | null>(null);
	let selfieCapturada = $state<string | null>(null);
	let gpsCoords = $state<{ lat: number; lng: number } | null>(null);
	let gpsIndisponivel = $state(false);

	async function getCoordinates(): Promise<{ lat: number; lng: number } | null> {
		if (typeof window === 'undefined' || !('geolocation' in navigator)) {
			gpsIndisponivel = true;
			return null;
		}
		try {
			const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
				navigator.geolocation.getCurrentPosition(resolve, reject, {
					enableHighAccuracy: true,
					timeout: 8000,
					maximumAge: 0
				});
			});
			gpsIndisponivel = false;
			return { lat: pos.coords.latitude, lng: pos.coords.longitude };
		} catch (err) {
			gpsIndisponivel = true;
			logger.warn('[AssinaturaEscala] geolocation indisponível', { err: String(err) });
			return null;
		}
	}

	async function conectarSerproClient() {
		if (!serproClient) {
			serproClient = await conectarSerpro();
		}
		return serproClient!;
	}

	async function assinarComSerpro() {
		try {
			const client = await conectarSerproClient();
			loading.show('Conectando ao SERPRO...');

			loading.show('Obtendo coordenadas...');
			gpsCoords = await getCoordinates();

			loading.show('Preparando assinatura...');
			const finResp = await executarFluxoAssinaturaToken({
				prepararUrl: `/api/escalas/${escalaId}/preparar-assinatura`,
				finalizarUrl: `/api/escalas/${escalaId}/finalizar-assinatura`,
				payloadPreparar: { signerName: serproSignerName, signerCpf: serproSignerCpf },
				obterAssinatura: async (prep) => {
					loading.show('Assinando com SERPRO...');
					const serproRes = await client.sign(digestHexParaBase64(prep.messageDigest));
					return { serproCms: serproRes.rawSignature };
				},
				payloadFinalizar: {
					signerName: serproSignerName,
					signerCpf: serproSignerCpf,
					latitude: gpsCoords?.lat,
					longitude: gpsCoords?.lng
				},
				onFinalizando: () => loading.show('Finalizando assinatura...')
			});
			const info: unknown = await finResp.json().catch(() => null);

			toaster.success({ title: 'Escala assinada com sucesso!' });
			onDocumentoAssinado?.(info);
		} catch (err: unknown) {
			toaster.error({
				title: 'Erro na assinatura',
				description: err instanceof Error ? err.message : 'Erro desconhecido'
			});
		} finally {
			loading.hide();
		}
	}

	async function assinarSimples(
		rubrica: string,
		lat?: number,
		lng?: number,
		selfie?: string | null,
		codigoValidação?: string,
		desafioId?: string,
		// Resultado do desafio ativo (head_turn/smile) — exigido pelo servidor
		// quando a flag exigirFotoAssinatura está ligada. Tipo intencionalmente
		// `unknown` para não acoplar este composable ao formato exato; o
		// servidor valida via Zod (livenessChallengeSchema).
		livenessChallenge?: unknown
	) {
		loading.show('Assinando...');
		try {
			// Usamos a geolocalizacao já capturada no SignaturePad ou fall-back
			if (lat && lng) {
				gpsCoords = { lat, lng };
			} else {
				loading.show('Obtendo coordenadas...');
				gpsCoords = await getCoordinates();
			}

			const evidencias = {
				rubrica,
				selfieBase64: selfie,
				latitude: gpsCoords?.lat,
				longitude: gpsCoords?.lng,
				codigoValidação,
				desafioId,
				livenessChallenge
			};

			// Com o reforço de passkey ligado, o caminho de um tiro nem é tentado:
			// o servidor o recusa com 403, e cair nele só produziria um erro
			// confuso depois de o usuário já ter desenhado a rubrica e tirado a
			// foto. A flag vem do `load` do layout, que a lê do cache server-side.
			const info = (page.data.exigirPasskeyAssinatura as boolean | undefined)
				? await assinarEscalaComPasskey(Number(escalaId), evidencias, (rotulo) =>
						loading.show(rotulo)
					)
				: await (async () => {
						loading.show('Assinando...');
						return apiFetch<unknown>(`/api/escalas/${escalaId}/assinar-simples`, {
							method: 'POST',
							body: JSON.stringify(evidencias)
						});
					})();

			toaster.success({ title: 'Escala assinada com sucesso!' });
			onDocumentoAssinado?.(info);
			rubricaCapturada = null;
			selfieCapturada = null;
		} catch (err: unknown) {
			toaster.error({
				title: 'Erro ao assinar',
				description: err instanceof Error ? err.message : 'Erro desconhecido'
			});
		} finally {
			loading.hide();
		}
	}

	function reset() {
		loading.hide();
		dialogSignOpen = false;
		rubricaCapturada = null;
		selfieCapturada = null;
		gpsCoords = null;
	}

	return {
		get assinando() {
			return loading.active;
		},
		get assinandoSimples() {
			return loading.active;
		},
		get dialogSignOpen() {
			return dialogSignOpen;
		},
		set dialogSignOpen(v: boolean) {
			dialogSignOpen = v;
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
		get rubricaCapturada() {
			return rubricaCapturada;
		},
		get selfieCapturada() {
			return selfieCapturada;
		},
		get gpsCoords() {
			return gpsCoords;
		},
		get gpsIndisponivel() {
			return gpsIndisponivel;
		},
		conectarSerproClient,
		assinarComSerpro,
		assinarSimples,
		reset
	};
}
