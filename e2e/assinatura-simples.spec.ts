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

	test('política de dispositivo: desktop → 403 mesmo por POST direto', async ({ request }) => {
		const token = seedSession(assinante().id);
		const tokenSuper = seedSession(FIXTURE.superAdmin.id, 'admin');
		if (!token || !tokenSuper) test.skip(true, 'wrangler/D1 local indisponível');

		// A restrição a celular já foi só de interface: escondia o painel e o POST
		// direto de um desktop assinava normalmente. Este teste existe para que
		// ela não volte a ser — a interface não participa daqui.
		const antes = await request.get('/api/configuracoes/assinatura', {
			headers: cookieDeSessao(tokenSuper!)
		});
		const original = ((await antes.json()) as { restringirSmartphone: boolean })
			.restringirSmartphone;

		const ligar = await request.put('/api/configuracoes/assinatura', {
			headers: headersDeSessaoMutacao(tokenSuper!),
			data: { restringirSmartphone: true }
		});
		test.skip(ligar.status() === 403, 'fixture não é Super Admin neste ambiente');
		expect(ligar.status()).toBe(200);

		try {
			const desktop = await request.post(
				`/api/escalas/${FIXTURE.escalaAssinavel.id}/assinar-simples`,
				{
					headers: {
						...headersDeSessaoMutacao(token!),
						'user-agent':
							'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
					},
					data: { rubrica: RUBRICA_PNG }
				}
			);
			expect(desktop.status()).toBe(403);
			// A mensagem importa: 403 sozinho não distingue esta recusa da de
			// permissão (FLW-AUT-001), que roda antes no mesmo endpoint.
			expect((await desktop.json()).error).toMatch(/só pode ser feita pelo celular/i);

			// Com UA de celular a política sai do caminho e a requisição volta a
			// morrer no 2FA — prova que o 403 acima veio do dispositivo, não de
			// permissão nem de corpo inválido.
			const celular = await request.post(
				`/api/escalas/${FIXTURE.escalaAssinavel.id}/assinar-simples`,
				{
					headers: {
						...headersDeSessaoMutacao(token!),
						'user-agent':
							'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
					},
					data: { rubrica: RUBRICA_PNG }
				}
			);
			expect(celular.status()).toBe(400);
			expect((await celular.json()).error).toMatch(/código de verificação por e-mail/i);
		} finally {
			// Restaura o valor original: as demais specs desta suíte rodam com UA de
			// runner, que não é móvel — deixar a flag ligada derrubaria o caminho
			// feliz, e esta suíte é serial.
			await request.put('/api/configuracoes/assinatura', {
				headers: headersDeSessaoMutacao(tokenSuper!),
				data: { restringirSmartphone: original }
			});
		}
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
