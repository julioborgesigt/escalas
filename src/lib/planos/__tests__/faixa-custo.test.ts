/**
 * A tradução (cargo, classe) → faixa de pagamento. O que este arquivo protege é
 * o `null`: a faixa não resolvida precisa CONTINUAR não resolvendo, porque é
 * ela que impede o servidor sem classe de sair custando R$ 0 no documento.
 */
import { describe, it, expect } from 'vitest';
import { faixaDoPolicial, categoriaDaFaixa, FAIXAS, ROTULO_FAIXA } from '../faixa-custo';
import { classesDoCargo } from '../../cadastro-campos';

describe('faixaDoPolicial — pares de classe', () => {
	it.each([
		['DPC', '1ª', 'dpc_12'],
		['DPC', '2ª', 'dpc_12'],
		['DPC', '3ª', 'dpc_3e'],
		['DPC', 'ESPECIAL', 'dpc_3e'],
		['OIP', 'D', 'oip_cd'],
		['OIP', 'C', 'oip_cd'],
		['OIP', 'B', 'oip_ab'],
		['OIP', 'A', 'oip_ab']
	])('%s classe %s → %s', (cargo, classe, esperado) => {
		expect(faixaDoPolicial(cargo, classe)).toBe(esperado);
	});

	it('cobre TODAS as classes que o cadastro aceita', () => {
		// Se `classesDoCargo` ganhar uma classe nova, ela cai aqui como `null` e
		// este teste reprova — que é o aviso de que a tabela de valores precisa de
		// uma faixa a mais antes de alguém ser escalado com ela.
		for (const cargo of ['DPC', 'OIP']) {
			for (const classe of classesDoCargo(cargo)) {
				expect(faixaDoPolicial(cargo, classe), `${cargo} ${classe}`).not.toBeNull();
			}
		}
	});
});

describe('faixaDoPolicial — o que NÃO resolve', () => {
	it.each([
		['classe vazia', 'OIP', ''],
		['classe só com espaço', 'OIP', '   '],
		['classe nula', 'OIP', null],
		['classe indefinida', 'OIP', undefined],
		['classe de DPC num OIP', 'OIP', '1ª'],
		['classe de OIP num DPC', 'DPC', 'A'],
		['classe inexistente', 'OIP', 'Z'],
		['cargo vazio', '', 'C'],
		['cargo desconhecido', 'ESCRIVAO', 'C'],
		['cargo nulo', null, 'C']
	])('%s → null', (_rotulo, cargo, classe) => {
		expect(faixaDoPolicial(cargo, classe)).toBeNull();
	});
});

describe('faixaDoPolicial — normalização', () => {
	it('aceita minúsculas e espaços, que é como a sincronização da planilha entrega', () => {
		expect(faixaDoPolicial('DPC', 'especial')).toBe('dpc_3e');
		expect(faixaDoPolicial('dpc', ' 1ª ')).toBe('dpc_12');
		expect(faixaDoPolicial('oip', 'c')).toBe('oip_cd');
	});
});

describe('categoriaDaFaixa', () => {
	it('agrupa as quatro faixas nas duas categorias do Anexo II', () => {
		expect(categoriaDaFaixa('dpc_12')).toBe('dpc');
		expect(categoriaDaFaixa('dpc_3e')).toBe('dpc');
		expect(categoriaDaFaixa('oip_cd')).toBe('oip');
		expect(categoriaDaFaixa('oip_ab')).toBe('oip');
	});
});

describe('metadados da tela de valores', () => {
	it('toda faixa tem rótulo', () => {
		for (const f of FAIXAS) {
			expect(ROTULO_FAIXA[f]).toBeTruthy();
		}
		expect(FAIXAS).toHaveLength(4);
	});
});
