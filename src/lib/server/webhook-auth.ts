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
import { bytesToHex } from '$lib/crypto/hex';
import { compararSegredoUtf8TimingSafe } from '$lib/auth';
import { webhookNonces } from './schema';
import { logger } from './logger';
import type { Database } from '$lib/db';

/** Comprimento mínimo aceito do SYNC_TOKEN (32 chars hex = 128 bits). */
export const SYNC_TOKEN_MIN_LEN = 32;

/** Janela default de aceitação de timestamp (segundos). 5min absorve clock skew razoável. */
export const REPLAY_DEFAULT_WINDOW_SECONDS = 300;

/** Comprimento mínimo do nonce — 16 chars (64 bits hex) já dão entropia de sobra para a janela. */
export const NONCE_MIN_LEN = 16;

/**
 * Resultado da validação. Use `kind` para distinguir os cenários de erro do
 * sucesso — facilita logging estruturado pelo caller.
 */
type WebhookAuthResult =
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
	const computedHex = bytesToHex(new Uint8Array(sig));

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

// ─── Replay protection (P1.3 da auditoria) ──────────────────────────────────
//
// HMAC garante autenticidade do payload, mas NÃO previne reenvio: um atacante
// que capture um body+assinatura válidos pode reproduzir indefinidamente. O
// padrão clássico (Stripe, Slack, GitHub) usa dois mecanismos combinados:
//
//   1. X-Webhook-Timestamp — timestamp Unix (segundos OU milissegundos) ou
//      ISO 8601. Receiver rejeita se fora da janela de aceitação.
//   2. X-Webhook-Nonce     — valor único por requisição. Receiver armazena
//      em `webhook_nonces` (UNIQUE) e rejeita o segundo envio.
//
// Os dois sozinhos têm furos (só timestamp: replay dentro da janela; só nonce:
// armazenamento cresce sem limite). Combinados, o atacante teria que executar
// o replay em ≤ window segundos E o servidor só precisa lembrar de nonces
// dentro dessa janela.

type ReplayProtectionResult =
	| { ok: true }
	| {
			ok: false;
			reason:
				| 'missing-headers'
				| 'invalid-timestamp'
				| 'stale'
				| 'in-future'
				| 'nonce-too-short'
				| 'replay';
	  };

/** Aceita epoch em segundos, em milissegundos, ou ISO 8601. Retorna ms ou NaN. */
function parseTimestampMs(raw: string): number {
	const trimmed = raw.trim();
	if (!trimmed) return NaN;
	// Numérico puro: heurística — 10 dígitos = segundos; 13 dígitos = ms.
	if (/^\d+$/.test(trimmed)) {
		const n = Number(trimmed);
		if (!Number.isFinite(n)) return NaN;
		return trimmed.length <= 10 ? n * 1000 : n;
	}
	// ISO 8601 / RFC 3339.
	const parsed = Date.parse(trimmed);
	return Number.isNaN(parsed) ? NaN : parsed;
}

/**
 * Valida X-Webhook-Timestamp + X-Webhook-Nonce e registra o nonce.
 *
 * Use ANTES de processar o payload (mas DEPOIS de validar HMAC — não vale a
 * pena gastar D1 para requests com assinatura inválida). Em sucesso, o nonce
 * fica gravado em `webhook_nonces` e qualquer reenvio falha por UNIQUE.
 *
 * Caller decide se headers ausentes são erro ou apenas warning (durante o
 * período de rollout, antes do sender ser atualizado). Esta função sempre
 * devolve `reason: 'missing-headers'` quando faltar algum — caller pode
 * tratar de acordo com env flag.
 */
export async function validarReplayProtection(
	db: Database,
	request: Request,
	options: { windowSeconds?: number; now?: number } = {}
): Promise<ReplayProtectionResult> {
	const windowMs = (options.windowSeconds ?? REPLAY_DEFAULT_WINDOW_SECONDS) * 1000;
	const nowMs = options.now ?? Date.now();

	const tsHeader = request.headers.get('X-Webhook-Timestamp');
	const nonceHeader = request.headers.get('X-Webhook-Nonce');

	if (!tsHeader || !nonceHeader) return { ok: false, reason: 'missing-headers' };

	const tsMs = parseTimestampMs(tsHeader);
	if (!Number.isFinite(tsMs)) return { ok: false, reason: 'invalid-timestamp' };

	const drift = nowMs - tsMs;
	if (drift > windowMs) return { ok: false, reason: 'stale' };
	if (drift < -windowMs) return { ok: false, reason: 'in-future' };

	const nonce = nonceHeader.trim();
	if (nonce.length < NONCE_MIN_LEN) return { ok: false, reason: 'nonce-too-short' };

	// Tentativa atômica de INSERT. UNIQUE constraint (PRIMARY KEY) detecta replay
	// sem precisar de SELECT prévio (que abriria janela TOCTOU entre isolates).
	try {
		await db.insert(webhookNonces).values({ nonce }).run();
		return { ok: true };
	} catch (err) {
		// Drizzle/D1: erros de UNIQUE vêm com mensagens contendo "UNIQUE" ou
		// código SQLITE_CONSTRAINT. Não temos código estruturado em D1, então
		// matching textual é o mais robusto.
		const msg = err instanceof Error ? err.message : String(err);
		if (/UNIQUE|constraint/i.test(msg)) return { ok: false, reason: 'replay' };
		throw err;
	}
}

/**
 * Helper para o caller decidir o comportamento de rollout. Se a env
 * `WEBHOOK_REPLAY_ENFORCE` estiver definida (qualquer valor truthy), faltar
 * headers vira erro 401. Caso contrário, apenas loga.
 *
 * Aceita `unknown` em vez do tipo `Env` gerado pelo wrangler porque a flag é
 * opcional, nem sempre está nos types, e o caller pode passar `platform?.env`
 * direto sem cast.
 */
export function replayEnforceLigado(env: unknown): boolean {
	if (!env || typeof env !== 'object') return false;
	const raw = (env as Record<string, unknown>).WEBHOOK_REPLAY_ENFORCE;
	if (typeof raw !== 'string') return false;
	const v = raw.trim().toLowerCase();
	return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * Loga falha de replay protection com nível adequado ao ambiente.
 *
 * Em produção, ausência de nonce/timestamp é um sinal forte (o sender
 * deveria estar atualizado faz tempo) — escalado para `error` para
 * disparar alerta no Sentry. Em dev/staging, fica `warn` e não polui o
 * canal de produção.
 *
 * Caller deve usar este helper em vez de `logger.info` puro — o log
 * antigo escondia o problema sob o radar.
 */
export function logFaltaReplayHeaders(
	caller: string,
	ctx: Record<string, unknown>,
	isProduction: boolean
): void {
	const msg =
		`[${caller}] webhook sem headers de replay protection (X-Webhook-Timestamp/Nonce). ` +
		'Atualize o sender e ligue WEBHOOK_REPLAY_ENFORCE.';
	// `import.meta.env.PROD` fica embutido em build-time pelo Vite — o helper
	// recebe explícito para facilitar teste e para evitar acoplamento ao Vite
	// neste módulo server-only.
	if (isProduction) {
		logger.error(msg, ctx);
	} else {
		logger.warn(msg, ctx);
	}
}
