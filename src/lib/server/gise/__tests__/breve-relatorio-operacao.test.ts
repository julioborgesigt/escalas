/**
 * Herança dos textos do breve relatório: operação → global → constante do código.
 *
 * Estes textos vão dentro de um PDF que alguém ASSINA. A falha que estes testes
 * impedem é silenciosa: um parágrafo do sistema saindo no relatório da CRAJUBAR
 * porque a sobrescrita dela não foi lida — o documento fica bonito, assinável e
 * dizendo a coisa errada.
 *
 * A cadeia completa tem quatro níveis; aqui ficam os dois do meio (operação e
 * global). O nível da escala (`gise_escalas.breve_relatorio_*`) e a constante
 * final são responsabilidade de `resolveBreveRelatorio*`, testada à parte.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import type { DatabaseSync } from 'node:sqlite';
import { getBreveRelatorioEnvMergido } from '../breve-relatorio-env';
import type { Database } from '$lib/db';

let sqlite: DatabaseSync;
let db: Database;
let crajubar: number;
let gise: number;

function definirGlobal(chave: string, valor: string) {
	sqlite
		.prepare(
			`INSERT INTO configuracoes (chave, valor) VALUES (?, ?)
			 ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`
		)
		.run(chave, valor);
}

function definirNaOperacao(id: number, coluna: string, valor: string | null) {
	sqlite.prepare(`UPDATE operacoes SET ${coluna} = ? WHERE id = ?`).run(valor, id);
}

function idPorNome(nome: string): number {
	return Number(
		(sqlite.prepare(`SELECT id FROM operacoes WHERE nome = ?`).get(nome) as { id: number }).id
	);
}

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	crajubar = idPorNome('OPERAÇÃO CRAJUBAR');
	gise = idPorNome('GISE');
});

describe('sem nada configurado', () => {
	it('devolve tudo indefinido, para o resolvedor cair na constante do código', async () => {
		expect(await getBreveRelatorioEnvMergido(db, null)).toEqual({
			GISE_BREVE_RELATORIO_TITULO: undefined,
			GISE_BREVE_RELATORIO_TEXTO_SECCIONAL: undefined,
			GISE_BREVE_RELATORIO_TEXTO_SUPERVISAO: undefined
		});
	});
});

describe('herança do global', () => {
	it('operação sem sobrescrita herda o texto global', async () => {
		definirGlobal('gise_breve_relatorio_titulo', 'RELATÓRIO GERAL:');
		const env = await getBreveRelatorioEnvMergido(db, crajubar);
		expect(env.GISE_BREVE_RELATORIO_TITULO).toBe('RELATÓRIO GERAL:');
	});

	it('`operacaoId` nulo lê só o global', async () => {
		definirGlobal('gise_breve_relatorio_titulo', 'GERAL');
		definirNaOperacao(crajubar, 'breve_relatorio_titulo', 'DA CRAJUBAR');
		expect((await getBreveRelatorioEnvMergido(db, null)).GISE_BREVE_RELATORIO_TITULO).toBe('GERAL');
	});
});

describe('sobrescrita da operação', () => {
	it('o texto da operação ganha do global', async () => {
		definirGlobal('gise_breve_relatorio_texto_seccional', 'TEXTO DO SISTEMA');
		definirNaOperacao(crajubar, 'breve_relatorio_texto_seccional', 'TEXTO DA FORÇA TAREFA');

		const env = await getBreveRelatorioEnvMergido(db, crajubar);
		expect(env.GISE_BREVE_RELATORIO_TEXTO_SECCIONAL).toBe('TEXTO DA FORÇA TAREFA');
	});

	it('a herança é POR CAMPO', async () => {
		definirGlobal('gise_breve_relatorio_titulo', 'TÍTULO GLOBAL');
		definirGlobal('gise_breve_relatorio_texto_supervisao', 'SUPERVISÃO GLOBAL');
		definirNaOperacao(crajubar, 'breve_relatorio_titulo', 'TÍTULO CRAJUBAR');

		const env = await getBreveRelatorioEnvMergido(db, crajubar);
		expect(env.GISE_BREVE_RELATORIO_TITULO).toBe('TÍTULO CRAJUBAR');
		expect(env.GISE_BREVE_RELATORIO_TEXTO_SUPERVISAO).toBe('SUPERVISÃO GLOBAL');
	});

	it('string vazia na operação NÃO sobrescreve — vazio é ausência de texto', async () => {
		// A tela grava NULL para "herda"; um `''` que sobrasse no banco não pode
		// apagar o parágrafo do PDF em silêncio.
		definirGlobal('gise_breve_relatorio_titulo', 'TÍTULO GLOBAL');
		definirNaOperacao(crajubar, 'breve_relatorio_titulo', '   ');

		expect((await getBreveRelatorioEnvMergido(db, crajubar)).GISE_BREVE_RELATORIO_TITULO).toBe(
			'TÍTULO GLOBAL'
		);
	});

	it('operações diferentes não se contaminam', async () => {
		definirNaOperacao(crajubar, 'breve_relatorio_titulo', 'CRAJUBAR');
		definirNaOperacao(gise, 'breve_relatorio_titulo', 'GISE');

		expect((await getBreveRelatorioEnvMergido(db, crajubar)).GISE_BREVE_RELATORIO_TITULO).toBe(
			'CRAJUBAR'
		);
		expect((await getBreveRelatorioEnvMergido(db, gise)).GISE_BREVE_RELATORIO_TITULO).toBe('GISE');
	});

	it('id inexistente cai no global, sem lançar', async () => {
		definirGlobal('gise_breve_relatorio_titulo', 'GLOBAL');
		expect((await getBreveRelatorioEnvMergido(db, 999999)).GISE_BREVE_RELATORIO_TITULO).toBe(
			'GLOBAL'
		);
	});
});
