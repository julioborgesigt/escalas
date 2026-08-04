/**
 * SHA-256 em hex — o idiom mais repetido do projeto.
 *
 * Estava reescrito inline em pelo menos oito pontos (hash de token de sessão,
 * de identificador de login, do desafio de certificado, do payload do termo, do
 * registro de auditoria...), cada um com sua variação de
 * `new TextEncoder().encode(...)` e `new Uint8Array(buf)`. Nenhum errava, mas é
 * a superfície onde um ajuste futuro — trocar o algoritmo, salgar a entrada —
 * teria de ser aplicado oito vezes.
 *
 * Usa WebCrypto (`crypto.subtle`), disponível igualmente no Worker, no Node e
 * no navegador; não importa `node:crypto`, então serve também ao cliente.
 */
import { bytesToHex } from './hex';

/** SHA-256 de um texto (UTF-8) ou de bytes, em hex minúsculo (64 chars). */
export async function sha256Hex(entrada: string | Uint8Array): Promise<string> {
	const bytes = typeof entrada === 'string' ? new TextEncoder().encode(entrada) : entrada;
	const buf = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
	return bytesToHex(new Uint8Array(buf));
}
