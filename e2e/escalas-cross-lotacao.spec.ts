import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { seedSession, cookieDeSessao, execD1Local } from './session';

/**
 * Regressão da P0.1 da auditoria: o GET de
 * /api/escalas/[id]/documento-assinado passou a exigir
 * `verificarPermissaoEscala`. Antes, qualquer usuário autenticado conseguia
 * baixar PDF de outra lotação trocando o [id] na URL — vazamento direto de
 * PII e quebra LGPD.
 *
 * O global-setup semeia 2 unidades (DEL-A, DEL-B), 2 policiais (um em
 * cada) e 1 escala+documento em DEL-A. Autenticação é por SESSÃO SEMEADA
 * (e2e/session.ts): o login por senha dessas contas é bloqueado pelo 2FA
 * fail-closed (sem e-mail cadastrado → 403), comportamento coberto pelo
 * teste de sanidade abaixo.
 *
 * Se o seed do fixture falhar (D1 local indisponível), os testes pulam via
 * `test.skip()` — assim o spec não trava o build em ambientes sem wrangler.
 */

test.describe('Cross-lotação — regressão P0.1', () => {
	test.describe.configure({ mode: 'serial' });

	test('sanidade: login por senha é fail-closed sem e-mail; sessão semeada autentica', async ({
		request
	}) => {
		// 2FA fail-closed: conta fixture (email=NULL) não recebe sessão por senha.
		// Limpa o rate-limit antes: o auth.spec (que roda antes na suíte) estoura
		// o limite de tentativas do IP compartilhado e mudaria o 403 para 429.
		execD1Local('DELETE FROM login_attempts;');
		const login = await request.post('/api/auth/login', {
			// `Origin` explícito: o `APIRequestContext` do Playwright não manda um, e
			// desde o SEC-14 o login recusa POST sem Origin no hook, ANTES de chegar
			// ao 2FA. Sem este header o teste continuaria verde medindo a coisa
			// errada — 403 de CSRF em vez de 403 de fail-closed.
			headers: { origin: 'http://localhost:4173' },
			data: { matricula: FIXTURE.policialB.matricula, senha: FIXTURE.password, tipo: 'policial' }
		});
		expect(login.status()).toBe(403);
		expect((await login.json()).errorType).not.toBe('csrf');

		// Sessão semeada no D1 local funciona (fundação de todos os specs
		// autenticados): endpoint autenticado responde 401 sem cookie e 200 com.
		const semSessao = await request.get('/api/policiais/search?q=fixture');
		expect(semSessao.status()).toBe(401);

		const token = seedSession(FIXTURE.policialB.id);
		if (!token) test.skip(true, 'wrangler/D1 local indisponível — checar global-setup');
		const res = await request.get('/api/policiais/search?q=fixture', {
			headers: cookieDeSessao(token!)
		});
		expect(res.status()).toBe(200);
	});

	test('policial de DEL-B NÃO consegue baixar documento de DEL-A', async ({ request }) => {
		const token = seedSession(FIXTURE.policialB.id);
		if (!token) test.skip(true, 'wrangler/D1 local indisponível');

		const res = await request.get(`/api/escalas/${FIXTURE.escalaA.id}/documento-assinado`, {
			headers: cookieDeSessao(token!)
		});
		expect(res.status()).toBe(403);

		const body = await res.json();
		expect(body).toMatchObject({
			status: 403,
			errorType: 'forbidden'
		});
		expect(body.error).toMatch(/permiss/i);
	});

	test('policial da MESMA lotação (DEL-A) consegue baixar', async ({ request }) => {
		const token = seedSession(FIXTURE.policialA.id);
		if (!token) test.skip(true, 'wrangler/D1 local indisponível');

		const res = await request.get(`/api/escalas/${FIXTURE.escalaA.id}/documento-assinado`, {
			headers: cookieDeSessao(token!)
		});
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
