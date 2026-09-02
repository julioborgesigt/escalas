import { describe, it, expect } from 'vitest';
import {
	sugerirCusteio,
	DISTANCIA_MINIMA_DIARIA_KM,
	DURACAO_MINIMA_DIARIA_HORAS,
	MEIAS_MINIMAS_PLANO
} from '../custeio';
import type { HorasClassificadas } from '../horas-extras';
import type { Parecer } from '$lib/diarias/parecer';

/** A operação típica: 04h às 08h num dia útil — 4 horas, 2 delas plus. */
const OPERACAO_4H: HorasClassificadas = { normais: 2, plus: 2, semCusto: 0 };
/** Uma janela curta, dentro do limite de distância mas de só 2 horas. */
const OPERACAO_2H: HorasClassificadas = { normais: 0, plus: 2, semCusto: 0 };
/** Nenhuma hora aferida: é o que `classificarJanela` devolve sem `hora_fim`. */
const SEM_JANELA: HorasClassificadas = { normais: 0, plus: 0, semCusto: 0 };
/** Janela longa inteiramente dentro do expediente. */
const EXPEDIENTE: HorasClassificadas = { normais: 0, plus: 0, semCusto: 9 };

const FAVORAVEL: Parecer = {
	resultado: 'favoravel',
	meias: 1,
	extrapolacao: 'horario_declarado',
	alertas: [],
	fundamentos: [{ texto: 'Saída de madrugada.', dispositivo: 'Decreto nº 35.922/2024' }]
};
const DESFAVORAVEL: Parecer = { ...FAVORAVEL, resultado: 'desfavoravel', meias: 0 };

describe('sugerirCusteio — a diária vem primeiro', () => {
	it('distância no limite, 4h de operação e parecer favorável dão diária', () => {
		const r = sugerirCusteio({
			distanciaKm: DISTANCIA_MINIMA_DIARIA_KM,
			horas: OPERACAO_4H,
			parecer: FAVORAVEL
		});
		expect(r.tipo_custo).toBe('diaria');
		expect(r.motivo).toBe('distancia');
	});

	it('a diária ZERA as horas — as duas verbas não se somam', () => {
		const r = sugerirCusteio({ distanciaKm: 250, horas: OPERACAO_4H, parecer: FAVORAVEL });
		expect(r.horas).toEqual({ normais: 0, plus: 0, semCusto: 0 });
	});

	it('um quilômetro abaixo do limite já é hora extra', () => {
		const r = sugerirCusteio({
			distanciaKm: DISTANCIA_MINIMA_DIARIA_KM - 1,
			horas: OPERACAO_4H,
			parecer: FAVORAVEL
		});
		expect(r.tipo_custo).toBe('hora_extra');
		expect(r.motivo).toBe('horario');
	});
});

describe('sugerirCusteio — o piso de 1,5 diária', () => {
	it('o parecer de meia diária vira 1,5 no plano operacional', () => {
		const r = sugerirCusteio({ distanciaKm: 150, horas: OPERACAO_4H, parecer: FAVORAVEL });
		expect(r.meias).toBe(MEIAS_MINIMAS_PLANO);
	});

	it('missão mais longa recebe o que a contagem der, não o piso', () => {
		const longa: Parecer = { ...FAVORAVEL, meias: 13 }; // 6,5 diárias
		const r = sugerirCusteio({ distanciaKm: 150, horas: OPERACAO_4H, parecer: longa });
		expect(r.meias).toBe(13);
	});

	it('quem não recebe diária não recebe meias', () => {
		const r = sugerirCusteio({ distanciaKm: 40, horas: OPERACAO_4H, parecer: FAVORAVEL });
		expect(r.meias).toBe(0);
	});
});

