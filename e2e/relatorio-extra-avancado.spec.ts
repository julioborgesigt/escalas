import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import {
	seedSession,
	headersDeSessaoMutacao,
	seedDesafioAssinatura,
	seedReauthAssinatura,
	execD1Local
} from './session';
import { RUBRICA_PNG, evidenciasReforco } from './evidencias';

/**
 * Assinatura AVANÇADA em tela do Relatório Extraordinário (endpoint `assinar`,
 * distinto do qualificado por token). Fluxo mobile do supervisor: rubrica +
 * 2FA + selfie/GPS (flags padrão LIGADAS) → PDF com manifesto + selo
 * institucional (best-effort; sem SELO_INSTITUCIONAL_PEM cai no rodapé honesto)
 * → R2 + registro. Antes só no roteiro manual.
 *
 * O 2FA é semeado no D1 (seedDesafioAssinatura). A montagem do manifesto (todas
 * as rubricas + supervisor) é coberta no unitário manifesto-signers.test.ts;
 * aqui garantimos que o ENDPOINT valida evidências e persiste.
 */

const GISE = FIXTURE.gise.id;
const SECCIONAL = FIXTURE.seccional.id;
const CODIGO = '515151';
const assinarUrl = `/api/gise/${GISE}/relatorios/${SECCIONAL}/assinar`;

let tokenSupervisor: string | null = null;
let tokenMembro: string | null = null;

function seedPresencaMembro(comSaida: boolean): boolean {
	const cols = comSaida ? `, saida_timestamp, saida_rubrica` : '';
	const vals = comSaida ? `, '2026-06-01T16:00:00.000Z', '${RUBRICA_PNG}'` : '';
	return execD1Local(
		`DELETE FROM gise_presencas WHERE gise_id = ${GISE}; ` +
			`INSERT INTO gise_presencas (gise_id, policial_id, entrada_timestamp, entrada_rubrica${cols}) ` +
			`VALUES (${GISE}, ${FIXTURE.membroGise.id}, '2026-06-01T08:00:00.000Z', '${RUBRICA_PNG}'${vals});`
	);
}

test.beforeAll(() => {
	tokenSupervisor = seedSession(FIXTURE.supervisor.id);
	tokenMembro = seedSession(FIXTURE.membroGise.id);
	seedPresencaMembro(false); // entrada apenas (saída incompleta)
});

test.afterAll(() => {
	if (tokenSupervisor) execD1Local(`DELETE FROM gise_presencas WHERE gise_id = ${GISE};`);
});

test.describe('Relatório extraordinário GISE — assinatura avançada em tela', () => {
	test.describe.configure({ mode: 'serial' });
	test.skip(() => !tokenSupervisor || !tokenMembro, 'D1 local indisponível');

	test('membro comum (não supervisor/admin) → 403', async ({ request }) => {
		const res = await request.post(assinarUrl, {
			headers: headersDeSessaoMutacao(tokenMembro!),
			data: { rubrica: RUBRICA_PNG, type: 'simples' }
		});
		expect(res.status()).toBe(403);
		expect((await res.json()).error).toMatch(/supervisor designado|administradores/i);
	});

	test('saída incompleta → 400 (antes de validar evidências)', async ({ request }) => {
		const res = await request.post(assinarUrl, {
			headers: headersDeSessaoMutacao(tokenSupervisor!),
			data: { rubrica: RUBRICA_PNG, type: 'simples' }
		});
		expect(res.status()).toBe(400);
		expect((await res.json()).error).toMatch(/confirmar a saída/i);
	});

	test('saída completa mas sem código 2FA → 400 (2FA sempre obrigatório)', async ({ request }) => {
		expect(seedPresencaMembro(true)).toBe(true);
		const reauthId = seedReauthAssinatura(FIXTURE.supervisor.id, tokenSupervisor!);
		test.skip(!reauthId, 'D1 local indisponível');
		const res = await request.post(assinarUrl, {
			headers: headersDeSessaoMutacao(tokenSupervisor!),
			data: { rubrica: RUBRICA_PNG, type: 'simples', reauthId, ...evidenciasReforco() }
		});
		expect(res.status()).toBe(400);
		expect((await res.json()).error).toMatch(/código de verificação por e-mail/i);
	});

	test('supervisor assina em tela (rubrica + 2FA + reforço) → 200', async ({ request }) => {
		const desafioId = seedDesafioAssinatura(FIXTURE.supervisor.id, CODIGO);
		const reauthId = seedReauthAssinatura(FIXTURE.supervisor.id, tokenSupervisor!);
		test.skip(!desafioId || !reauthId, 'D1 local indisponível');

		const res = await request.post(assinarUrl, {
			headers: headersDeSessaoMutacao(tokenSupervisor!),
			data: {
				rubrica: RUBRICA_PNG,
				type: 'simples',
				signerName: FIXTURE.supervisor.nome,
				signerCpf: FIXTURE.supervisor.cpf,
				codigoValidação: CODIGO,
				desafioId,
				reauthId,
				...evidenciasReforco()
			}
		});
		expect(res.status(), await res.text().catch(() => '')).toBe(200);
		expect(await res.json()).toMatchObject({ success: true });
	});
});
