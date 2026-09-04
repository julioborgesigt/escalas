/**
 * As regras da tela de escalas, agora testáveis.
 *
 * Nada disto tinha teste antes: viviam em `escalas/+page.svelte`, e componente
 * neste projeto só é exercitado por Playwright — que alcança o que a interface
 * deixa alcançar, e não o caso de borda.
 */

import { describe, it, expect } from 'vitest';
import type { Unidade } from '$lib/types';
import {
	filtrosPadrao,
	temFiltrosAtivos,
	queryDeFiltros,
	delegaciasVisiveis,
	destinoDaEdicao,
	tituloDaLista,
	anosDisponiveis,
	type FiltrosEscalas
} from '../filtros-escalas';

/** Data fixa: o padrão depende do relógio, e teste que o recalcula é tautologia. */
const HOJE = new Date('2026-09-04T12:00:00Z');
const PADRAO = filtrosPadrao(HOJE);

function comFiltros(over: Partial<FiltrosEscalas> = {}): FiltrosEscalas {
	return { ...PADRAO, ...over };
}

describe('filtrosPadrao', () => {
	it('mês e ano são os correntes', () => {
		expect(PADRAO.mes).toBe(9);
		expect(PADRAO.ano).toBe(2026);
	});

	it('é a fonte ÚNICA — o padrão de lotação não diverge mais', () => {
		// Era o bug: `getSavedFilters` usava `''` e `limparFiltros`/`temFiltros`,
		// `'todas'`. Três cópias, uma discordando.
		expect(PADRAO.lotacao).toBe('todas');
	});
});

describe('temFiltrosAtivos', () => {
	it('no padrão, não há filtro ativo', () => {
		expect(temFiltrosAtivos(PADRAO, PADRAO)).toBe(false);
	});

	it('REGRESSÃO: lotação vazia é ausência de filtro, não filtro', () => {
		// O usuário que entrava pela primeira vez (localStorage vazio, sem query)
		// nascia com `lotacao: ''`, e o `'' !== 'todas'` acendia o botão "limpar
		// filtros" numa tela sem filtro nenhum. As duas opções do `<select>` —
		// a vazia e a "Todas as unidades" — significam a mesma coisa.
		expect(temFiltrosAtivos(comFiltros({ lotacao: '' }), PADRAO)).toBe(false);
		expect(temFiltrosAtivos(comFiltros({ lotacao: 'todas' }), PADRAO)).toBe(false);
	});

	it('lotação de verdade acende o botão', () => {
		expect(temFiltrosAtivos(comFiltros({ lotacao: 'DELEGACIA X' }), PADRAO)).toBe(true);
	});

	it('cada eixo acende sozinho', () => {
		expect(temFiltrosAtivos(comFiltros({ seccional: 7 }), PADRAO)).toBe(true);
		expect(temFiltrosAtivos(comFiltros({ mes: 1 }), PADRAO)).toBe(true);
		expect(temFiltrosAtivos(comFiltros({ ano: 2025 }), PADRAO)).toBe(true);
		expect(temFiltrosAtivos(comFiltros({ tipo: 'plantao' }), PADRAO)).toBe(true);
	});

	it('busca e status NÃO contam — é decisão, não esquecimento', () => {
		// A busca some sozinha ao ser apagada; `status` é a PASTA, e o
		// `limparFiltros` a preserva de propósito.
		expect(temFiltrosAtivos(comFiltros({ busca: 'fulano' }), PADRAO)).toBe(false);
		expect(temFiltrosAtivos(comFiltros({ status: 'arquivada' }), PADRAO)).toBe(false);
	});
});

describe('queryDeFiltros', () => {
	it('sentinela NÃO viaja para o servidor', () => {
		// `todas`/`todos` e o zero significam "sem filtro"; mandá-los faria o
		// servidor filtrar por um literal que não existe em coluna nenhuma.
		const q = queryDeFiltros(comFiltros({ lotacao: 'todas', tipo: 'todos', mes: 0, ano: 0 }), 1);
		expect(q.has('lotacao')).toBe(false);
		expect(q.has('tipo')).toBe(false);
		expect(q.has('mes')).toBe(false);
		expect(q.has('ano')).toBe(false);
		expect(q.get('page')).toBe('1');
	});

	it('lotação vazia também não viaja', () => {
		expect(queryDeFiltros(comFiltros({ lotacao: '' }), 1).has('lotacao')).toBe(false);
	});

	it('valores reais viajam', () => {
		const q = queryDeFiltros(
			comFiltros({ lotacao: 'DEL A', tipo: 'plantao', mes: 3, ano: 2026, busca: 'silva' }),
			2
		);
		expect(q.get('lotacao')).toBe('DEL A');
		expect(q.get('tipo')).toBe('plantao');
		expect(q.get('mes')).toBe('3');
		expect(q.get('ano')).toBe('2026');
		expect(q.get('busca')).toBe('silva');
		expect(q.get('page')).toBe('2');
	});

	it('status só viaja nos DOIS valores que a rota entende', () => {
		expect(queryDeFiltros(comFiltros({ status: 'aguardando' }), 1).get('status')).toBe(
			'aguardando'
		);
		expect(queryDeFiltros(comFiltros({ status: 'arquivada' }), 1).get('status')).toBe('arquivada');
		expect(queryDeFiltros(comFiltros({ status: '' }), 1).has('status')).toBe(false);
	});

	it('`seccional` NUNCA viaja — recorta o dropdown, não a consulta', () => {
		expect(queryDeFiltros(comFiltros({ seccional: 7 }), 1).has('seccional')).toBe(false);
	});

	it('a busca preserva caracteres que precisam de escape', () => {
		const q = queryDeFiltros(comFiltros({ busca: 'a&b=c d' }), 1);
		expect(q.get('busca')).toBe('a&b=c d');
		// E o `toString` escapa, em vez de quebrar a query.
		expect(q.toString()).toContain('busca=a%26b%3Dc+d');
	});
});

