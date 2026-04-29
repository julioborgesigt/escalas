/**
 * Trust store ICP-Brasil — carrega certificados raiz e intermediários
 * embutidos no bundle e os converte para o formato consumido por node-forge.
 *
 * Os PEMs são importados via `?raw` do Vite, o que garante que o conteúdo
 * é inlinado no bundle em build-time (necessário em Cloudflare Workers,
 * que não dispõe de `fs`).
 */

import forge from 'node-forge';
import rootsPem from './roots.pem?raw';
import intermediatesPem from './intermediates.pem?raw';

export interface TrustStore {
	disponivel: boolean;
	roots: forge.pki.Certificate[];
	intermediates: forge.pki.Certificate[];
	/** Pool combinado para passar a forge.pki.verifyCertificateChain */
	caStore: forge.pki.CAStore;
}

let cache: TrustStore | null = null;

/**
 * Extrai todos os blocos PEM de uma string (ignorando linhas de comentário).
 */
function extrairBlocosPem(texto: string): string[] {
	const blocos: string[] = [];
	const regex = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(texto)) !== null) {
		blocos.push(match[0]);
	}
	return blocos;
}

function parsePemSeguro(pem: string): forge.pki.Certificate | null {
	try {
		return forge.pki.certificateFromPem(pem);
	} catch {
		return null;
	}
}

/**
 * Carrega o trust store. Resultado é cacheado em memória do isolate.
 */
export function loadTrustStore(): TrustStore {
	if (cache) return cache;

	const rootsBlocos = extrairBlocosPem(String(rootsPem ?? ''));
	const intermediatesBlocos = extrairBlocosPem(String(intermediatesPem ?? ''));

	const roots = rootsBlocos.map(parsePemSeguro).filter((c): c is forge.pki.Certificate => c !== null);
	const intermediates = intermediatesBlocos
		.map(parsePemSeguro)
		.filter((c): c is forge.pki.Certificate => c !== null);

	const caStore = forge.pki.createCaStore([...roots, ...intermediates]);

	cache = {
		disponivel: roots.length > 0,
		roots,
		intermediates,
		caStore
	};

	return cache;
}
