/**
 * Wrapper TypeScript para a API do Lacuna Web PKI.
 *
 * O script lacuna-web-pki.js é carregado via CDN no app.html
 * e expõe window.LacunaWebPKI globalmente.
 *
 * Referência: https://docs.lacunasoftware.com/pt-br/articles/web-pki/get-started.html
 */

declare global {
	interface Window {
		LacunaWebPKI: new (license?: string) => LacunaWebPKIInstance;
	}
}

interface CertificateInfo {
	thumbprint: string;
	subjectName: string;
	issuerName: string;
	notBefore: string;
	notAfter: string;
	pkiBrazil?: {
		cpf?: string;
		cnpj?: string;
		responsavel?: string;
		companyName?: string;
	};
}

interface LacunaWebPKIInstance {
	init(args: { ready: () => void; notInstalled?: () => void; defaultFail?: (ex: unknown) => void }): void;
	listCertificates(): Promise<CertificateInfo[]>;
	readCertificate(thumbprint: string): Promise<string>;
	signHash(args: {
		thumbprint: string;
		hash: string;
		digestAlgorithm: string;
	}): Promise<string>;
}

export interface WebPKICertificate {
	thumbprint: string;
	subjectName: string;
	issuerName: string;
	cpf?: string;
}

/**
 * Inicializa o Lacuna Web PKI e retorna a instância pronta.
 */
export function initWebPKI(license?: string): Promise<LacunaWebPKIInstance> {
	return new Promise((resolve, reject) => {
		if (typeof window === 'undefined' || !window.LacunaWebPKI) {
			reject(
				new Error(
					'Lacuna Web PKI não está carregado. Verifique se a extensão está instalada.'
				)
			);
			return;
		}

		const pki = new window.LacunaWebPKI(license);
		pki.init({
			ready: () => resolve(pki),
			notInstalled: () =>
				reject(
					new Error(
						'Lacuna Web PKI não está instalado. Instale em https://get.webpkiplugin.com/'
					)
				),
			defaultFail: (ex) => reject(ex)
		});
	});
}

/**
 * Lista os certificados digitais disponíveis (eToken, A1, etc.)
 */
export async function listarCertificados(
	pki: LacunaWebPKIInstance
): Promise<WebPKICertificate[]> {
	const certs = await pki.listCertificates();
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
	pki: LacunaWebPKIInstance,
	thumbprint: string,
	hashHex: string
): Promise<string> {
	return pki.signHash({
		thumbprint,
		hash: hashHex,
		digestAlgorithm: 'SHA-256'
	});
}
