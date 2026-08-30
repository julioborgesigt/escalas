/**
 * A classificação das horas é a peça que erra CARO e em silêncio: trocar um
 * sábado por sexta transforma dez horas "plus" em "sem custo" e o PDF sai com
 * um total menor sem nada denunciar.
 *
 * Sobre a ausência de uma bateria de fuso — e por que ela foi REMOVIDA depois de
 * escrita —, ver o bloco "blindagem de calendário" no fim do arquivo.
 */
import { describe, it, expect } from 'vitest';
import { classificarJanela, horasPagas } from '../horas-extras';

// 2026-09-29 é uma TERÇA (o dia do plano-modelo). 2026-10-03 é sábado,
// 2026-10-04 domingo, 2026-10-05 segunda.
const TERCA = '2026-09-29';
const SABADO = '2026-10-03';
const DOMINGO = '2026-10-04';
const SEGUNDA = '2026-10-05';

describe('classificarJanela — dia útil', () => {
	it('08:00 às 18:00 não gera custo nenhum', () => {
		expect(classificarJanela({ dataInicio: TERCA, horaInicio: '08:00', horaFim: '18:00' })).toEqual(
			{ normais: 0, plus: 0, semCusto: 10 }
		);
	});

	it('05:00 às 11:00 mistura plus, normal e sem custo', () => {
		// 05 plus · 06,07 normais · 08,09,10 sem custo
		expect(classificarJanela({ dataInicio: TERCA, horaInicio: '05:00', horaFim: '11:00' })).toEqual(
			{ normais: 2, plus: 1, semCusto: 3 }
		);
	});

	it('18:00 às 22:00 é hora extra normal', () => {
		expect(classificarJanela({ dataInicio: TERCA, horaInicio: '18:00', horaFim: '22:00' })).toEqual(
			{ normais: 4, plus: 0, semCusto: 0 }
		);
	});

	it('00:00 às 06:00 é tudo plus', () => {
		expect(classificarJanela({ dataInicio: TERCA, horaInicio: '00:00', horaFim: '06:00' })).toEqual(
			{ normais: 0, plus: 6, semCusto: 0 }
		);
	});

	it('o minuto final na virada da hora não paga a hora seguinte', () => {
		// Sair às 18:00 = a última hora INICIADA é a das 17.
		const ate18 = classificarJanela({ dataInicio: TERCA, horaInicio: '17:00', horaFim: '18:00' });
		expect(ate18).toEqual({ normais: 0, plus: 0, semCusto: 1 });

		// Um minuto depois já inicia a hora das 18, que é paga.
		const ate1801 = classificarJanela({ dataInicio: TERCA, horaInicio: '17:00', horaFim: '18:01' });
		expect(ate1801).toEqual({ normais: 1, plus: 0, semCusto: 1 });
	});
});

describe('classificarJanela — fim de semana e feriado', () => {
	it('sábado paga plus mesmo no horário de expediente', () => {
		expect(
			classificarJanela({ dataInicio: SABADO, horaInicio: '08:00', horaFim: '18:00' })
		).toEqual({ normais: 0, plus: 10, semCusto: 0 });
	});

	it('domingo paga plus', () => {
		expect(
			classificarJanela({ dataInicio: DOMINGO, horaInicio: '09:00', horaFim: '12:00' })
		).toEqual({ normais: 0, plus: 3, semCusto: 0 });
	});

	it('feriado em dia útil se comporta como fim de semana', () => {
		const comum = classificarJanela({ dataInicio: TERCA, horaInicio: '08:00', horaFim: '18:00' });
		const feriado = classificarJanela({
			dataInicio: TERCA,
			horaInicio: '08:00',
			horaFim: '18:00',
			feriado: true
		});
		expect(comum).toEqual({ normais: 0, plus: 0, semCusto: 10 });
		expect(feriado).toEqual({ normais: 0, plus: 10, semCusto: 0 });
	});
});

