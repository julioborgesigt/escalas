/**
 * Independência de fuso das funções de ARITMÉTICA de data.
 *
 * Por que este arquivo existe separado: `utils.test.ts` já cobria
 * `adicionarDias` — e passava, com o bug presente. Todo o CI e todo o
 * desenvolvimento rodam em UTC ou UTC-3, onde a versão defeituosa (ler a data
 * em horário local e devolvê-la com `toISOString()`) tem as duas pontas se
 * compensando e acerta por acidente. O defeito só aparece em fuso POSITIVO.
 *
 * Ou seja: não faltava teste, faltava a DIMENSÃO fuso. É isso que se fixa aqui.
 *
 * `America/Fortaleza` é o fuso real da corporação (UTC-3, sem horário de
 * verão). Os demais existem só para provar que o resultado não depende do fuso:
 * `Asia/Tokyo` (+9) e `Pacific/Kiritimati` (+14, o extremo do planeta) são os
 * que quebravam a implementação antiga.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	adicionarDias,
	calcularDataSaida,
	diasNoMes,
	diffDiasInclusivo,
	hojeLocalISO,
	hojeBrasilISO,
	intervaloDeDatas,
	dataISOValida
} from '../utils/datas';
import { ultimoDiaDoMes, primeiroDiaDoMes } from '../rotacao';

const FUSOS = [
	'America/Fortaleza', // UTC-3 — produção
	'UTC',
	'Europe/Lisbon', // +0/+1
	'Asia/Tokyo', // +9
	'Pacific/Kiritimati' // +14
];

const tzOriginal = process.env.TZ;
beforeEach(() => {
	process.env.TZ = tzOriginal;
});
afterEach(() => {
	process.env.TZ = tzOriginal;
});

/** Roda `fn` sob cada fuso e exige o MESMO resultado em todos. */
function mesmoResultadoEmTodoFuso<T>(fn: () => T, esperado: T) {
	for (const tz of FUSOS) {
		process.env.TZ = tz;
		expect(fn(), `fuso ${tz}`).toEqual(esperado);
	}
}

describe('adicionarDias — independente de fuso', () => {
	it('soma um dia', () => {
		mesmoResultadoEmTodoFuso(() => adicionarDias('2026-07-28', 1), '2026-07-29');
	});

	it('soma zero devolve a própria data', () => {
		mesmoResultadoEmTodoFuso(() => adicionarDias('2026-07-28', 0), '2026-07-28');
	});

	it('atravessa a virada de mês', () => {
		mesmoResultadoEmTodoFuso(() => adicionarDias('2026-01-30', 3), '2026-02-02');
	});

	it('atravessa a virada de ano', () => {
		mesmoResultadoEmTodoFuso(() => adicionarDias('2026-12-31', 1), '2027-01-01');
	});

	it('aceita negativo', () => {
		mesmoResultadoEmTodoFuso(() => adicionarDias('2026-03-01', -1), '2026-02-28');
	});

	it('respeita ano bissexto', () => {
		mesmoResultadoEmTodoFuso(() => adicionarDias('2028-02-28', 1), '2028-02-29');
	});
});

describe('ultimoDiaDoMes / primeiroDiaDoMes — independentes de fuso', () => {
	it('julho termina em 31', () => {
		mesmoResultadoEmTodoFuso(() => ultimoDiaDoMes(2026, 7), '2026-07-31');
	});

	it('fevereiro comum termina em 28', () => {
		mesmoResultadoEmTodoFuso(() => ultimoDiaDoMes(2026, 2), '2026-02-28');
	});

	it('fevereiro bissexto termina em 29', () => {
		mesmoResultadoEmTodoFuso(() => ultimoDiaDoMes(2028, 2), '2028-02-29');
	});

	it('dezembro termina em 31', () => {
		mesmoResultadoEmTodoFuso(() => ultimoDiaDoMes(2026, 12), '2026-12-31');
	});

	it('o primeiro dia é sempre 01', () => {
		mesmoResultadoEmTodoFuso(() => primeiroDiaDoMes(2026, 7), '2026-07-01');
	});
});

describe('diasNoMes — independente de fuso', () => {
	// Já era correta (constrói e lê a data no MESMO fuso, então o offset
	// cancela). Fixada aqui para que continue assim.
	it('conta os dias de cada mês de 2026', () => {
		const esperado = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
		mesmoResultadoEmTodoFuso(
			() => Array.from({ length: 12 }, (_, i) => diasNoMes(2026, i + 1)),
			esperado
		);
	});
});

describe('diffDiasInclusivo — independente de fuso', () => {
	// Também já era correta, e por não usar `toISOString()`.
	it('conta o intervalo de forma inclusiva', () => {
		mesmoResultadoEmTodoFuso(() => diffDiasInclusivo('2026-01-01', '2026-01-10'), 10);
	});

	it('mesma data conta 1', () => {
		mesmoResultadoEmTodoFuso(() => diffDiasInclusivo('2026-07-28', '2026-07-28'), 1);
	});
});

