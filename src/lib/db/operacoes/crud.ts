/**
 * Cadastro das operações extraordinárias — GISE, OPERAÇÃO CRAJUBAR, EDGE.
 *
 * A operação é o que dá identidade à escala extra e é dona dos formulários de
 * produtividade. Duas regras moram aqui e não nas rotas:
 *
 * - **operação não se exclui, desativa-se.** Não existe `excluirOperacao` neste
 *   módulo, e é deliberado: escala histórica e PDF assinado continuam apontando
 *   para ela. Mesmo desenho de `unidades.ativo`.
 * - **toda operação tem ao menos um tipo de equipe.** O banco aceita (0,0); a
 *   aplicação não. Operação sem tipo de equipe não escala ninguém e não teria
 *   formulário nenhum — `normalizarTiposEquipe` é quem barra.
 */
import { eq, asc, sql, and, inArray } from 'drizzle-orm';
import { operacoes, giseEscalas, giseModeloFormulario } from '$lib/server/schema';
import type { Database } from '../core';
import type { Operacao } from '$lib/server/schema';

/** Os tipos de equipe que uma operação pode habilitar. Espelha `gise_equipes.tipo`. */
export type TipoEquipeOperacao = 'operacional' | 'seint';

/** Todos os tipos de equipe existentes, na ordem em que a UI os apresenta. */
export const TIPOS_EQUIPE: readonly TipoEquipeOperacao[] = ['operacional', 'seint'];

/** Campos que a tela de cadastro edita. `nome` é a chave natural (UNIQUE). */
export interface OperacaoEntrada {
	nome: string;
	sigla?: string;
	descricao?: string;
	usaEquipeOperacional: boolean;
	usaEquipeSeint: boolean;
	dataInicio?: string | null;
	dataFim?: string | null;
}

/** Os tipos de equipe habilitados nesta operação, já como lista. */
export function tiposEquipeDaOperacao(op: {
	usa_equipe_operacional: boolean;
	usa_equipe_seint: boolean;
}): TipoEquipeOperacao[] {
	const tipos: TipoEquipeOperacao[] = [];
	if (op.usa_equipe_operacional) tipos.push('operacional');
	if (op.usa_equipe_seint) tipos.push('seint');
	return tipos;
}

/**
 * A operação aceita equipe deste tipo?
 *
 * Fonte única do gate — a tela esconde o tipo desabilitado, mas quem RECUSA o
 * POST direto é a action, e as duas precisam concordar.
 */
export function operacaoAceitaTipoEquipe(
	op: { usa_equipe_operacional: boolean; usa_equipe_seint: boolean },
	tipo: string
): boolean {
	if (tipo === 'operacional') return op.usa_equipe_operacional;
	if (tipo === 'seint') return op.usa_equipe_seint;
	return false;
}

/**
 * Os dois flags de tipo de equipe, garantindo que ao menos um fique ligado.
 *
 * Devolve `null` quando os dois vêm desligados, em vez de "corrigir" para um
 * padrão: a escolha é do admin e adivinhá-la criaria uma operação diferente da
 * que ele pediu. O chamador transforma o `null` em erro de validação.
 */
export function normalizarTiposEquipe(
	usaOperacional: boolean,
	usaSeint: boolean
): { usa_equipe_operacional: boolean; usa_equipe_seint: boolean } | null {
	if (!usaOperacional && !usaSeint) return null;
	return { usa_equipe_operacional: usaOperacional, usa_equipe_seint: usaSeint };
}

/**
 * Todas as operações, ativas primeiro e em ordem alfabética dentro de cada
 * grupo. `somenteAtivas` é o recorte de quem vai OFERECER a operação (criar
 * escala, filtrar); as telas de cadastro e de histórico querem todas.
 */
export async function listarOperacoes(
	db: Database,
	opts?: { somenteAtivas?: boolean }
): Promise<Operacao[]> {
	const q = db.select().from(operacoes);
	const linhas = opts?.somenteAtivas
		? await q.where(eq(operacoes.ativo, true)).orderBy(asc(operacoes.nome)).all()
		: await q.orderBy(asc(operacoes.nome)).all();
	return linhas;
}

/** Uma operação pelo id, ou `null`. */
export async function buscarOperacao(db: Database, id: number): Promise<Operacao | null> {
	const row = await db.select().from(operacoes).where(eq(operacoes.id, id)).get();
	return row ?? null;
}

/**
 * A operação de uma escala extra.
 *
 * Trata `operacao_id` nulo como a operação `GISE`: é o que as escalas anteriores
 * à migração 0048 são, e o backfill já as marcou — o fallback cobre só a linha
 * inserida por uma versão antiga do código durante o deploy.
 */
export async function buscarOperacaoDaEscala(
	db: Database,
	giseId: number
): Promise<Operacao | null> {
	const escala = await db
		.select({ operacao_id: giseEscalas.operacao_id })
		.from(giseEscalas)
		.where(eq(giseEscalas.id, giseId))
		.get();
	if (!escala) return null;
	if (escala.operacao_id != null) return buscarOperacao(db, escala.operacao_id);
	return buscarOperacaoPorNome(db, NOME_OPERACAO_PADRAO);
}

