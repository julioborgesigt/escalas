import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	bearerTokenValido,
	hmacSha256Valido,
	validarWebhookSync,
	validarReplayProtection,
	replayEnforceLigado,
	SYNC_TOKEN_MIN_LEN,
	NONCE_MIN_LEN,
	REPLAY_DEFAULT_WINDOW_SECONDS
} from '../webhook-auth';
import type { Database } from '$lib/db';

const TOKEN = 'a'.repeat(SYNC_TOKEN_MIN_LEN); // token "forte" de 32 chars

function makeReq(headers: Record<string, string>): Request {
	return new Request('https://x.test/', { method: 'POST', headers });
}

describe('bearerTokenValido', () => {
	it('aceita header correto', () => {
		expect(bearerTokenValido(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
	});
	it('rejeita header null', () => {
		expect(bearerTokenValido(null, TOKEN)).toBe(false);
	});
	it('rejeita token errado de mesmo comprimento', () => {
		const wrong = 'b'.repeat(SYNC_TOKEN_MIN_LEN);
		expect(bearerTokenValido(`Bearer ${wrong}`, TOKEN)).toBe(false);
	});
	it('rejeita prefix sem "Bearer "', () => {
		expect(bearerTokenValido(TOKEN, TOKEN)).toBe(false);
	});
	it('rejeita header com padding extra (não vaza via comprimento)', () => {
		expect(bearerTokenValido(`Bearer ${TOKEN}   `, TOKEN)).toBe(false);
	});
});

describe('hmacSha256Valido', () => {
	async function sign(secret: string, body: string): Promise<string> {
		const key = await crypto.subtle.importKey(
			'raw',
			new TextEncoder().encode(secret),
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign']
		);
		const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
		return Array.from(new Uint8Array(sig))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
	}

	it('aceita assinatura correta', async () => {
		const body = '{"x":1}';
		const sig = await sign(TOKEN, body);
		expect(await hmacSha256Valido(TOKEN, body, `sha256=${sig}`)).toBe(true);
	});

	it('rejeita assinatura adulterada', async () => {
		const body = '{"x":1}';
		const sig = await sign(TOKEN, body);
		const tampered = sig.slice(0, -2) + '00';
		expect(await hmacSha256Valido(TOKEN, body, `sha256=${tampered}`)).toBe(false);
	});

	it('rejeita body adulterado', async () => {
		const sig = await sign(TOKEN, '{"x":1}');
		expect(await hmacSha256Valido(TOKEN, '{"x":2}', `sha256=${sig}`)).toBe(false);
	});

	it('rejeita header sem prefix sha256=', async () => {
		const sig = await sign(TOKEN, 'x');
		expect(await hmacSha256Valido(TOKEN, 'x', sig)).toBe(false);
	});

	it('rejeita header null', async () => {
		expect(await hmacSha256Valido(TOKEN, 'x', null)).toBe(false);
	});

	it('rejeita comprimento divergente sem crashar timingSafeEqual', async () => {
		expect(await hmacSha256Valido(TOKEN, 'x', 'sha256=deadbeef')).toBe(false);
	});
});

describe('validarWebhookSync', () => {
	it('config-missing quando SYNC_TOKEN ausente', async () => {
		const r = await validarWebhookSync(undefined, makeReq({}), '');
		expect(r.ok).toBe(false);
		expect(r).toMatchObject({ reason: 'config-missing' });
	});

	it('config-weak quando SYNC_TOKEN < 32 chars (placeholder/fraco)', async () => {
		const r = await validarWebhookSync('short', makeReq({}), '');
		expect(r.ok).toBe(false);
		expect(r).toMatchObject({ reason: 'config-weak' });
	});

	it('aceita Bearer válido', async () => {
		const r = await validarWebhookSync(TOKEN, makeReq({ Authorization: `Bearer ${TOKEN}` }), '');
		expect(r.ok).toBe(true);
	});

	it('prefere HMAC quando ambos os headers vêm (mais seguro)', async () => {
		const body = '{"a":1}';
		const key = await crypto.subtle.importKey(
			'raw',
			new TextEncoder().encode(TOKEN),
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign']
		);
		const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
		const sig = Array.from(new Uint8Array(sigBytes))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');

		// HMAC válido + Bearer INVÁLIDO → ainda aceito (porque escolhemos HMAC)
		const r = await validarWebhookSync(
			TOKEN,
			makeReq({ Authorization: 'Bearer ERRADO', 'X-Hub-Signature-256': `sha256=${sig}` }),
			body
		);
		expect(r.ok).toBe(true);
	});

	it('hmac-invalid quando assinatura errada e nenhum Bearer', async () => {
		const r = await validarWebhookSync(
			TOKEN,
			makeReq({ 'X-Hub-Signature-256': 'sha256=deadbeef' }),
			'{}'
		);
		expect(r.ok).toBe(false);
		expect(r).toMatchObject({ reason: 'hmac-invalid' });
	});

	it('bearer-invalid quando Bearer errado e nenhum HMAC', async () => {
		const r = await validarWebhookSync(TOKEN, makeReq({ Authorization: 'Bearer ERRADO' }), '');
		expect(r.ok).toBe(false);
		expect(r).toMatchObject({ reason: 'bearer-invalid' });
	});
});

// ─── replay protection (P1.3) ──────────────────────────────────────────────

const NONCE_OK = 'a'.repeat(NONCE_MIN_LEN);

/**
 * Mock mínimo do Drizzle: `db.insert(table).values(v).run()`. Aceita
 * configuração para simular UNIQUE constraint violation no segundo INSERT
 * com o mesmo nonce.
 */
function makeFakeDb(opts: { failWith?: Error } = {}): Database {
	const seen = new Set<string>();
	const chain = {
		values(v: { nonce: string }) {
			return {
				run() {
					if (opts.failWith) throw opts.failWith;
					if (seen.has(v.nonce)) throw new Error('UNIQUE constraint failed: webhook_nonces.nonce');
					seen.add(v.nonce);
					return Promise.resolve();
				}
			};
		}
	};
	return { insert: () => chain } as unknown as Database;
}

const NOW = 1_700_000_000_000; // Timestamp arbitrário em ms para reproducibilidade.

describe('validarReplayProtection', () => {
	let db: Database;

	beforeEach(() => {
		db = makeFakeDb();
	});

	it('aceita timestamp + nonce válidos', async () => {
		const r = await validarReplayProtection(
			db,
			makeReq({
				'X-Webhook-Timestamp': String(Math.floor(NOW / 1000)),
				'X-Webhook-Nonce': NONCE_OK
			}),
			{ now: NOW }
		);
		expect(r).toEqual({ ok: true });
	});

	it('headers ausentes → missing-headers (caller decide se enforça)', async () => {
		const r1 = await validarReplayProtection(db, makeReq({}), { now: NOW });
		expect(r1).toEqual({ ok: false, reason: 'missing-headers' });

		const r2 = await validarReplayProtection(db, makeReq({ 'X-Webhook-Timestamp': '1' }), {
			now: NOW
		});
		expect(r2.ok).toBe(false);

		const r3 = await validarReplayProtection(db, makeReq({ 'X-Webhook-Nonce': NONCE_OK }), {
			now: NOW
		});
		expect(r3.ok).toBe(false);
	});

	it('timestamp inválido (não-numérico, não-ISO) → invalid-timestamp', async () => {
		const r = await validarReplayProtection(
			db,
			makeReq({ 'X-Webhook-Timestamp': 'foobar', 'X-Webhook-Nonce': NONCE_OK }),
			{ now: NOW }
		);
		expect(r).toEqual({ ok: false, reason: 'invalid-timestamp' });
	});

	it('timestamp em segundos é aceito (10 dígitos = epoch s)', async () => {
		const r = await validarReplayProtection(
			db,
			makeReq({
				'X-Webhook-Timestamp': String(Math.floor(NOW / 1000)),
				'X-Webhook-Nonce': NONCE_OK
			}),
			{ now: NOW }
		);
		expect(r.ok).toBe(true);
	});

	it('timestamp em milissegundos é aceito (13 dígitos = epoch ms)', async () => {
		const r = await validarReplayProtection(
			db,
			makeReq({ 'X-Webhook-Timestamp': String(NOW), 'X-Webhook-Nonce': NONCE_OK }),
			{ now: NOW }
		);
		expect(r.ok).toBe(true);
	});

	it('timestamp ISO 8601 é aceito', async () => {
		const r = await validarReplayProtection(
			db,
			makeReq({
				'X-Webhook-Timestamp': new Date(NOW).toISOString(),
				'X-Webhook-Nonce': NONCE_OK
			}),
			{ now: NOW }
		);
		expect(r.ok).toBe(true);
	});

	it('timestamp antigo fora da janela → stale', async () => {
		const tooOld = NOW - (REPLAY_DEFAULT_WINDOW_SECONDS + 60) * 1000;
		const r = await validarReplayProtection(
			db,
			makeReq({ 'X-Webhook-Timestamp': String(tooOld), 'X-Webhook-Nonce': NONCE_OK }),
			{ now: NOW }
		);
		expect(r).toEqual({ ok: false, reason: 'stale' });
	});

	it('timestamp no futuro fora da janela → in-future', async () => {
		const tooNew = NOW + (REPLAY_DEFAULT_WINDOW_SECONDS + 60) * 1000;
		const r = await validarReplayProtection(
			db,
			makeReq({ 'X-Webhook-Timestamp': String(tooNew), 'X-Webhook-Nonce': NONCE_OK }),
			{ now: NOW }
		);
		expect(r).toEqual({ ok: false, reason: 'in-future' });
	});

	it('clock skew dentro da janela é tolerado (ambos os lados)', async () => {
		for (const skew of [-100_000, 100_000]) {
			const r = await validarReplayProtection(
				makeFakeDb(),
				makeReq({ 'X-Webhook-Timestamp': String(NOW + skew), 'X-Webhook-Nonce': NONCE_OK }),
				{ now: NOW }
			);
			expect(r.ok).toBe(true);
		}
	});

	it('nonce muito curto → nonce-too-short (não consome DB)', async () => {
		const shortNonce = 'a'.repeat(NONCE_MIN_LEN - 1);
		const insertSpy = vi.spyOn(db, 'insert');
		const r = await validarReplayProtection(
			db,
			makeReq({ 'X-Webhook-Timestamp': String(NOW), 'X-Webhook-Nonce': shortNonce }),
			{ now: NOW }
		);
		expect(r).toEqual({ ok: false, reason: 'nonce-too-short' });
		expect(insertSpy).not.toHaveBeenCalled();
	});

	it('reenvio do mesmo nonce → replay (UNIQUE constraint)', async () => {
		const headers = {
			'X-Webhook-Timestamp': String(NOW),
			'X-Webhook-Nonce': NONCE_OK
		};
		const r1 = await validarReplayProtection(db, makeReq(headers), { now: NOW });
		expect(r1).toEqual({ ok: true });
		const r2 = await validarReplayProtection(db, makeReq(headers), { now: NOW });
		expect(r2).toEqual({ ok: false, reason: 'replay' });
	});

	it('windowSeconds custom encurta janela de aceitação', async () => {
		const r = await validarReplayProtection(
			db,
			makeReq({ 'X-Webhook-Timestamp': String(NOW - 11_000), 'X-Webhook-Nonce': NONCE_OK }),
			{ now: NOW, windowSeconds: 10 }
		);
		expect(r).toEqual({ ok: false, reason: 'stale' });
	});

	it('erros de DB não relacionados a UNIQUE são re-lançados', async () => {
		const boom = new Error('database is locked');
		const failDb = makeFakeDb({ failWith: boom });
		await expect(
			validarReplayProtection(
				failDb,
				makeReq({ 'X-Webhook-Timestamp': String(NOW), 'X-Webhook-Nonce': NONCE_OK }),
				{ now: NOW }
			)
		).rejects.toThrow(/locked/);
	});
});

describe('replayEnforceLigado', () => {
	it('aceita "1", "true", "yes", "on" (case-insensitive)', () => {
		for (const v of ['1', 'true', 'TRUE', ' yes ', 'on', 'On']) {
			expect(replayEnforceLigado({ WEBHOOK_REPLAY_ENFORCE: v })).toBe(true);
		}
	});

	it('rejeita strings vazias / outros valores / não-string', () => {
		expect(replayEnforceLigado({ WEBHOOK_REPLAY_ENFORCE: '' })).toBe(false);
		expect(replayEnforceLigado({ WEBHOOK_REPLAY_ENFORCE: '0' })).toBe(false);
		expect(replayEnforceLigado({ WEBHOOK_REPLAY_ENFORCE: 'false' })).toBe(false);
		expect(replayEnforceLigado({ WEBHOOK_REPLAY_ENFORCE: 'maybe' })).toBe(false);
		expect(replayEnforceLigado({})).toBe(false);
		expect(replayEnforceLigado(undefined)).toBe(false);
		expect(replayEnforceLigado(null)).toBe(false);
	});
});
