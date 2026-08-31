import { describe, it, expect } from 'vitest';
import { escolhasDaEquipe } from '../opcoes';

/**
 * O que se prova aqui é a PERDA SILENCIOSA que a função evita.
 *
 * Um `<select>` cujo `value` não está entre os `<option>` não fica vazio: o
 * navegador exibe o primeiro item. Então uma equipe cujo destino saiu da lista
 * abriria mostrando outra cidade, e o "Salvar Alterações" gravaria essa outra —
 * sem erro, sem aviso, e com o Anexo I passando a imprimir o destino errado.
 */
describe('escolhasDaEquipe', () => {
	const LISTA = [{ valor: 'Iguatu' }, { valor: 'Juazeiro do Norte' }];

	it('devolve a lista do plano quando a equipe não tem valor próprio', () => {
		expect(escolhasDaEquipe(LISTA, null)).toEqual(['Iguatu', 'Juazeiro do Norte']);
		expect(escolhasDaEquipe(LISTA, '')).toEqual(['Iguatu', 'Juazeiro do Norte']);
		expect(escolhasDaEquipe(LISTA, '   ')).toEqual(['Iguatu', 'Juazeiro do Norte']);
	});

	it('não duplica o valor que já está na lista', () => {
		expect(escolhasDaEquipe(LISTA, 'Iguatu')).toEqual(['Iguatu', 'Juazeiro do Norte']);
	});

	it('acrescenta À FRENTE o valor da equipe que saiu da lista', () => {
		expect(escolhasDaEquipe(LISTA, 'Icó')).toEqual(['Icó', 'Iguatu', 'Juazeiro do Norte']);
	});

	it('aceita lista vazia, preservando o que a equipe tem', () => {
		expect(escolhasDaEquipe([], 'Icó')).toEqual(['Icó']);
		expect(escolhasDaEquipe([], null)).toEqual([]);
	});

	it('compara pelo valor APARADO, mas devolve o aparado — não o original', () => {
		// A coluna pode ter espaço de digitação; o `<option>` tem de casar com o
		// que o `bind:value` do seletor recebe, que é o texto limpo.
		expect(escolhasDaEquipe(LISTA, '  Iguatu  ')).toEqual(['Iguatu', 'Juazeiro do Norte']);
		expect(escolhasDaEquipe(LISTA, '  Icó  ')).toEqual(['Icó', 'Iguatu', 'Juazeiro do Norte']);
	});
});
