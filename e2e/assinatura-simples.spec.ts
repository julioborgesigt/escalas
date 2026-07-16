import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import {
	seedSession,
	cookieDeSessao,
	headersDeSessaoMutacao,
	seedDesafioAssinatura
} from './session';

/**
 * Assinatura AVANÇADA em tela (assinar-simples) de ponta a ponta, contra o
 * servidor real: validação de evidências (2FA sempre obrigatório), geração do
 * PDF (rodapé + folha de auditoria), gravação no R2 local e registro do
 * documento — o coração do fluxo que antes só o roteiro manual do TESTING.md
 * cobria.
 *
 * O 2FA por e-mail é contornável em teste sem furar o fail-closed: o desafio
 * é SEMEADO no D1 local com código conhecido (ver seedDesafioAssinatura em
 * e2e/session.ts), mesma técnica das sessões semeadas.
 *
 * O fluxo por Token A3 (SERPRO) NÃO é coberto aqui: o finalizar valida o CMS
 * criptograficamente contra a cadeia ICP-Brasil, o que exigiria injetar uma
 * CA de teste no trust store — decisão de produto, não de teste.
 */

/** PNG 1×1 válido — o pdf-lib embute a rubrica de verdade no rodapé. */
const RUBRICA_PNG =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const CODIGO_VALIDO = '123456';

/** JPEG 1×1 válido — a câmera real produz JPEG; o manifesto embute a selfie. */
const SELFIE_JPEG =
	'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';

/**
 * Evidências dos reforços opcionais (flags padrão do banco: foto e GPS
 * LIGADOS). O veredito de liveness é calculado no cliente por decisão de
 * produto (auditoria A2 — "Nível 0"); o servidor confere consistência
 * estrutural/temporal, que este payload satisfaz.
 */
function evidenciasReforco() {
	const agora = Date.now();
	return {
		latitude: -3.71839,
		longitude: -38.5434,
		selfieBase64: SELFIE_JPEG,
		livenessChallenge: {
			tipo: 'smile' as const,
			cumprido: true,
			tentativas: 1,
			iniciadoEm: new Date(agora - 2000).toISOString(),
			concluidoEm: new Date(agora).toISOString(),
			duracaoMs: 2000
		}
	};
}

test.describe('Assinatura avançada em tela (assinar-simples)', () => {
	test.describe.configure({ mode: 'serial' });

	test('sem código de e-mail → 400 (2FA é sempre obrigatório)', async ({ request }) => {
		const token = seedSession(FIXTURE.policialA.id);
		if (!token) test.skip(true, 'wrangler/D1 local indisponível');

		const res = await request.post(`/api/escalas/${FIXTURE.escalaAssinavel.id}/assinar-simples`, {
			headers: headersDeSessaoMutacao(token!),
			data: { rubrica: RUBRICA_PNG }
		});
		expect(res.status()).toBe(400);
		expect((await res.json()).error).toMatch(/código de verificação por e-mail é obrigatório/i);
	});

	test('código errado → 400 e nada é assinado', async ({ request }) => {
		const token = seedSession(FIXTURE.policialA.id);
		const desafioId = seedDesafioAssinatura(FIXTURE.policialA.id, CODIGO_VALIDO);
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
		const token = seedSession(FIXTURE.policialA.id);
		// Desafio criado para o policial B, mas quem assina é o A.
		const desafioId = seedDesafioAssinatura(FIXTURE.policialB.id, CODIGO_VALIDO);
		if (!token || !desafioId) test.skip(true, 'wrangler/D1 local indisponível');

		const res = await request.post(`/api/escalas/${FIXTURE.escalaAssinavel.id}/assinar-simples`, {
			headers: headersDeSessaoMutacao(token!),
			data: { rubrica: RUBRICA_PNG, codigoValidação: CODIGO_VALIDO, desafioId }
		});
		expect(res.status()).toBe(403);
		expect((await res.json()).error).toMatch(/não pertence ao usuário/i);
	});

	test('escala vazia não pode ser assinada', async ({ request }) => {
		const token = seedSession(FIXTURE.policialA.id);
		if (!token) test.skip(true, 'wrangler/D1 local indisponível');

		// escalaA do fixture não tem NENHUM policial escalado.
		const res = await request.post(`/api/escalas/${FIXTURE.escalaA.id}/assinar-simples`, {
			headers: headersDeSessaoMutacao(token!),
			data: { rubrica: RUBRICA_PNG }
		});
		expect(res.status()).toBe(400);
		expect((await res.json()).error).toMatch(/vazia/i);
	});

	test('caminho feliz: assina com código válido e o PDF assinado fica disponível', async ({
		request
	}) => {
		const token = seedSession(FIXTURE.policialA.id);
		const desafioId = seedDesafioAssinatura(FIXTURE.policialA.id, CODIGO_VALIDO);
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

		// O documento gerado (rodapé + folha de auditoria) está no R2 local e
		// é servido pelo GET — assinatura completa de ponta a ponta.
		const doc = await request.get(`/api/escalas/${FIXTURE.escalaAssinavel.id}/documento-assinado`, {
			headers: cookieDeSessao(token!)
		});
		expect(doc.status()).toBe(200);
		const corpo = await doc.body();
		expect(corpo.subarray(0, 5).toString('latin1')).toBe('%PDF-');

		// O mesmo código continua válido dentro da janela (assinatura em lote):
		// re-assinar com o MESMO desafio deve funcionar (markUsed: false).
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
		expect(reassina.status()).toBe(200);
	});
});
