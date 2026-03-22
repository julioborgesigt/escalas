/**
 * Wrapper TypeScript para a API do Lacuna Web PKI.
 *
 * Usa o pacote npm `web-pki` (import direto, sem CDN).
 * Referência: https://docs.lacunasoftware.com/pt-br/articles/web-pki/get-started.html
 */

import LacunaWebPKI from 'web-pki';
import type { CertificateModel } from 'web-pki';

export interface WebPKICertificate {
	thumbprint: string;
	subjectName: string;
	issuerName: string;
	cpf?: string;
}

/**
 * Converte a Promise customizada do Web PKI em uma Promise nativa.
 */
function toNativePromise<T>(webPkiPromise: { success(cb: (result: T) => void): { fail(cb: (err: unknown) => void): void } }): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		webPkiPromise
			.success((result: T) => resolve(result))
			.fail((ex: unknown) => reject(ex));
	});
}

/**
 * Inicializa o Lacuna Web PKI e retorna a instância pronta.
 * Funciona gratuitamente em localhost.
 */
export function initWebPKI(license?: string): Promise<LacunaWebPKI> {
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
			defaultFail: (ex: unknown) => reject(ex)
		});
	});
}

/**
 * Lista os certificados digitais disponíveis (eToken, A1, etc.)
 */
export async function listarCertificados(
	pki: LacunaWebPKI
): Promise<WebPKICertificate[]> {
	const certs = await toNativePromise<CertificateModel[]>(pki.listCertificates());
	return certs.map((c) => ({
		thumbprint: c.thumbprint,
		subjectName: c.subjectName,
		issuerName: c.issuerName,
		cpf: c.pkiBrazil?.cpf
	}));
}

/**
 * Assina um hash SHA-256 usando o certificado selecionado.
 * Retorna a assinatura PKCS#7 em base64.
 * Neste momento a janela de PIN do token aparece para o usuário.
 */
export async function assinarHash(
	pki: LacunaWebPKI,
	thumbprint: string,
	hashHex: string
): Promise<string> {
	return toNativePromise<string>(pki.signHash({
		thumbprint,
		hash: hashHex,
		digestAlgorithm: 'SHA-256'
	}));
}
