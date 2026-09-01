import { describe, it, expect } from 'vitest';
import {
	acrescentarNaLista,
	definirPadraoNaLista,
	removerDaLista,
	padraoDaLista,
	type OpcaoEmLista
} from '../opcoes';

/**
 * Estas regras existem em DOIS lugares (ver o cabeçalho de `../opcoes.ts`): aqui
 * para a lista em memória da tela de criação, e em `$lib/db/planos/opcoes.ts`
 * contra o banco. Os testes abaixo fixam o comportamento que os dois lados
 * precisam concordar — a padrão que sai de uma sequência de cliques na criação
 * tem de ser a mesma que sairia dos mesmos cliques no editor.
 */
describe('regras da lista de opções', () => {
	describe('acrescentarNaLista', () => {
		it('a primeira nasce padrão; as seguintes, não', () => {
			let l: OpcaoEmLista[] = [];
			l = acrescentarNaLista(l, 'Iguatu');
			expect(l).toEqual([{ valor: 'Iguatu', padrao: true, municipio: null }]);
			l = acrescentarNaLista(l, 'Acopiara');
			expect(l).toEqual([
				{ valor: 'Iguatu', padrao: true, municipio: null },
				{ valor: 'Acopiara', padrao: false, municipio: null }
			]);
		});

		it('ignora valor repetido, sem mexer na padrão', () => {
			const l = acrescentarNaLista(acrescentarNaLista([], 'Iguatu'), 'Acopiara');
			expect(acrescentarNaLista(l, 'Iguatu')).toEqual(l);
		});

		it('apara o valor e recusa o que fica em branco', () => {
			expect(acrescentarNaLista([], '  Jucás  ')).toEqual([
				{ valor: 'Jucás', padrao: true, municipio: null }
			]);
			expect(acrescentarNaLista([], '   ')).toEqual([]);
		});
	});

	describe('definirPadraoNaLista', () => {
		it('move a estrela, deixando exatamente uma', () => {
			const l = acrescentarNaLista(acrescentarNaLista([], 'Iguatu'), 'Acopiara');
			const r = definirPadraoNaLista(l, 'Acopiara');
			expect(r.filter((o) => o.padrao)).toEqual([
				{ valor: 'Acopiara', padrao: true, municipio: null }
			]);
		});

		it('valor ausente não muda nada — e não deixa a lista sem padrão', () => {
			const l = acrescentarNaLista([], 'Iguatu');
			expect(definirPadraoNaLista(l, 'Barbalha')).toEqual(l);
		});
	});

	describe('removerDaLista', () => {
		it('removida a padrão, a primeira das restantes assume', () => {
			let l = acrescentarNaLista(acrescentarNaLista([], 'Iguatu'), 'Acopiara');
			l = acrescentarNaLista(l, 'Jucás');
			const r = removerDaLista(l, 'Iguatu');
			expect(r).toEqual([
				{ valor: 'Acopiara', padrao: true, municipio: null },
				{ valor: 'Jucás', padrao: false, municipio: null }
			]);
		});

		it('removida uma não-padrão, a estrela fica onde estava', () => {
			const l = acrescentarNaLista(acrescentarNaLista([], 'Iguatu'), 'Acopiara');
			expect(removerDaLista(l, 'Acopiara')).toEqual([
				{ valor: 'Iguatu', padrao: true, municipio: null }
			]);
		});

		it('esvaziar a lista é permitido', () => {
			expect(removerDaLista(acrescentarNaLista([], 'Iguatu'), 'Iguatu')).toEqual([]);
		});
	});

	it('padraoDaLista devolve vazio quando não há estrela', () => {
		expect(padraoDaLista(acrescentarNaLista([], 'Iguatu'))).toBe('Iguatu');
		expect(padraoDaLista([])).toBe('');
		expect(padraoDaLista([{ valor: 'Iguatu', padrao: false, municipio: null }])).toBe('');
	});
});