describe('sugerirCusteio — o portão de duração', () => {
	it('operação de menos de 4h não vira diária, mesmo longe', () => {
		const r = sugerirCusteio({ distanciaKm: 300, horas: OPERACAO_2H, parecer: FAVORAVEL });
		expect(r.tipo_custo).toBe('hora_extra');
		expect(r.motivo).toBe('duracao_curta');
	});

	it('a fronteira é exata: 4h passa, 3h não', () => {
		const tresHoras: HorasClassificadas = { normais: 1, plus: 2, semCusto: 0 };
		const quatroHoras: HorasClassificadas = { normais: 2, plus: 2, semCusto: 0 };
		expect(
			sugerirCusteio({ distanciaKm: 150, horas: tresHoras, parecer: FAVORAVEL }).tipo_custo
		).toBe('hora_extra');
		expect(
			sugerirCusteio({ distanciaKm: 150, horas: quatroHoras, parecer: FAVORAVEL }).tipo_custo
		).toBe('diaria');
		expect(DURACAO_MINIMA_DIARIA_HORAS).toBe(4);
	});

	it('horas SEM CUSTO também contam a duração — é a jornada, não a despesa', () => {
		// Nove horas de expediente: longa o bastante, mas o relógio não gera custo.
		const r = sugerirCusteio({ distanciaKm: 150, horas: EXPEDIENTE, parecer: FAVORAVEL });
		expect(r.tipo_custo).toBe('diaria');
	});

	it('sem janela fechada o motivo é sem_janela, não duracao_curta', () => {
		// Distinção que a tela usa: "ninguém fechou o horário" é diferente de
		// "a operação é curta demais".
		const r = sugerirCusteio({ distanciaKm: 300, horas: SEM_JANELA, parecer: FAVORAVEL });
		expect(r.motivo).toBe('sem_janela');
		expect(r.tipo_custo).toBe('sem_custo');
	});
});

describe('sugerirCusteio — o parecer manda', () => {
	it('parecer desfavorável recusa a diária mesmo com distância e duração', () => {
		const r = sugerirCusteio({ distanciaKm: 300, horas: OPERACAO_4H, parecer: DESFAVORAVEL });
		expect(r.tipo_custo).toBe('hora_extra');
		expect(r.motivo).toBe('parecer');
	});

	it('sem parecer não se concede — não se defere o que não foi analisado', () => {
		const r = sugerirCusteio({ distanciaKm: 300, horas: OPERACAO_4H });
		expect(r.tipo_custo).toBe('hora_extra');
		expect(r.motivo).toBe('parecer');
	});
});

describe('sugerirCusteio — o limite é da versão de valores', () => {
	it('subir o limite para 120 tira a diária da equipe de 110 km', () => {
		const base = { distanciaKm: 110, horas: OPERACAO_4H, parecer: FAVORAVEL };
		expect(sugerirCusteio({ ...base, limiteKm: 100 }).tipo_custo).toBe('diaria');
		expect(sugerirCusteio({ ...base, limiteKm: 120 }).tipo_custo).toBe('hora_extra');
	});

	it('sem limite informado vale o padrão do módulo', () => {
		const r = sugerirCusteio({
			distanciaKm: DISTANCIA_MINIMA_DIARIA_KM,
			horas: OPERACAO_4H,
			parecer: FAVORAVEL
		});
		expect(r.tipo_custo).toBe('diaria');
	});
});

describe('sugerirCusteio — distância ausente não é distância zero', () => {
	it('sem medida, decide o relógio e o motivo denuncia a falta', () => {
		const r = sugerirCusteio({ distanciaKm: null, horas: OPERACAO_4H, parecer: FAVORAVEL });
		expect(r.tipo_custo).toBe('hora_extra');
		expect(r.motivo).toBe('sem_distancia');
	});

	it('zero é uma medida: mesma cidade, abaixo do limite', () => {
		const r = sugerirCusteio({ distanciaKm: 0, horas: OPERACAO_4H, parecer: FAVORAVEL });
		expect(r.motivo).toBe('horario');
	});

	it('entrada quebrada cai em sem_distancia, não vira comparação', () => {
		expect(sugerirCusteio({ distanciaKm: -5, horas: OPERACAO_4H }).motivo).toBe('sem_distancia');
		expect(sugerirCusteio({ distanciaKm: Number.NaN, horas: OPERACAO_4H }).motivo).toBe(
			'sem_distancia'
		);
	});

	it('janela dentro do expediente e sem distância é sem custo, não hora extra de zero', () => {
		const r = sugerirCusteio({ distanciaKm: null, horas: EXPEDIENTE });
		expect(r.tipo_custo).toBe('sem_custo');
	});
});