describe('intervaloDeDatas — independente de fuso', () => {
	it('enumera a semana inteira, inclusive as pontas', () => {
		mesmoResultadoEmTodoFuso(
			() => intervaloDeDatas('2026-07-27', '2026-08-02'),
			[
				'2026-07-27',
				'2026-07-28',
				'2026-07-29',
				'2026-07-30',
				'2026-07-31',
				'2026-08-01',
				'2026-08-02'
			]
		);
	});

	it('um único dia devolve um item', () => {
		mesmoResultadoEmTodoFuso(() => intervaloDeDatas('2026-07-28', '2026-07-28'), ['2026-07-28']);
	});

	it('o mês de julho tem 31 dias', () => {
		mesmoResultadoEmTodoFuso(() => intervaloDeDatas('2026-07-01', '2026-07-31').length, 31);
	});

	it('fim antes do início devolve vazio, sem laço infinito', () => {
		mesmoResultadoEmTodoFuso(() => intervaloDeDatas('2026-07-28', '2026-07-01'), []);
	});

	it('data inválida devolve vazio', () => {
		mesmoResultadoEmTodoFuso(() => intervaloDeDatas('28/07/2026', '2026-07-31'), []);
	});
});

describe('hojeLocalISO — segue o fuso do aparelho, não o UTC', () => {
	// O ponto desta função é justamente NÃO ser independente de fuso: ela deve
	// devolver o dia do relógio do usuário. O que se fixa aqui é que ela nunca
	// devolve o dia de UTC quando os dois divergem.
	it('devolve a data local, e não a de UTC, no fim da noite em Brasília', () => {
		process.env.TZ = 'America/Fortaleza';
		// 28/07 21:30 em Brasília já é 29/07 00:30 em UTC — a janela exata em que
		// a versão antiga marcava amanhã como hoje.
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-29T00:30:00Z'));
		try {
			expect(new Date().toISOString().slice(0, 10)).toBe('2026-07-29'); // o defeito
			expect(hojeLocalISO()).toBe('2026-07-28'); // o correto
		} finally {
			vi.useRealTimers();
		}
	});

	it('devolve sempre uma data ISO bem formada', () => {
		for (const tz of FUSOS) {
			process.env.TZ = tz;
			expect(hojeLocalISO(), `fuso ${tz}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		}
	});
});

describe('hojeBrasilISO — data civil de Brasília, independente do TZ do isolate', () => {
	it('ainda é dia 28 em Brasília quando UTC já virou 29', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-29T00:30:00Z'));
		try {
			for (const tz of FUSOS) {
				process.env.TZ = tz;
				expect(hojeBrasilISO(), `fuso ${tz}`).toBe('2026-07-28');
			}
		} finally {
			vi.useRealTimers();
		}
	});

	it('vira o dia à meia-noite de Brasília, não à de UTC', () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date('2026-07-29T02:59:00Z'));
			expect(hojeBrasilISO()).toBe('2026-07-28');
			vi.setSystemTime(new Date('2026-07-29T03:00:00Z'));
			expect(hojeBrasilISO()).toBe('2026-07-29');
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('calcularDataSaida — independente de fuso', () => {
	// Depende de `proximoDia`, que delega para `adicionarDias`.
	it('plantão que vira o dia devolve a data seguinte', () => {
		mesmoResultadoEmTodoFuso(() => calcularDataSaida('2026-07-28', '19:00', '07:00'), '2026-07-29');
	});

	it('expediente que termina no mesmo dia mantém a data', () => {
		mesmoResultadoEmTodoFuso(() => calcularDataSaida('2026-07-28', '08:00', '18:00'), '2026-07-28');
	});

	it('virada de mês no plantão noturno', () => {
		mesmoResultadoEmTodoFuso(() => calcularDataSaida('2026-07-31', '19:00', '07:00'), '2026-08-01');
	});
});

describe('dataISOValida — parâmetro de URL é entrada de fora', () => {
	it('aceita YYYY-MM-DD', () => {
		expect(dataISOValida('2026-08-22')).toBe('2026-08-22');
	});

	it('recusa o que não tem a forma', () => {
		for (const v of ['abc', '2026-8-2', '22/08/2026', '2026-08', '', ' 2026-08-22']) {
			expect(dataISOValida(v), v).toBeNull();
		}
	});

	it('recusa ausente', () => {
		expect(dataISOValida(null)).toBeNull();
		expect(dataISOValida(undefined)).toBeNull();
	});

	it('valida só a FORMA — data impossível passa, e é de propósito', () => {
		// Filtro com data inexistente devolve recorte VAZIO, não erro; é o
		// comportamento certo para janela. Quem precisa de data existente confere
		// com `new Date`.
		expect(dataISOValida('2026-13-45')).toBe('2026-13-45');
	});
});
