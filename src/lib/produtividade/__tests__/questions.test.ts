/**
 * O que entra no painel de produtividade, em que FORMA — e, sobretudo, o que NÃO
 * entra.
 *
 * Os dois bugs que motivaram o módulo são negativos. Até ago/2026 toda pergunta
 * de tipo contável virava gráfico sozinha, e a quilometragem inicial da viatura
 * ocupava um card ao lado das prisões; não havia como tirá-la sem apagar o campo
 * do formulário, o que apagaria a coleta junto. E os blocos fixos (prisões,
 * drogas, armas) apareciam SEMPRE: numa operação cujo formulário nunca teve
 * pergunta de droga, a tela exibia "Ranking de Drogas" zerado — afirmando
 * "nenhuma apreensão" sobre uma pergunta que ninguém fez.
 */
import { describe, it, expect } from 'vitest';
import { mapQuestions, temBlocoPrisoes } from '../questions';

/** Só colunas — a forma que a migração 0053/0054 carimbou no que já era gráfico. */
const COLUNAS = { colunas: true };

describe('mapQuestions', () => {
	it('só devolve a pergunta MARCADA', () => {
		const questoes = mapQuestions([
			{ id: 2, texto: '2. KM INICIAL', tipo: 'numero', key: 'km_inicial' },
			{ id: 7, texto: '7. PRISÕES', tipo: 'select_99', key: 'prisoes', grafico: COLUNAS }
		]);

		expect(questoes.map((q) => q.key)).toEqual(['prisoes']);
	});

	it('modelo inteiro sem marca nenhuma devolve lista vazia', () => {
		// É o estado de um formulário novo: coletar não é o mesmo que acompanhar.
		expect(
			mapQuestions([
				{ id: 1, texto: 'a', tipo: 'numero', key: 'a' },
				{ id: 2, texto: 'b', tipo: 'sim_nao', key: 'b' }
			])
		).toEqual([]);
	});

	it('marca com todas as formas desligadas não gera card', () => {
		// O editor apaga a chave ao desligar a última forma, mas um `{}` gravado por
		// outra via não pode virar um card sem forma nenhuma.
		expect(mapQuestions([{ id: 1, texto: 'a', tipo: 'numero', key: 'a', grafico: {} }])).toEqual(
			[]
		);
	});

	it('marca em tipo que NÃO comporta gráfico é descartada', () => {
		// O admin marcou a pergunta e depois trocou o tipo para texto livre. A marca
		// fica no JSON; somar prosa é que não dá.
		expect(
			mapQuestions([
				{ id: 1, texto: 'Resumo', tipo: 'textarea', key: 'descricao', grafico: COLUNAS }
			])
		).toEqual([]);
	});

	it('as três formas acumulam na mesma pergunta', () => {
		const [q] = mapQuestions([
			{
				id: 10,
				texto: 'DROGAS',
				tipo: 'drogas_complex',
				key: 'apreensoes_drogas',
				grafico: { colunas: true, ranking: true, detalhe: true }
			}
		]);

		expect(q.formas).toEqual({ colunas: true, ranking: true, detalhe: true });
	});

	it('`detalhe` é descartada no tipo que não guarda quebra por categoria', () => {
		// Uma pergunta de número tem um valor só — o "detalhamento" dela seria um
		// card de uma barra.
		const [q] = mapQuestions([
			{
				id: 1,
				texto: 'Atendimentos',
				tipo: 'numero',
				key: 'atend',
				grafico: { colunas: true, detalhe: true }
			}
		]);

		expect(q.formas.detalhe).toBe(false);
		expect(q.formas.colunas).toBe(true);
	});

	it('pergunta que SÓ pedia detalhamento inválido sai do painel inteira', () => {
		// Sem forma nenhuma sobrando, ela não é uma pergunta do painel — e um card
		// vazio seria pior que card nenhum.
		expect(
			mapQuestions([{ id: 1, texto: 'x', tipo: 'numero', key: 'x', grafico: { detalhe: true } }])
		).toEqual([]);
	});

	it('aceita a marca ANTIGA (booleano) como colunas', () => {
		// É o formato entre as migrações 0053 e 0054, que a 0054 não alcança dentro
		// dos `filhos`. Sem esta compatibilidade a sub-pergunta sumiria do painel.
		const [q] = mapQuestions([
			{ id: 1, texto: 'a', tipo: 'numero', key: 'a', grafico: true as unknown as { colunas: true } }
		]);
		expect(q.formas).toEqual({ colunas: true, ranking: false, detalhe: false });
	});

	it('desce nos filhos — sub-pergunta marcada também entra', () => {
		const questoes = mapQuestions([
			{
				id: 4,
				texto: '4. FLAGRANTE?',
				tipo: 'prisoes_maiores',
				key: 'flagrante_bool',
				filhos: [
					{ id: 41, texto: 'Quantos?', tipo: 'numero', key: 'flagrante_qtd', grafico: COLUNAS }
				]
			}
		]);

		// O pai não entra (tipo de lista não é graficável); o filho marcado, sim.
		expect(questoes.map((q) => q.key)).toEqual(['flagrante_qtd']);
	});

	it('traduz a chave dos tipos compostos — a resposta não mora em `key`', () => {
		const [q] = mapQuestions([
			{
				id: 1,
				texto: 'Celulares',
				tipo: 'celulares_complex',
				key: 'apreensao_celulares',
				grafico: COLUNAS
			}
		]);

		expect(q.key).toBe('apreensao_celulares');
		// Ler por `key` daria gráfico zerado sem erro nenhum.
		expect(q.mappedKey).toBe('celulares_qtd');
	});

	it('preserva a identidade de drogas e armas nos cards', () => {
		// Sem isto, "Ranking de Drogas" viraria o texto cru da pergunta e o peso
		// apareceria em gramas.
		const [drogas, armas] = mapQuestions([
			{
				id: 10,
				texto: '10. HOUVE APREENSÃO DE DROGAS?',
				tipo: 'drogas_complex',
				key: 'apreensoes_drogas',
				grafico: { ranking: true }
			},
			{
				id: 11,
				texto: '11. HOUVE APREENSÃO DE ARMAS/MUNIÇÕES?',
				tipo: 'armas_complex',
				key: 'apreensoes_armas_bool',
				grafico: { ranking: true }
			}
		]);

		expect(drogas.titulo).toBe('Drogas');
		expect(drogas.unidade).toBe('g');
		expect(armas.titulo).toBe('Armas');
		expect(armas.unidade).toBe('');
	});

	it('pergunta comum usa o próprio texto como título', () => {
		const [q] = mapQuestions([
			{ id: 1, texto: 'ATENDIMENTOS', tipo: 'numero', key: 'a', grafico: COLUNAS }
		]);
		expect(q.titulo).toBe('ATENDIMENTOS');
		expect(q.unidade).toBe('');
	});

	it('modelo vazio ou ausente devolve lista vazia', () => {
		expect(mapQuestions([])).toEqual([]);
		expect(mapQuestions(null)).toEqual([]);
		expect(mapQuestions(undefined)).toEqual([]);
	});
});

