/**
 * O dia lançado pertence ao período da escala? — FLW-ESC-005.
 *
 * As datas chegam do cliente, e o calendário do modal — que era a única coisa
 * limitando — é markup. Um POST direto com um dia de outro mês não dava erro
 * visível: a linha entrava, sumia da grade (que só desenha o mês) e reaparecia
 * no PDF, que lista o que o banco tem. Uma escala de setembro assinada com um
 * plantão de agosto.
 *
 * A comparação é lexicográfica de propósito, e o último bloco é o que prova por
 * que: `new Date('2026-09-01')` é meia-noite UTC, que em UTC-3 é 31 de agosto —
 * a conversão de fuso já custou dois bugs neste projeto.
 */
import { describe, it, expect } from 'vitest';
import {
	dataNoPeriodo,
	datasForaDoPeriodo,
	erroDeDatasForaDoPeriodo,
	formatarDiasBR
} from '../periodo';

const SETEMBRO = { data_inicio: '2026-09-01', data_fim: '2026-09-30' };

describe('dataNoPeriodo', () => {
	it('aceita as bordas', () => {
		expect(dataNoPeriodo(SETEMBRO, '2026-09-01')).toBe(true);
		expect(dataNoPeriodo(SETEMBRO, '2026-09-30')).toBe(true);
	});

	it('recusa o dia anterior e o posterior', () => {
		expect(dataNoPeriodo(SETEMBRO, '2026-08-31')).toBe(false);
		expect(dataNoPeriodo(SETEMBRO, '2026-10-01')).toBe(false);
	});

	it('recusa string vazia', () => {
		// Campo não preenchido não pode virar "dentro do período" por comparação
		// com string vazia.
		expect(dataNoPeriodo(SETEMBRO, '')).toBe(false);
	});

	it('a virada de ANO não engana a comparação', () => {
		const dez = { data_inicio: '2026-12-01', data_fim: '2026-12-31' };
		expect(dataNoPeriodo(dez, '2027-01-01')).toBe(false);
		expect(dataNoPeriodo(dez, '2025-12-15')).toBe(false);
	});

	it('escala de UM dia aceita só aquele dia', () => {
		const fds = { data_inicio: '2026-09-12', data_fim: '2026-09-12' };
		expect(dataNoPeriodo(fds, '2026-09-12')).toBe(true);
		expect(dataNoPeriodo(fds, '2026-09-13')).toBe(false);
	});
});

describe('datasForaDoPeriodo', () => {
	it('devolve QUAIS datas, na ordem em que vieram', () => {
		// Um booleano não permite corrigir: quem colou trinta dias precisa saber
		// qual está errado.
		expect(
			datasForaDoPeriodo(SETEMBRO, ['2026-09-05', '2026-08-31', '2026-09-20', '2026-10-02'])
		).toEqual(['2026-08-31', '2026-10-02']);
	});

	it('vazio quando todas cabem', () => {
		expect(datasForaDoPeriodo(SETEMBRO, ['2026-09-01', '2026-09-30'])).toEqual([]);
	});
});

describe('erroDeDatasForaDoPeriodo', () => {
	it('null quando não há o que recusar', () => {
		expect(erroDeDatasForaDoPeriodo(SETEMBRO, ['2026-09-15'])).toBeNull();
	});

	it('a mensagem nomeia o período E os dias recusados', () => {
		const msg = erroDeDatasForaDoPeriodo(SETEMBRO, ['2026-08-31', '2026-09-10']);
		expect(msg).toContain('01/09');
		expect(msg).toContain('30/09');
		expect(msg).toContain('31/08');
		expect(msg, 'o dia válido não entra na lista de recusados').not.toContain('10/09');
	});
});

describe('formatarDiasBR', () => {
	it('converte ISO para dd/mm', () => {
		expect(formatarDiasBR(['2026-09-05', '2026-10-12'])).toBe('05/09, 12/10');
	});

	it('não usa Date — o fuso não desloca o dia', () => {
		// `new Date('2026-09-01')` é meia-noite UTC, que em UTC-3 é 31/08. É o
		// mesmo erro que já custou o calendário marcando AMANHÃ das 21h à
		// meia-noite (ver a tabela de duplicações no CLAUDE.md).
		expect(formatarDiasBR(['2026-09-01'])).toBe('01/09');
		expect(formatarDiasBR(['2026-01-01'])).toBe('01/01');
	});
});
