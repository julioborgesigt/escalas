/**
 * O que entra no painel de produtividade — e, sobretudo, o que NÃO entra.
 *
 * O caso que motivou o módulo é o negativo: até ago/2026 toda pergunta de tipo
 * contável virava gráfico sozinha, e a quilometragem inicial da viatura ocupava
 * um card ao lado das prisões. Não havia como tirá-la sem apagar o campo do
 * formulário — o que apagaria a coleta junto.
 *
 * O outro negativo, e o pior deles: os três blocos fixos (prisões, drogas,
 * armas) apareciam SEMPRE. Numa operação cujo formulário nunca teve pergunta de
 * droga, a tela exibia "Ranking de Drogas" zerado — afirmando "nenhuma
 * apreensão" sobre uma pergunta que ninguém fez.
 */
import { describe, it, expect } from 'vitest';
import { mapQuestions, getArmasKey, blocosFixosDisponiveis } from '../questions';

describe('mapQuestions', () => {
	it('só devolve a pergunta MARCADA como gráfico', () => {
		const questoes = mapQuestions([
			{ id: 2, texto: '2. KM INICIAL', tipo: 'numero', key: 'km_inicial' },
			{ id: 7, texto: '7. PRISÕES', tipo: 'select_99', key: 'prisoes', grafico: true }
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

	it('marca em tipo que NÃO comporta gráfico é descartada', () => {
		// O admin marcou a pergunta e depois trocou o tipo para texto livre. A marca
		// fica no JSON; somar prosa é que não dá.
		expect(
			mapQuestions([{ id: 1, texto: 'Resumo', tipo: 'textarea', key: 'descricao', grafico: true }])
		).toEqual([]);
	});

	it('desce nos filhos — sub-pergunta marcada também entra', () => {
		const questoes = mapQuestions([
			{
				id: 4,
				texto: '4. FLAGRANTE?',
				tipo: 'prisoes_maiores',
				key: 'flagrante_bool',
				filhos: [{ id: 41, texto: 'Quantos?', tipo: 'numero', key: 'flagrante_qtd', grafico: true }]
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
				grafico: true
			}
		]);

		expect(q.key).toBe('apreensao_celulares');
		// Ler por `key` daria gráfico zerado sem erro nenhum.
		expect(q.mappedKey).toBe('celulares_qtd');
	});

	it('`sim_nao` vira contagem de ocorrências', () => {
		const [q] = mapQuestions([
			{ id: 8, texto: 'Tentativa?', tipo: 'sim_nao', key: 'tentativa', grafico: true }
		]);
		expect(q.isBool).toBe(true);
	});

	it('cores são estáveis pela posição entre as MARCADAS', () => {
		// Duas perguntas marcadas com uma desmarcada no meio recebem a 1ª e a 2ª cor:
		// a posição que conta é a da lista final, não a do formulário.
		const questoes = mapQuestions([
			{ id: 1, texto: 'a', tipo: 'numero', key: 'a', grafico: true },
			{ id: 2, texto: 'b', tipo: 'numero', key: 'b' },
			{ id: 3, texto: 'c', tipo: 'numero', key: 'c', grafico: true }
		]);
		expect(questoes).toHaveLength(2);
		expect(questoes[0].color).not.toBe(questoes[1].color);
	});

	it('modelo vazio ou ausente devolve lista vazia', () => {
		expect(mapQuestions([])).toEqual([]);
		expect(mapQuestions(null)).toEqual([]);
		expect(mapQuestions(undefined)).toEqual([]);
	});
});

describe('blocosFixosDisponiveis', () => {
	it('libera cada bloco pelo TIPO que o alimenta', () => {
		expect(
			blocosFixosDisponiveis([
				{ id: 4, texto: 'Flagrante', tipo: 'prisoes_maiores', key: 'f' },
				{ id: 10, texto: 'Drogas', tipo: 'drogas_complex', key: 'd' },
				{ id: 11, texto: 'Armas', tipo: 'armas_complex', key: 'a' }
			])
		).toEqual({ prisoes: true, drogas: true, armas: true });
	});

	it('formulário SEM essas perguntas não libera bloco nenhum', () => {
		// O caso do bug: operação nova, formulário só com perguntas próprias. Antes,
		// os seis cards apareciam zerados e apagar o campo não os removia.
		expect(
			blocosFixosDisponiveis([
				{ id: 1, texto: 'Atendimentos', tipo: 'numero', key: 'atend', grafico: true }
			])
		).toEqual({ prisoes: false, drogas: false, armas: false });
	});

	it('só mandados já libera o bloco de prisões', () => {
		// O card soma flagrantes E mandados; um formulário pode ter só um dos dois.
		expect(
			blocosFixosDisponiveis([{ id: 5, texto: 'Mandados', tipo: 'mandados_maiores', key: 'm' }])
		).toMatchObject({ prisoes: true, drogas: false });
	});

	it('a marca de gráfico não interfere — aqui o que conta é a PRESENÇA', () => {
		// Desmarcar a pergunta de drogas como gráfico não tira o bloco de detalhe:
		// são leituras diferentes da mesma coleta.
		expect(
			blocosFixosDisponiveis([{ id: 10, texto: 'Drogas', tipo: 'drogas_complex', key: 'd' }]).drogas
		).toBe(true);
	});

	it('modelo vazio ou ausente não libera nada', () => {
		expect(blocosFixosDisponiveis(null)).toEqual({ prisoes: false, drogas: false, armas: false });
		expect(blocosFixosDisponiveis([])).toEqual({ prisoes: false, drogas: false, armas: false });
	});
});

describe('getArmasKey', () => {
	it('lê a chave do modelo quando há pergunta de armas', () => {
		expect(
			getArmasKey([{ id: 11, texto: 'Armas', tipo: 'armas_complex', key: 'apreendeu_arma' }])
		).toBe('apreendeu_arma');
	});

	it('cai na chave histórica quando não há', () => {
		expect(getArmasKey([])).toBe('apreensoes_armas_bool');
	});
});
