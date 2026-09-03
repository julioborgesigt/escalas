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
import { logger } from '../../logger';
import rootsPem from './roots.pem?raw';
import intermediatesPem from './intermediates.pem?raw';

/**
 * Raiz de TESTE da suíte E2E, inlinada em BUILD-time pelo `define` do Vite
 * quando (e somente quando) o build roda com `E2E_TEST_CA=1` — vide
 * vite.config.ts e e2e/servidor-e2e.ts. Em qualquer build normal a constante
 * não é definida e o ramo abaixo é código morto: NÃO existe env de runtime
 * capaz de ligar isto em produção.
 */
declare const __E2E_TEST_TRUST_ROOTS_PEM__: string | undefined;

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

	// Só existe em builds de E2E (define do Vite) — vide declaração no topo.
	const testRootsPem =
		typeof __E2E_TEST_TRUST_ROOTS_PEM__ === 'string' ? __E2E_TEST_TRUST_ROOTS_PEM__ : '';
	if (testRootsPem) {
		console.warn(
			'[TRUST-STORE] ⚠️ RAIZ DE TESTE E2E ATIVA — este build confia numa CA sintética. ' +
				'NUNCA use este artefato em produção (rebuilde sem E2E_TEST_CA).'
		);
		rootsBlocos.push(...extrairBlocosPem(testRootsPem));
	}

	const roots = rootsBlocos
		.map(parsePemSeguro)
		.filter((c): c is forge.pki.Certificate => c !== null);
	const intermediates = intermediatesBlocos
		.map(parsePemSeguro)
		.filter((c): c is forge.pki.Certificate => c !== null);

	// Bloco PEM que não parseia era descartado EM SILÊNCIO. O sintoma disso não
	// aparece aqui: aparece como "Certificado não encadeia até uma AC Raiz da
	// ICP-Brasil reconhecida" no `/validar` — ou seja, o sistema acusando de
	// inválido um documento autêntico, porque a âncora dele sumiu do store sem
	// que nada tenha sido dito. Com 182 blocos hoje e um cron mensal que
	// regrava os dois arquivos, um download truncado é cenário real, e é
	// justamente o tipo de degradação que ninguém procura no lugar certo.
	//
	// `error`, não `warn`: isto é persistido em `app_log` e sobe no Sentry, que
	// é onde o operador vai olhar quando reclamarem da validação.
	const perdidosRoots = rootsBlocos.length - roots.length;
	const perdidosInter = intermediatesBlocos.length - intermediates.length;
	if (perdidosRoots > 0 || perdidosInter > 0) {
		logger.error('[TRUST-STORE] Bloco PEM não parseou — âncora ICP-Brasil ausente do store', {
			rootsLidos: rootsBlocos.length,
			rootsValidos: roots.length,
			intermediariasLidas: intermediatesBlocos.length,
			intermediariasValidas: intermediates.length
		});
	}

	const caStore = forge.pki.createCaStore([...roots, ...intermediates]);

	cache = {
		disponivel: roots.length > 0,
		roots,
		intermediates,
		caStore
	};

	return cache;
}
