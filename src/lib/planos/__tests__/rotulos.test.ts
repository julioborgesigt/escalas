/**
 * Rótulos e formatação de moeda. `formatarBRL` tem teste porque é escrita à
 * mão — o `Intl` não é usado (ICU reduzida no Worker), então o separador de
 * milhar e a casa decimal são responsabilidade deste código.
 */
import { describe, it, expect } from 'vitest';
import { formatarBRL, resumoHoras, rotuloCustoDaEquipe, ROTULO_TIPO_CUSTO } from '../rotulos';
import { formatarDiarias, lerDiarias, meiasDiariasValidas } from '../diarias';

describe('formatarBRL', () => {
	it.each([
		[0, 'R$ 0,00'],
		[5, 'R$ 0,05'],
		[50, 'R$ 0,50'],
		[100, 'R$ 1,00'],
		[16380, 'R$ 163,80'], // a linha do modelo
		[20481, 'R$ 204,81'], // a outra linha do modelo
		[36861, 'R$ 368,61'], // o total do modelo
		[100000, 'R$ 1.000,00'],
		[123456789, 'R$ 1.234.567,89']
	])('%d centavos → %s', (centavos, esperado) => {
		expect(formatarBRL(centavos)).toBe(esperado);
	});

	it('o total do plano-modelo fecha: 163,80 + 204,81 = 368,61', () => {
		expect(formatarBRL(16380 + 20481)).toBe('R$ 368,61');
	});

	it('valor negativo sai com o sinal antes do símbolo', () => {
		expect(formatarBRL(-16380)).toBe('-R$ 163,80');
	});
});

describe('resumoHoras', () => {
	it('reproduz o formato do modelo', () => {
		expect(resumoHoras(5, 1)).toBe('6h (5N/1A)');
	});

	it('omite a decomposição quando não há hora acrescida', () => {
		expect(resumoHoras(6, 0)).toBe('6h');
	});

	it('mostra só as acrescidas quando não há normal', () => {
		expect(resumoHoras(0, 10)).toBe('10h (10A)');
	});

	it('zero hora não vira "0h"', () => {
		expect(resumoHoras(0, 0)).toBe('—');
	});
});

describe('rotuloCustoDaEquipe', () => {
	it('hora extra sai como DRO, a grafia do documento', () => {
		expect(rotuloCustoDaEquipe('hora_extra')).toBe('DRO (H. Extra)');
		expect(ROTULO_TIPO_CUSTO.hora_extra).toBe('DRO (H. Extra)');
	});

	it('diária diz QUAL diária, porque os valores diferem', () => {
		expect(rotuloCustoDaEquipe('diaria', 'estadual')).toBe('Diária estadual');
		expect(rotuloCustoDaEquipe('diaria', 'interestadual')).toBe('Diária interestadual');
	});

	it('diária sem tipo definido cai no rótulo genérico', () => {
		expect(rotuloCustoDaEquipe('diaria', null)).toBe('Diária');
	});

	it('sem custo tem rótulo próprio', () => {
		expect(rotuloCustoDaEquipe('sem_custo')).toBe('Sem custo');
	});
});

describe('meiasDiariasValidas', () => {
	it('aceita de 1 a 30', () => {
		expect(meiasDiariasValidas(1)).toBe(true);
		expect(meiasDiariasValidas(30)).toBe(true);
	});

	it('recusa zero, negativo, acima de 30 e não-inteiro', () => {
		expect(meiasDiariasValidas(0)).toBe(false);
		expect(meiasDiariasValidas(-1)).toBe(false);
		expect(meiasDiariasValidas(31)).toBe(false);
		expect(meiasDiariasValidas(2.5)).toBe(false);
		expect(meiasDiariasValidas('2' as unknown)).toBe(false);
	});
});

describe('formatarDiarias', () => {
	it.each([
		[1, 'meia diária'],
		[2, '1 diária'],
		[3, '1,5 diárias'],
		[4, '2 diárias'],
		[29, '14,5 diárias'],
		[30, '15 diárias']
	])('%d meias → %s', (meias, esperado) => {
		expect(formatarDiarias(meias)).toBe(esperado);
	});

	it('quantidade inválida não inventa texto', () => {
		expect(formatarDiarias(0)).toBe('—');
		expect(formatarDiarias(31)).toBe('—');
	});
});

describe('lerDiarias', () => {
	it('aceita vírgula, que é o que o teclado brasileiro produz', () => {
		expect(lerDiarias('1,5')).toBe(3);
		expect(lerDiarias('0,5')).toBe(1);
		expect(lerDiarias('15')).toBe(30);
	});

	it('aceita ponto também', () => {
		expect(lerDiarias('2.5')).toBe(5);
	});

	it('recusa passo diferente de meia em vez de arredondar', () => {
		// Arredondar em silêncio mudaria o valor pago sem o admin saber.
		expect(lerDiarias('1,3')).toBeNull();
		expect(lerDiarias('0,25')).toBeNull();
	});

	it('recusa fora da faixa concedível', () => {
		expect(lerDiarias('0')).toBeNull();
		expect(lerDiarias('15,5')).toBeNull();
		expect(lerDiarias('-1')).toBeNull();
	});

	it('recusa lixo e vazio', () => {
		expect(lerDiarias('')).toBeNull();
		expect(lerDiarias('  ')).toBeNull();
		expect(lerDiarias('duas')).toBeNull();
	});
});
