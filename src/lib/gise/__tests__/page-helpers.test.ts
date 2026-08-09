import { describe, it, expect } from 'vitest';
import {
	filtrarDelegacias,
	filtrarSeccionaisDisponiveis,
	getSeccionalColorClass,
	tiposEquipeNaSeccional
} from '../page-helpers';
import type { GiseEquipeComMembros } from '$lib/db/gise';
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

describe('page-helpers', () => {
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

	it('getSeccionalColorClass é estável por id e varia a intensidade', () => {
		expect(getSeccionalColorClass(0)).toBe(getSeccionalColorClass(0, 'forte'));
		expect(getSeccionalColorClass(5)).not.toBe('');
		expect(getSeccionalColorClass(5, 'forte')).not.toBe(getSeccionalColorClass(5, 'media'));
		expect(getSeccionalColorClass(5, 'media')).not.toBe(getSeccionalColorClass(5, 'suave'));
	});

	it('tiposEquipeNaSeccional lê unidades[].equipes (não só sec.equipes)', () => {
		const op = { tipo: 'operacional' } as GiseEquipeComMembros;
		expect(
			tiposEquipeNaSeccional({
				unidades: [{ id: 1, unidade_id: 1, nome: 'X', equipes: [op] }]
			})
		).toEqual(['operacional']);
	});

	it('tiposEquipeNaSeccional agrega seint e operacional em ordem fixa', () => {
		const sec = {
			unidades: [
				{
					id: 1,
					unidade_id: 1,
					nome: 'A',
					equipes: [
						{ tipo: 'seint' } as GiseEquipeComMembros,
						{ tipo: 'operacional' } as GiseEquipeComMembros
					]
				}
			]
		};
		expect(tiposEquipeNaSeccional(sec)).toEqual(['operacional', 'seint']);
	});
});
