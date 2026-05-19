/**
 * Hook de assinatura de escala (WebPKI, SERPRO, simples).
 * Centraliza toda a lógica de assinatura para reutilização.
 */

import { toaster } from '$lib/toast';
import {
	initWebPKI,
	listarCertificados,
	assinarHash,
	type WebPKICertificate,
} from '$lib/webpki';
import { conectarSerpro, type SerproSignerClient } from '$lib/serpro';
import type { UsuarioLogado } from '$lib/auth';
import { loading } from '$lib/loading.svelte';
import { apiFetch } from '$lib/api-fetch';
import { logger } from '$lib/logger';
import { page } from '$app/state';

export interface UseAssinaturaParams {
	getParams: () => {
		escalaId: string;
		isFDS: boolean;
		policiaisCount: number;
		usuario: UsuarioLogado | null;
	};
	onDocumentoAssinado?: (info: any) => void;
}

export function useAssinaturaEscala({
	getParams,
	onDocumentoAssinado
}: UseAssinaturaParams) {
	const escalaId = $derived(getParams().escalaId);
	const isFDS = $derived(getParams().isFDS);
	const policiaisCount = $derived(getParams().policiaisCount);
	const usuario = $derived(getParams().usuario);
	// Estados de assinatura
	let dialogSignOpen = $state(false);

	// WebPKI
	let certificados = $state<WebPKICertificate[]>([]);
	let certSelecionado = $state('');
	let lendoCertificados = $state(false);
	let tentouLerCertificados = $state(false);
	let pkInstance = $state<any>(null);

	// SERPRO
	let serproClient = $state<SerproSignerClient | null>(null);
	let serproSignerName = $state(usuario?.nome ?? '');
	let serproSignerCpf = $state('');

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

	async function loadCertificados() {
		lendoCertificados = true;
		tentouLerCertificados = true;
		try {
			if (!pkInstance) {
				// Licença Lacuna propagada do server via +layout.server.ts.
				// `null` em dev/localhost (gratuito) ou ausência de config; ambos
				// os casos retornam undefined para initWebPKI (legado).
				const lic = (page.data?.webPkiLicense as string | null | undefined) ?? undefined;
				pkInstance = await initWebPKI(lic);
			}
			certificados = await listarCertificados(pkInstance);
		} catch (err) {
			logger.warn('[AssinaturaEscala] listar certificados Web PKI', { err: String(err) });
			certificados = [];
		} finally {
			lendoCertificados = false;
		}
	}

	function onCertSelecionado(alias: string) {
		certSelecionado = alias;
	}

	async function assinarComWebPKI() {
		loading.show('Obtendo coordenadas...');
		gpsCoords = await getCoordinates();

		loading.show('Preparando assinatura...');
		const prepData = await apiFetch<any>(`/api/escalas/${escalaId}/preparar-assinatura`, {
			method: 'POST',
			body: JSON.stringify({ signerName: '', signerCpf: '' })
		});

		loading.show('Assinando com token...');
		const hash = btoa(prepData.messageDigest.match(/.{2}/g).map((h: string) => String.fromCharCode(parseInt(h, 16))).join(''));
		const signature = await assinarHash(pkInstance, certSelecionado, hash);

		loading.show('Finalizando assinatura...');
		const info = await apiFetch<any>(`/api/escalas/${escalaId}/finalizar-assinatura`, {
			method: 'POST',
			body: JSON.stringify({
				preparedPdf: prepData.preparedPdf,
				serproCms: signature,
				messageDigest: prepData.messageDigest,
				signingTimeISO: prepData.signingTimeISO,
				signerName: serproSignerName,
				signerCpf: serproSignerCpf,
				verificationHash: prepData.verificationHash,
				latitude: gpsCoords?.lat,
				longitude: gpsCoords?.lng
			})
		});

		toaster.success({ title: 'Escala assinada com sucesso!' });
		onDocumentoAssinado?.(info);
		loading.hide();
	}

	async function conectarSerproClient() {
		if (!serproClient) {
			serproClient = await conectarSerpro();
		}
		return serproClient!;
	}

	async function assinarComSerpro() {
		loading.show('Conectando ao SERPRO...');
		const client = await conectarSerproClient();

		loading.show('Obtendo coordenadas...');
		gpsCoords = await getCoordinates();

		loading.show('Preparando assinatura...');
		const prepData = await apiFetch<any>(`/api/escalas/${escalaId}/preparar-assinatura`, {
			method: 'POST',
			body: JSON.stringify({ signerName: serproSignerName, signerCpf: serproSignerCpf })
		});

		loading.show('Assinando com SERPRO...');
		const messageDigestBase64 = btoa(prepData.messageDigest.match(/.{2}/g).map((h: string) => String.fromCharCode(parseInt(h, 16))).join(''));
		const serproRes = await client.sign(messageDigestBase64);

		loading.show('Finalizando assinatura...');
		const info = await apiFetch<any>(`/api/escalas/${escalaId}/finalizar-assinatura`, {
			method: 'POST',
			body: JSON.stringify({
				preparedPdf: prepData.preparedPdf,
				serproCms: serproRes.rawSignature,
				messageDigest: prepData.messageDigest,
				signingTimeISO: prepData.signingTimeISO,
				signerName: serproSignerName,
				signerCpf: serproSignerCpf,
				verificationHash: prepData.verificationHash,
				latitude: gpsCoords?.lat,
				longitude: gpsCoords?.lng
			})
		});

		toaster.success({ title: 'Escala assinada com sucesso!' });
		onDocumentoAssinado?.(info);
		loading.hide();
	}

	async function assinarSimples(
		rubrica: string,
		lat?: number,
		lng?: number,
		selfie?: string | null,
		codigoValidação?: string,
		desafioId?: string,
		// Resultado do desafio ativo (blink/smile) — exigido pelo servidor
		// quando a flag exigirFotoAssinatura está ligada. Tipo intencionalmente
		// `unknown` para não acoplar este composable ao formato exato; o
		// servidor valida via Zod (livenessChallengeSchema).
		livenessChallenge?: unknown
	) {
		loading.show('Assinando...');
		// Usamos a geolocalizacao já capturada no SignaturePad ou fall-back
		if (lat && lng) {
			gpsCoords = { lat, lng };
		} else {
			loading.show('Obtendo coordenadas...');
			gpsCoords = await getCoordinates();
		}

		loading.show('Assinando...');
		const info = await apiFetch<any>(`/api/escalas/${escalaId}/assinar-simples`, {
			method: 'POST',
			body: JSON.stringify({
				rubrica,
				selfieBase64: selfie,
				latitude: gpsCoords?.lat,
				longitude: gpsCoords?.lng,
				codigoValidação,
				desafioId,
				livenessChallenge
			})
		});

		toaster.success({ title: 'Escala assinada com sucesso!' });
		onDocumentoAssinado?.(info);
		rubricaCapturada = null;
		selfieCapturada = null;
		loading.hide();
	}

	function reset() {
		loading.hide();
		dialogSignOpen = false;
		rubricaCapturada = null;
		selfieCapturada = null;
		gpsCoords = null;
	}

	return {
		get assinando() { return loading.active; },
		get assinandoSimples() { return loading.active; },
		get dialogSignOpen() { return dialogSignOpen; },
		set dialogSignOpen(v: boolean) { dialogSignOpen = v; },
		get certificados() { return certificados; },
		get certSelecionado() { return certSelecionado; },
		set certSelecionado(v: string) { certSelecionado = v; },
		get lendoCertificados() { return lendoCertificados; },
		get tentouLerCertificados() { return tentouLerCertificados; },
		get serproSignerName() { return serproSignerName; },
		set serproSignerName(v: string) { serproSignerName = v; },
		get serproSignerCpf() { return serproSignerCpf; },
		set serproSignerCpf(v: string) { serproSignerCpf = v; },
		get rubricaCapturada() { return rubricaCapturada; },
		get selfieCapturada() { return selfieCapturada; },
		get gpsCoords() { return gpsCoords; },
		get gpsIndisponivel() { return gpsIndisponivel; },
		loadCertificados,
		onCertSelecionado,
		assinarComWebPKI,
		conectarSerproClient,
		assinarComSerpro,
		assinarSimples,
		reset
	};
}