/** Nome da operação que já existia antes de haver operações (ver migração 0048). */
export const NOME_OPERACAO_PADRAO = 'GISE';

/** Uma operação pelo nome exato (a coluna é UNIQUE), ou `null`. */
export async function buscarOperacaoPorNome(db: Database, nome: string): Promise<Operacao | null> {
	const row = await db.select().from(operacoes).where(eq(operacoes.nome, nome)).get();
	return row ?? null;
}

/**
 * Cria a operação e devolve o id.
 *
 * Não clona formulário — quem faz isso é `clonarModelosFormulario`, chamada
 * logo em seguida pela action. Separadas porque criar do zero é um caso
 * legítimo ("começar em branco") e porque o clone tem regra própria.
 *
 * A violação de UNIQUE em `nome` sobe como erro do driver; o chamador a traduz
 * em 409 com `traduzirErroDeBanco` (`$lib/server/db-errors`).
 */
export async function criarOperacao(db: Database, dados: OperacaoEntrada): Promise<number> {
	const [row] = await db
		.insert(operacoes)
		.values({
			nome: dados.nome,
			sigla: dados.sigla ?? '',
			descricao: dados.descricao ?? '',
			usa_equipe_operacional: dados.usaEquipeOperacional,
			usa_equipe_seint: dados.usaEquipeSeint,
			data_inicio: dados.dataInicio ?? null,
			data_fim: dados.dataFim ?? null
		})
		.returning({ id: operacoes.id });
	return row.id;
}

/**
 * Patch da operação: escreve exatamente os campos recebidos.
 *
 * Desabilitar um tipo de equipe NÃO mexe nas escalas já montadas — as equipes
 * daquele tipo continuam existindo, com seus membros e presenças. O flag só
 * governa o que pode ser criado daqui para frente; apagar retroativamente
 * destruiria escala assinada.
 */
export async function atualizarOperacao(
	db: Database,
	id: number,
	dados: Partial<{
		nome: string;
		sigla: string;
		descricao: string;
		usa_equipe_operacional: boolean;
		usa_equipe_seint: boolean;
		data_inicio: string | null;
		data_fim: string | null;
		ativo: boolean;
	}>
) {
	return db.update(operacoes).set(dados).where(eq(operacoes.id, id));
}

/**
 * Liga/desliga a operação. Desativada, ela some das listas de escolha (criar
 * escala, filtro padrão) mas continua resolvendo nome e id no histórico.
 */
export async function definirAtivoOperacao(db: Database, id: number, ativo: boolean) {
	return db.update(operacoes).set({ ativo }).where(eq(operacoes.id, id));
}

/** Quantas escalas extras cada operação tem — para a coluna de uso da tela de cadastro. */
export async function contarEscalasPorOperacao(db: Database): Promise<Map<number, number>> {
	const linhas = await db
		.select({ operacao_id: giseEscalas.operacao_id, total: sql<number>`count(*)` })
		.from(giseEscalas)
		.groupBy(giseEscalas.operacao_id)
		.all();
	const mapa = new Map<number, number>();
	for (const l of linhas) {
		if (l.operacao_id != null) mapa.set(l.operacao_id, Number(l.total));
	}
	return mapa;
}

/**
 * Copia os formulários de `origemId` para `destinoId`, um por tipo de equipe.
 *
 * É o "basear o formulário em" da criação de operação: o pedido é justamente
 * NÃO começar do zero. Regras:
 *
 * - só clona os tipos que o DESTINO habilita — uma EDGE só de inteligência não
 *   deve herdar o formulário operacional que ela nunca vai usar;
 * - tipo cuja origem não tem linha gravada é PULADO, não criado vazio: sem
 *   linha, a leitura cai no modelo padrão do código
 *   (`DEFAULT_QUESTIONS_FORM_OPERACIONAL`), que é um ponto de partida melhor
 *   que um formulário em branco;
 * - `INSERT` direto, sem passar por `salvarGiseModeloFormulario`: a operação é
 *   nova e não há `config_anterior` a preservar — o "Restaurar anterior" do
 *   editor começa vazio, que é a verdade.
 *
 * Devolve os tipos efetivamente clonados, para a auditoria registrar o que de
 * fato aconteceu.
 */
export async function clonarModelosFormulario(
	db: Database,
	origemId: number,
	destinoId: number,
	tipos: readonly TipoEquipeOperacao[]
): Promise<TipoEquipeOperacao[]> {
	if (tipos.length === 0) return [];

	const origens = await db
		.select({ tipo: giseModeloFormulario.tipo, config: giseModeloFormulario.config })
		.from(giseModeloFormulario)
		.where(
			and(
				eq(giseModeloFormulario.operacao_id, origemId),
				inArray(giseModeloFormulario.tipo, [...tipos])
			)
		)
		.all();

	const clonados: TipoEquipeOperacao[] = [];
	for (const origem of origens) {
		await db.insert(giseModeloFormulario).values({
			operacao_id: destinoId,
			tipo: origem.tipo,
			config: origem.config,
			updated_at: sql`datetime('now', '-3 hours')`
		});
		clonados.push(origem.tipo as TipoEquipeOperacao);
	}
	return clonados;
}