describe('delegaciasVisiveis', () => {
	const unidades = [
		{ id: 1, nome: 'SEC A', tipo: 'seccional', seccional_id: null },
		{ id: 2, nome: 'DEL A1', tipo: 'delegacia', seccional_id: 1 },
		{ id: 3, nome: 'DEL A2', tipo: 'delegacia', seccional_id: 1 },
		{ id: 4, nome: 'DEL B1', tipo: 'delegacia', seccional_id: 9 }
	] as unknown as Unidade[];

	it('sem seccional escolhida, mostra todas as delegacias — e nenhuma seccional', () => {
		const r = delegaciasVisiveis(unidades, 'todas');
		expect(r.map((u) => u.nome)).toEqual(['DEL A1', 'DEL A2', 'DEL B1']);
	});

	it('com seccional escolhida, mostra só as dela', () => {
		expect(delegaciasVisiveis(unidades, 1).map((u) => u.nome)).toEqual(['DEL A1', 'DEL A2']);
	});

	it('seccional sem delegacia devolve lista vazia, não todas', () => {
		expect(delegaciasVisiveis(unidades, 999)).toEqual([]);
	});
});

describe('destinoDaEdicao', () => {
	it('escala assinada vai para a revogação', () => {
		expect(
			destinoDaEdicao(
				{ id: 1, is_assinada: true },
				{ podeOIPSolicitar: false, temSolicitacao: false }
			)
		).toBe('revogar');
	});

	it('a assinatura GANHA da solicitação pendente — e a ordem é a regra', () => {
		// Se a solicitação viesse antes, quem tem pedido numa escala JÁ ASSINADA
		// cairia no diálogo de solicitação e editaria por baixo de uma assinatura
		// válida.
		expect(
			destinoDaEdicao(
				{ id: 1, is_assinada: true },
				{ podeOIPSolicitar: true, temSolicitacao: true }
			)
		).toBe('revogar');
	});

	it('não assinada, com solicitação e permissão → diálogo de solicitação', () => {
		expect(
			destinoDaEdicao(
				{ id: 1, is_assinada: false },
				{ podeOIPSolicitar: true, temSolicitacao: true }
			)
		).toBe('solicitacao');
	});

	it('sem permissão de solicitar, abre direto mesmo havendo solicitação', () => {
		expect(
			destinoDaEdicao(
				{ id: 1, is_assinada: false },
				{ podeOIPSolicitar: false, temSolicitacao: true }
			)
		).toBe('abrir');
	});

	it('o caso comum abre a escala', () => {
		expect(
			destinoDaEdicao(
				{ id: 1, is_assinada: false },
				{ podeOIPSolicitar: true, temSolicitacao: false }
			)
		).toBe('abrir');
	});

	it('`is_assinada` ausente ou nulo é "não assinada"', () => {
		expect(destinoDaEdicao({ id: 1 }, { podeOIPSolicitar: false, temSolicitacao: false })).toBe(
			'abrir'
		);
		expect(
			destinoDaEdicao(
				{ id: 1, is_assinada: null },
				{ podeOIPSolicitar: false, temSolicitacao: false }
			)
		).toBe('abrir');
	});
});

describe('tituloDaLista', () => {
	it('anuncia a pasta aberta', () => {
		expect(tituloDaLista('arquivada')).toBe('Escalas criadas (arquivo)');
		expect(tituloDaLista('aguardando')).toBe('Escalas aguardando ass');
	});

	it('sem status cai no arquivo — é o destino de quem chega por link', () => {
		expect(tituloDaLista('')).toBe('Arquivo');
	});
});

describe('anosDisponiveis', () => {
	it('abre no ANTERIOR ao corrente e cobre cinco anos, com o zero de "Todos"', () => {
		// Começa no anterior porque escala do ano passado ainda é consultada, e
		// termina depois do corrente para dezembro conseguir criar a do ano que vem.
		expect(anosDisponiveis(HOJE)).toEqual([0, 2025, 2026, 2027, 2028, 2029]);
	});
});
