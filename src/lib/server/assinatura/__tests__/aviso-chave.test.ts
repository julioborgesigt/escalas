/**
 * Aviso da chave no e-mail funcional — best-effort, nunca derruba o ato.
 */
import { describe, it, expect, vi } from 'vitest';
import { avisarChaveNoEmailFuncional } from '../aviso-chave';
import { logger } from '../../logger';

vi.mock('../../logger', () => ({
	logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}));

const CRED = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHw';

function platformCapturando(alvo: { msg?: { subject: string; html: string } }) {
	return {
		env: {
			EMAIL: {
				async send(m: { subject: string; html: string }) {
					alvo.msg = { subject: m.subject, html: m.html };
					return { messageId: 't' };
				}
			}
		}
	} as unknown as App.Platform;
}

describe('avisarChaveNoEmailFuncional', () => {
	it('não envia sem e-mail e não relança', async () => {
		const alvo: { msg?: { subject: string; html: string } } = {};
		await expect(
			avisarChaveNoEmailFuncional(platformCapturando(alvo), {
				email: null,
				nome: 'FULANO',
				evento: 'cadastrada',
				credentialId: CRED
			})
		).resolves.toBeUndefined();
		expect(alvo.msg).toBeUndefined();
		expect(logger.warn).toHaveBeenCalled();
	});

	it('envia recorte, não o id completo, e não menciona IP', async () => {
		const alvo: { msg?: { subject: string; html: string } } = {};
		await avisarChaveNoEmailFuncional(platformCapturando(alvo), {
			email: 'fulano@pc.ce.gov.br',
			nome: 'FULANO DE TAL',
			evento: 'substituida',
			credentialId: CRED
		});
		expect(alvo.msg?.subject).toMatch(/substituída/);
		expect(alvo.msg?.html).toContain('AQIDBAUG...obHB0eHw');
		expect(alvo.msg?.html).not.toContain(CRED);
		expect(alvo.msg?.html).not.toMatch(/\bIP\b/);
		expect(alvo.msg?.html).not.toMatch(/user-agent/i);
	});

	it('falha de envio não relança', async () => {
		const platform = {
			env: {
				EMAIL: {
					async send() {
						throw new Error('provedor fora');
					}
				}
			}
		} as unknown as App.Platform;
		await expect(
			avisarChaveNoEmailFuncional(platform, {
				email: 'fulano@pc.ce.gov.br',
				nome: 'FULANO',
				evento: 'revogada',
				credentialId: CRED
			})
		).resolves.toBeUndefined();
	});
});
