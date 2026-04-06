import { describe, it, expect } from 'vitest';

// ===========================================================================
// apiError — testado via importação direta (módulo puro, sem dependência SvelteKit runtime)
// ===========================================================================

describe('apiError', () => {
	it('retorna Response com status e corpo de erro', async () => {
		const { apiError } = await import('$lib/server/api-error');
		const response = apiError('Não autorizado', 401);
		expect(response.status).toBe(401);
		const body = await response.json();
		expect(body).toEqual({ error: 'Não autorizado', status: 401 });
	});

	it('usa 500 como padrão quando status não é informado', async () => {
		const { apiError } = await import('$lib/server/api-error');
		const response = apiError('Erro interno');
		expect(response.status).toBe(500);
		const body = await response.json();
		expect(body.status).toBe(500);
	});

	it('inclui errorType quando fornecido', async () => {
		const { apiError } = await import('$lib/server/api-error');
		const response = apiError('Campo obrigatório', 400, 'validation');
		const body = await response.json();
		expect(body).toEqual({ error: 'Campo obrigatório', status: 400, errorType: 'validation' });
	});

	it('não inclui errorType quando não é fornecido', async () => {
		const { apiError } = await import('$lib/server/api-error');
		const response = apiError('Erro genérico');
		const body = await response.json();
		expect(body).not.toHaveProperty('errorType');
	});

	it('suporta string vazia como mensagem', async () => {
		const { apiError } = await import('$lib/server/api-error');
		const response = apiError('', 400);
		const body = await response.json();
		expect(body.error).toBe('');
	});
});

// ===========================================================================
// buildCSP — função duplicada para teste isolado (evita import de hooks.server)
// ===========================================================================

function buildCSP(isHTML: boolean): string {
	if (!isHTML) {
		return "default-src 'none'; base-uri 'none'; form-action 'none'";
	}
	const isDev = process.env.NODE_ENV !== 'production';
	const scriptExtra = isDev ? " 'unsafe-eval'" : '';
	const connectExtra = isDev ? ' http://localhost:*' : '';
	return [
		`default-src 'self'`,
		`script-src 'self' 'unsafe-inline'${scriptExtra}`,
		`style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
		`img-src 'self' data: blob: https://fonts.gstatic.com`,
		`font-src 'self' data: https://fonts.gstatic.com`,
		`connect-src 'self'${connectExtra}`,
		`frame-src 'none'`,
		`object-src 'none'`,
		`base-uri 'self'`,
		`form-action 'self'`,
		`upgrade-insecure-requests`,
		`block-all-mixed-content`
	].join('; ');
}

describe('buildCSP', () => {
	it('CSP para HTML contém script-src com self e unsafe-inline', () => {
		const csp = buildCSP(true);
		expect(csp).toContain("script-src 'self' 'unsafe-inline'");
	});

	it('CSP para HTML contém style-src com Google Fonts', () => {
		const csp = buildCSP(true);
		expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
	});

	it('CSP para HTML contém img-src com data e blob', () => {
		const csp = buildCSP(true);
		expect(csp).toContain("img-src 'self' data: blob:");
	});

	it('CSP para HTML contém font-src com Google Fonts', () => {
		const csp = buildCSP(true);
		expect(csp).toContain("font-src 'self' data: https://fonts.gstatic.com");
	});

	it('CSP para HTML bloqueia frames e objects', () => {
		const csp = buildCSP(true);
		expect(csp).toContain("frame-src 'none'");
		expect(csp).toContain("object-src 'none'");
	});

	it('CSP para HTML restringe base-uri e form-action a self', () => {
		const csp = buildCSP(true);
		expect(csp).toContain("base-uri 'self'");
		expect(csp).toContain("form-action 'self'");
	});

	it('CSP para HTML inclui upgrade-insecure-requests e block-all-mixed-content', () => {
		const csp = buildCSP(true);
		expect(csp).toContain('upgrade-insecure-requests');
		expect(csp).toContain('block-all-mixed-content');
	});

	it('CSP para API bloqueia tudo', () => {
		const csp = buildCSP(false);
		expect(csp).toContain("default-src 'none'");
		expect(csp).toContain("base-uri 'none'");
		expect(csp).toContain("form-action 'none'");
	});

	it('CSP para HTML em modo dev inclui unsafe-eval e localhost', () => {
		const original = process.env.NODE_ENV;
		process.env.NODE_ENV = 'development';
		const csp = buildCSP(true);
		expect(csp).toContain("'unsafe-eval'");
		expect(csp).toContain('http://localhost:*');
		process.env.NODE_ENV = original;
	});

	it('CSP para HTML em produção NÃO inclui unsafe-eval nem localhost', () => {
		const original = process.env.NODE_ENV;
		process.env.NODE_ENV = 'production';
		const csp = buildCSP(true);
		expect(csp).not.toContain("'unsafe-eval'");
		expect(csp).not.toContain('http://localhost');
		process.env.NODE_ENV = original;
	});

	it('CSP é uma única string separada por "; "', () => {
		const csp = buildCSP(true);
		expect(csp).toMatch(/^[\w\-]+[\s\S]*; [\w\-]+/);
		expect(csp.split('; ').length).toBeGreaterThan(5);
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
		const jan = ['2025-01-01', '2025-01-05', '2025-01-09', '2025-01-13',
			'2025-01-17', '2025-01-21', '2025-01-25', '2025-01-29'];
		const result = calcularProximoMesDias(jan, 2025, 2);
		expect(result.rotacao).toBe('1x3');
		// Fevereiro: 2, 6, 10, 14, 18, 22, 26
		expect(result.dias).toEqual([
			'2025-02-02', '2025-02-06', '2025-02-10', '2025-02-14',
			'2025-02-18', '2025-02-22', '2025-02-26'
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
		const jan = ['2025-01-01', '2025-01-02', '2025-01-09', '2025-01-10',
			'2025-01-17', '2025-01-18', '2025-01-25', '2025-01-26'];
		const result = calcularProximoMesDias(jan, 2025, 2);
		expect(result.rotacao).toBe('2x6');
		// Fevereiro: pares 2-3, 10-11, 18-19, 26-27
		expect(result.dias).toEqual([
			'2025-02-02', '2025-02-03',
			'2025-02-10', '2025-02-11',
			'2025-02-18', '2025-02-19',
			'2025-02-26', '2025-02-27'
		]);
	});
});
