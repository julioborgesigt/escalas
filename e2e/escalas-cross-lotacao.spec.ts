import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';

/**
 * Regressão da P0.1 da auditoria: o GET de
 * /api/escalas/[id]/documento-assinado passou a exigir
 * `verificarPermissaoEscala`. Antes, qualquer usuário autenticado conseguia
 * baixar PDF de outra lotação trocando o [id] na URL — vazamento direto de
 * PII e quebra LGPD.
 *
 * O global-setup semeia 2 unidades (DEL-A, DEL-B), 2 policiais (um em
 * cada) e 1 escala+documento em DEL-A. O teste loga como policial de
 * DEL-B (não-admin) e verifica que o servidor recusa.
 *
 * Se o seed do fixture falhar (D1 local indisponível), os testes pulam via
 * `test.skip()` — assim o spec não trava o build em ambientes sem wrangler.
 */

async function loginAsPolicial(
	request: import('@playwright/test').APIRequestContext,
	matricula: string,
	senha: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
	const res = await request.post('/api/auth/login', {
		data: { matricula, senha, tipo: 'policial' }
	});
	if (res.status() !== 200) {
		return { ok: false, reason: `HTTP ${res.status()}` };
	}
	const body = await res.json();
	if (body.pendente2FA) {
		// Não deveria acontecer pq email=NULL, mas se aconteceu vamos diagnosticar.
		return { ok: false, reason: '2FA inesperado (fixture com email?)' };
	}
	if (!body.success) {
		return { ok: false, reason: 'login não retornou success=true' };
	}
	return { ok: true };
}

test.describe('Cross-lotação — regressão P0.1', () => {
	test.describe.configure({ mode: 'serial' });

	test('login do fixture funciona (sanity check do seed)', async ({ request }) => {
		const r = await loginAsPolicial(request, FIXTURE.policialB.matricula, FIXTURE.password);
		if (!r.ok) {
			test.skip(true, `Fixture não disponível: ${r.reason} — checar global-setup`);
		}
		expect(r.ok).toBe(true);
	});

	test('policial de DEL-B NÃO consegue baixar documento de DEL-A', async ({ request }) => {
		const login = await loginAsPolicial(request, FIXTURE.policialB.matricula, FIXTURE.password);
		if (!login.ok) {
			test.skip(true, `Fixture não disponível: ${login.reason}`);
		}

		const res = await request.get(`/api/escalas/${FIXTURE.escalaA.id}/documento-assinado`);
		expect(res.status()).toBe(403);

		const body = await res.json();
		expect(body).toMatchObject({
			status: 403,
			errorType: 'forbidden'
		});
		expect(body.error).toMatch(/permiss/i);
	});

	test('policial da MESMA lotação (DEL-A) consegue baixar', async ({ request }) => {
		const login = await loginAsPolicial(request, FIXTURE.policialA.matricula, FIXTURE.password);
		if (!login.ok) {
			test.skip(true, `Fixture não disponível: ${login.reason}`);
		}

		const res = await request.get(`/api/escalas/${FIXTURE.escalaA.id}/documento-assinado`);
		// O R2 do fixture não existe, então o handler chega no estágio R2 e
		// devolve 404 ("Arquivo PDF no Storage"). Mas a checagem de permissão
		// passou — que é o ponto deste teste. Aceita 200 (R2 hit) OU 404 (R2
		// miss); REJEITA 401/403 (falha de permissão é regressão).
		expect([200, 404]).toContain(res.status());
		if (res.status() === 404) {
			const body = await res.json();
			expect(body.errorType).toBe('not_found');
			// E confirma que NÃO é "Escala não encontrada" (gate de permissão
			// passou antes desse erro). A rota devolve "Arquivo PDF..." só DEPOIS
			// de verificarPermissaoEscala retornar permitido.
			expect(body.error).toMatch(/PDF|Storage/i);
		}
	});
});
