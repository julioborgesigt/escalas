import { describe, it, expect } from 'vitest';
import {
	ITEM_PADRAO,
	TIPOS_COM_FILHOS,
	TIPOS_COM_LISTA,
	TIPO_LISTA_REUTILIZAVEL,
	chavesLista,
	chavesListaComFallback
} from '../tipos-pergunta';

describe('chavesLista', () => {
	it('tipo original devolve a chave FIXA — contrato dos blobs já gravados', () => {
		expect(chavesLista({ tipo: 'prisoes_maiores', key: 'qualquer' })).toEqual({
			qtd: 'prisoes_qtd',
			lista: 'prisoes_lista'
		});
		// A `key` da pergunta é irrelevante para os originais: duas perguntas do
		// mesmo tipo caem na MESMA chave. É por isso que eles são de uso único.
		expect(chavesLista({ tipo: 'prisoes_maiores', key: 'a' })).toEqual(
			chavesLista({ tipo: 'prisoes_maiores', key: 'b' })
		);
	});

	it('tipo reutilizável deriva da `key` — duas perguntas, dois espaços', () => {
		const a = chavesLista({ tipo: TIPO_LISTA_REUTILIZAVEL, key: 'extra_1' });
		const b = chavesLista({ tipo: TIPO_LISTA_REUTILIZAVEL, key: 'extra_2' });
		expect(a).toEqual({ qtd: 'extra_1__qtd', lista: 'extra_1__lista' });
		expect(b).toEqual({ qtd: 'extra_2__qtd', lista: 'extra_2__lista' });
		expect(a).not.toEqual(b);
	});

	it('as chaves derivadas não colidem com as fixas', () => {
		const fixas = TIPOS_COM_LISTA.filter((t) => t !== TIPO_LISTA_REUTILIZAVEL).flatMap((tipo) => {
			const c = chavesLista({ tipo, key: 'x' })!;
			return [c.qtd, c.lista];
		});
		const derivadas = chavesLista({ tipo: TIPO_LISTA_REUTILIZAVEL, key: 'prisoes' })!;
		expect(fixas).not.toContain(derivadas.qtd);
		expect(fixas).not.toContain(derivadas.lista);
	});

	it('tipo sem listagem devolve null', () => {
		expect(chavesLista({ tipo: 'sim_nao', key: 'a' })).toBeNull();
		expect(chavesLista({ tipo: 'texto', key: 'a' })).toBeNull();
	});

	it('o fallback do formulário nunca devolve null', () => {
		expect(chavesListaComFallback({ tipo: 'sim_nao', key: 'a' })).toEqual({
			qtd: 'operacoes_seint_qtd',
			lista: 'operacoes_seint_lista'
		});
	});
});

describe('tabelas de tipo', () => {
	it('todo tipo com lista tem chaves e item padrão', () => {
		for (const tipo of TIPOS_COM_LISTA) {
			expect(chavesLista({ tipo, key: 'k' }), tipo).not.toBeNull();
			expect(ITEM_PADRAO[tipo], tipo).toBeDefined();
		}
	});

	it('todo tipo com lista também aceita sub-pergunta', () => {
		for (const tipo of TIPOS_COM_LISTA) {
			expect(TIPOS_COM_FILHOS, tipo).toContain(tipo);
		}
	});

	it('o item do tipo reutilizável é o par nome + procedimento', () => {
		expect(ITEM_PADRAO[TIPO_LISTA_REUTILIZAVEL]).toEqual({ nome: '', mandado: '' });
	});
});
