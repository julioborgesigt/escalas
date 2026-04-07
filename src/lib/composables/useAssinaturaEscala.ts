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

export interface UseAssinaturaParams {
	escalaId: string;
	isFDS: boolean;
	policiaisCount: number;
	usuario: UsuarioLogado | null;
	onDocumentoAssinado?: (info: any) => void;
}

export function useAssinaturaEscala({
	escalaId,
	usuario,
	onDocumentoAssinado
}: UseAssinaturaParams) {
	// Estados de assinatura
	let assinando = $state(false);
	let etapaAssinatura = $state('');
	let assinandoSimples = $state(false);
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

	async function getCoordinates(): Promise<{ lat: number; lng: number } | null> {
		if (typeof window === 'undefined' || !('geolocation' in navigator)) return null;
		try {
			const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
				navigator.geolocation.getCurrentPosition(resolve, reject, {
					enableHighAccuracy: true,
					timeout: 8000,
					maximumAge: 0
				});
			});
			return { lat: pos.coords.latitude, lng: pos.coords.longitude };
		} catch {
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
		} catch {
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
			} catch { /* ignora */ }
		}
	}

	async function assinarComWebPKI() {
		assinando = true;
		etapaAssinatura = 'Obtendo coordenadas...';
		gpsCoords = await getCoordinates();

		etapaAssinatura = 'Preparando assinatura...';
		const prepRes = await fetch(`/api/escalas/${escalaId}/preparar-assinatura`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
			body: JSON.stringify({ signerName: '', signerCpf: '' })
		});
		if (!prepRes.ok) throw new Error((await prepRes.json()).error);
		const prepData = await prepRes.json();

		etapaAssinatura = 'Assinando com token...';
		const hash = btoa(prepData.messageDigest.match(/.{2}/g).map((h: string) => String.fromCharCode(parseInt(h, 16))).join(''));
		const signature = await assinarHash(pkInstance, certSelecionado, hash);

		etapaAssinatura = 'Finalizando assinatura...';
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
	}

	async function conectarSerproClient() {
		if (!serproClient) {
			serproClient = await conectarSerpro();
		}
		return serproClient!;
	}

	async function assinarComSerpro() {
		assinando = true;
		etapaAssinatura = 'Conectando ao SERPRO...';
		const client = await conectarSerproClient();

		etapaAssinatura = 'Obtendo coordenadas...';
		gpsCoords = await getCoordinates();

		etapaAssinatura = 'Preparando assinatura...';
		const prepRes = await fetch(`/api/escalas/${escalaId}/preparar-assinatura`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
			body: JSON.stringify({ signerName: serproSignerName, signerCpf: serproSignerCpf })
		});
		if (!prepRes.ok) throw new Error((await prepRes.json()).error);
		const prepData = await prepRes.json();

		etapaAssinatura = 'Assinando com SERPRO...';
		const messageDigestBase64 = btoa(prepData.messageDigest.match(/.{2}/g).map((h: string) => String.fromCharCode(parseInt(h, 16))).join(''));
		const serproRes = await client.sign(messageDigestBase64);

		etapaAssinatura = 'Finalizando assinatura...';
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
	}

	async function assinarSimples(rubrica: string, selfie?: string | null) {
		assinandoSimples = true;
		etapaAssinatura = 'Obtendo coordenadas...';
		gpsCoords = await getCoordinates();

		etapaAssinatura = 'Assinando...';
		const res = await fetch(`/api/escalas/${escalaId}/assinar-simples`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
			body: JSON.stringify({
				rubrica,
				selfieBase64: selfie,
				latitude: gpsCoords?.lat,
				longitude: gpsCoords?.lng
			})
		});
		if (!res.ok) throw new Error((await res.json()).error);

		toaster.success({ title: 'Escala assinada com sucesso!' });
		const info = await res.json();
		onDocumentoAssinado?.(info);
		rubricaCapturada = null;
		selfieCapturada = null;
	}

	function reset() {
		assinando = false;
		etapaAssinatura = '';
		assinandoSimples = false;
		dialogSignOpen = false;
		rubricaCapturada = null;
		selfieCapturada = null;
		gpsCoords = null;
	}

	return {
		get assinando() { return assinando; },
		get etapaAssinatura() { return etapaAssinatura; },
		get assinandoSimples() { return assinandoSimples; },
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
		loadCertificados,
		onCertSelecionado,
		assinarComWebPKI,
		conectarSerproClient,
		assinarComSerpro,
		assinarSimples,
		reset
	};
}
