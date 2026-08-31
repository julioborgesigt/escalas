/**
 * O cargo do signatário é lista FECHADA, e o servidor é quem fecha.
 *
 * O `<select>` da tela limita a escolha, mas o POST direto não — e este campo
 * sai IMPRESSO sob a assinatura de um documento oficial. Cargo livre vindo do
 * corpo iria ao papel sem passar por revisão nenhuma, que é a mesma razão de o
 * servidor não confiar no `disabled` de um botão.
 */
import { describe, it, expect } from 'vitest';
import { CARGOS_SIGNATARIO, CARGO_SIGNATARIO_PADRAO, cargoSignatarioValido } from '../padroes';

describe('cargoSignatarioValido', () => {
	it('devolve intacto cada um dos cargos da lista', () => {
		for (const cargo of CARGOS_SIGNATARIO) {
			expect(cargoSignatarioValido(cargo)).toBe(cargo);
		}
	});

	it('cargo fora da lista cai no padrão, em vez de ir para o documento', () => {
		expect(cargoSignatarioValido('Chefe Supremo')).toBe(CARGO_SIGNATARIO_PADRAO);
		expect(cargoSignatarioValido('')).toBe(CARGO_SIGNATARIO_PADRAO);
		// O caso que motiva a função: o cargo por extenso que era o padrão antigo.
		expect(
			cargoSignatarioValido('Diretor Titular do Departamento de Polícia do Interior Sul')
		).toBe(CARGO_SIGNATARIO_PADRAO);
	});

	it('não casa por prefixo nem ignora caixa — é igualdade exata', () => {
		expect(cargoSignatarioValido('diretor titular do dpi sul')).toBe(CARGO_SIGNATARIO_PADRAO);
		expect(cargoSignatarioValido('Diretor Titular do DPI SUL ')).toBe(CARGO_SIGNATARIO_PADRAO);
	});
});
