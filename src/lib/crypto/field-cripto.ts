/**
 * Cifragem genérica de campos sensíveis em repouso (AES-256-GCM).
 *
 * Mesmo envelope de `cpf-cripto.ts` (`enc:v1:<base64(iv(12) || ct+tag)>`), porém
 * SEM normalização de domínio — serve para qualquer string (ex.: o IP completo
 * do log de auditoria, que precisa ficar recuperável só em perícia autorizada).
 *
 * Confidencialidade: AES-256-GCM com IV aleatório por gravação (não
 * determinístico — não dá para `WHERE`; por isso a auditoria mantém também a
 * coluna `ip` ANONIMIZADA para filtro/exibição).
 *
 * Módulo puro (WebCrypto + ./hex), importável pelo app e por scripts `tsx`.
 */
import { hexToBytes } from './hex';

const ENC_PREFIX = 'enc:v1:';

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

/** `true` se o valor já está no envelope cifrado `enc:v1:...`. */
export function ehCifrado(valor: string | null | undefined): boolean {
	return typeof valor === 'string' && valor.startsWith(ENC_PREFIX);
}

/** Cifra um texto arbitrário → `enc:v1:<base64>`. */
export async function cifrarTexto(plain: string, encKeyHex: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		chaveHexParaBytes(encKeyHex, 'AUDIT_IP_ENCRYPTION_KEY'),
		{ name: 'AES-GCM' },
		false,
		['encrypt']
	);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv: iv as BufferSource },
			key,
			new TextEncoder().encode(plain) as BufferSource
		)
	);
	const blob = new Uint8Array(iv.length + ct.length);
	blob.set(iv, 0);
	blob.set(ct, iv.length);
	return ENC_PREFIX + bytesToBase64(blob);
}

/**
 * Decifra um valor `enc:v1:...`. Valores SEM o prefixo (vazios ou legados em
 * texto) voltam como estão — tolerante à coexistência durante o rollout.
 */
export async function decifrarTexto(
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
		chaveHexParaBytes(encKeyHex, 'AUDIT_IP_ENCRYPTION_KEY'),
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
