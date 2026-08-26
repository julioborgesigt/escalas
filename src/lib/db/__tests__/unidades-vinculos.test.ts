/**
 * Resumo dos vínculos de uma unidade, exibido ao DESATIVAR.
 *
 * Contexto da decisão: unidade não se exclui. `gise_assinaturas_relatorios`
 * referencia `unidades(id)` com `ON DELETE CASCADE` e o D1 aplica FK de
 * verdade — um DELETE levava junto o registro do ato de assinar (nome, CPF,
 * selfie, IP, GPS, hash do arquivo, chave do PDF no R2) e fazia o
 * portal público `/validar` negar um documento já entregue. Escala e lotação,
 * que ligam por NOME e sem FK, ficavam órfãs sem erro nenhum.
 *
 * Por isso esta frase é INFORMAÇÃO, não bloqueio: desativar é sempre permitido,
 * e todos os vínculos continuam válidos depois. O que ela garante é que quem
 * confirma vê o tamanho do que está mexendo — e vê tudo de uma vez, não um item
 * por tentativa.
 */
import { describe, it, expect } from 'vitest';
import { descreverVinculosUnidade, type VinculosUnidade } from '../unidades';

const semVinculo: VinculosUnidade = {
	escalas: 0,
	policiaisLotados: 0,
	policiaisComPapel: 0,
	unidadesFilhas: 0,
	gises: 0
};

const com = (v: Partial<VinculosUnidade>): VinculosUnidade => ({ ...semVinculo, ...v });

describe('descreverVinculosUnidade', () => {
	it('devolve null quando a unidade não tem vínculo nenhum', () => {
		expect(descreverVinculosUnidade(semVinculo)).toBeNull();
	});

	describe('nomeia cada tipo de vínculo isoladamente', () => {
		const casos: Array<[string, Partial<VinculosUnidade>, string]> = [
			['escala', { escalas: 1 }, '1 escala'],
			['servidor lotado', { policiaisLotados: 1 }, '1 servidor lotado'],
			['papel administrativo', { policiaisComPapel: 1 }, '1 servidor com papel administrativo'],
			['unidade subordinada', { unidadesFilhas: 1 }, '1 unidade subordinada'],
			['GISE', { gises: 1 }, '1 GISE']
		];

		for (const [nome, vinculo, trecho] of casos) {
			it(nome, () => {
				expect(descreverVinculosUnidade(com(vinculo))).toBe(trecho);
			});
		}
	});

	it('pluraliza cada vínculo', () => {
		const msg = descreverVinculosUnidade(
			com({ escalas: 3, policiaisLotados: 2, unidadesFilhas: 4 })
		);
		expect(msg).toContain('3 escalas');
		expect(msg).toContain('2 servidores lotados');
		expect(msg).toContain('4 unidades subordinadas');
	});

	it('lista TODOS os vínculos de uma vez, não só o primeiro', () => {
		const msg = descreverVinculosUnidade(
			com({ escalas: 2, policiaisLotados: 5, policiaisComPapel: 1, unidadesFilhas: 3, gises: 4 })
		);
		expect(msg).toContain('2 escalas');
		expect(msg).toContain('5 servidores lotados');
		expect(msg).toContain('1 servidor com papel administrativo');
		expect(msg).toContain('3 unidades subordinadas');
		expect(msg).toContain('4 GISEs');
	});

	it('separa com vírgulas e "e" antes do último', () => {
		expect(descreverVinculosUnidade(com({ escalas: 1, policiaisLotados: 1 }))).toBe(
			'1 escala e 1 servidor lotado'
		);
		expect(
			descreverVinculosUnidade(com({ escalas: 1, policiaisLotados: 1, unidadesFilhas: 1 }))
		).toBe('1 escala, 1 servidor lotado e 1 unidade subordinada');
	});

	it('conta um vínculo isolado mesmo com os outros zerados', () => {
		// A checagem antiga (inline na action de excluir) só olhava `escalas`, então
		// uma unidade com 40 servidores lotados e nenhuma escala passava batido.
		expect(descreverVinculosUnidade(com({ policiaisLotados: 40 }))).toBe('40 servidores lotados');
	});
});
