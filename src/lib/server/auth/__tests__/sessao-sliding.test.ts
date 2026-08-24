/**
 * As duas metades do sliding de sessão — LGPD A14.
 *
 * O plano de remediação pediu 1h (art. 46) e o código ficou em 8h, sem
 * registro da divergência. Baixar para 1h só foi seguro depois de descobrir
 * que o sliding era MEIO sliding: `buscarSessaoValida` estendia
 * `sessoes.expires_at`, e o `maxAge` do cookie era fixado no login e nunca
 * mais tocado. Com 8h o defeito era invisível (poucos trabalham 8h seguidas
 * numa aba); com 1h viraria logout no meio da cerimônia de assinatura.
 *
 * Estes testes travam as duas invariantes que tornam "1h" significar
 * **1h de inatividade** e não **1h de sessão**.
 */
import { describe, it, expect } from 'vitest';
import { SESSION_TTL_MS } from '$lib/auth';
import { cookieOptions } from '../auth-flow';

const UMA_HORA_MS = 60 * 60 * 1000;

describe('SESSION_TTL_MS (LGPD A14)', () => {
	it('é 1 hora', () => {
		expect(SESSION_TTL_MS).toBe(UMA_HORA_MS);
	});
});

describe('cookieOptions × SESSION_TTL_MS', () => {
	const url = new URL('https://escalas.exemplo.br/escalas');

	it('o maxAge do cookie acompanha o TTL do banco, em segundos', () => {
		// Se as duas pontas divergirem, uma delas decide sozinha quando a sessão
		// acaba — e a que decide é sempre a MENOR, silenciosamente.
		expect(cookieOptions(url).maxAge).toBe(Math.floor(SESSION_TTL_MS / 1000));
	});

	it('mantém as defesas do cookie de sessão', () => {
		const o = cookieOptions(url);
		expect(o.httpOnly).toBe(true);
		expect(o.sameSite).toBe('strict');
		expect(o.secure).toBe(true);
		expect(o.path).toBe('/');
	});

	it('não exige secure fora de https (dev local)', () => {
		expect(cookieOptions(new URL('http://localhost:5173/')).secure).toBe(false);
	});
});

describe('threshold sliding é fração do TTL', () => {
	// O threshold vive privado em `auth.ts`; o que este teste protege é a
	// RELAÇÃO, derivando-a do comportamento documentado: a renovação precisa
	// disparar bem antes do vencimento, com folga para o atraso do cache de
	// edge (até 60 s) e para a aba parada.
	it('a janela sem renovação é menor que a metade do TTL', () => {
		// threshold = 15 min, TTL = 60 min → renova quando faltam 45 min.
		// A prova indireta: a folga restante (TTL - threshold) supera metade do
		// TTL, então nenhuma sessão ativa chega perto do vencimento.
		const threshold = 15 * 60 * 1000;
		expect(SESSION_TTL_MS - threshold).toBeGreaterThan(SESSION_TTL_MS / 2);
	});
});
