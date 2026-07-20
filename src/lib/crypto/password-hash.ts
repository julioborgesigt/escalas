/**
 * Hashing de senha (PBKDF2 + pepper) — módulo PURO, sem dependências de DB,
 * `$lib` ou `$env`. De propósito: assim o app SvelteKit (`$lib/auth` re-exporta
 * daqui) E os scripts `tsx` standalone (`scripts/`, `e2e/`) usam EXATAMENTE o
 * mesmo código, em vez de manter cópias que divergem (item C6 da auditoria).
 *
 * ── Formatos suportados ──────────────────────────────────────────────────────
 * `verificarSenha` aceita v1/v2/v3; `hashSenha` emite v3 (com pepper) ou v2:
 *   v1 (legado): `pbkdf2v1:<salt_hex>:<hash_hex>`        — iterations = 100 000 implícito
 *   v2 (atual):  `pbkdf2v2:<iter>:<salt_hex>:<hash_hex>` — iterations explícito
 *   v3 (pepper): `pbkdf2v3:<iter>:<salt_hex>:<hash_hex>` — PBKDF2 sobre
 *                HMAC-SHA256(PASSWORD_PEPPER, senha). Ver nota A3 abaixo.
 *
 * ── Iterações e o achado A3 (IMPORTANTE — leia antes de mexer) ───────────────
 * OWASP 2023+ recomenda mínimo 600 000 iterações para PBKDF2-HMAC-SHA256.
 * PORÉM, o runtime da Cloudflare (workerd — o MESMO no Pages e no Workers)
 * IMPÕE UM TETO RÍGIDO DE 100 000 iterações na API `crypto.subtle`: pedir mais
 * devolve "Pbkdf2 failed: iteration counts above 100000 are not supported". NÃO
 * é limite de CPU (não adianta `cpu_ms`), é um limite da API — idêntico no Pages
 * e no Workers (confirmado empiricamente; ver MIGRACAO-WORKERS.md, arquivado — docs/HISTORICO.md).
 *
 * COMO O A3 É RESOLVIDO — PEPPER (v3): em vez de subir iterações, aplicamos um
 * HMAC-SHA256 da senha com um segredo GLOBAL `PASSWORD_PEPPER` (do ambiente,
 * nunca no banco) ANTES do PBKDF2. Custo de CPU ~zero e dentro do teto de 100k.
 * Um dump do D1 sozinho NÃO permite brute-force offline: sem o `PASSWORD_PEPPER`,
 * o atacante nem testa candidatos. É defesa melhor que 600k para o cenário real.
 *
 * FALLBACK: sem `PASSWORD_PEPPER`, `hashSenha` emite v2 (comportamento legado).
 * Com o segredo presente, o login re-hasha v1/v2/legado → v3 progressivamente.
 */

import { timingSafeEqual } from 'node:crypto';
import { bytesToHex, hexToBytes } from './hex';

const PBKDF2_V1_PREFIX = 'pbkdf2v1:';
const PBKDF2_V2_PREFIX = 'pbkdf2v2:';
/** Pepper (A3): PBKDF2 sobre HMAC-SHA256(PASSWORD_PEPPER, senha). */
const PBKDF2_V3_PREFIX = 'pbkdf2v3:';
const PBKDF2_V1_ITERATIONS = 100_000;
/** Teto RÍGIDO da API `crypto.subtle` do workerd (Pages e Workers). Ver nota A3. */
const PBKDF2_V2_ITERATIONS = 100_000;
/** Prefixo do fake-hash de cadastro em massa (sempre v2). */
const PBKDF2_PREFIX = PBKDF2_V2_PREFIX;
/** Iterações usadas em hashes recém-criados (v2 e v3). */
const PBKDF2_ITERATIONS = PBKDF2_V2_ITERATIONS;

async function derivarPBKDF2Material(
	material: BufferSource,
	salt: Uint8Array<ArrayBuffer>,
	iterations: number
): Promise<string> {
	const keyMaterial = await crypto.subtle.importKey('raw', material, 'PBKDF2', false, [
		'deriveBits'
	]);
	const hashBuffer = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
		keyMaterial,
		256
	);
	return bytesToHex(new Uint8Array(hashBuffer));
}

async function derivarPBKDF2(
	senha: string,
	salt: Uint8Array<ArrayBuffer>,
	iterations: number
): Promise<string> {
	return derivarPBKDF2Material(new TextEncoder().encode(senha) as BufferSource, salt, iterations);
}

/**
 * Pepper (A3): HMAC-SHA256(PASSWORD_PEPPER, senha) → 32 bytes. Pré-tempera a
 * senha com um segredo GLOBAL (do ambiente, nunca no banco) antes do PBKDF2.
 */
async function pepperizarSenha(senha: string, pepper: string): Promise<Uint8Array<ArrayBuffer>> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(pepper) as BufferSource,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const sig = await crypto.subtle.sign(
		'HMAC',
		key,
		new TextEncoder().encode(senha) as BufferSource
	);
	return new Uint8Array(sig);
}

/** Compara dois hex de hash (64 chars) em tempo ~constante. */
function hashHexConfere(actualHex: string, expectedHex: string): boolean {
	const a = Buffer.from(actualHex.padEnd(64, '0').slice(0, 64));
	const b = Buffer.from(expectedHex.padEnd(64, '0').slice(0, 64));
	const hashMatch = timingSafeEqual(a, b) ? 1 : 0;
	const lenMatch = actualHex.length === expectedHex.length ? 1 : 0;
	return (hashMatch & lenMatch) === 1;
}

function iterValido(iter: number): boolean {
	return Number.isFinite(iter) && iter >= PBKDF2_V1_ITERATIONS && iter <= 10_000_000;
}

