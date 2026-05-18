/**
 * Trust store ICP-Brasil — carrega certificados raiz e intermediários
 * embutidos no bundle e os converte para o formato consumido por node-forge.
 *
 * Os PEMs são importados via `?raw` do Vite, o que garante que o conteúdo
 * é inlinado no bundle em build-time (necessário em Cloudflare Workers,
 * que não dispõe de `fs`).
 *
 * ## Comportamento quando trust store está vazio
 *
 * Sem `roots.pem`/`intermediates.pem` populados (estado inicial deste repo),
 * `loadTrustStore()` retorna `{ disponivel: false, ... }`. O comportamento
 * subsequente depende da env `ICP_BRASIL_TRUST_STORE_REQUIRED`:
 *
 *   - **Não definida / "0" / "false"** (default): retrocompat — `cades-finalizer`
 *     aceita a assinatura com warning no log, sinalizando "cadeia indisponível"
 *     na página /validar.
 *
 *   - **"1" / "true"** (recomendado em produção): `cades-finalizer` rejeita
 *     a assinatura com 422. Sem cadeia ICP-Brasil validada, não há como
 *     classificar a assinatura como qualificada nos termos do art. 10 §1º
 *     da MP 2.200-2/2001 — aceitar seria fraude de rótulo.
 *
 * Antes de ativar a flag em produção, rode `./update-trust-store.sh` neste
 * diretório (vide README.md) e commite os PEMs populados.
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
 * Lê a env `ICP_BRASIL_TRUST_STORE_REQUIRED` aplicando "fail-closed" friendly:
 * qualquer valor truthy (1/true/yes/on, case-insensitive) ativa o modo
 * estrito. Vazio ou undefined mantém o comportamento legado.
 *
 * Aceita `platform.env` (Cloudflare Workers) e `process.env` (Node) com
 * mesma semântica, para uso em testes locais.
 */
export function trustStoreRequerido(env?: Record<string, string | undefined>): boolean {
	const raw =
		env?.ICP_BRASIL_TRUST_STORE_REQUIRED ??
		(typeof process !== 'undefined' ? process.env?.ICP_BRASIL_TRUST_STORE_REQUIRED : undefined);
	if (!raw) return false;
	return /^(1|true|yes|on)$/i.test(raw.trim());
}

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
