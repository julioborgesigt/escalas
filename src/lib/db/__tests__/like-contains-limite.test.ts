/**
 * O limite de padrão `LIKE` do D1 (50 caracteres) transformava busca longa em
 * 500 — `LIKE or GLOB pattern too complex: SQLITE_ERROR`.
 *
 * Quem disparava não era o usuário digitando: o `SearchableSelect` reescreve no
 * campo o rótulo do item escolhido, e o eco vira uma busca de 50+ caracteres.
 *
 * O `node:sqlite` daqui é compilado com o limite padrão (50 000), então ele NÃO
 * reproduz o erro do D1 — o que ele prova é o que importa depois da troca de
 * forma: que `instr(lower(...))` devolve exatamente as mesmas linhas que o
 * `LIKE` devolveria. Se as duas divergissem, a correção do 500 teria trocado
 * uma falha barulhenta por um resultado errado.
 */
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { likeContains } from '../core';
import { sql } from 'drizzle-orm';

/** Renderiza o `SQL` do Drizzle em `{ texto, params }` prontos para o sqlite. */
function render(fragmento: ReturnType<typeof likeContains>) {
	const q = sql`SELECT n FROM t WHERE ${fragmento} ORDER BY n`;
	// `toQuery` com dialeto sqlite: `?` posicionais, que é o que o D1 recebe.
	const { sql: texto, params } = q.toQuery({
		escapeName: (n) => `"${n}"`,
		escapeParam: () => '?',
		escapeString: (s) => `'${s.replace(/'/g, "''")}'`,
		casing: { cache: {}, cachedTables: {}, convert: (c: unknown) => String(c) } as never
	});
	return { texto, params: params as string[] };
}

const LINHAS = [
	'FRANCISCO ALEX FELINTO DE LUCENA',
	'francisco alex felinto de lucena',
	'MARIA DE FATIMA SOUSA LIMA',
	'ANTONIO CARLOS DE SOUSA FILHO E MAIS UM NOME BEM COMPRIDO',
	'100% DE DESCONTO NA PRIMEIRA COMPRA DE VERAO DO ANO',
	''
];

function banco() {
	const db = new DatabaseSync(':memory:');
	db.exec('CREATE TABLE t (n TEXT);');
	const ins = db.prepare('INSERT INTO t VALUES (?)');
	for (const l of LINHAS) ins.run(l);
	return db;
}

function buscar(termo: string): string[] {
	const db = banco();
	const { texto, params } = render(likeContains(sql.raw('n'), termo));
	return (db.prepare(texto).all(...params) as { n: string }[]).map((r) => r.n);
}

/** A forma antiga, para comparar linha a linha com a nova. */
function buscarComoLikeSempre(termo: string): string[] {
	const db = banco();
	const padrao = '%' + termo.replace(/[%_\\]/g, '\\$&') + '%';
	return (
		db.prepare(`SELECT n FROM t WHERE n LIKE ? ESCAPE '\\' ORDER BY n`).all(padrao) as {
			n: string;
		}[]
	).map((r) => r.n);
}

describe('likeContains e o limite de padrão do D1', () => {
	it('termo curto continua saindo como LIKE ... ESCAPE', () => {
		const { texto } = render(likeContains(sql.raw('n'), 'FRANCISCO'));
		expect(texto).toContain('LIKE');
		expect(texto).toContain("ESCAPE '\\'");
		expect(texto).not.toContain('instr');
	});

	it('termo que estoura o limite sai como instr, não como LIKE', () => {
		// 52 caracteres: o rótulo que o SearchableSelect devolve ao campo.
		const rotulo = 'FRANCISCO ALEX FELINTO DE LUCENA — OIP Mat. 30010124';
		expect(rotulo.length).toBeGreaterThan(48);
		const { texto } = render(likeContains(sql.raw('n'), rotulo));
		expect(texto).toContain('instr(lower(n), lower(?))');
		expect(texto).not.toContain('LIKE');
	});

	it('a fronteira é o PADRÃO de 50, não o termo: 48 ainda é LIKE, 49 já é instr', () => {
		expect(render(likeContains(sql.raw('n'), 'A'.repeat(48))).texto).toContain('LIKE');
		expect(render(likeContains(sql.raw('n'), 'A'.repeat(49))).texto).toContain('instr');
	});

	it('escapeLike conta para a fronteira — % ocupa dois caracteres no padrão', () => {
		// 47 caracteres, mas dois deles viram `\%`: o padrão passa de 50.
		const termo = '%' + 'A'.repeat(45) + '%';
		expect(termo.length).toBeLessThan(49);
		expect(render(likeContains(sql.raw('n'), termo)).texto).toContain('instr');
	});

	it('acima do limite, instr devolve as MESMAS linhas que o LIKE devolveria', () => {
		const termos = [
			'ANTONIO CARLOS DE SOUSA FILHO E MAIS UM NOME BEM COMPRIDO',
			'CARLOS DE SOUSA FILHO E MAIS UM NOME BEM COMPRIDO', // 49: só o miolo
			'antonio carlos de sousa filho e mais um nome bem comprido', // caixa trocada
			'100% DE DESCONTO NA PRIMEIRA COMPRA DE VERAO DO ANO', // com wildcard literal
			'NAO EXISTE ESTE TEXTO EM LUGAR NENHUM DESTA TABELA AQUI'
		];
		for (const t of termos) {
			expect(buscar(t), `termo: ${t}`).toEqual(buscarComoLikeSempre(t));
		}
	});

	it('o % de um termo longo continua literal — instr não tem wildcard', () => {
		// Se `instr` recebesse o termo ESCAPADO, a barra entraria na comparação e
		// a linha não casaria. Se o `LIKE` perdesse o ESCAPE, `%` viraria curinga
		// e casaria tudo. As duas regressões caem aqui.
		const achados = buscar('100% DE DESCONTO NA PRIMEIRA COMPRA DE VERAO DO ANO');
		expect(achados).toEqual(['100% DE DESCONTO NA PRIMEIRA COMPRA DE VERAO DO ANO']);
	});
});
