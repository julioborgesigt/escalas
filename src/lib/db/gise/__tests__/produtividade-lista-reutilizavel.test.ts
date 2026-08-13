import { describe, it, expect } from 'vitest';
import { buscarRespostasProdutividadeSeccional } from '../respostas';
import { TIPO_LISTA_REUTILIZAVEL } from '../../../gise/tipos-pergunta';
import type { Database } from '../../core';

/**
 * A expansão do detalhe no relatório de produtividade — o caminho que termina
 * num PDF ASSINADO.
 *
 * O risco que estes testes cobrem não dá erro nenhum quando acontece: o
 * formulário grava numa chave, a expansão lê de outra, e o detalhe some do
 * documento em silêncio. Por isso as duas pontas agora saem de `chavesLista`
 * (`$lib/gise/tipos-pergunta`), e é essa combinação que se verifica aqui.
 *
 * O `db` é um duplo mínimo: a função faz exatamente duas consultas, na ordem
 * modelos → respostas.
 */
function dbFake(
	configRows: { tipo: string; config: string }[],
	respostaRows: { equipe_id: number; respostas: string; equipe_tipo: string }[]
): Database {
	let chamada = 0;
	return {
		select: () => {
			chamada += 1;
			const daVez = chamada;
			const chain: Record<string, unknown> = {};
			chain.from = () => chain;
			chain.innerJoin = () => chain;
			chain.where = () => chain;
			chain.all = () => Promise.resolve(daVez === 1 ? configRows : respostaRows);
			return chain;
		}
	} as unknown as Database;
}

const EQUIPE = 7;

function rodar(perguntas: unknown[], respostas: Record<string, unknown>) {
	return buscarRespostasProdutividadeSeccional(
		dbFake(
			[{ tipo: 'operacional', config: JSON.stringify(perguntas) }],
			[{ equipe_id: EQUIPE, respostas: JSON.stringify(respostas), equipe_tipo: 'operacional' }]
		),
		1,
		1
	);
}

describe('relatório de produtividade — lista reutilizável', () => {
	it('expande a lista da pergunta usando a chave derivada da `key`', async () => {
		const linhas = await rodar(
			[{ id: 1, key: 'extra_10', texto: 'Houve prisão?', tipo: TIPO_LISTA_REUTILIZAVEL }],
			{
				extra_10: 'Sim',
				extra_10__qtd: 2,
				extra_10__lista: [
					{ nome: 'Fulano', mandado: '818181' },
					{ nome: 'Beltrano', mandado: '929292' }
				]
			}
		);

		expect(linhas).toEqual([
			{ equipe_id: EQUIPE, pergunta: 'Houve prisão?', resposta: 'Sim' },
			{ equipe_id: EQUIPE, pergunta: '  ↳ Item 1', resposta: 'Fulano - 818181' },
			{ equipe_id: EQUIPE, pergunta: '  ↳ Item 2', resposta: 'Beltrano - 929292' }
		]);
	});

	it('DUAS perguntas do tipo não misturam listas — é o ponto do tipo existir', async () => {
		const linhas = await rodar(
			[
				{ id: 1, key: 'extra_10', texto: 'Prisões?', tipo: TIPO_LISTA_REUTILIZAVEL },
				{ id: 2, key: 'extra_20', texto: 'Apreensões?', tipo: TIPO_LISTA_REUTILIZAVEL }
			],
			{
				extra_10: 'Sim',
				extra_10__lista: [{ nome: 'Fulano', mandado: '111' }],
				extra_20: 'Sim',
				extra_20__lista: [{ nome: 'Sicrano', mandado: '222' }]
			}
		);

		expect(linhas.map((l) => `${l.pergunta}|${l.resposta}`)).toEqual([
			'Prisões?|Sim',
			'  ↳ Item 1|Fulano - 111',
			'Apreensões?|Sim',
			'  ↳ Item 1|Sicrano - 222'
		]);
	});

	it('detalhe só sai sob um "Sim" — igual aos tipos originais', async () => {
		const linhas = await rodar(
			[{ id: 1, key: 'extra_10', texto: 'Houve prisão?', tipo: TIPO_LISTA_REUTILIZAVEL }],
			{
				extra_10: 'Não',
				// O policial marcou Sim, preencheu e voltou para Não: o dado fica no
				// blob, mas o relatório não pode declarar o que a equipe negou.
				extra_10__lista: [{ nome: 'Fulano', mandado: '818181' }]
			}
		);
		expect(linhas).toEqual([{ equipe_id: EQUIPE, pergunta: 'Houve prisão?', resposta: 'Não' }]);
	});

	it('item em branco não vira linha', async () => {
		const linhas = await rodar(
			[{ id: 1, key: 'extra_10', texto: 'Houve prisão?', tipo: TIPO_LISTA_REUTILIZAVEL }],
			{
				extra_10: 'Sim',
				extra_10__lista: [
					{ nome: '', mandado: '' },
					{ nome: 'Fulano', mandado: '1' }
				]
			}
		);
		expect(linhas).toHaveLength(2);
		expect(linhas[1].resposta).toBe('Fulano - 1');
	});

	it('lista ausente ou de tipo inesperado não derruba a geração', async () => {
		const semLista = await rodar(
			[{ id: 1, key: 'extra_10', texto: 'P?', tipo: TIPO_LISTA_REUTILIZAVEL }],
			{ extra_10: 'Sim' }
		);
		expect(semLista).toHaveLength(1);

		const listaTorta = await rodar(
			[{ id: 1, key: 'extra_10', texto: 'P?', tipo: TIPO_LISTA_REUTILIZAVEL }],
			{ extra_10: 'Sim', extra_10__lista: 'nao sou array' }
		);
		expect(listaTorta).toHaveLength(1);
	});

	it('o tipo original continua lendo da chave FIXA (nada regrediu)', async () => {
		const linhas = await rodar(
			[{ id: 1, key: 'prisoes_apreensoes_flagrante', texto: 'Prisões?', tipo: 'prisoes_maiores' }],
			{
				prisoes_apreensoes_flagrante: 'Sim',
				prisoes_lista: [{ nome: 'Fulano', mandado: '818181' }]
			}
		);
		expect(linhas.map((l) => l.pergunta)).toEqual(['Prisões?', '  ↳ Procedimento 1']);
	});
});
