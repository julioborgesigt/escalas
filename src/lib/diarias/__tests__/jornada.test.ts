import { describe, it, expect } from 'vitest';
import { extrapolaJornada, houveExtrapolacao } from '../jornada';

/** 2026-09-10 é uma quinta-feira; 2026-09-12 é sábado; 2026-09-13, domingo. */
const QUINTA = '2026-09-10';
const SABADO = '2026-09-12';
const DOMINGO = '2026-09-13';

describe('extrapolaJornada', () => {
	describe('1. presunção do art. 22 — vem antes de tudo', () => {
		it('sábado e domingo extrapolam em qualquer horário', () => {
			expect(extrapolaJornada({ data: SABADO, horaInicio: '09:00', horaFim: '12:00' })).toBe(
				'dia_pago'
			);
			expect(extrapolaJornada({ data: DOMINGO, horaInicio: '09:00', horaFim: '12:00' })).toBe(
				'dia_pago'
			);
		});

		it('feriado declarado extrapola em dia útil', () => {
			expect(
				extrapolaJornada({ data: QUINTA, feriado: true, horaInicio: '09:00', horaFim: '12:00' })
			).toBe('dia_pago');
		});

		it('vence o horário: sábado dentro do expediente ainda é dia pago', () => {
			expect(extrapolaJornada({ data: SABADO, horaInicio: '08:00', horaFim: '17:00' })).toBe(
				'dia_pago'
			);
		});
	});

	describe('2. horário declarado', () => {
		it('saída antes das 6h extrapola — é o caso da operação das 04h', () => {
			expect(extrapolaJornada({ data: QUINTA, horaInicio: '04:00', horaFim: '08:00' })).toBe(
				'horario_declarado'
			);
			expect(extrapolaJornada({ data: QUINTA, horaInicio: '05:59', horaFim: '12:00' })).toBe(
				'horario_declarado'
			);
		});

		it('retorno após as 18h extrapola', () => {
			expect(extrapolaJornada({ data: QUINTA, horaInicio: '08:00', horaFim: '18:01' })).toBe(
				'horario_declarado'
			);
		});

		it('as bordas são estritas: 06:00 e 18:00 em ponto NÃO extrapolam', () => {
			expect(extrapolaJornada({ data: QUINTA, horaInicio: '06:00', horaFim: '18:00' })).toBe('nao');
		});

		it('dentro do expediente não extrapola', () => {
			expect(extrapolaJornada({ data: QUINTA, horaInicio: '08:00', horaFim: '17:00' })).toBe('nao');
		});

		it('horário declarado NÃO é reexaminado pelo cálculo estimado', () => {
			// Três horas de estrada em cada sentido dariam 9h pela estimativa, mas o
			// horário foi declarado e não extrapolou: o passo 3 é subsidiário.
			expect(
				extrapolaJornada({
					data: QUINTA,
					horaInicio: '08:00',
					horaFim: '17:00',
					minutosIda: 180
				})
			).toBe('nao');
		});

		it('só uma das pontas declarada não é declaração de jornada', () => {
			// Cai para o passo 3, e sem tempo de viagem fica indeterminada.
			expect(extrapolaJornada({ data: QUINTA, horaInicio: '04:00' })).toBe('indeterminada');
			expect(extrapolaJornada({ data: QUINTA, horaFim: '20:00' })).toBe('indeterminada');
		});

		it('hora malformada não conta como declarada', () => {
			expect(extrapolaJornada({ data: QUINTA, horaInicio: '4h', horaFim: '08:00' })).toBe(
				'indeterminada'
			);
			expect(extrapolaJornada({ data: QUINTA, horaInicio: '25:00', horaFim: '08:00' })).toBe(
				'indeterminada'
			);
		});
	});

	describe('3. cálculo estimado — só sem horário declarado', () => {
		it('2×ida + 3h acima de 8h extrapola', () => {
			// 2h31 de ida → 8,03h.
			expect(extrapolaJornada({ data: QUINTA, minutosIda: 151 })).toBe('estimada');
		});

		it('exatamente 8h NÃO extrapola — o texto exige passar de 8', () => {
			// 2h30 de ida → 8,00h.
			expect(extrapolaJornada({ data: QUINTA, minutosIda: 150 })).toBe('nao');
		});

		it('percurso curto não extrapola', () => {
			expect(extrapolaJornada({ data: QUINTA, minutosIda: 40 })).toBe('nao');
		});

		it('sem tempo de viagem fica indeterminada, não "não"', () => {
			expect(extrapolaJornada({ data: QUINTA })).toBe('indeterminada');
			expect(extrapolaJornada({ data: QUINTA, minutosIda: null })).toBe('indeterminada');
			expect(extrapolaJornada({ data: QUINTA, minutosIda: Number.NaN })).toBe('indeterminada');
			expect(extrapolaJornada({ data: QUINTA, minutosIda: -5 })).toBe('indeterminada');
		});
	});

	it('data inválida não vira fim de semana por acidente', () => {
		expect(extrapolaJornada({ data: '', horaInicio: '08:00', horaFim: '17:00' })).toBe('nao');
	});
});

describe('houveExtrapolacao', () => {
	it('reconhece os três caminhos que concedem', () => {
		expect(houveExtrapolacao('dia_pago')).toBe(true);
		expect(houveExtrapolacao('horario_declarado')).toBe(true);
		expect(houveExtrapolacao('estimada')).toBe(true);
	});

	it('recusa o que não decidiu a favor', () => {
		expect(houveExtrapolacao('nao')).toBe(false);
		// Indeterminada NÃO concede: sem aferir, não se defere.
		expect(houveExtrapolacao('indeterminada')).toBe(false);
	});
});