describe('temBlocoPrisoes', () => {
	it('libera pelo TIPO que alimenta o bloco', () => {
		expect(
			temBlocoPrisoes([{ id: 4, texto: 'Flagrante', tipo: 'prisoes_maiores', key: 'f' }])
		).toBe(true);
	});

	it('só mandados já libera — o card soma os dois', () => {
		expect(
			temBlocoPrisoes([{ id: 5, texto: 'Mandados', tipo: 'mandados_maiores', key: 'm' }])
		).toBe(true);
	});

	it('formulário SEM essas perguntas não libera o bloco', () => {
		// O caso do bug: operação nova, formulário só com perguntas próprias. Antes,
		// os dois cards apareciam zerados e apagar o campo não os removia.
		expect(
			temBlocoPrisoes([
				{ id: 1, texto: 'Atendimentos', tipo: 'numero', key: 'atend', grafico: COLUNAS }
			])
		).toBe(false);
	});

	it('droga e arma NÃO liberam nada aqui — elas viraram marcação', () => {
		// A conversão da 0054: os dois blocos saíram do código e viraram formas da
		// pergunta. Só prisões sobrou fixo, porque atravessa três perguntas.
		expect(
			temBlocoPrisoes([
				{ id: 10, texto: 'Drogas', tipo: 'drogas_complex', key: 'd' },
				{ id: 11, texto: 'Armas', tipo: 'armas_complex', key: 'a' }
			])
		).toBe(false);
	});

	it('modelo vazio ou ausente não libera nada', () => {
		expect(temBlocoPrisoes(null)).toBe(false);
		expect(temBlocoPrisoes([])).toBe(false);
	});
});
