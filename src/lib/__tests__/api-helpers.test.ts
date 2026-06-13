import { describe, it, expect } from 'vitest';
import { buildCSP } from '../server/csp';

// ===========================================================================
// apiError — testado via importação direta (módulo puro, sem dependência SvelteKit runtime)
// ===========================================================================

describe('apiError', () => {
	it('retorna Response com status e corpo de erro', async () => {
		const { apiError } = await import('$lib/server/api');
		const response = apiError('Não autorizado', 401);
		expect(response.status).toBe(401);
		const body = await response.json();
		expect(body).toEqual({ error: 'Não autorizado', status: 401 });
	});

	it('usa 500 como padrão quando status não é informado', async () => {
		const { apiError } = await import('$lib/server/api');
		const response = apiError('Erro interno');
		expect(response.status).toBe(500);
		const body = await response.json();
		expect(body.status).toBe(500);
	});

	it('inclui errorType tipado quando fornecido', async () => {
		const { apiError, ErrorCode } = await import('$lib/server/api');
		const response = apiError('Campo obrigatório', 400, ErrorCode.VALIDATION);
		const body = await response.json();
		expect(body).toEqual({ error: 'Campo obrigatório', status: 400, errorType: 'validation' });
	});

	it('inclui errorId quando fornecido', async () => {
		const { apiError, ErrorCode } = await import('$lib/server/api');
		const response = apiError('erro 5xx', 500, ErrorCode.INTERNAL, { errorId: 'abc12345' });
		const body = await response.json();
		expect(body.errorId).toBe('abc12345');
	});

	it('não inclui errorType quando não é fornecido', async () => {
		const { apiError } = await import('$lib/server/api');
		const response = apiError('Erro genérico');
		const body = await response.json();
		expect(body).not.toHaveProperty('errorType');
	});

	it('suporta string vazia como mensagem', async () => {
		const { apiError } = await import('$lib/server/api');
		const response = apiError('', 400);
		const body = await response.json();
		expect(body.error).toBe('');
	});

	it('ErrorCode é congelado e expõe códigos esperados', async () => {
		const { ErrorCode } = await import('$lib/server/api');
		expect(ErrorCode.VALIDATION).toBe('validation');
		expect(ErrorCode.AUTH_REQUIRED).toBe('auth_required');
		expect(ErrorCode.FORBIDDEN).toBe('forbidden');
		expect(ErrorCode.CSRF).toBe('csrf');
		expect(ErrorCode.NOT_FOUND).toBe('not_found');
		expect(ErrorCode.CONFLICT).toBe('conflict');
		expect(ErrorCode.RATE_LIMIT).toBe('rate_limit');
		expect(ErrorCode.UPSTREAM).toBe('upstream');
		expect(ErrorCode.INTERNAL).toBe('internal');
	});
});

describe('helpers de erro (badRequest, unauthorized, ...)', () => {
	it('badRequest default usa ErrorCode.VALIDATION', async () => {
		const { badRequest } = await import('$lib/server/api');
		const body = await badRequest('campo X').json();
		expect(body).toEqual({ error: 'campo X', status: 400, errorType: 'validation' });
	});

	it('unauthorized retorna AUTH_REQUIRED', async () => {
		const { unauthorized } = await import('$lib/server/api');
		const body = await unauthorized().json();
		expect(body).toMatchObject({ status: 401, errorType: 'auth_required' });
	});

	it('forbidden retorna FORBIDDEN', async () => {
		const { forbidden } = await import('$lib/server/api');
		const body = await forbidden().json();
		expect(body).toMatchObject({ status: 403, errorType: 'forbidden' });
	});

	it('notFound retorna NOT_FOUND com recurso interpolado', async () => {
		const { notFound } = await import('$lib/server/api');
		const body = await notFound('Escala').json();
		expect(body).toMatchObject({
			status: 404,
			errorType: 'not_found',
			error: 'Escala não encontrado'
		});
	});

	it('conflict retorna CONFLICT', async () => {
		const { conflict } = await import('$lib/server/api');
		const body = await conflict('já assinado').json();
		expect(body).toMatchObject({ status: 409, errorType: 'conflict' });
	});

	it('rateLimited retorna RATE_LIMIT', async () => {
		const { rateLimited } = await import('$lib/server/api');
		const body = await rateLimited().json();
		expect(body).toMatchObject({ status: 429, errorType: 'rate_limit' });
	});

	it('serverError inclui errorId rastreável', async () => {
		const { serverError } = await import('$lib/server/api');
		const resp = serverError('contexto', new Error('boom'));
		const body = await resp.json();
		expect(resp.status).toBe(500);
		expect(body.errorType).toBe('internal');
		expect(body.errorId).toMatch(/^[0-9a-f]{8}$/);
	});
});

