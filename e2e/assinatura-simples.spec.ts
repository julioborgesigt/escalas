import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import {
	seedSession,
	cookieDeSessao,
	headersDeSessaoMutacao,
	seedDesafioAssinatura,
	execD1Local
} from './session';
import { RUBRICA_PNG, evidenciasReforco } from './evidencias';

/**
 * Assinatura AVANÇADA em tela (assinar-simples) de ponta a ponta, contra o
 * servidor real: validação de evidências (2FA sempre obrigatório), geração do
 * PDF (rodapé + folha de auditoria), gravação no R2 local e registro do
 * documento — o coração do fluxo que antes só o roteiro manual do TESTING.md
 * cobria.
 *
 * FLW-AUT-001: quem assina é Admin Geral ou DPC com papel administrativo
 * (`adminUnidade` no fixture). Policial sem papel na lotação recebe 403.
 *
 * FLW-AUT-004: reassinar exige revogar antes (409 se documento já existe).
 */

const CODIGO_VALIDO = '123456';
/** Ator autorizado a assinar a escala da unidade A (DPC + admin_unidade). */
const assinante = () => FIXTURE.adminUnidade;

test.describe('Assinatura avançada em tela (assinar-simples)', () => {
	test.describe.configure({ mode: 'serial' });

	test.beforeAll(() => {
		// Garante escala limpa (sem documento) antes da suíte serial.
		execD1Local(`DELETE FROM escala_documentos WHERE escala_id=${FIXTURE.escalaAssinavel.id};`);
	});

	test('policial sem papel na lotação → 403 (FLW-AUT-001)', async ({ request }) => {
		const token = seedSession(FIXTURE.policialA.id);
		if (!token) test.skip(true, 'wrangler/D1 local indisponível');

		const res = await request.post(`/api/escalas/${FIXTURE.escalaAssinavel.id}/assinar-simples`, {
			headers: headersDeSessaoMutacao(token!),
			data: { rubrica: RUBRICA_PNG }
		});
		expect(res.status()).toBe(403);
	});

	test('sem código de e-mail → 400 (2FA é sempre obrigatório)', async ({ request }) => {
		const token = seedSession(assinante().id);
		if (!token) test.skip(true, 'wrangler/D1 local indisponível');

		const res = await request.post(`/api/escalas/${FIXTURE.escalaAssinavel.id}/assinar-simples`, {
			headers: headersDeSessaoMutacao(token!),
			data: { rubrica: RUBRICA_PNG }
		});
		expect(res.status()).toBe(400);
		expect((await res.json()).error).toMatch(/código de verificação por e-mail é obrigatório/i);
	});

	test('código errado → 400 e nada é assinado', async ({ request }) => {
		const token = seedSession(assinante().id);
		const desafioId = seedDesafioAssinatura(assinante().id, CODIGO_VALIDO);
		if (!token || !desafioId) test.skip(true, 'wrangler/D1 local indisponível');

		const res = await request.post(`/api/escalas/${FIXTURE.escalaAssinavel.id}/assinar-simples`, {
			headers: headersDeSessaoMutacao(token!),
			data: { rubrica: RUBRICA_PNG, codigoValidação: '999999', desafioId }
		});
		expect(res.status()).toBe(400);
		expect((await res.json()).error).toMatch(/código de verificação inválido/i);

		const doc = await request.get(`/api/escalas/${FIXTURE.escalaAssinavel.id}/documento-assinado`, {
			headers: cookieDeSessao(token!)
		});
		expect(doc.status()).toBe(404);
	});

	test('código de OUTRO usuário → 403 (desafio amarrado ao signatário)', async ({ request }) => {
		const token = seedSession(assinante().id);
		const desafioId = seedDesafioAssinatura(FIXTURE.policialB.id, CODIGO_VALIDO);
		if (!token || !desafioId) test.skip(true, 'wrangler/D1 local indisponível');

		const res = await request.post(`/api/escalas/${FIXTURE.escalaAssinavel.id}/assinar-simples`, {
			headers: headersDeSessaoMutacao(token!),
			data: { rubrica: RUBRICA_PNG, codigoValidação: CODIGO_VALIDO, desafioId }
		});
		expect(res.status()).toBe(403);
		expect((await res.json()).error).toMatch(/não pertence ao usuário/i);
	});

	test('escala já assinada → 409 (FLW-AUT-004) mesmo sem membros', async ({ request }) => {
		const token = seedSession(assinante().id);
		if (!token) test.skip(true, 'wrangler/D1 local indisponível');

		// escalaA do fixture tem documento e zero policiais escalados — o conflict
		// de documento tem de vir antes do "vazia".
		const res = await request.post(`/api/escalas/${FIXTURE.escalaA.id}/assinar-simples`, {
			headers: headersDeSessaoMutacao(token!),
			data: { rubrica: RUBRICA_PNG }
		});
		expect(res.status()).toBe(409);
		expect((await res.json()).error).toMatch(/revogue/i);
	});

	test('caminho feliz: assina com código válido e o PDF assinado fica disponível', async ({
		request
	}) => {
		const token = seedSession(assinante().id);
		const desafioId = seedDesafioAssinatura(assinante().id, CODIGO_VALIDO);
		if (!token || !desafioId) test.skip(true, 'wrangler/D1 local indisponível');

		const res = await request.post(`/api/escalas/${FIXTURE.escalaAssinavel.id}/assinar-simples`, {
			headers: headersDeSessaoMutacao(token!),
			data: {
				rubrica: RUBRICA_PNG,
				codigoValidação: CODIGO_VALIDO,
				desafioId,
				...evidenciasReforco()
			}
		});
		expect(res.status()).toBe(200);
		expect(await res.json()).toMatchObject({ success: true });

		const doc = await request.get(`/api/escalas/${FIXTURE.escalaAssinavel.id}/documento-assinado`, {
			headers: cookieDeSessao(token!)
		});
		expect(doc.status()).toBe(200);
		const corpo = await doc.body();
		expect(corpo.subarray(0, 5).toString('latin1')).toBe('%PDF-');
	});

	test('reassinar sem revogar → 409 (FLW-AUT-004)', async ({ request }) => {
		const token = seedSession(assinante().id);
		const desafioId = seedDesafioAssinatura(assinante().id, CODIGO_VALIDO);
		if (!token || !desafioId) test.skip(true, 'wrangler/D1 local indisponível');

		const reassina = await request.post(
			`/api/escalas/${FIXTURE.escalaAssinavel.id}/assinar-simples`,
			{
				headers: headersDeSessaoMutacao(token!),
				data: {
					rubrica: RUBRICA_PNG,
					codigoValidação: CODIGO_VALIDO,
					desafioId,
					...evidenciasReforco()
				}
			}
		);
		expect(reassina.status()).toBe(409);
		expect((await reassina.json()).error).toMatch(/revogue/i);
	});
});
