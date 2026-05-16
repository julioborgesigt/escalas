/**
 * Autenticação compartilhada dos webhooks (`/api/webhook/*`).
 *
 * Duas modalidades aceitas (alternativas):
 *  1. `Authorization: Bearer <SYNC_TOKEN>` — simples, mas exposto se intermediário
 *     loga headers. Comparação em tempo constante via `compararSegredoUtf8TimingSafe`.
 *  2. `X-Hub-Signature-256: sha256=<hex>` — HMAC do body usando `SYNC_TOKEN` como
 *     chave. Imune a logging acidental do header. Estilo GitHub.
 *
 * Endpoint REJEITA tokens menores que `SYNC_TOKEN_MIN_LEN` para evitar segredos
 * fracos em produção (32 chars hex = 128 bits de entropia mínima recomendada).
 */

import { timingSafeEqual } from 'node:crypto';
import { compararSegredoUtf8TimingSafe } from '$lib/auth';

/** Comprimento mínimo aceito do SYNC_TOKEN (32 chars hex = 128 bits). */
export const SYNC_TOKEN_MIN_LEN = 32;

/**
 * Resultado da validação. Use `kind` para distinguir os cenários de erro do
 * sucesso — facilita logging estruturado pelo caller.
 */
export type WebhookAuthResult =
	| { ok: true }
	| { ok: false; reason: 'config-missing' | 'config-weak' | 'bearer-invalid' | 'hmac-invalid' };

/**
 * Valida Bearer token em tempo constante. Aceita header `null` (responde
 * `false` sem branch curto que vaze timing).
 */
export function bearerTokenValido(authHeader: string | null, expectedToken: string): boolean {
	return compararSegredoUtf8TimingSafe(authHeader ?? '', `Bearer ${expectedToken}`);
}

/**
 * Valida HMAC-SHA256 do body. Header esperado: `sha256=<hex_minusculo>`.
 *
 * Comparação em tempo constante. Retorna `false` para header malformado,
 * comprimento divergente ou assinatura incorreta — caller não precisa
 * distinguir.
 */
export async function hmacSha256Valido(
	secret: string,
	body: string,
	sigHeader: string | null
): Promise<boolean> {
	if (!sigHeader?.startsWith('sha256=')) return false;
	const expectedHex = sigHeader.slice(7);

	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey(
		'raw',
		enc.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
	const computedHex = Array.from(new Uint8Array(sig))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');

	if (computedHex.length !== expectedHex.length) return false;
	return timingSafeEqual(Buffer.from(computedHex), Buffer.from(expectedHex));
}

/**
 * Orquestra a validação completa de um webhook de sync.
 *
 * Convenção: preferir HMAC quando ambos os headers vierem; cair em Bearer caso
 * contrário. Fail-closed para SYNC_TOKEN ausente/curto.
 */
export async function validarWebhookSync(
	syncToken: string | undefined,
	request: Request,
	rawBody: string
): Promise<WebhookAuthResult> {
	if (!syncToken) return { ok: false, reason: 'config-missing' };
	if (syncToken.length < SYNC_TOKEN_MIN_LEN) return { ok: false, reason: 'config-weak' };

	const sigHeader = request.headers.get('X-Hub-Signature-256');
	const authHeader = request.headers.get('Authorization');

	if (sigHeader) {
		const ok = await hmacSha256Valido(syncToken, rawBody, sigHeader);
		return ok ? { ok: true } : { ok: false, reason: 'hmac-invalid' };
	}
	const ok = bearerTokenValido(authHeader, syncToken);
	return ok ? { ok: true } : { ok: false, reason: 'bearer-invalid' };
}