// ===========================================================================
// buildCSP — não-HTML apenas
// CSP para HTML é gerenciada pelo SvelteKit em svelte.config.js (com nonce
// automático para inline scripts da hidratação). Os testes específicos da CSP
// HTML vivem em src/lib/__tests__/security.test.ts.
// ===========================================================================

describe('buildCSP', () => {
	it('para HTML retorna null (delegado ao SvelteKit)', () => {
		expect(buildCSP(true, { isProduction: true })).toBeNull();
		expect(buildCSP(true, { isProduction: false })).toBeNull();
	});

	it("para não-HTML bloqueia tudo (default-src 'none')", () => {
		const csp = buildCSP(false, { isProduction: true });
		expect(csp).toContain("default-src 'none'");
		expect(csp).toContain("base-uri 'none'");
		expect(csp).toContain("form-action 'none'");
	});

	it('para não-HTML é a mesma string em dev e prod', () => {
		expect(buildCSP(false, { isProduction: true })).toBe(buildCSP(false, { isProduction: false }));
	});
});

// ===========================================================================
// Rotação — funções puras de $lib/rotacao (sem dependência SvelteKit)
// ===========================================================================

import {
	detectarRotacao,
	calcularProximoMesDias,
	proximoMes,
	primeiroDiaDoMes,
	ultimoDiaDoMes,
	calcularDataSaida,
	agruparDiasPorPolicial,
	MESES_PT
} from '$lib/rotacao';

describe('MESES_PT', () => {
	it('contém 12 meses em português', () => {
		expect(MESES_PT).toHaveLength(12);
		expect(MESES_PT[0]).toBe('JANEIRO');
		expect(MESES_PT[11]).toBe('DEZEMBRO');
	});
});

describe('detectarRotacao', () => {
	it('detecta 1x3 quando todos os intervalos são 4 dias', () => {
		const dias = ['2025-01-01', '2025-01-05', '2025-01-09', '2025-01-13'];
		expect(detectarRotacao(dias)).toBe('1x3');
	});

	it('detecta 2x6 quando intervalos alternam 1 e 7', () => {
		const dias = ['2025-01-01', '2025-01-02', '2025-01-09', '2025-01-10'];
		expect(detectarRotacao(dias)).toBe('2x6');
	});

	it('detecta 2x6 mesmo começando pela folga (7, 1, 7, 1)', () => {
		const dias = ['2025-01-02', '2025-01-09', '2025-01-10', '2025-01-17'];
		expect(detectarRotacao(dias)).toBe('2x6');
	});

	it('retorna null para array com menos de 2 elementos', () => {
		expect(detectarRotacao(['2025-01-01'])).toBeNull();
		expect(detectarRotacao([])).toBeNull();
	});

	it('retorna null para padrão irregular', () => {
		const dias = ['2025-01-01', '2025-01-03', '2025-01-10'];
		expect(detectarRotacao(dias)).toBeNull();
	});

	it('ignora ordem do array (ordena internamente)', () => {
		const dias = ['2025-01-09', '2025-01-01', '2025-01-13', '2025-01-05'];
		expect(detectarRotacao(dias)).toBe('1x3');
	});
});

describe('proximoMes', () => {
	it('avança mês normalmente', () => {
		expect(proximoMes(2025, 3)).toEqual({ ano: 2025, mes: 4 });
	});

	it('vira o ano em dezembro', () => {
		expect(proximoMes(2025, 12)).toEqual({ ano: 2026, mes: 1 });
	});
});

describe('primeiroDiaDoMes', () => {
	it('retorna dia 01 formatado', () => {
		expect(primeiroDiaDoMes(2025, 6)).toBe('2025-06-01');
	});

	it('preenche zero à esquerda para mês único', () => {
		expect(primeiroDiaDoMes(2025, 1)).toBe('2025-01-01');
	});
});

describe('ultimoDiaDoMes', () => {
	it('retorna último dia de mês com 31 dias', () => {
		expect(ultimoDiaDoMes(2025, 1)).toBe('2025-01-31');
	});

	it('retorna último dia de fevereiro em ano não bissexto', () => {
		expect(ultimoDiaDoMes(2025, 2)).toBe('2025-02-28');
	});

	it('retorna último dia de fevereiro em ano bissexto', () => {
		expect(ultimoDiaDoMes(2024, 2)).toBe('2024-02-29');
	});
});

