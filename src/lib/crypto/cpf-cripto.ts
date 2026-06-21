/**
 * Cifragem de CPF em repouso (LGPD, achado de privacidade).
 *
 *  - Confidencialidade: AES-256-GCM com IV aleatório por gravação. Formato de
 *    armazenamento: `enc:v1:<base64(iv(12) || ciphertext+tag)>`.
 *  - Lookup: o GCM é não-determinístico, então não dá para `WHERE cpf = ?`.
 *    Um índice cego determinístico `HMAC-SHA256(CPF_INDEX_KEY, cpfNormalizado)`
 *    (hex) é gravado em `cpf_index` e usado pelo login por certificado.
 *
 * Dois segredos SEPARADOS, ambos em hex de 32 bytes (`openssl rand -hex 32`):
 *   CPF_ENCRYPTION_KEY — cifra/decifra (confidencialidade).
 *   CPF_INDEX_KEY      — índice de busca (lookup do cert-login).
 *
 * São LOAD-BEARING como o `PASSWORD_PEPPER`: trocar o valor invalida os dados
 * cifrados/índices existentes (exige re-cifrar tudo ou wipe + re-sincronizar).
 *
 * Módulo puro (só WebCrypto + ./hex), importável pelo app e por scripts.
 */
import { bytesToHex, hexToBytes } from './hex';

const ENC_PREFIX = 'enc:v1:';

/** Mantém só os dígitos do CPF (normalização antes de cifrar/indexar). */
function normalizarCPF(cpf: string | null | undefined): string {
	return String(cpf ?? '').replace(/\D/g, '');
}

function bytesToBase64(bytes: Uint8Array): string {
	let s = '';
	for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
	return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

function chaveHexParaBytes(hex: string, nome: string): Uint8Array<ArrayBuffer> {
	const bytes = hexToBytes(hex.trim());
	if (!bytes || bytes.length !== 32) {
		throw new Error(
			`${nome} inválida: esperado 32 bytes em hex (64 chars). Gere com "openssl rand -hex 32".`
		);
	}
	return bytes;
}

/** Cifra o CPF (normalizado) → `enc:v1:<base64>`. */
export async function cifrarCPF(cpfPlain: string, encKeyHex: string): Promise<string> {
	const norm = normalizarCPF(cpfPlain);
	const key = await crypto.subtle.importKey(
		'raw',
		chaveHexParaBytes(encKeyHex, 'CPF_ENCRYPTION_KEY'),
		{ name: 'AES-GCM' },
		false,
		['encrypt']
	);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv: iv as BufferSource },
			key,
			new TextEncoder().encode(norm) as BufferSource
		)
	);
	const blob = new Uint8Array(iv.length + ct.length);
	blob.set(iv, 0);
	blob.set(ct, iv.length);
	return ENC_PREFIX + bytesToBase64(blob);
}

/**
 * Decifra um valor `enc:v1:...`. Se o valor NÃO tiver o prefixo (vazio ou
 * legado em texto plano), devolve como está — tolerante para coexistência.
 */
export async function decifrarCPF(
	armazenado: string | null | undefined,
	encKeyHex: string
): Promise<string> {
	const v = String(armazenado ?? '');
	if (!v.startsWith(ENC_PREFIX)) return v;
	const blob = base64ToBytes(v.slice(ENC_PREFIX.length));
	const iv = blob.slice(0, 12);
	const ct = blob.slice(12);
	const key = await crypto.subtle.importKey(
		'raw',
		chaveHexParaBytes(encKeyHex, 'CPF_ENCRYPTION_KEY'),
		{ name: 'AES-GCM' },
		false,
		['decrypt']
	);
	const pt = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: iv as BufferSource },
		key,
		ct as BufferSource
	);
	return new TextDecoder().decode(pt);
}

/** Índice cego determinístico para lookup: `HMAC-SHA256(indexKey, cpf)` em hex. */
export async function indiceCPF(cpfPlain: string, indexKeyHex: string): Promise<string> {
	const norm = normalizarCPF(cpfPlain);
	const key = await crypto.subtle.importKey(
		'raw',
		chaveHexParaBytes(indexKeyHex, 'CPF_INDEX_KEY'),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const sig = new Uint8Array(
		await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(norm) as BufferSource)
	);
	return bytesToHex(sig);
}

export interface CpfCriptoEnv {
	CPF_ENCRYPTION_KEY?: string;
	CPF_INDEX_KEY?: string;
}

/** Extrai as chaves do env (trim; undefined quando ausente/vazia). */
export function cpfKeys(env: CpfCriptoEnv | undefined): { encKey?: string; indexKey?: string } {
	return {
		encKey: env?.CPF_ENCRYPTION_KEY?.trim() || undefined,
		indexKey: env?.CPF_INDEX_KEY?.trim() || undefined
	};
}

/**
 * Prepara o CPF para persistência — devolve `{ cpf (cifrado), cpf_index }`.
 *
 * Usado por TODOS os caminhos de escrita (sync da planilha e cadastro/edição
 * pelo site), garantindo formato idêntico independentemente da origem.
 *
 * Fail-open: sem as chaves configuradas, grava o CPF normalizado em texto e
 * `cpf_index = null` — mantém o app funcional, mas SEM proteção. Configure
 * CPF_ENCRYPTION_KEY e CPF_INDEX_KEY antes de popular em produção.
 */
export async function prepararCpfParaDB(
	cpfPlain: string | null | undefined,
	env: CpfCriptoEnv | undefined
): Promise<{ cpf: string | null; cpf_index: string | null }> {
	const norm = normalizarCPF(cpfPlain);
	if (!norm) return { cpf: null, cpf_index: null };
	const { encKey, indexKey } = cpfKeys(env);
	if (!encKey || !indexKey) return { cpf: norm, cpf_index: null };
	const [cpf, cpf_index] = await Promise.all([cifrarCPF(norm, encKey), indiceCPF(norm, indexKey)]);
	return { cpf, cpf_index };
}

/**
 * Decifra um CPF lido do banco para exibição/uso. Sem chave configurada (ou
 * valor legado em texto), devolve o valor como está. Conveniência para loads e
 * montagem de sessão.
 */
export async function decifrarCpfDoDB(
	armazenado: string | null | undefined,
	env: CpfCriptoEnv | undefined
): Promise<string> {
	const { encKey } = cpfKeys(env);
	if (!encKey) return String(armazenado ?? '');
	return decifrarCPF(armazenado, encKey);
}

/**
 * Cifra um CPF para colunas de PROVENIÊNCIA (ex.: `assinante_cpf`) que não
 * precisam de índice de busca. Devolve `enc:v1:...` (ou o CPF normalizado em
 * texto, fallback sem chave) ou `null` quando vazio. Para colunas NOT NULL use
 * `(await cifrarCpfParaArmazenar(...)) ?? ''`.
 */
export async function cifrarCpfParaArmazenar(
	cpfPlain: string | null | undefined,
	env: CpfCriptoEnv | undefined
): Promise<string | null> {
	const norm = normalizarCPF(cpfPlain);
	if (!norm) return null;
	const { encKey } = cpfKeys(env);
	return encKey ? cifrarCPF(norm, encKey) : norm;
}
