/**
 * Testes das guardas de autenticação/autorização e da validação de body em
 * `$lib/server/api`. Complementam `api-helpers.test.ts` (que cobre apiError e
 * as respostas de erro), focando aqui em `requireAuth/requireAdmin/
 * requireSuperAdmin`, `validateBody` e `contentDisposition`.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { UsuarioLogado } from '$lib/auth';
import {
	requireAuth,
	requireAdmin,
	requireSuperAdmin,
	validateBody,
	contentDisposition,
	ErrorCode
} from '$lib/server/api';

/** Monta um App.Locals mínimo com (ou sem) usuário para as guardas. */
function locals(usuario?: Partial<UsuarioLogado>): App.Locals {
	return { usuario: usuario as UsuarioLogado | undefined } as App.Locals;
}

const policial: Partial<UsuarioLogado> = {
	id: 1,
	tipo: 'policial',
	nome: 'Policial',
	primeiro_acesso: false
};
const admin: Partial<UsuarioLogado> = {
	id: 2,
	tipo: 'admin',
	nome: 'Admin',
	primeiro_acesso: false
};
const superAdmin: Partial<UsuarioLogado> = { ...admin, id: 3, isSuperAdmin: true };
// Policial promovido a Admin Geral (papel === 'admin_geral'): tipo 'policial',
// mas com poderes de Admin Geral.
const policialAdminGeral: Partial<UsuarioLogado> = {
	id: 4,
	tipo: 'policial',
	nome: 'Policial Admin Geral',
	papel: 'admin_geral',
	primeiro_acesso: false
};

describe('requireAuth', () => {
	it('devolve o usuário quando autenticado', () => {
		const r = requireAuth(locals(policial));
		expect(r).not.toBeInstanceOf(Response);
		expect((r as UsuarioLogado).id).toBe(1);
	});

	it('devolve 401 AUTH_REQUIRED quando sem usuário', async () => {
		const r = requireAuth(locals(undefined));
		expect(r).toBeInstanceOf(Response);
		const resp = r as Response;
		expect(resp.status).toBe(401);
		expect((await resp.json()).errorType).toBe(ErrorCode.AUTH_REQUIRED);
	});
});

describe('requireAdmin', () => {
	it('devolve o usuário quando admin', () => {
		const r = requireAdmin(locals(admin));
		expect((r as UsuarioLogado).tipo).toBe('admin');
	});

	it('aceita policial promovido a papel admin_geral', () => {
		const r = requireAdmin(locals(policialAdminGeral));
		expect(r).not.toBeInstanceOf(Response);
		expect((r as UsuarioLogado).papel).toBe('admin_geral');
	});

	it('rejeita policial com papel admin_seccional (não é Admin Geral)', () => {
		const r = requireAdmin(locals({ ...policial, papel: 'admin_seccional' }));
		expect(r).toBeInstanceOf(Response);
		expect((r as Response).status).toBe(403);
	});

	it('devolve 403 FORBIDDEN quando autenticado mas não-admin', async () => {
		const r = requireAdmin(locals(policial));
		expect(r).toBeInstanceOf(Response);
		const resp = r as Response;
		expect(resp.status).toBe(403);
		expect((await resp.json()).errorType).toBe(ErrorCode.FORBIDDEN);
	});

	it('devolve 401 quando nem autenticado (delega a requireAuth)', () => {
		const r = requireAdmin(locals(undefined));
		expect((r as Response).status).toBe(401);
	});
});

describe('requireSuperAdmin', () => {
	it('devolve o usuário quando super admin', () => {
		const r = requireSuperAdmin(locals(superAdmin));
		expect((r as UsuarioLogado).isSuperAdmin).toBe(true);
	});

	it('devolve 403 para admin comum (sem isSuperAdmin)', () => {
		const r = requireSuperAdmin(locals(admin));
		expect((r as Response).status).toBe(403);
	});

	it('devolve 401 quando não autenticado', () => {
		const r = requireSuperAdmin(locals(undefined));
		expect((r as Response).status).toBe(401);
	});
});

describe('validateBody', () => {
	const schema = z.object({ nome: z.string().min(1, 'nome obrigatório'), idade: z.number().int() });

	function req(body: string): Request {
		return new Request('http://localhost/api/x', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body
		});
	}

	it('devolve data tipada em body válido', async () => {
		const v = await validateBody(req(JSON.stringify({ nome: 'Ana', idade: 30 })), schema);
		expect(v.ok).toBe(true);
		if (v.ok) expect(v.data).toEqual({ nome: 'Ana', idade: 30 });
	});

	it('devolve 400 para JSON malformado', async () => {
		const v = await validateBody(req('{nao é json'), schema);
		expect(v.ok).toBe(false);
		if (!v.ok) {
			expect(v.response.status).toBe(400);
			expect((await v.response.json()).errorType).toBe(ErrorCode.VALIDATION);
		}
	});

	it('devolve 400 com a mensagem do primeiro issue do Zod', async () => {
		const v = await validateBody(req(JSON.stringify({ nome: '', idade: 1 })), schema);
		expect(v.ok).toBe(false);
		if (!v.ok) {
			expect(v.response.status).toBe(400);
			expect((await v.response.json()).error).toBe('nome obrigatório');
		}
	});

	it('rejeita tipo incorreto de campo', async () => {
		const v = await validateBody(req(JSON.stringify({ nome: 'Ana', idade: 'x' })), schema);
		expect(v.ok).toBe(false);
	});
});

describe('contentDisposition', () => {
	it('inclui fallback ASCII e filename* UTF-8 para nomes simples', () => {
		const cd = contentDisposition('Escala 2025-01-15.pdf');
		expect(cd).toContain('attachment;');
		expect(cd).toContain('filename="Escala 2025-01-15.pdf"');
		expect(cd).toContain("filename*=UTF-8''Escala%202025-01-15.pdf");
	});

	it('substitui caracteres não-ASCII no fallback mas preserva no filename*', () => {
		const cd = contentDisposition('Escala Polícia Civil.pdf');
		// fallback ASCII: acento vira "_"
		expect(cd).toContain('filename="Escala Pol_cia Civil.pdf"');
		// filename* preserva via percent-encoding
		expect(cd).toContain("filename*=UTF-8''Escala%20Pol%C3%ADcia%20Civil.pdf");
	});

	it('escapa aspas duplas no fallback ASCII', () => {
		const cd = contentDisposition('rel"atorio.pdf');
		expect(cd).toContain('filename="rel\\"atorio.pdf"');
	});
});
