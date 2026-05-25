import { describe, it, expect } from 'vitest';
import { isAdminGeral, isAdminSeccional, isAdminUnidade, isAnyAdmin } from '../auth';
import type { UsuarioLogado } from '../auth';
import { buildCSP } from '../server/csp';
// Importa o config do SvelteKit para verificar as diretivas CSP de HTML.
// `svelte.config.js` é a fonte autoritativa para CSP HTML (gerenciada pelo
// framework com nonce automático). `csp.ts` cuida apenas de respostas não-HTML.
import svelteConfig from '../../../svelte.config.js';

describe('Content-Security-Policy — HTML (gerenciado pelo SvelteKit)', () => {
	const directives = svelteConfig.kit?.csp?.directives ?? {};

	it("modo CSP é 'auto' (nonce em SSR / hash em prerender)", () => {
		expect(svelteConfig.kit?.csp?.mode).toBe('auto');
	});

	it("script-src é apenas 'self' — SEM unsafe-inline (anti-XSS)", () => {
		expect(directives['script-src']).toEqual(['self']);
		expect(directives['script-src']).not.toContain('unsafe-inline');
		expect(directives['script-src']).not.toContain('unsafe-eval');
	});

	it('style-src não libera CDNs externos (fontes são self-hosted via @fontsource)', () => {
		const styleSrc = directives['style-src'] ?? [];
		expect(styleSrc).not.toContain('https://fonts.googleapis.com');
		expect(styleSrc.every((s) => s === 'self' || s === 'unsafe-inline')).toBe(true);
	});

	it("font-src é apenas 'self' e data: (fontes empacotadas no bundle)", () => {
		const fontSrc = directives['font-src'] ?? [];
		expect(fontSrc).not.toContain('https://fonts.gstatic.com');
		expect(fontSrc.every((s) => s === 'self' || s === 'data:')).toBe(true);
	});

	it('img-src não libera fonts.gstatic (sem dependência externa do Google)', () => {
		expect(directives['img-src']).not.toContain('https://fonts.gstatic.com');
	});

	it('frame-src e object-src bloqueiam tudo', () => {
		expect(directives['frame-src']).toEqual(['none']);
		expect(directives['object-src']).toEqual(['none']);
	});

	it("base-uri e form-action restritos a 'self'", () => {
		expect(directives['base-uri']).toEqual(['self']);
		expect(directives['form-action']).toEqual(['self']);
	});

	it('connect-src permite WebSocket SERPRO e localhost para o assinador', () => {
		const connect = directives['connect-src'] ?? [];
		expect(connect.some((s) => s.includes('assinador-desktop.serpro.gov.br'))).toBe(true);
		expect(connect.some((s) => s.includes('127.0.0.1'))).toBe(true);
	});

	it('upgrade-insecure-requests está habilitado', () => {
		expect(directives['upgrade-insecure-requests']).toBe(true);
	});

	it('block-all-mixed-content está habilitado', () => {
		expect(directives['block-all-mixed-content']).toBe(true);
	});
});

describe('Content-Security-Policy — não-HTML (buildCSP)', () => {
	it('para HTML retorna null (gerenciado pelo SvelteKit)', () => {
		expect(buildCSP(true, { isProduction: true })).toBeNull();
		expect(buildCSP(true, { isProduction: false })).toBeNull();
	});

	it('para não-HTML bloqueia tudo (default-src none)', () => {
		const csp = buildCSP(false, { isProduction: true });
		expect(csp).toContain("default-src 'none'");
		expect(csp).toContain("base-uri 'none'");
		expect(csp).toContain("form-action 'none'");
	});

	it('para não-HTML não depende do modo dev/prod', () => {
		const prod = buildCSP(false, { isProduction: true });
		const dev = buildCSP(false, { isProduction: false });
		expect(prod).toBe(dev);
	});
});

// ---- RBAC Tests ----

function makeUser(overrides: Partial<UsuarioLogado> = {}): UsuarioLogado {
	return {
		id: 1,
		tipo: 'policial',
		nome: 'Teste',
		primeiro_acesso: false,
		...overrides
	};
}

describe('RBAC - isAdminGeral', () => {
	it('retorna true para tipo admin', () => {
		expect(isAdminGeral(makeUser({ tipo: 'admin' }))).toBe(true);
	});

	it('retorna false para policial', () => {
		expect(isAdminGeral(makeUser({ tipo: 'policial' }))).toBe(false);
	});

	it('retorna false para null', () => {
		expect(isAdminGeral(null)).toBe(false);
	});
});

describe('RBAC - isAdminSeccional', () => {
	it('retorna true para policial com papel admin_seccional', () => {
		expect(isAdminSeccional(makeUser({ tipo: 'policial', papel: 'admin_seccional' }))).toBe(true);
	});

	it('retorna false para admin geral', () => {
		expect(isAdminSeccional(makeUser({ tipo: 'admin' }))).toBe(false);
	});

	it('retorna false para policial sem papel', () => {
		expect(isAdminSeccional(makeUser({ tipo: 'policial', papel: null }))).toBe(false);
	});
});

describe('RBAC - isAdminUnidade', () => {
	it('retorna true para policial com papel admin_unidade', () => {
		expect(isAdminUnidade(makeUser({ tipo: 'policial', papel: 'admin_unidade' }))).toBe(true);
	});

	it('retorna false para admin_seccional', () => {
		expect(isAdminUnidade(makeUser({ tipo: 'policial', papel: 'admin_seccional' }))).toBe(false);
	});
});

describe('RBAC - isAnyAdmin', () => {
	it('retorna true para admin geral', () => {
		expect(isAnyAdmin(makeUser({ tipo: 'admin' }))).toBe(true);
	});

	it('retorna true para admin seccional', () => {
		expect(isAnyAdmin(makeUser({ tipo: 'policial', papel: 'admin_seccional' }))).toBe(true);
	});

	it('retorna true para admin unidade', () => {
		expect(isAnyAdmin(makeUser({ tipo: 'policial', papel: 'admin_unidade' }))).toBe(true);
	});

	it('retorna false para policial comum', () => {
		expect(isAnyAdmin(makeUser({ tipo: 'policial', papel: null }))).toBe(false);
	});

	it('retorna false para null', () => {
		expect(isAnyAdmin(null)).toBe(false);
	});
});

// ---- API Error Format Tests ----

describe('API Error Response Helper', () => {
	it('apiError creates consistent error format', async () => {
		const { apiError } = await import('$lib/server/api');
		const response = apiError('Não autorizado', 401);
		expect(response.status).toBe(401);
		const body = await response.json();
		expect(body).toHaveProperty('error', 'Não autorizado');
		expect(body).toHaveProperty('status', 401);
	});

	it('apiError with details includes them', async () => {
		const { apiError, ErrorCode } = await import('$lib/server/api');
		const response = apiError('Erro de validação', 400, ErrorCode.VALIDATION);
		const body = await response.json();
		expect(body.errorType).toBe('validation');
	});
});
