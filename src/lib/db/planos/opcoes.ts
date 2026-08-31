/**
 * As opções de LOCAL DE BRIEFING e CIDADE DE DESTINO que um plano oferece.
 *
 * ## Por que uma lista, e não um campo por equipe
 *
 * Numa operação com oito equipes saindo para três cidades, o destino era
 * redigitado oito vezes. Basta um acento diferente para o Anexo I listar dois
 * destinos onde só há um — e o documento é o que a corporação lê. O plano
 * declara a lista uma vez e a equipe escolhe num seletor.
 *
 * ## A padrão é decidida pelo BANCO
 *
 * `uq_plano_opcoes_padrao` é um índice único PARCIAL sobre `(plano_id, tipo)`
 * com `WHERE padrao = 1` — o mesmo mecanismo do chefe de equipe. Trocar a
 * padrão é limpar a anterior e marcar a nova no MESMO `batch`: duas abas
 * abertas não conseguem deixar duas padrões, porque a segunda gravação esbarra
 * no índice em vez de passar por uma consulta prévia que já envelheceu.
 *
 * ## Valor repetido também é o índice que recusa
 *
 * `uq_plano_opcoes_valor` impede duas entradas iguais no mesmo tipo. Duas
 * linhas idênticas no seletor não ajudam ninguém a escolher — a segunda só
 * existiria por engano de digitação, e quem cadastrou não perceberia.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import { planoOpcoes } from '../../server/schema';
import type { PlanoOpcao } from '../../server/schema';
import { type Database, batchNonEmpty } from '../core';
import { ehViolacaoUnique } from '../../server/db-errors';

/** Os dois tipos de opção. */
export type TipoOpcao = 'briefing' | 'destino';

/** Motivo pelo qual uma opção não entrou. */
export type ResultadoOpcao = { ok: true; id: number } | { ok: false; motivo: 'repetida' | 'erro' };

/**
 * As opções de um plano, por tipo, na ordem em que a tela as apresenta.
 *
 * A PADRÃO vem primeiro, e o resto por `ordem` e depois valor: quem abre o
 * seletor encontra no topo o que vai usar na maioria das equipes.
 */
export async function listarOpcoes(
	db: Database,
	planoId: number,
	tipo: TipoOpcao
): Promise<PlanoOpcao[]> {
	return db
		.select()
		.from(planoOpcoes)
		.where(and(eq(planoOpcoes.plano_id, planoId), eq(planoOpcoes.tipo, tipo)))
		.orderBy(sql`${planoOpcoes.padrao} DESC`, asc(planoOpcoes.ordem), asc(planoOpcoes.valor))
		.all();
}

/** Todas as opções do plano, já separadas nos dois tipos. */
export async function opcoesDoPlano(
	db: Database,
	planoId: number
): Promise<{ briefing: PlanoOpcao[]; destino: PlanoOpcao[] }> {
	const [briefing, destino] = await Promise.all([
		listarOpcoes(db, planoId, 'briefing'),
		listarOpcoes(db, planoId, 'destino')
	]);
	return { briefing, destino };
}

/**
 * O VALOR da opção padrão do tipo, ou `''` quando o plano não tem nenhuma.
 *
 * É o que a equipe nova recebe pré-preenchido e o que a cascata usa quando a
 * equipe está com o campo vazio.
 */
export function valorPadrao(opcoes: PlanoOpcao[]): string {
	return opcoes.find((o) => o.padrao)?.valor ?? '';
}

/**
 * Acrescenta uma opção. A PRIMEIRA de cada tipo nasce como padrão.
 *
 * Nasce padrão porque um plano com opções e nenhuma padrão daria equipe nova
 * com o campo vazio — e quem acabou de cadastrar a única opção não espera
 * precisar marcá-la também.
 *
 * A repetição é recusada pelo ÍNDICE, não por um `SELECT` antes: entre a
 * consulta e o insert cabe outra aba gravando o mesmo valor.
 */
export async function adicionarOpcao(
	db: Database,
	planoId: number,
	tipo: TipoOpcao,
	valor: string
): Promise<ResultadoOpcao> {
	const limpo = valor.trim().slice(0, 200);
	if (!limpo) return { ok: false, motivo: 'erro' };

	const existentes = await listarOpcoes(db, planoId, tipo);
	const primeira = existentes.length === 0;
	const proximaOrdem = existentes.reduce((m, o) => Math.max(m, o.ordem), -1) + 1;

	try {
		const linha = await db
			.insert(planoOpcoes)
			.values({
				plano_id: planoId,
				tipo,
				valor: limpo,
				padrao: primeira,
				ordem: proximaOrdem
			})
			.returning({ id: planoOpcoes.id })
			.get();
		return { ok: true, id: linha.id };
	} catch (e) {
		if (ehViolacaoUnique(e)) return { ok: false, motivo: 'repetida' };
		throw e;
	}
}

/**
 * Marca a opção como padrão do tipo dela, tirando a marca da anterior.
 *
 * As duas gravações num `batch` só: entre limpar a antiga e marcar a nova não
 * pode existir um instante em que o plano fique sem padrão nenhuma, nem outro
 * em que tenha duas — e é o índice parcial que garante o segundo caso.
 *
 * `false` quando a opção não é do plano informado: o id vem do formulário, e o
 * índice conta padrões POR PLANO — ele não impediria marcar como padrão uma
 * opção de outro plano.
 */
export async function definirOpcaoPadrao(
	db: Database,
	planoId: number,
	opcaoId: number
): Promise<boolean> {
	const alvo = await db
		.select()
		.from(planoOpcoes)
		.where(and(eq(planoOpcoes.id, opcaoId), eq(planoOpcoes.plano_id, planoId)))
		.get();
	if (!alvo) return false;

	await batchNonEmpty(db, [
		db
			.update(planoOpcoes)
			.set({ padrao: false })
			.where(and(eq(planoOpcoes.plano_id, planoId), eq(planoOpcoes.tipo, alvo.tipo))),
		db.update(planoOpcoes).set({ padrao: true }).where(eq(planoOpcoes.id, opcaoId))
	]);
	return true;
}

/**
 * Remove a opção. Se ela era a padrão, a primeira das restantes assume.
 *
 * Deixar o tipo sem padrão faria a próxima equipe nascer com o campo vazio sem
 * que ninguém tivesse pedido isso — e o motivo (a padrão foi removida há três
 * dias) não estaria em lugar nenhum da tela.
 *
 * O que as equipes JÁ escolheram não muda: elas guardam o texto, não uma
 * referência. Apagar uma opção da lista não pode esvaziar o destino de uma
 * equipe montada — e muito menos o de um plano cujo documento já circulou.
 */
export async function removerOpcao(
	db: Database,
	planoId: number,
	opcaoId: number
): Promise<boolean> {
	const alvo = await db
		.select()
		.from(planoOpcoes)
		.where(and(eq(planoOpcoes.id, opcaoId), eq(planoOpcoes.plano_id, planoId)))
		.get();
	if (!alvo) return false;

	await db.delete(planoOpcoes).where(eq(planoOpcoes.id, opcaoId));

	if (alvo.padrao) {
		const restantes = await listarOpcoes(db, planoId, alvo.tipo);
		if (restantes.length > 0) {
			await db.update(planoOpcoes).set({ padrao: true }).where(eq(planoOpcoes.id, restantes[0].id));
		}
	}
	return true;
}
