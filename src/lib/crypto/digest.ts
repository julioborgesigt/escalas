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

/**
 * Prefixo dos tokens persistidos como hash.
 *
 * O valor em claro tem 64 hex chars e o hash também, então sem prefixo as duas
 * formas são indistinguíveis no banco. É ele que permite aceitar a linha legada
 * em claro no fallback e migrá-la no primeiro uso.
 */
export const PREFIXO_TOKEN_HASH = 'sha256:';

/**
 * Forma ARMAZENÁVEL de um token opaco: `sha256:<hex>`.
 *
 * Usada por tudo que guarda credencial no D1 — `sessoes`, `reset_senha_tokens`,
 * `assinatura_intencoes` e `assinatura_reauth`. O valor em claro existe uma vez
 * só, na resposta ao cliente; o banco nunca o vê. Um dump ou acesso de operador
 * não permite sequestrar sessão ativa, reset pendente nem intenção de assinatura.
 *
 * Estava reescrita em três módulos (`$lib/auth`, `assinatura/intencao`,
 * `db/reauth`), cada um com sua constante de prefixo — três lugares para
 * consertar se o algoritmo ou o prefixo mudar, num ponto onde divergir significa
 * token que não confere mais.
 */
export async function hashTokenArmazenado(token: string): Promise<string> {
	return `${PREFIXO_TOKEN_HASH}${await sha256Hex(token)}`;
}
