/**
 * O cargo do signatário é lista FECHADA, e o servidor é quem fecha.
 *
 * O `<select>` da tela limita a escolha, mas o POST direto não — e este campo
 * sai IMPRESSO sob a assinatura de um documento oficial. Cargo livre vindo do
 * corpo iria ao papel sem passar por revisão nenhuma, que é a mesma razão de o
 * servidor não confiar no `disabled` de um botão.
 *
 * Desde set/2026 a lista é GERADA do departamento (decisão 17 do plano do
 * módulo de diárias) e o órgão vai por extenso (decisão 69).
 */
import { describe, it, expect } from 'vitest';
import { cargosSignatario, cargoSignatarioValido } from '../padroes';

const DPI_SUL = 'Departamento de Polícia do Interior Sul';

describe('cargosSignatario', () => {
	it('gera os três cargos com o órgão POR EXTENSO, nunca pela sigla', () => {
		expect(cargosSignatario(DPI_SUL)).toEqual([
			'Diretor Titular do Departamento de Polícia do Interior Sul',
			'Diretor Adjunto do Departamento de Polícia do Interior Sul',
			'Delegado de Polícia'
		]);
	});

	it('serve outro departamento sem edição de código', () => {
		expect(cargosSignatario('Departamento de Polícia da Capital')[0]).toBe(
			'Diretor Titular do Departamento de Polícia da Capital'
		);
	});

	it('sem departamento, sai sem o órgão — nunca "do " seguido de nada', () => {
		expect(cargosSignatario('')).toEqual([
			'Diretor Titular',
			'Diretor Adjunto',
			'Delegado de Polícia'
		]);
		expect(cargosSignatario('   ')[0]).toBe('Diretor Titular');
	});
});

describe('cargoSignatarioValido', () => {
	const cargos = cargosSignatario(DPI_SUL);

	it('devolve intacto cada um dos cargos da lista', () => {
		for (const cargo of cargos) {
			expect(cargoSignatarioValido(cargo, cargos)).toBe(cargo);
		}
	});

	it('cargo fora da lista cai no primeiro (Titular), em vez de ir para o documento', () => {
		expect(cargoSignatarioValido('Chefe Supremo', cargos)).toBe(cargos[0]);
		expect(cargoSignatarioValido('', cargos)).toBe(cargos[0]);
		// A forma ABREVIADA, que era a lista até a migração 0080, deixou de valer.
		expect(cargoSignatarioValido('Diretor Titular do DPI SUL', cargos)).toBe(cargos[0]);
	});

	it('não casa por prefixo nem ignora caixa — é igualdade exata', () => {
		expect(
			cargoSignatarioValido('diretor titular do departamento de polícia do interior sul', cargos)
		).toBe(cargos[0]);
		expect(cargoSignatarioValido(`${cargos[1]} `, cargos)).toBe(cargos[0]);
	});
});
