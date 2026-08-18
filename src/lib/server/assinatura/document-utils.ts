/**
 * Utilitários para segurança jurídica de documentos digitais.
 *
 * Funções reutilizáveis entre os endpoints de preparação e finalização
 * de assinatura, e pelo módulo de geração de PDF.
 */
import { bytesToHex } from '$lib/crypto/hex';

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
	return bytesToHex(hashArray);
}

// ---------------------------------------------------------------------------
// GPS (minimização LGPD)
// ---------------------------------------------------------------------------

/**
 * Reduz a coordenada a 2 casas decimais (~1 km).
 *
 * A evidência exigida é "a assinatura ocorreu nesta região", não a localização
 * exata do servidor — guardar menos precisão é o mínimo necessário (LGPD, art.
 * 6º III). Estava reescrita como `gps2` em quatro módulos de dados.
 */
export function reduzirPrecisaoGps(v?: number): number | undefined {
	return v !== undefined ? Math.round(v * 100) / 100 : undefined;
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
 * Reduz o user-agent bruto a `Navegador versão / SO / dispositivo` — a forma que
 * é gravada nos documentos assinados, nos aceites de termo e na auditoria
 * (`Desktop` é omitido por ser o caso comum).
 *
 * Minimização LGPD: o UA completo é impressão digital razoavelmente única
 * (plugins, build, arquitetura). Navegador e sistema bastam para a conferência
 * de "assinou de onde"; o restante seria rastreamento.
 *
 * Nunca devolve string vazia — o campo do documento não pode ficar em branco:
 * UA ausente vira `'Desconhecido'` e UA irreconhecível volta truncado em 60
 * caracteres, preservando alguma pista sem guardar a linha inteira.
 */
export function parseUserAgent(ua: string): string {
	if (!ua || ua === 'N/A') return 'Desconhecido';

	try {
		const parsed = parseUAInternal(ua);
		const parts: string[] = [];

		if (parsed.browser) {
			parts.push(
				parsed.browserVersion ? `${parsed.browser} ${parsed.browserVersion}` : parsed.browser
			);
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

/**
 * Decide se o user-agent declara um dispositivo móvel — o lado SERVIDOR da
 * política `restringirSmartphone`.
 *
 * É a metade que RECUSA. A outra metade é `$lib/composables/useMobile`, que
 * decide o que a tela mostra lendo `navigator`; esta lê o header da requisição.
 * As duas não podem virar um arquivo só (fontes de sinal diferentes, bundles
 * diferentes), mas a classificação de dispositivo é UMA — por isso reaproveita
 * `parseUAInternal`, o mesmo classificador que imprime "DISPOSITIVO" no
 * manifesto. Um segundo regex aqui é como `useMobile` e `useGiseEstado`
 * divergiram em ago/2026, aplicando a MESMA restrição com critérios diferentes.
 *
 * `Tablet` conta como móvel, em paridade com o regex do cliente (que inclui
 * `iPad`). Duas consequências assumidas:
 *
 *   - UA vazio/desconhecido NÃO é móvel: sem declaração, a política recusa.
 *   - iPadOS 13+ manda UA de macOS por padrão e cai em `Desktop`. Em tela
 *     cheia o cliente também bloqueia (largura > 768px), então há paridade;
 *     em split view estreita o cliente libera e o servidor recusa. Recusar é o
 *     lado seguro, e a mensagem de erro precisa ser legível para quem cair aí.
 *
 * O que isto prova é limitado e a mensagem ao usuário não deve exagerar: o UA
 * é DECLARAÇÃO do cliente, não propriedade dele. Vale como reforço de boa-fé —
 * quem controla o navegador controla o header.
 */
export function ehDispositivoMovelUA(ua: string): boolean {
	if (!ua || ua === 'N/A') return false;

	try {
		const { device } = parseUAInternal(ua);
		return device === 'Mobile' || device === 'Tablet';
	} catch {
		return false;
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

/**
 * Tipo de carimbo a registrar na folha de auditoria de uma assinatura
 * qualificada: `tsa_externa` quando o ambiente tem `TSA_URL` configurada,
 * `servidor` caso contrário. Os quatro `preparar-assinatura` (escala, GISE,
 * presença, relatório de seccional) decidiam isso com o mesmo ternário
 * copiado — e o cast `as unknown as Record<...>` era desnecessário: `Env`
 * já declara `TSA_URL?: string`.
 */
export function resolverTipoCarimboTempo(platform: App.Platform | undefined): TipoCarimoTempo {
	return platform?.env?.TSA_URL ? 'tsa_externa' : 'servidor';
}

/**
 * `platform.env` como o `Record<string, string | undefined>` que as funções
 * de assinatura esperam — elas ficam fora do domínio de bindings do Cloudflare
 * (D1Database, R2Bucket) de propósito, para não acoplar lógica de PDF/CAdES a
 * tipos de Workers. Doze rotas de preparar/assinar (escala e GISE) repetiam o
 * mesmo `as unknown as Record<...>` no call site.
 */
export function envComoRegistro(
	platform: App.Platform | undefined
): Record<string, string | undefined> | undefined {
	return platform?.env as unknown as Record<string, string | undefined> | undefined;
}
