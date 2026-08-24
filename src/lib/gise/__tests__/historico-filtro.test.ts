import { describe, expect, it } from 'vitest';
import { escalaPassaRecorteHistorico } from '../historico-filtro';

function escala(
	data: string,
	seccionais: { id: number; tipos?: string[] }[] = []
): { data_inicio: string; seccionais: { id: number; tipos?: string[] }[] } {
	return { data_inicio: data, seccionais };
}

describe('escalaPassaRecorteHistorico', () => {
	const op = escala('2026-08-10', [{ id: 1, tipos: ['operacional'] }]);
	const seint = escala('2026-08-10', [{ id: 1, tipos: ['seint'] }]);
	const ambos = escala('2026-08-10', [
		{ id: 1, tipos: ['operacional'] },
		{ id: 2, tipos: ['seint'] }
	]);

	it('sem recorte deixa passar', () => {
		expect(escalaPassaRecorteHistorico(op, {})).toBe(true);
	});

	it('seccional recusa quem não participa', () => {
		expect(escalaPassaRecorteHistorico(op, { seccionalId: 9 })).toBe(false);
		expect(escalaPassaRecorteHistorico(op, { seccionalId: 1 })).toBe(true);
	});

	it('tipo de equipe olha as equipes da escala', () => {
		expect(escalaPassaRecorteHistorico(op, { tipoEquipe: 'seint' })).toBe(false);
		expect(escalaPassaRecorteHistorico(op, { tipoEquipe: 'operacional' })).toBe(true);
		expect(escalaPassaRecorteHistorico(seint, { tipoEquipe: 'seint' })).toBe(true);
		expect(escalaPassaRecorteHistorico(ambos, { tipoEquipe: 'seint' })).toBe(true);
	});

	it('seccional + tipo exigem os dois na mesma seccional', () => {
		expect(escalaPassaRecorteHistorico(ambos, { seccionalId: 1, tipoEquipe: 'seint' })).toBe(false);
		expect(escalaPassaRecorteHistorico(ambos, { seccionalId: 2, tipoEquipe: 'seint' })).toBe(true);
	});

	it('mês civil recorta pelo prefixo YYYY-MM', () => {
		expect(escalaPassaRecorteHistorico(op, { mesAno: '2026-08' })).toBe(true);
		expect(escalaPassaRecorteHistorico(op, { mesAno: '2026-07' })).toBe(false);
	});

	it('data exata ganha do mês quando os dois vêm preenchidos', () => {
		const emJulho = escala('2026-07-01', [{ id: 1, tipos: ['operacional'] }]);
		expect(escalaPassaRecorteHistorico(emJulho, { mesAno: '2026-08', data: '2026-07-01' })).toBe(
			true
		);
		expect(escalaPassaRecorteHistorico(op, { mesAno: '2026-08', data: '2026-07-01' })).toBe(false);
	});

	it('ciclo 7 de 2026 é 21/jun a 20/jul', () => {
		const emJun = escala('2026-06-22');
		const emJul = escala('2026-07-20');
		const fora = escala('2026-07-21');
		const recorte = { anoCiclo: 2026, numeroCiclo: 7 };
		expect(escalaPassaRecorteHistorico(emJun, recorte)).toBe(true);
		expect(escalaPassaRecorteHistorico(emJul, recorte)).toBe(true);
		expect(escalaPassaRecorteHistorico(fora, recorte)).toBe(false);
	});

	it('ciclo 1 atravessa o ano (21/dez a 20/jan)', () => {
		const recorte = { anoCiclo: 2026, numeroCiclo: 1 };
		expect(escalaPassaRecorteHistorico(escala('2025-12-21'), recorte)).toBe(true);
		expect(escalaPassaRecorteHistorico(escala('2026-01-20'), recorte)).toBe(true);
		expect(escalaPassaRecorteHistorico(escala('2025-12-20'), recorte)).toBe(false);
		expect(escalaPassaRecorteHistorico(escala('2026-01-21'), recorte)).toBe(false);
	});
});
