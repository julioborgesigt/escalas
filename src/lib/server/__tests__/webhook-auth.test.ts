import { describe, it, expect } from 'vitest';
import {
	bearerTokenValido,
	hmacSha256Valido,
	validarWebhookSync,
	SYNC_TOKEN_MIN_LEN
} from '../webhook-auth';

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