describe('classificarJanela — janela que atravessa a meia-noite', () => {
	it('conta as horas do dia seguinte com a regra DELE', () => {
		// Sexta 2026-10-02 às 22:00 até sábado 03 às 02:00.
		// 22,23 de sexta = normais · 00,01 de sábado = plus (fim de semana).
		expect(
			classificarJanela({
				dataInicio: '2026-10-02',
				horaInicio: '22:00',
				dataFim: SABADO,
				horaFim: '02:00'
			})
		).toEqual({ normais: 2, plus: 2, semCusto: 0 });
	});

	it('o feriado NÃO vaza para o dia seguinte', () => {
		// Segunda feriado 22:00 → terça comum 10:00.
		// 22,23 de segunda = plus (feriado).
		// Terça: 00–05 plus (madrugada), 06,07 normais, 08,09 sem custo.
		expect(
			classificarJanela({
				dataInicio: SEGUNDA,
				horaInicio: '22:00',
				dataFim: '2026-10-06',
				horaFim: '10:00',
				feriado: true
			})
		).toEqual({ normais: 2, plus: 8, semCusto: 2 });
	});

	it('atravessa um dia inteiro no meio', () => {
		// Terça 23:00 → quinta 01:00. Quarta inteira (24h) no meio.
		const r = classificarJanela({
			dataInicio: TERCA,
			horaInicio: '23:00',
			dataFim: '2026-10-01',
			horaFim: '01:00'
		});
		// terça 23 = normal · quarta 00-05 plus, 06-07 normal, 08-17 sem custo,
		// 18-23 normal · quinta 00 = plus
		expect(r).toEqual({ normais: 1 + 2 + 6, plus: 6 + 1, semCusto: 10 });
		expect(r.normais + r.plus + r.semCusto).toBe(26);
	});
});

describe('classificarJanela — entradas inválidas devolvem zero, não palpite', () => {
	it.each([
		['sem hora de fim', { dataInicio: TERCA, horaInicio: '08:00' }],
		['fim antes do início', { dataInicio: TERCA, horaInicio: '18:00', horaFim: '08:00' }],
		['fim igual ao início', { dataInicio: TERCA, horaInicio: '08:00', horaFim: '08:00' }],
		['data mal formada', { dataInicio: '29/09/2026', horaInicio: '08:00', horaFim: '18:00' }],
		['hora mal formada', { dataInicio: TERCA, horaInicio: '8h', horaFim: '18:00' }],
		['hora fora do relógio', { dataInicio: TERCA, horaInicio: '25:00', horaFim: '26:00' }],
		[
			'dataFim antes de dataInicio',
			{ dataInicio: SABADO, horaInicio: '08:00', dataFim: TERCA, horaFim: '18:00' }
		]
	])('%s', (_rotulo, janela) => {
		expect(classificarJanela(janela)).toEqual({ normais: 0, plus: 0, semCusto: 0 });
	});

	it('janela absurdamente longa não trava o Worker', () => {
		const r = classificarJanela({
			dataInicio: TERCA,
			horaInicio: '00:00',
			dataFim: '2226-09-29',
			horaFim: '23:00'
		});
		// Teto de 31 dias: 31 × 24 = 744 horas, e não duzentos anos de laço.
		expect(r.normais + r.plus + r.semCusto).toBe(744);
	});
});

describe('horasPagas', () => {
	it('soma normais e plus, e ignora o expediente ordinário', () => {
		expect(horasPagas({ normais: 5, plus: 1, semCusto: 10 })).toBe(6);
	});
});

