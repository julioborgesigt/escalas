import { describe, it, expect } from 'vitest';
import {
	recorteSeccionalVisivel,
	type RecorteGise,
	type RecorteSeccional
} from '../recorte-seccional';

const gise: RecorteGise = {
	supervisor_id: 10,
	assessor_id: 11,
	seint1_id: 12,
	seint2_id: 13
};

const secA: RecorteSeccional = {
	seccional_id: 50,
	unidades: [
		{
			unidade_id: 501,
			equipes: [{ membros: [{ policial_id: 77 }, { policial_id: 78 }] }]
		}
	]
};

const secB: RecorteSeccional = {
	seccional_id: 60,
	unidades: [{ unidade_id: 601, equipes: [{ membros: [{ policial_id: 88 }] }] }]
};

describe('recorteSeccionalVisivel (SEC-20)', () => {
	it('Admin Geral vê qualquer seccional da GISE', () => {
		expect(recorteSeccionalVisivel({ id: 1, tipo: 'admin' }, gise, secA)).toBe(true);
		expect(recorteSeccionalVisivel({ id: 1, tipo: 'admin' }, gise, secB)).toBe(true);
	});

	it('quadro de supervisão vê qualquer seccional', () => {
		expect(recorteSeccionalVisivel({ id: 10, tipo: 'policial' }, gise, secB)).toBe(true);
		expect(recorteSeccionalVisivel({ id: 11, tipo: 'policial' }, gise, secA)).toBe(true);
	});

	it('admin da seccional A não vê a B', () => {
		const u = { id: 2, tipo: 'policial', papel_unidade_id: 50 };
		expect(recorteSeccionalVisivel(u, gise, secA)).toBe(true);
		expect(recorteSeccionalVisivel(u, gise, secB)).toBe(false);
	});

	it('admin da DP da seccional A não vê a B', () => {
		const u = { id: 3, tipo: 'policial', papel_unidade_id: 501 };
		expect(recorteSeccionalVisivel(u, gise, secA)).toBe(true);
		expect(recorteSeccionalVisivel(u, gise, secB)).toBe(false);
	});

	it('membro da seccional A não vê a B', () => {
		const u = { id: 77, tipo: 'policial' };
		expect(recorteSeccionalVisivel(u, gise, secA)).toBe(true);
		expect(recorteSeccionalVisivel(u, gise, secB)).toBe(false);
	});
});