/**
 * Gera um hash seguro da senha usando PBKDF2 (100 000 iterações — teto da API).
 * Com `pepper` (PASSWORD_PEPPER do ambiente): emite v3 (HMAC antes do PBKDF2).
 * Sem `pepper`: emite v2 (fallback), preservando o funcionamento sem o segredo.
 */
export async function hashSenha(senha: string, pepper?: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
	const saltHex = bytesToHex(salt);
	if (pepper) {
		const material = await pepperizarSenha(senha, pepper);
		const hashHex = await derivarPBKDF2Material(material as BufferSource, salt, PBKDF2_ITERATIONS);
		return `${PBKDF2_V3_PREFIX}${PBKDF2_ITERATIONS}:${saltHex}:${hashHex}`;
	}
	const hashHex = await derivarPBKDF2(senha, salt, PBKDF2_ITERATIONS);
	return `${PBKDF2_PREFIX}${PBKDF2_ITERATIONS}:${saltHex}:${hashHex}`;
}

/**
 * Verifica se uma senha corresponde ao hash armazenado.
 * Suporta PBKDF2 v3 (pepper), v2 (atual) e v1 (legado). Hashes em qualquer
 * outro formato (ex.: SHA-256 sem salt, pré-PBKDF2) NÃO são mais aceitos — o
 * suporte legado expirou; contas nesse estado precisam redefinir a senha.
 */
export async function verificarSenha(
	senha: string,
	storedHash: string,
	pepper?: string
): Promise<boolean> {
	if (storedHash.startsWith(PBKDF2_V3_PREFIX)) {
		// pbkdf2v3:<iter>:<salt_hex>:<hash_hex> sobre HMAC(pepper, senha).
		// Sem o pepper o hash é inverificável — fail-closed (não dá pra autenticar).
		if (!pepper) return false;
		const parts = storedHash.slice(PBKDF2_V3_PREFIX.length).split(':');
		if (parts.length !== 3) return false;
		const [iterStr, saltHex, expectedHex] = parts;
		const iter = parseInt(iterStr, 10);
		if (!iterValido(iter)) return false;
		const salt = hexToBytes(saltHex);
		if (!salt) return false;
		const material = await pepperizarSenha(senha, pepper);
		const actualHex = await derivarPBKDF2Material(material as BufferSource, salt, iter);
		return hashHexConfere(actualHex, expectedHex);
	}
	if (storedHash.startsWith(PBKDF2_V2_PREFIX)) {
		// pbkdf2v2:<iter>:<salt_hex>:<hash_hex>
		const parts = storedHash.slice(PBKDF2_V2_PREFIX.length).split(':');
		if (parts.length !== 3) return false;
		const [iterStr, saltHex, expectedHex] = parts;
		const iter = parseInt(iterStr, 10);
		// Sanity: iter dentro de uma janela razoável (impede DoS via iter gigante
		// vindo de hash corrompido/banco adulterado).
		if (!iterValido(iter)) return false;
		const salt = hexToBytes(saltHex);
		if (!salt) return false;
		const actualHex = await derivarPBKDF2(senha, salt, iter);
		return hashHexConfere(actualHex, expectedHex);
	}
	if (storedHash.startsWith(PBKDF2_V1_PREFIX)) {
		// Formato legado: pbkdf2v1:<salt_hex>:<hash_hex>, iter = 100 000 implícito.
		const parts = storedHash.slice(PBKDF2_V1_PREFIX.length).split(':');
		if (parts.length !== 2) return false;
		const [saltHex, expectedHex] = parts;
		const salt = hexToBytes(saltHex);
		if (!salt) return false;
		const actualHex = await derivarPBKDF2(senha, salt, PBKDF2_V1_ITERATIONS);
		return hashHexConfere(actualHex, expectedHex);
	}
	// Formato desconhecido (ex.: SHA-256 sem salt, pré-PBKDF2): suporte removido.
	// Contas nesse estado não autenticam — precisam redefinir a senha.
	return false;
}

/**
 * Retorna true se o hash deve ser migrado para o formato corrente. O auth-flow
 * chama `hashSenha` para re-hashar (no login bem-sucedido) quando true.
 *
 * - `pepperAtivo = true` (PASSWORD_PEPPER setado): o alvo é v3, então tudo abaixo
 *   de v3 (v2, v1, legado) é legado e sobe para v3 no login.
 * - `pepperAtivo = false` (sem segredo): o alvo é v2; v3 NUNCA é legado (não
 *   rebaixa, e sem o segredo nem seria reproduzível).
 */
export function isHashLegado(storedHash: string, pepperAtivo: boolean = false): boolean {
	if (storedHash.startsWith(PBKDF2_V3_PREFIX)) return false;
	if (pepperAtivo) return true;
	return !storedHash.startsWith(PBKDF2_V2_PREFIX);
}

/**
 * Retorna um hash no formato PBKDF2 **inválido para login**: não é derivado da
 * senha. Usado no cadastro/sincronização em massa para evitar derivação pesada.
 *
 * **Invariantes:** quem recebe este hash deve ter `primeiro_acesso = 1` e só
 * autenticar após `hashSenha` real (primeiro acesso ou redefinição).
 * `verificarSenha` continuará falhando para qualquer senha digitada até lá.
 * Emite v2 para não disparar re-hash desnecessário em `isHashLegado`.
 */
export async function gerarSenhaAleatoriaHash(): Promise<string> {
	const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
	const fakeHash = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
	return `${PBKDF2_PREFIX}${PBKDF2_ITERATIONS}:${salt}:${fakeHash}`;
}
