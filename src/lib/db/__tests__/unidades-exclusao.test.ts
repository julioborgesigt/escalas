/**
 * Bloqueio de exclusão de unidade.
 *
 * O nome da unidade é a chave que amarra lotação de policial e escala, e esses
 * dois vínculos NÃO têm chave estrangeira (herança da planilha que originou o
 * sistema). Apagar a unidade os deixa apontando para um nome inexistente sem
 * erro nenhum do banco — e o RBAC, nesse estado, falha FECHADO: o admin
 * simplesmente perde o escopo, sem mensagem. É o tipo de estrago que ninguém
 * relaciona à exclusão feita semanas antes.
 *
 * A matriz vive aqui, sobre a função PURA, porque é ela que decide. A consulta
 * (`contarVinculosUnidade`) só conta.
 */
import { describe, it, expect } from 'vitest';
import { descreverBloqueioUnidade, type VinculosUnidade } from '../unidades';

const semVinculo: VinculosUnidade = {
	escalas: 0,
	policiaisLotados: 0,
	policiaisComPapel: 0,
	unidadesFilhas: 0,
	gises: 0
};

const com = (v: Partial<VinculosUnidade>): VinculosUnidade => ({ ...semVinculo, ...v });

describe('descreverBloqueioUnidade', () => {
	it('libera a exclusão quando não há nenhum vínculo', () => {
		expect(descreverBloqueioUnidade(semVinculo)).toBeNull();
	});

	describe('bloqueia cada tipo de vínculo isoladamente', () => {
		const casos: Array<[string, Partial<VinculosUnidade>, string]> = [
			['escala', { escalas: 1 }, '1 escala'],
			['servidor lotado', { policiaisLotados: 1 }, '1 servidor lotado'],
			['papel administrativo', { policiaisComPapel: 1 }, '1 servidor com papel administrativo'],
			['unidade subordinada', { unidadesFilhas: 1 }, '1 unidade subordinada'],
			['GISE', { gises: 1 }, '1 GISE']
		];

		for (const [nome, vinculo, trecho] of casos) {
			it(nome, () => {
				const msg = descreverBloqueioUnidade(com(vinculo));
				expect(msg).toContain('Não é possível excluir');
				expect(msg).toContain(trecho);
			});
		}
	});

	it('pluraliza cada vínculo', () => {
		const msg = descreverBloqueioUnidade(
			com({ escalas: 3, policiaisLotados: 2, unidadesFilhas: 4 })
		);
		expect(msg).toContain('3 escalas');
		expect(msg).toContain('2 servidores lotados');
		expect(msg).toContain('4 unidades subordinadas');
	});

	it('lista TODOS os vínculos de uma vez, não só o primeiro', () => {
		// O ponto da mensagem: quem vai desativar a unidade precisa do tamanho do
		// trabalho ANTES de começar. Descobrir uma pendência por tentativa é o que
		// faz alguém parar no meio e deixar a base inconsistente.
		const msg = descreverBloqueioUnidade(
			com({ escalas: 2, policiaisLotados: 5, policiaisComPapel: 1, unidadesFilhas: 3, gises: 4 })
		);
		expect(msg).toContain('2 escalas');
		expect(msg).toContain('5 servidores lotados');
		expect(msg).toContain('1 servidor com papel administrativo');
		expect(msg).toContain('3 unidades subordinadas');
		expect(msg).toContain('4 GISEs');
	});

	it('separa com vírgulas e "e" antes do último', () => {
		expect(descreverBloqueioUnidade(com({ escalas: 1, policiaisLotados: 1 }))).toContain(
			'1 escala e 1 servidor lotado'
		);
		expect(
			descreverBloqueioUnidade(com({ escalas: 1, policiaisLotados: 1, unidadesFilhas: 1 }))
		).toContain('1 escala, 1 servidor lotado e 1 unidade subordinada');
	});

	it('diz o que fazer, não só que falhou', () => {
		expect(descreverBloqueioUnidade(com({ policiaisLotados: 1 }))).toContain(
			'Transfira ou remova esses vínculos antes.'
		);
	});

	it('um vínculo sozinho não é engolido por outro ausente', () => {
		// Regressão do defeito original: a checagem só olhava `escalas.lotacao`,
		// então uma unidade com 40 servidores lotados e nenhuma escala era
		// excluída sem aviso.
		expect(descreverBloqueioUnidade(com({ policiaisLotados: 40 }))).toContain(
			'40 servidores lotados'
		);
	});
});
