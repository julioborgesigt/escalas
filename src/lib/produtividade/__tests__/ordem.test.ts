/**
 * A ordem dos cards do painel — e, sobretudo, o que acontece com o card que a
 * ordem salva NÃO menciona.
 *
 * O pedido que originou o módulo é negativo: "a pergunta nova não pode aparecer
 * no topo". Marcar uma pergunta como gráfico depois de o painel ter sido
 * organizado é o caso comum, não a exceção — o formulário ganha campo o tempo
 * todo —, e é o caso que os testes daqui cercam por todos os lados.
 */
import { describe, it, expect } from 'vitest';
import {
	lerOrdemPainel,
	ordenarCardsDoPainel,
	moverNaLista,
	idCardColunas,
	idCardRanking,
	idCardDetalhe,
	idCardIndicador
} from '../ordem';

/** Um card mínimo: só o id importa para a ordenação. */
const card = (id: string) => ({ id });
const ids = (cards: Array<{ id: string }>) => cards.map((c) => c.id);
const porId = (c: { id: string }) => c.id;

describe('lerOrdemPainel', () => {
	it('lê o array salvo', () => {
		expect(lerOrdemPainel('["b","a"]')).toEqual(['b', 'a']);
	});

	it('NULL é ordem do formulário, não erro', () => {
		// É o estado de toda linha anterior à migração 0064.
		expect(lerOrdemPainel(null)).toEqual([]);
		expect(lerOrdemPainel(undefined)).toEqual([]);
		expect(lerOrdemPainel('')).toEqual([]);
	});

	it('JSON inválido cai na ordem do formulário em vez de estourar', () => {
		// O blob é escrito por uma versão do app e lido por outra: painel na ordem
		// antiga é melhor que painel que não abre.
		expect(lerOrdemPainel('{')).toEqual([]);
		expect(lerOrdemPainel('null')).toEqual([]);
		expect(lerOrdemPainel('{"a":1}')).toEqual([]);
		expect(lerOrdemPainel('"rank-q1"')).toEqual([]);
	});

	it('descarta entrada não-string sem descartar a lista', () => {
		expect(lerOrdemPainel('["a",7,null,"b"]')).toEqual(['a', 'b']);
	});
});

describe('ordenarCardsDoPainel', () => {
	it('sem ordem salva, mantém a ordem do formulário', () => {
		const cards = [card('a'), card('b'), card('c')];
		expect(ids(ordenarCardsDoPainel(cards, [], porId))).toEqual(['a', 'b', 'c']);
	});

	it('aplica a ordem salva', () => {
		const cards = [card('a'), card('b'), card('c')];
		expect(ids(ordenarCardsDoPainel(cards, ['c', 'a', 'b'], porId))).toEqual(['c', 'a', 'b']);
	});

	it('card fora da ordem salva vai para o FIM', () => {
		// A pergunta marcada como gráfico DEPOIS da última organização. Era isto que
		// aparecia no topo antes do módulo existir.
		const cards = [card('novo'), card('a'), card('b')];
		expect(ids(ordenarCardsDoPainel(cards, ['b', 'a'], porId))).toEqual(['b', 'a', 'novo']);
	});

	it('vários cards novos entram no fim na ordem do formulário', () => {
		const cards = [card('n1'), card('a'), card('n2')];
		expect(ids(ordenarCardsDoPainel(cards, ['a'], porId))).toEqual(['a', 'n1', 'n2']);
	});

	it('id órfão na ordem salva não vira card', () => {
		// A pergunta foi desmarcada no editor: o id ficou na lista e o card não
		// existe mais. A ordenação percorre os CARDS, nunca a lista.
		const cards = [card('a'), card('b')];
		expect(ids(ordenarCardsDoPainel(cards, ['sumiu', 'b', 'tambem-sumiu', 'a'], porId))).toEqual([
			'b',
			'a'
		]);
	});

	it('id repetido na lista vale pela PRIMEIRA posição', () => {
		// Um blob escrito à mão pode repetir; a segunda ocorrência decidiria e o
		// card saltaria para o fim sem nada explicando.
		const cards = [card('a'), card('b')];
		expect(ids(ordenarCardsDoPainel(cards, ['a', 'b', 'a'], porId))).toEqual(['a', 'b']);
	});

	it('não muta a lista recebida', () => {
		// O painel chama isto a cada recálculo de `$derived`, sobre a lista que
		// outro derivado produziu.
		const cards = [card('a'), card('b'), card('c')];
		ordenarCardsDoPainel(cards, ['c', 'b', 'a'], porId);
		expect(ids(cards)).toEqual(['a', 'b', 'c']);
	});

	it('ids de outras seções na mesma lista não atrapalham', () => {
		// A ordem salva é UMA lista para as três seções; cada uma pergunta a
		// posição dos seus ids e ignora o resto.
		const colunas = [card('7'), card('3')];
		const ordem = ['ind-acervo', 'rank-q3', '3', 'det-q3', '7'];
		expect(ids(ordenarCardsDoPainel(colunas, ordem, porId))).toEqual(['3', '7']);
	});
});

describe('ids de card', () => {
	it('as três formas da mesma pergunta têm ids diferentes', () => {
		// Sem os prefixos, marcar o ranking marcaria o detalhamento junto — na
		// ordenação e na seleção de exportação, que usam o mesmo vocabulário.
		const formas = [idCardColunas(7), idCardRanking(7), idCardDetalhe(7)];
		expect(new Set(formas).size).toBe(3);
		expect(formas).toEqual(['7', 'rank-q7', 'det-q7']);
	});

	it('o card de colunas se identifica pelo id da pergunta, em texto', () => {
		// É o mesmo id que a seleção de exportação guarda (lá, número).
		expect(idCardColunas(12)).toBe('12');
	});

	it('indicador é pela key, que é como os dois modelos o unificam', () => {
		expect(idCardIndicador('acervo_ip')).toBe('ind-acervo_ip');
	});
});

describe('moverNaLista', () => {
	it('move para frente e para trás', () => {
		expect(moverNaLista(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
		expect(moverNaLista(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
	});

	it('índice fora da lista devolve a lista intacta', () => {
		// O alvo do arraste vem do DOM: um `drop` fora de card nenhum chega como -1.
		expect(moverNaLista(['a', 'b'], -1, 0)).toEqual(['a', 'b']);
		expect(moverNaLista(['a', 'b'], 0, 9)).toEqual(['a', 'b']);
		expect(moverNaLista(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
	});

	it('não muta a lista recebida', () => {
		const lista = ['a', 'b', 'c'];
		moverNaLista(lista, 0, 2);
		expect(lista).toEqual(['a', 'b', 'c']);
	});
});
