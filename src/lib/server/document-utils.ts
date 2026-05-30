/**
 * Utilitários para segurança jurídica de documentos digitais.
 *
 * Funções reutilizáveis entre os endpoints de preparação e finalização
 * de assinatura, e pelo módulo de geração de PDF.
 */

// ---------------------------------------------------------------------------
// Hash SHA-256 do arquivo original
// ---------------------------------------------------------------------------

/**
 * Calcula o hash SHA-256 de um buffer de bytes (PDF original, antes de qualquer
 * modificação visual ou criptográfica).
 *
 * Usa a Web Crypto API nativa (crypto.subtle), disponível tanto em
 * Cloudflare Workers quanto em Node.js 18+.
 *
 * @returns Hash em formato hexadecimal (64 caracteres lowercase)
 */
export async function calcularHashBuffer(bytes: Uint8Array): Promise<string> {
	const hashBuffer = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
	const hashArray = new Uint8Array(hashBuffer);
	return Array.from(hashArray)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

// ---------------------------------------------------------------------------
// Parser de User-Agent
// ---------------------------------------------------------------------------

interface UAResult {
	browser: string;
	browserVersion: string;
	os: string;
	device: 'Desktop' | 'Mobile' | 'Tablet' | 'Bot' | 'Desconhecido';
}

/**
 * Converte a string bruta do User-Agent em formato legível para impressão em PDF.
 *
 * Em vez de exibir "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537...",
 * retorna "Chrome 114 / Windows 10 / Desktop".
 *
 * Cobre os navegadores mais comuns em ambientes corporativos:
 * Chrome, Firefox, Edge, Safari, Opera, Samsung Browser.
 */
export function parseUserAgent(ua: string): string {
	if (!ua || ua === 'N/A') return 'Desconhecido';

	try {
		const parsed = parseUAInternal(ua);
		const parts: string[] = [];

		if (parsed.browser) {
			parts.push(parsed.browserVersion ? `${parsed.browser} ${parsed.browserVersion}` : parsed.browser);
		}

		if (parsed.os) {
			parts.push(parsed.os);
		}

		if (parsed.device && parsed.device !== 'Desktop') {
			parts.push(parsed.device);
		}

		return parts.length > 0 ? parts.join(' / ') : ua.slice(0, 60);
	} catch {
		return ua.slice(0, 60);
	}
}

function parseUAInternal(ua: string): UAResult {
	const result: UAResult = {
		browser: 'Desconhecido',
		browserVersion: '',
		os: 'Desconhecido',
		device: 'Desconhecido'
	};

	// --- Sistema Operacional ---
	if (/Windows NT 10\.0/.test(ua)) result.os = 'Windows 10/11';
	else if (/Windows NT 6\.3/.test(ua)) result.os = 'Windows 8.1';
	else if (/Windows NT 6\.1/.test(ua)) result.os = 'Windows 7';
	else if (/Windows/.test(ua)) result.os = 'Windows';
	else if (/Mac OS X ([\d_]+)/.test(ua)) {
		const v = ua.match(/Mac OS X ([\d_]+)/)?.[1]?.replace(/_/g, '.') ?? '';
		result.os = `macOS ${v}`;
	} else if (/Android ([\d.]+)/.test(ua)) {
		const v = ua.match(/Android ([\d.]+)/)?.[1] ?? '';
		result.os = `Android ${v}`;
	} else if (/iPhone OS ([\d_]+)/.test(ua)) {
		const v = ua.match(/iPhone OS ([\d_]+)/)?.[1]?.replace(/_/g, '.') ?? '';
		result.os = `iOS ${v}`;
	} else if (/iPad; CPU OS ([\d_]+)/.test(ua)) {
		const v = ua.match(/CPU OS ([\d_]+)/)?.[1]?.replace(/_/g, '.') ?? '';
		result.os = `iPadOS ${v}`;
	} else if (/Linux/.test(ua)) {
		result.os = 'Linux';
	} else if (/CrOS/.test(ua)) {
		result.os = 'Chrome OS';
	}

	// --- Dispositivo ---
	if (/Mobile/.test(ua)) result.device = 'Mobile';
	else if (/Tablet|iPad/.test(ua)) result.device = 'Tablet';
	else if (/bot|crawl|spider/i.test(ua)) result.device = 'Bot';
	else result.device = 'Desktop';

	// --- Navegador (ordem importa: Edge/OPR antes de Chrome/Safari) ---
	let m: RegExpMatchArray | null;

	if ((m = ua.match(/Edg\/([0-9.]+)/))) {
		result.browser = 'Edge';
		result.browserVersion = m[1].split('.')[0];
	} else if ((m = ua.match(/OPR\/([0-9.]+)/))) {
		result.browser = 'Opera';
		result.browserVersion = m[1].split('.')[0];
	} else if ((m = ua.match(/SamsungBrowser\/([0-9.]+)/))) {
		result.browser = 'Samsung Browser';
		result.browserVersion = m[1].split('.')[0];
	} else if ((m = ua.match(/Firefox\/([0-9.]+)/))) {
		result.browser = 'Firefox';
		result.browserVersion = m[1].split('.')[0];
	} else if ((m = ua.match(/Chrome\/([0-9.]+)/))) {
		result.browser = 'Chrome';
		result.browserVersion = m[1].split('.')[0];
	} else if ((m = ua.match(/Version\/([0-9.]+).*Safari/))) {
		result.browser = 'Safari';
		result.browserVersion = m[1].split('.')[0];
	} else if (/MSIE|Trident/.test(ua)) {
		result.browser = 'Internet Explorer';
	}

	return result;
}

// ---------------------------------------------------------------------------
// Formatação de CPF (LGPD)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Determinação do tipo de carimbo de tempo
// ---------------------------------------------------------------------------

export type TipoCarimoTempo = 'servidor' | 'act_icp' | 'tsa_externa';

/**
 * Retorna a descrição legível do tipo de carimbo para exibição no PDF.
 */
export function descreverTipoCarimbo(tipo: TipoCarimoTempo): string {
	switch (tipo) {
		case 'act_icp':
			return 'Carimbo de Tempo (ACT) ICP-Brasil';
		case 'tsa_externa':
			return 'Carimbo de Tempo (TSA externa, não-ICP)';
		default:
			return 'Data/Hora do Sistema (Servidor)';
	}
}
