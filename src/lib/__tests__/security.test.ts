import { describe, it, expect } from 'vitest';
import { isAdminGeral, isAdminSeccional, isAdminUnidade, isAnyAdmin } from '../auth';
import type { UsuarioLogado } from '../auth';

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
