import { describe, it, expect } from 'vitest';
import {
	filtrarDelegacias,
	filtrarSeccionaisDisponiveis,
	getSeccionalColorClass,
	resumoDoSlot,
	rotuloCurtoUnidade,
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

/**
 * O que a ABA da unidade diz sem ser aberta.
 *
 * Com abas, só uma unidade aparece por vez — o resumo é o que impede que "falta
 * gente na Icó" só apareça para quem clicar na Icó.
 */
describe('resumoDoSlot', () => {
	function eq(dpc: number, oip: number, membros: number): GiseEquipeComMembros {
		return {
			id: 1,
			gise_seccional_id: 1,
			gise_unidade_id: 1,
			tipo: 'operacional',
			slots_dpc: dpc,
			slots_oip: oip,
			hora_entrada: null,
			hora_saida: null,
			membros: Array.from({ length: membros }, () => ({}))
		} as unknown as GiseEquipeComMembros;
	}

	it('conta equipes e as vagas ainda sem policial', () => {
		expect(resumoDoSlot({ equipes: [eq(1, 3, 1), eq(0, 2, 0)] })).toEqual({
			equipes: 2,
			vagasAbertas: 5
		});
	});

	it('não acusa vaga quando a equipe está completa', () => {
		expect(resumoDoSlot({ equipes: [eq(1, 3, 4)] })).toEqual({ equipes: 1, vagasAbertas: 0 });
	});

	it('não vira negativo com mais membros que vagas', () => {
		// Acontece quando o Admin Geral REDUZ as vagas de uma equipe já montada.
		expect(resumoDoSlot({ equipes: [eq(1, 1, 5)] })).toEqual({ equipes: 1, vagasAbertas: 0 });
	});

	it('tolera árvore incompleta', () => {
		expect(resumoDoSlot(null)).toEqual({ equipes: 0, vagasAbertas: 0 });
		expect(resumoDoSlot({ equipes: [] })).toEqual({ equipes: 0, vagasAbertas: 0 });
	});
});

describe('rotuloCurtoUnidade', () => {
	it('deixa o município, que é o que distingue', () => {
		expect(rotuloCurtoUnidade('Delegacia de Polícia Civil de Iguatu')).toBe('Iguatu');
		expect(rotuloCurtoUnidade('Delegacia Municipal de Icó')).toBe('Municipal de Icó');
	});

	it('devolve inteiro o nome que não segue o padrão', () => {
		// Cortar no escuro é como se perde a única parte que identifica a unidade.
		expect(rotuloCurtoUnidade('DEFAC')).toBe('DEFAC');
	});

	it('tolera slot sem unidade escolhida', () => {
		expect(rotuloCurtoUnidade(null)).toBe('');
	});
});