describe('calcularDataSaida', () => {
	it('mesmo dia quando saída após entrada (turno diurno)', () => {
		expect(calcularDataSaida('2025-03-10', '07:00', '19:00')).toBe('2025-03-10');
	});

	it('dia seguinte quando saída antes ou igual entrada (turno noturno)', () => {
		expect(calcularDataSaida('2025-03-10', '19:00', '07:00')).toBe('2025-03-11');
	});

	it('dia seguinte quando entrada e saída no mesmo horário', () => {
		expect(calcularDataSaida('2025-03-10', '07:00', '07:00')).toBe('2025-03-11');
	});

	it('trata entradas vazias como meia-noite', () => {
		expect(calcularDataSaida('2025-03-10', '', '')).toBe('2025-03-10');
	});
});

describe('calcularProximoMesDias — 1x3', () => {
	it('calcula dias do mês seguinte para rotação 1x3', () => {
		// Janeiro 2025: 1, 5, 9, 13, 17, 21, 25, 29
		const jan = [
			'2025-01-01',
			'2025-01-05',
			'2025-01-09',
			'2025-01-13',
			'2025-01-17',
			'2025-01-21',
			'2025-01-25',
			'2025-01-29'
		];
		const result = calcularProximoMesDias(jan, 2025, 2);
		expect(result.rotacao).toBe('1x3');
		// Fevereiro: 2, 6, 10, 14, 18, 22, 26
		expect(result.dias).toEqual([
			'2025-02-02',
			'2025-02-06',
			'2025-02-10',
			'2025-02-14',
			'2025-02-18',
			'2025-02-22',
			'2025-02-26'
		]);
	});

	it('retorna array vazio quando entrada vazia', () => {
		const result = calcularProximoMesDias([], 2025, 3);
		expect(result.dias).toEqual([]);
		expect(result.rotacao).toBeNull();
	});

	it('retorna vazio quando padrão não é reconhecido', () => {
		const dias = ['2025-01-01', '2025-01-03'];
		const result = calcularProximoMesDias(dias, 2025, 2);
		expect(result.dias).toEqual([]);
		expect(result.rotacao).toBeNull();
	});
});

describe('calcularProximoMesDias — 2x6', () => {
	it('calcula dias do mês seguinte para rotação 2x6', () => {
		// Janeiro 2025: pares 1-2, 9-10, 17-18, 25-26
		const jan = [
			'2025-01-01',
			'2025-01-02',
			'2025-01-09',
			'2025-01-10',
			'2025-01-17',
			'2025-01-18',
			'2025-01-25',
			'2025-01-26'
		];
		const result = calcularProximoMesDias(jan, 2025, 2);
		expect(result.rotacao).toBe('2x6');
		// Fevereiro: pares 2-3, 10-11, 18-19, 26-27
		expect(result.dias).toEqual([
			'2025-02-02',
			'2025-02-03',
			'2025-02-10',
			'2025-02-11',
			'2025-02-18',
			'2025-02-19',
			'2025-02-26',
			'2025-02-27'
		]);
	});
});

describe('agruparDiasPorPolicial', () => {
	it('agrupa os dias de cada policial preservando nome e equipe', () => {
		const map = agruparDiasPorPolicial([
			{ policial_id: 1, nome: 'Ana', equipe: 'A', data_plantao: '2025-01-01' },
			{ policial_id: 2, nome: 'Beto', equipe: 'B', data_plantao: '2025-01-02' },
			{ policial_id: 1, nome: 'Ana', equipe: 'A', data_plantao: '2025-01-05' }
		]);
		expect(map.size).toBe(2);
		expect(map.get(1)).toEqual({ nome: 'Ana', equipe: 'A', dias: ['2025-01-01', '2025-01-05'] });
		expect(map.get(2)).toEqual({ nome: 'Beto', equipe: 'B', dias: ['2025-01-02'] });
	});

	it('preserva a ordem de inserção dos dias', () => {
		const map = agruparDiasPorPolicial([
			{ policial_id: 7, nome: 'X', equipe: 'A', data_plantao: '2025-01-09' },
			{ policial_id: 7, nome: 'X', equipe: 'A', data_plantao: '2025-01-01' }
		]);
		expect(map.get(7)?.dias).toEqual(['2025-01-09', '2025-01-01']);
	});

	it('normaliza equipe null/undefined para string vazia', () => {
		const map = agruparDiasPorPolicial([
			{ policial_id: 1, nome: 'Ana', equipe: null, data_plantao: '2025-01-01' },
			{ policial_id: 2, nome: 'Beto', data_plantao: '2025-01-02' }
		]);
		expect(map.get(1)?.equipe).toBe('');
		expect(map.get(2)?.equipe).toBe('');
	});

	it('retorna mapa vazio para entrada vazia', () => {
		expect(agruparDiasPorPolicial([]).size).toBe(0);
	});
});
