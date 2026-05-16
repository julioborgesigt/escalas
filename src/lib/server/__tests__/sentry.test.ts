import { describe, it, expect } from 'vitest';
import { sentryBeforeSend } from '../sentry';
import type { ErrorEvent as SentryErrorEvent, EventHint } from '@sentry/cloudflare';

const hint: EventHint = {};

function ev(overrides: Partial<SentryErrorEvent> = {}): SentryErrorEvent {
	return { ...overrides } as SentryErrorEvent;
}

describe('sentryBeforeSend — sanitização de PII', () => {
	it('mascara IDs numéricos em request.url e remove query string', () => {
		const out = sentryBeforeSend(
			ev({ request: { url: 'https://app.com/api/policiais/12345/email-aviso?token=abc' } }),
			hint
		);
		expect(out?.request?.url).toBe('https://app.com/api/policiais/:id/email-aviso');
	});

	it('mascara IDs em event.transaction', () => {
		const out = sentryBeforeSend(ev({ transaction: 'GET /escalas/42' }), hint);
		expect(out?.transaction).toBe('GET /escalas/:id');
	});

	it('mascara IDs em tags.path', () => {
		const out = sentryBeforeSend(ev({ tags: { path: '/api/gise/7/finalizar' } }), hint);
		expect(out?.tags?.path).toBe('/api/gise/:id/finalizar');
	});

	it('strip de cookies, autorização e CSRF dos headers', () => {
		const out = sentryBeforeSend(
			ev({
				request: {
					headers: {
						cookie: 'session_token=abc',
						authorization: 'Bearer xxx',
						'X-CSRF-Token': 'csrf',
						'x-reset-token': 'r',
						'user-agent': 'browser'
					}
				}
			}),
			hint
		);
		const headers = out?.request?.headers as Record<string, string>;
		expect(headers).not.toHaveProperty('cookie');
		expect(headers).not.toHaveProperty('authorization');
		expect(headers).not.toHaveProperty('X-CSRF-Token');
		expect(headers).not.toHaveProperty('x-reset-token');
		expect(headers['user-agent']).toBe('browser');
	});

	it('redige request.data (pode conter senha, código 2FA, CPF)', () => {
		const out = sentryBeforeSend(
			ev({ request: { data: { senha: '12345', cpf: '00000000000' } } }),
			hint
		);
		expect(out?.request?.data).toBe('[REDACTED]');
	});

	it('limpa variáveis locais de stack frames', () => {
		const out = sentryBeforeSend(
			ev({
				exception: {
					values: [
						{
							type: 'Error',
							value: 'x',
							stacktrace: {
								frames: [{ vars: { senha: 'segredo' } }]
							}
						}
					]
				}
			}),
			hint
		);
		const frame = out?.exception?.values?.[0]?.stacktrace?.frames?.[0];
		expect(frame?.vars).toEqual({});
	});

	it('lida com URL malformada sem crashar', () => {
		const out = sentryBeforeSend(ev({ request: { url: 'nao-é-uma-url' } }), hint);
		expect(out?.request?.url).toBe('nao-é-uma-url');
	});

	it('eventos sem request/transaction passam intactos', () => {
		const out = sentryBeforeSend(ev({ message: 'evento simples' }), hint);
		expect(out?.message).toBe('evento simples');
	});
});
