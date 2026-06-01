/**
 * Wrapper TypeScript para a API do Lacuna Web PKI.
 *
 * O pacote npm `web-pki` acessa `window` no momento do import,
 * então usamos dynamic import para carregar apenas no browser.
 *
 * Referência: https://docs.lacunasoftware.com/pt-br/articles/web-pki/get-started.html
 */

export interface WebPKICertificate {
	thumbprint: string;
	subjectName: string;
	issuerName: string;
	cpf?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PKIInstance = any;

/**
 * Converte a Promise customizada do Web PKI em uma Promise nativa.
 */
function toNativePromise<T>(webPkiPromise: {
	success(cb: (result: T) => void): { fail(cb: (err: unknown) => void): void };
}): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		webPkiPromise.success((result: T) => resolve(result)).fail((ex: unknown) => reject(ex));
	});
}

/**
 * Inicializa o Lacuna Web PKI e retorna a instância pronta.
 *
 * **Licença em produção:** Lacuna Web PKI é gratuito **apenas em localhost**.
 * Em qualquer outro domínio (produção, staging, etc.) requer licença comercial
 * paga, configurada via env `WEBPKI_LICENSE` no Cloudflare Pages. A chave
 * deve ser propagada do server ao cliente através de `+layout.server.ts`
 * (ou endpoint dedicado).
 *
 * Sem licença em produção:
 *   - `pki.init()` chama `defaultFail` com erro de "license missing".
 *   - O caller (componente de assinatura) deve degradar para SERPRO ou
 *     mostrar mensagem clara ao usuário.
 *
 * Pricing/registro: https://www.lacunasoftware.com/products/web-pki
 */
export async function initWebPKI(license?: string): Promise<PKIInstance> {
	const { default: LacunaWebPKI } = await import('web-pki');
	return new Promise((resolve, reject) => {
		const pki = new LacunaWebPKI(license);
		pki.init({
			ready: () => resolve(pki),
			notInstalled: () =>
				reject(
					new Error(
						'Lacuna Web PKI não está instalado. Instale a extensão e o componente nativo em https://get.webpkiplugin.com/'
					)
				),
			defaultFail: (ex: unknown) => {
				// O erro "license is required" da Lacuna chega aqui. Reescrevemos
				// a mensagem para deixar claro para o operador o que fazer.
				const msg =
					typeof ex === 'object' && ex !== null && 'userMessage' in ex
						? String((ex as { userMessage?: unknown }).userMessage)
						: String(ex);
				if (/license/i.test(msg)) {
					reject(
						new Error(
							'Lacuna Web PKI sem licença válida para este domínio. ' +
								'Configure a env `WEBPKI_LICENSE` no Cloudflare Pages (admin geral). ' +
								'Alternativamente, use o Assinador SERPRO no painel de assinatura.'
						)
					);
				} else {
					reject(ex);
				}
			}
		});
	});
}

/**
 * Lista os certificados digitais disponíveis (eToken, A1, etc.)
 */
export async function listarCertificados(pki: PKIInstance): Promise<WebPKICertificate[]> {
	const certs = await toNativePromise<
		Array<{
			thumbprint: string;
			subjectName: string;
			issuerName: string;
			pkiBrazil?: { cpf?: string };
		}>
	>(pki.listCertificates());
	return certs.map((c) => ({
		thumbprint: c.thumbprint,
		subjectName: c.subjectName,
		issuerName: c.issuerName,
		cpf: c.pkiBrazil?.cpf
	}));
}

/**
 * Lê o conteúdo do certificado DER codificado em Base64.
 */
export async function lerCertificado(pki: PKIInstance, thumbprint: string): Promise<string> {
	return toNativePromise<string>(pki.readCertificate({ thumbprint }));
}

/**
 * Converte uma string hexadecimal em Base64.
 */
function hexToBase64(hex: string): string {
	const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

/**
 * Assina um hash SHA-256 usando o certificado selecionado.
 * Retorna os bytes brutos da assinatura RSA em base64.
 * Neste momento a janela de PIN do token aparece para o usuário.
 *
 * @param hashHex - Hash em formato hexadecimal (será convertido para Base64 internamente,
 *                  pois o Web PKI espera o hash codificado em Base64).
 */
export async function assinarHash(
	pki: PKIInstance,
	thumbprint: string,
	hashHex: string
): Promise<string> {
	const hashBase64 = hexToBase64(hashHex);
	return toNativePromise<string>(
		pki.signHash({
			thumbprint,
			hash: hashBase64,
			digestAlgorithm: 'SHA-256'
		})
	);
}
