import { describe, it, expect } from 'vitest';
import {
	filtrarDelegacias,
	filtrarSeccionaisDisponiveis,
	getSeccionalColorClass
} from './gise-page-helpers';
import type { GiseDetalhado } from '$lib/db/gise';
import type { Unidade } from '$lib/server/schema';

function u(id: number, tipo: Unidade['tipo'], nome = 'U'): Unidade {
	return {
		id,
		nome,
		tipo,
		seccional_id: null,
		tem_plantao: true,
		tem_expediente: true,
		tem_fds: true,
		cidade: 'X'
	} as Unidade;
}

describe('gise-page-helpers', () => {
	it('filtrarSeccionaisDisponiveis exclui seccionais já ligadas à GISE', () => {
		const gise = {
			seccionais: [{ seccional_id: 1 }]
		} as unknown as GiseDetalhado;
		const todas = [u(1, 'seccional'), u(2, 'seccional'), u(3, 'delegacia')];
		const livres = filtrarSeccionaisDisponiveis(gise, todas);
		expect(livres.map((x) => x.id)).toEqual([2]);
	});

	it('filtrarDelegacias retorna só delegacias', () => {
		const todas = [u(1, 'seccional'), u(10, 'delegacia')];
		expect(filtrarDelegacias(todas).map((d) => d.id)).toEqual([10]);
	});

	it('getSeccionalColorClass é estável por id', () => {
		expect(getSeccionalColorClass(0)).toBe(getSeccionalColorClass(0));
		expect(getSeccionalColorClass(5)).not.toBe('');
	});
});
