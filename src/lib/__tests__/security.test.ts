import { describe, it, expect } from 'vitest';
import { isAdminGeral, isAdminSeccional, isAdminUnidade, isAnyAdmin } from '../auth';
import type { UsuarioLogado } from '../auth';
import { buildCSP } from '../server/csp';

describe('Content-Security-Policy', () => {
	it('CSP para HTML (produção) inclui diretivas de script, style e font', () => {
		const csp = buildCSP(true, { isProduction: true });
		expect(csp).not.toBeNull();
		expect(csp).toContain("script-src 'self'");
		expect(csp).toContain("style-src 'self'");
		expect(csp).toContain('https://fonts.googleapis.com');
		expect(csp).toContain('https://fonts.gstatic.com');
	});

	it('CSP para HTML (produção) bloqueia frames e objects', () => {
		const csp = buildCSP(true, { isProduction: true });
		expect(csp).toContain("frame-src 'none'");
		expect(csp).toContain("object-src 'none'");
	});

	it('CSP para HTML inclui upgrade-insecure-requests e block-all-mixed-content', () => {
		const csp = buildCSP(true, { isProduction: true });
		expect(csp).toContain('upgrade-insecure-requests');
		expect(csp).toContain('block-all-mixed-content');
	});

	it('CSP para API bloqueia tudo', () => {
		const csp = buildCSP(false, { isProduction: true });
		expect(csp).toContain("default-src 'none'");
		expect(csp).toContain("base-uri 'none'");
		expect(csp).toContain("form-action 'none'");
	});

	it('CSP para HTML restringe base-uri e form-action a self', () => {
		const csp = buildCSP(true, { isProduction: true });
		expect(csp).toContain("base-uri 'self'");
		expect(csp).toContain("form-action 'self'");
	});

	it('CSP para produção não inclui unsafe-eval', () => {
		const csp = buildCSP(true, { isProduction: true });
		expect(csp).not.toContain("'unsafe-eval'");
		expect(csp).not.toContain('http://localhost');
	});

	it('CSP para HTML em desenvolvimento é omitida (null)', () => {
		expect(buildCSP(true, { isProduction: false })).toBeNull();
	});

	it('CSP para HTML (produção) permite WebSocket Serpro e localhost para assinador', () => {
		const csp = buildCSP(true, { isProduction: true });
		expect(csp).toContain('wss://assinador-desktop.serpro.gov.br');
		expect(csp).toContain('127.0.0.1');
	});

	it('CSP para API não depende do modo dev/prod', () => {
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
		const { apiError } = await import('$lib/server/api-error');
		const response = apiError('Não autorizado', 401);
		expect(response.status).toBe(401);
		const body = await response.json();
		expect(body).toHaveProperty('error', 'Não autorizado');
		expect(body).toHaveProperty('status', 401);
	});

	it('apiError with details includes them', async () => {
		const { apiError } = await import('$lib/server/api-error');
		const response = apiError('Erro de validação', 400, 'validation');
		const body = await response.json();
		expect(body.errorType).toBe('validation');
	});
});
