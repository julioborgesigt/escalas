/**
 * Projeção de mês — o laço que `criarComBase` e `gerarProximoMes` compartilham.
 *
 * Expediente: uma linha por policial no dia 1, horário individual.
 * Plantão: rotação reconhecida vira dias no mês-alvo; padrão estranho vai
 * para `naoProcessados` em vez de um palpite.
 */
import { describe, it, expect } from 'vitest';
import { projetarLinhasMesSeguinte } from '../projetar-mes';

const JAN_1X3 = [
	'2025-01-01',
	'2025-01-05',
	'2025-01-09',
	'2025-01-13',
	'2025-01-17',
	'2025-01-21',
	'2025-01-25',
	'2025-01-29'
];

describe('projetarLinhasMesSeguinte — expediente', () => {
	it('deduplica o policial e lança no primeiro dia, preservando horário', () => {
		const r = projetarLinhasMesSeguinte({
			tipo: 'expediente',
			novaEscalaId: 9,
			ano: 2025,
			mes: 2,
			dataInicioAlvo: '2025-02-01',
			horaEntradaPadrao: '08:00',
			horaSaidaPadrao: '18:00',
			policiaisAtuais: [
				{
					policial_id: 1,
					nome: 'Ana',
					data_plantao: '2025-01-01',
					hora_entrada: '07:00',
					hora_saida: '13:00'
				},
				{
					policial_id: 1,
					nome: 'Ana',
					data_plantao: '2025-01-15',
					hora_entrada: '07:00',
					hora_saida: '13:00'
				},
				{
					policial_id: 2,
					nome: 'Beto',
					data_plantao: '2025-01-01',
					hora_entrada: null,
					hora_saida: null
				}
			]
		});
		expect(r.adicionados).toBe(2);
		expect(r.naoProcessados).toEqual([]);
		expect(r.linhas).toEqual([
			{
				escala_id: 9,
				policial_id: 1,
				data_plantao: '2025-02-01',
				data_saida: '2025-02-01',
				hora_entrada: '07:00',
				hora_saida: '13:00'
			},
			{
				escala_id: 9,
				policial_id: 2,
				data_plantao: '2025-02-01',
				data_saida: '2025-02-01',
				hora_entrada: '08:00',
				hora_saida: '18:00'
			}
		]);
	});
});

describe('projetarLinhasMesSeguinte — plantão', () => {
	it('projeta a rotação 1x3 e marca quem não tem padrão', () => {
		const r = projetarLinhasMesSeguinte({
			tipo: 'plantao',
			novaEscalaId: 3,
			ano: 2025,
			mes: 2,
			dataInicioAlvo: '2025-02-01',
			horaEntradaPadrao: '19:00',
			horaSaidaPadrao: '07:00',
			policiaisAtuais: [
				...JAN_1X3.map((d) => ({
					policial_id: 1,
					nome: 'Ana',
					equipe: 'A',
					data_plantao: d
				})),
				{ policial_id: 2, nome: 'Beto', equipe: 'B', data_plantao: '2025-01-01' },
				{ policial_id: 2, nome: 'Beto', equipe: 'B', data_plantao: '2025-01-03' }
			]
		});
		expect(r.adicionados).toBe(1);
		expect(r.naoProcessados).toEqual([{ nome: 'Beto', motivo: 'Rotação não identificada' }]);
		expect(r.linhas.map((l) => l.data_plantao)).toEqual([
			'2025-02-02',
			'2025-02-06',
			'2025-02-10',
			'2025-02-14',
			'2025-02-18',
			'2025-02-22',
			'2025-02-26'
		]);
		expect(r.linhas[0]).toMatchObject({
			escala_id: 3,
			policial_id: 1,
			data_saida: '2025-02-03',
			hora_entrada: '19:00',
			hora_saida: '07:00',
			equipe: 'A'
		});
	});
});
