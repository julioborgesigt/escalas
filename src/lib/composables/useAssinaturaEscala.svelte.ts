/**
 * Hook de assinatura de escala (WebPKI, SERPRO, simples).
 * Centraliza toda a lógica de assinatura para reutilização.
 */

import { untrack } from 'svelte';
import { toaster } from '$lib/toast';
import {
	initWebPKI,
	listarCertificados,
	assinarHash,
	lerCertificado,
	type WebPKICertificate,
} from '$lib/webpki';
import { conectarSerpro, type SerproSignerClient } from '$lib/serpro';
import type { UsuarioLogado } from '$lib/auth';
import { csrfHeaders } from '$lib/csrf';
import { loading } from '$lib/loading.svelte';

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
	let serproSignerName = $state(untrack(() => usuario?.nome ?? ''));
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
		} catch {
			gpsIndisponivel = true;
			console.warn('[Assinatura] GPS indisponível — coordenadas não serão registradas.');
			return null;
		}
	}

	async function loadCertificados() {
		lendoCertificados = true;
		tentouLerCertificados = true;
		try {
			if (!pkInstance) {
				pkInstance = await initWebPKI();
			}
			certificados = await listarCertificados(pkInstance);
		} catch (e) {
			if (import.meta.env.DEV) {
				console.warn('[Assinatura] listar certificados Web PKI', e);
			}
			certificados = [];
		} finally {
			lendoCertificados = false;
		}
	}

	async function onCertSelecionado(alias: string) {
		certSelecionado = alias;
		if (pkInstance) {
			try {
				const info = await lerCertificado(pkInstance, alias);
				// info is base64 string, we just store it for later use
			} catch (e) {
				if (import.meta.env.DEV) {
					console.warn('[Assinatura] ler certificado', e);
				}
			}
		}
	}

	async function assinarComWebPKI() {
		loading.show('Obtendo coordenadas...');
		gpsCoords = await getCoordinates();

		loading.show('Preparando assinatura...');
		const prepRes = await fetch(`/api/escalas/${escalaId}/preparar-assinatura`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
			body: JSON.stringify({ signerName: '', signerCpf: '' })
		});
		if (!prepRes.ok) throw new Error((await prepRes.json()).error);
		const prepData = await prepRes.json();

		loading.show('Assinando com token...');
		const hash = btoa(prepData.messageDigest.match(/.{2}/g).map((h: string) => String.fromCharCode(parseInt(h, 16))).join(''));
		const signature = await assinarHash(pkInstance, certSelecionado, hash);

		loading.show('Finalizando assinatura...');
		const finRes = await fetch(`/api/escalas/${escalaId}/finalizar-assinatura`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
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
		if (!finRes.ok) throw new Error((await finRes.json()).error);

		toaster.success({ title: 'Escala assinada com sucesso!' });
		const info = await finRes.json();
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
		const prepRes = await fetch(`/api/escalas/${escalaId}/preparar-assinatura`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
			body: JSON.stringify({ signerName: serproSignerName, signerCpf: serproSignerCpf })
		});
		if (!prepRes.ok) throw new Error((await prepRes.json()).error);
		const prepData = await prepRes.json();

		loading.show('Assinando com SERPRO...');
		const messageDigestBase64 = btoa(prepData.messageDigest.match(/.{2}/g).map((h: string) => String.fromCharCode(parseInt(h, 16))).join(''));
		const serproRes = await client.sign(messageDigestBase64);

		loading.show('Finalizando assinatura...');
		const finRes = await fetch(`/api/escalas/${escalaId}/finalizar-assinatura`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
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
		if (!finRes.ok) throw new Error((await finRes.json()).error);

		toaster.success({ title: 'Escala assinada com sucesso!' });
		const info = await finRes.json();
		onDocumentoAssinado?.(info);
		loading.hide();
	}

	async function assinarSimples(rubrica: string, lat?: number, lng?: number, selfie?: string | null, codigoValidação?: string, desafioId?: string) {
		loading.show('Assinando...');
		// Usamos a geolocalizacao já capturada no SignaturePad ou fall-back
		if (lat && lng) {
			gpsCoords = { lat, lng };
		} else {
			loading.show('Obtendo coordenadas...');
			gpsCoords = await getCoordinates();
		}

		loading.show('Assinando...');
		const res = await fetch(`/api/escalas/${escalaId}/assinar-simples`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
			body: JSON.stringify({
				rubrica,
				selfieBase64: selfie,
				latitude: gpsCoords?.lat,
				longitude: gpsCoords?.lng,
				codigoValidação,
				desafioId
			})
		});
		if (!res.ok) throw new Error((await res.json()).error);

		toaster.success({ title: 'Escala assinada com sucesso!' });
		const info = await res.json();
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
		get etapaAssinatura() { return ''; },
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
