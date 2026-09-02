import { describe, it, expect } from 'vitest';
import { analisarDiaria } from '../parecer';

/** Quinta-feira. A operação típica do DPI SUL: 04h às 08h, no mesmo dia. */
const OPERACAO_TIPICA = {
	dataInicio: '2026-09-10',
	dataFim: '2026-09-10',
	horaInicio: '04:00',
	horaFim: '08:00'
};

describe('analisarDiaria — missão de um dia', () => {
	it('a operação das 04h é favorável, com meia diária', () => {
		const p = analisarDiaria(OPERACAO_TIPICA);
		expect(p.resultado).toBe('favoravel');
		expect(p.meias).toBe(1);
		expect(p.extrapolacao).toBe('horario_declarado');
	});

	it('dentro do expediente é desfavorável, e diz por quê', () => {
		const p = analisarDiaria({ ...OPERACAO_TIPICA, horaInicio: '08:00', horaFim: '17:00' });
		expect(p.resultado).toBe('desfavoravel');
		expect(p.meias).toBe(0);
		expect(p.fundamentos[0].texto).toMatch(/não extrapolou a jornada/);
	});

	it('sábado é favorável mesmo dentro do expediente, pelo art. 22', () => {
		const p = analisarDiaria({
			dataInicio: '2026-09-12',
			dataFim: '2026-09-12',
			horaInicio: '09:00',
			horaFim: '12:00'
		});
		expect(p.resultado).toBe('favoravel');
		expect(p.fundamentos[0].dispositivo).toBe('art. 22');
	});

	it('sem horário e sem tempo de viagem é desfavorável, e o fundamento diz o que falta', () => {
		const p = analisarDiaria({ dataInicio: '2026-09-10', dataFim: '2026-09-10' });
		expect(p.resultado).toBe('desfavoravel');
		expect(p.extrapolacao).toBe('indeterminada');
		expect(p.fundamentos[0].texto).toMatch(/sem tempo de viagem/);
	});
});

describe('analisarDiaria — pernoite', () => {
	it('dispensa o teste de jornada: 2 dias dão 1,5 diárias mesmo no expediente', () => {
		const p = analisarDiaria({
			dataInicio: '2026-09-10',
			dataFim: '2026-09-11',
			horaInicio: '09:00',
			horaFim: '17:00'
		});
		expect(p.resultado).toBe('favoravel');
		expect(p.meias).toBe(3);
	});

	it('a saída às 23h da véspera é pernoite: N = 2', () => {
		const p = analisarDiaria({
			dataInicio: '2026-09-09',
			dataFim: '2026-09-10',
			horaInicio: '23:00',
			horaFim: '10:00'
		});
		expect(p.meias).toBe(3); // 1,5 diárias, não 0,5
	});

	it('reproduz os exemplos do decreto', () => {
		expect(analisarDiaria({ dataInicio: '2026-09-10', dataFim: '2026-09-16' }).meias).toBe(13);
		expect(analisarDiaria({ dataInicio: '2026-09-10', dataFim: '2026-09-19' }).meias).toBe(19);
	});

	it('período invertido é desfavorável, não uma contagem negativa', () => {
		const p = analisarDiaria({ dataInicio: '2026-09-11', dataFim: '2026-09-10' });
		expect(p.resultado).toBe('desfavoravel');
		expect(p.meias).toBe(0);
		expect(p.fundamentos[0].texto).toMatch(/invertido/);
	});
});

describe('analisarDiaria — alertas não bloqueiam', () => {
	it('o teto mensal alerta e o parecer segue favorável', () => {
		const p = analisarDiaria({ ...OPERACAO_TIPICA, mesesAcimaDoTeto: ['2026-09'] });
		expect(p.resultado).toBe('favoravel');
		expect(p.alertas).toEqual(['teto_mensal']);
		expect(p.fundamentos.some((f) => f.dispositivo === 'art. 13')).toBe(true);
	});

	it('a vedação de região metropolitana sai com o dispositivo citado', () => {
		const p = analisarDiaria({
			dataInicio: '2026-09-10',
			dataFim: '2026-09-11', // pernoite, para o parecer não morrer na jornada
			horaInicio: '09:00',
			horaFim: '17:00',
			regiaoOrigem: 'RMC',
			regiaoDestino: 'RMC',
			distanciaKm: 12
		});
		expect(p.resultado).toBe('favoravel');
		expect(p.alertas).toEqual(['mesma_regiao_metropolitana']);
		expect(p.fundamentos.some((f) => f.dispositivo === 'art. 4º, §1º, II')).toBe(true);
	});

	it('a operação das 04h dentro do Cariri NÃO alerta — ela extrapola', () => {
		const p = analisarDiaria({
			...OPERACAO_TIPICA,
			regiaoOrigem: 'RMC',
			regiaoDestino: 'RMC',
			distanciaKm: 12
		});
		expect(p.alertas).toEqual([]);
	});
});

describe('analisarDiaria — o parecer é imprimível', () => {
	it('todo parecer sai com ao menos um fundamento, e todos com dispositivo', () => {
		const casos = [
			OPERACAO_TIPICA,
			{ ...OPERACAO_TIPICA, horaInicio: '08:00', horaFim: '17:00' },
			{ dataInicio: '2026-09-10', dataFim: '2026-09-16' },
			{ dataInicio: '2026-09-11', dataFim: '2026-09-10' }
		];
		for (const caso of casos) {
			const p = analisarDiaria(caso);
			expect(p.fundamentos.length).toBeGreaterThan(0);
			for (const f of p.fundamentos) {
				expect(f.texto.length).toBeGreaterThan(10);
				expect(f.dispositivo).toBeTruthy();
			}
		}
	});
});
