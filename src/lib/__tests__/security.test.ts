import { describe, it, expect } from 'vitest';
import { isAdminGeral, isAdminSeccional, isAdminUnidade, isAnyAdmin } from '../auth';
import type { UsuarioLogado } from '../auth';

// ---- CSP Tests ----
// Testa a lógica da CSP de forma isolada (sem importar hooks.server que depende de $lib)

/**
 * Réplica da lógica buildCSP para teste isolado.
 * Se a lógica mudar em hooks.server.ts, atualizar aqui também.
 */
function buildCSPTest(isHTML: boolean): string {
	if (!isHTML) {
		return "default-src 'none'; base-uri 'none'; form-action 'none'";
	}
	const isDev = process.env.NODE_ENV !== 'production';
	const scriptExtra = isDev ? " 'unsafe-eval'" : '';
	const connectExtra = isDev ? ' http://localhost:*' : '';
	return [
		`default-src 'self'`,
		`script-src 'self' 'unsafe-inline'${scriptExtra}`,
		`style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
		`img-src 'self' data: blob: https://fonts.gstatic.com`,
		`font-src 'self' data: https://fonts.gstatic.com`,
		`connect-src 'self'${connectExtra}`,
		`frame-src 'none'`,
		`object-src 'none'`,
		`base-uri 'self'`,
		`form-action 'self'`,
		`upgrade-insecure-requests`,
		`block-all-mixed-content`
	].join('; ');
}

describe('Content-Security-Policy', () => {
	it('CSP para HTML inclui diretivas de script, style e font', () => {
		const csp = buildCSPTest(true);
		expect(csp).toContain("script-src 'self'");
		expect(csp).toContain("style-src 'self'");
		expect(csp).toContain('https://fonts.googleapis.com');
		expect(csp).toContain('https://fonts.gstatic.com');
	});

	it('CSP para HTML bloqueia frames e objects', () => {
		const csp = buildCSPTest(true);
		expect(csp).toContain("frame-src 'none'");
		expect(csp).toContain("object-src 'none'");
	});

	it('CSP para HTML inclui upgrade-insecure-requests e block-all-mixed-content', () => {
		const csp = buildCSPTest(true);
		expect(csp).toContain('upgrade-insecure-requests');
		expect(csp).toContain('block-all-mixed-content');
	});

	it('CSP para API bloqueia tudo', () => {
		const csp = buildCSPTest(false);
		expect(csp).toContain("default-src 'none'");
		expect(csp).toContain("base-uri 'none'");
		expect(csp).toContain("form-action 'none'");
	});

	it('CSP para HTML restringe base-uri e form-action a self', () => {
		const csp = buildCSPTest(true);
		expect(csp).toContain("base-uri 'self'");
		expect(csp).toContain("form-action 'self'");
	});

	it('CSP para produção não inclui unsafe-eval', () => {
		const originalEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = 'production';
		const csp = buildCSPTest(true);
		expect(csp).not.toContain("'unsafe-eval'");
		expect(csp).not.toContain('http://localhost');
		process.env.NODE_ENV = originalEnv;
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
