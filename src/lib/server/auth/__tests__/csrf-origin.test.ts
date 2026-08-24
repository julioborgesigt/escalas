import { describe, it, expect } from 'vitest';
import { exigeOriginPresente, deveRecusarPorOrigem } from '../csrf-origin';

const NOSSA = 'https://escalas.exemplo.br';

describe('exigeOriginPresente (SEC-14)', () => {
	it('login exige Origin — é o isento de token CSRF que fala com browser', () => {
		expect(exigeOriginPresente('/api/auth/login')).toBe(true);
	});

	it('webhook e health NÃO exigem: cliente externo legítimo não manda Origin', () => {
		expect(exigeOriginPresente('/api/webhook/sync-policiais')).toBe(false);
		expect(exigeOriginPresente('/api/health')).toBe(false);
	});

	it('o match é com delimitador — rota futura parecida não herda a regra', () => {
		expect(exigeOriginPresente('/api/auth/login-alternativo')).toBe(false);
		expect(exigeOriginPresente('/api/auth/login/2fa')).toBe(true);
	});

	it('resto de /api/auth/ não precisa: tem token CSRF de verdade', () => {
		expect(exigeOriginPresente('/api/auth/logout')).toBe(false);
		expect(exigeOriginPresente('/api/auth/verificar-2fa')).toBe(false);
	});
});

describe('deveRecusarPorOrigem (SEC-14)', () => {
	it('origem divergente morre em qualquer rota — comportamento antigo mantido', () => {
		expect(deveRecusarPorOrigem('/api/auth/login', 'https://malicioso.com', NOSSA)).toBe(true);
		expect(deveRecusarPorOrigem('/api/auth/logout', 'https://malicioso.com', NOSSA)).toBe(true);
	});

	it('origem casando passa', () => {
		expect(deveRecusarPorOrigem('/api/auth/login', NOSSA, NOSSA)).toBe(false);
		expect(deveRecusarPorOrigem('/api/auth/logout', NOSSA, NOSSA)).toBe(false);
	});

	it('Origin AUSENTE agora morre no login — era o buraco do SEC-14', () => {
		expect(deveRecusarPorOrigem('/api/auth/login', null, NOSSA)).toBe(true);
	});

	it('Origin ausente segue passando onde o token CSRF já protege', () => {
		expect(deveRecusarPorOrigem('/api/auth/logout', null, NOSSA)).toBe(false);
	});
});