/**
 * A blindagem de calendário.
 *
 * **Não há bateria de `process.env.TZ` aqui, e é decisão.** A primeira versão
 * deste arquivo tinha uma — quatro fusos extremos, a mesma janela em cada um —
 * e ela era DECORATIVA: o Node cacheia o fuso no start do processo, mudar
 * `process.env.TZ` em runtime não alcança o `Date`, e a bateria continuava
 * verde com a implementação quebrada de propósito. Teste que não pode falhar é
 * pior que teste nenhum, porque compra confiança sem entregar nada.
 *
 * Trocada a bateria por mutação, ficou claro que o alarme era exagerado: o
 * parse local (`T00:00:00` + `getDay()`) acerta o dia da semana sob UTC+14,
 * UTC-11 e na virada do horário de verão brasileiro — local entra, local sai, e
 * as pontas se cancelam. O que quebra é MISTURAR convenções (`T00:00:00` local
 * com `toISOString()`), e isso não existe no módulo.
 *
 * A imunidade que sobra é estrutural: `diaDaSemana` usa `Date.UTC` +
 * `getUTCDay`. Então o que vale testar não é fuso — é o CALENDÁRIO: viradas de
 * DST, de ano e de ano bissexto, onde um erro de aritmética apareceria.
 */
describe('blindagem de calendário', () => {
	it('acerta o dia da semana na virada do horário de verão brasileiro', () => {
		// 2018-11-04: entrada do DST (00:00 → 01:00; a meia-noite NÃO existiu em
		// São Paulo). Era um DOMINGO — tem de pagar plus no expediente.
		expect(
			classificarJanela({ dataInicio: '2018-11-04', horaInicio: '08:00', horaFim: '18:00' })
		).toEqual({ normais: 0, plus: 10, semCusto: 0 });

		// 2019-02-16: saída do DST, um SÁBADO.
		expect(
			classificarJanela({ dataInicio: '2019-02-16', horaInicio: '08:00', horaFim: '18:00' })
		).toEqual({ normais: 0, plus: 10, semCusto: 0 });

		// 2018-11-05, a segunda logo depois da virada: dia útil, sem custo.
		expect(
			classificarJanela({ dataInicio: '2018-11-05', horaInicio: '08:00', horaFim: '18:00' })
		).toEqual({ normais: 0, plus: 0, semCusto: 10 });
	});

	it('acerta a semana inteira, um dia de cada vez', () => {
		// 2026-09-28 é segunda; sábado e domingo caem em 03 e 04 de outubro.
		const semana = [
			['2026-09-28', 'segunda', false],
			['2026-09-29', 'terça', false],
			['2026-09-30', 'quarta', false],
			['2026-10-01', 'quinta', false],
			['2026-10-02', 'sexta', false],
			['2026-10-03', 'sábado', true],
			['2026-10-04', 'domingo', true]
		] as const;

		for (const [iso, rotulo, pago] of semana) {
			const r = classificarJanela({ dataInicio: iso, horaInicio: '08:00', horaFim: '18:00' });
			expect(r, `${iso} (${rotulo})`).toEqual(
				pago ? { normais: 0, plus: 10, semCusto: 0 } : { normais: 0, plus: 0, semCusto: 10 }
			);
		}
	});

	it('acerta a virada de ano e o 29 de fevereiro bissexto', () => {
		// 2027-01-01 é uma sexta.
		expect(
			classificarJanela({ dataInicio: '2027-01-01', horaInicio: '08:00', horaFim: '18:00' })
		).toEqual({ normais: 0, plus: 0, semCusto: 10 });

		// 2028-02-29 é uma terça (ano bissexto).
		expect(
			classificarJanela({ dataInicio: '2028-02-29', horaInicio: '08:00', horaFim: '18:00' })
		).toEqual({ normais: 0, plus: 0, semCusto: 10 });

		// A janela atravessa 31/12 → 01/01, dois anos diferentes.
		expect(
			classificarJanela({
				dataInicio: '2026-12-31',
				horaInicio: '22:00',
				dataFim: '2027-01-01',
				horaFim: '02:00'
			})
		).toEqual({ normais: 2, plus: 2, semCusto: 0 });
	});
});
