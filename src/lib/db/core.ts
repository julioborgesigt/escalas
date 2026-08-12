/**
 * Infra transversal da camada de dados: cliente D1, bindings R2, formato de
 * timestamp SQLite (as duas convenções de fuso) e o epílogo de paginação.
 *
 * Nada aqui é de um domínio — escalas, GISE e auditoria consomem estes
 * helpers. Timestamp errado (ISO contra TEXT SQLite, ou UTC contra Brasília)
 * não lança: apaga dado ou desliga rate-limit em silêncio. Por isso as duas
 * funções de corte têm o fuso no próprio nome.
 */
import { drizzle } from 'drizzle-orm/d1';
import type { BatchItem } from 'drizzle-orm/batch';
import * as schema from '../server/schema';
import type { R2Bucket as _R2Bucket } from '@cloudflare/workers-types';

export type Database = ReturnType<typeof getDB>;

/**
 * Formato aceito para `platform`: o `event.platform` do SvelteKit
 * (`{ env: Env }`) ou, como fallback, o próprio objeto de bindings
 * (scripts/testes que montam o env na mão). Os campos são opcionais porque
 * em dev local (vite sem wrangler) os bindings podem estar ausentes.
 */
type PlatformLike = { env?: Partial<Env> } & Partial<Env>;

/**
 * Cliente Drizzle sobre o binding D1 — o ponto de entrada de toda a camada de
 * dados. Barato de chamar (só embrulha o binding), então cada handler chama o
 * seu; não existe conexão a reaproveitar entre requests em Workers.
 *
 * LANÇA quando o binding não está presente, em vez de devolver `undefined`: sem
 * banco não há nada de útil a fazer, e o erro no ponto da chamada aponta o
 * problema real (wrangler/env mal configurado) em vez de estourar em algum
 * `.select()` adiante.
 */
export function getDB(
	platform: PlatformLike | undefined
): ReturnType<typeof drizzle<typeof schema>> {
	const env = platform?.env || platform;
	if (!env?.escalas_db) {
		throw new Error('Database not available. Make sure D1 is configured.');
	}
	return drizzle(env.escalas_db, { schema });
}

/**
 * Executa `db.batch()` a partir de um array comum de statements.
 *
 * `db.batch()` exige a tupla non-empty `[T, ...T[]]`, mas `.map()` devolve
 * `T[]` — este helper concentra a conversão (com guarda de vazio em runtime)
 * num único ponto, em vez de espalhar `as any` pelos chamadores.
 */
export async function batchNonEmpty(db: Database, stmts: BatchItem<'sqlite'>[]): Promise<void> {
	if (stmts.length === 0) return;
	await db.batch(stmts as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
}

/**
 * O que uma ESCRITA devolve. O D1 responde `D1Result` a todo `INSERT`/`UPDATE`/
 * `DELETE`, e a contagem de linhas mora em `meta.changes`.
 */
export interface ResultadoDeEscrita {
	meta?: { changes?: number };
}

/**
 * Quantas linhas a escrita afetou.
 *
 * **`rowsAffected` não existe no D1.** Esse é o nome do `better-sqlite3` e do
 * libsql; o D1 devolve `{ success, results, meta: { changes, ... } }`, e o
 * drizzle repassa o objeto do driver sem tocar (`mapRunResult` é a identidade
 * nos dois drivers). Ler o campo errado dá `undefined`, que o `?? 0` idiomático
 * transforma em "nenhuma linha" — sem erro, sem log, sem teste vermelho.
 *
 * Custou caro justamente porque o campo era plausível: quatro chamadores
 * decidiam por ele, e o harness de testes SINTETIZAVA um `rowsAffected` que o
 * banco real nunca produz. Todos os testes passavam contra a invenção enquanto
 * em produção a saída da presença GISE nunca se registrava, a alocação de
 * membro respondia "sem vaga" depois de gravar, e renomear unidade lançava
 * conflito sempre. Foi o e2e — que roda sobre D1 de verdade — que denunciou.
 *
 * Por isso é UMA função e ela lê UM campo: com um `?? rowsAffected` de reserva,
 * o harness poderia voltar a mentir e ninguém veria.
 */
export function linhasAfetadas(resultado: ResultadoDeEscrita): number {
	return resultado.meta?.changes ?? 0;
}

/**
 * Timestamp no formato que as colunas de data TEXT deste projeto guardam:
 * `"YYYY-MM-DD HH:MM:SS"`, o mesmo que o default `datetime(...)` do SQLite
 * produz. Sem argumento, é "agora".
 *
 * Fonte ÚNICA desse formato, e a razão é um bug real: comparar uma dessas
 * colunas com um `toISOString()` (`"...T...Z"`) não dá erro nenhum, porque em
 * SQLite a comparação de TEXT é lexicográfica — e como `' '` (0x20) vem antes
 * de `'T'` (0x54), toda linha do MESMO DIA do limite parece anterior a ele,
 * qualquer que seja a hora. Era assim que a expurga de retenção apagava até 24h
 * a mais de dado pessoal a cada execução, sem falhar teste nenhum.
 *
 * **São DUAS funções porque o schema tem DUAS convenções de fuso**, e escolher
 * a errada erra por três horas em silêncio — o mesmo tipo de falha do parágrafo
 * acima, uma casa depois:
 *
 * | default da coluna              | use               | tabelas                                          |
 * | ------------------------------ | ----------------- | ------------------------------------------------ |
 * | `datetime('now')`              | `timestampSqliteUtc`      | `audit_log`, `app_log`, `login_attempts`, `recovery_attempts`, `webhook_nonces` |
 * | `datetime('now', '-3 hours')`  | `timestampSqliteBrasilia` | `dois_fatores_tokens`, `reset_senha_tokens` e as tabelas de domínio |
 *
 * As colunas gravadas pelo APP com `toISOString()` (`sessoes.expires_at` e os
 * `expires_at` dos tokens) são uma TERCEIRA convenção e não usam nenhuma das
 * duas — comparar essas com ISO é o certo.
 */
export function timestampSqliteUtc(ms: number = Date.now()): string {
	return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/** Horário de Brasília (UTC-3), para as colunas com `datetime('now','-3 hours')`. */
export function timestampSqliteBrasilia(ms: number = Date.now()): string {
	return timestampSqliteUtc(ms - 3 * 3_600_000);
}

/**
 * Fecha uma listagem paginada feita com `count(*) OVER()`.
 *
 * Esse `OVER()` traz o total de linhas do filtro em CADA linha da página — é o
 * que evita uma segunda query de contagem. O preço é que a coluna `total` viaja
 * junto com os dados e precisa sair antes de devolver, senão vaza para a UI.
 *
 * Era este desfecho — ler o total da primeira linha, calcular as páginas,
 * remover a coluna e montar o envelope — que estava repetido nas quatro
 * listagens paginadas do projeto (logs técnicos, auditoria, escalas,
 * policiais), com pequenas variações inúteis entre elas.
 *
 * Página vazia devolve `total: 0`, e não há caso especial a tratar: o `map` de
 * uma lista vazia é uma lista vazia.
 */
export function paginarComContagem<T extends { total: unknown }>(
	rows: T[],
	page: number,
	limit: number
): { itens: Omit<T, 'total'>[]; total: number; page: number; limit: number; totalPages: number } {
	const total = rows.length > 0 ? Number(rows[0].total ?? 0) : 0;
	return {
		itens: rows.map(({ total: _descartado, ...resto }) => resto),
		total,
		page,
		limit,
		totalPages: Math.ceil(total / limit)
	};
}

/**
 * Retorna o binding do bucket R2 para armazenamento de documentos.
 */
export function getR2(platform: PlatformLike | undefined): _R2Bucket {
	const env = platform?.env || platform;
	if (!env?.escalas_docs) {
		throw new Error('R2 bucket not available. Make sure escalas-docs is configured.');
	}
	return env.escalas_docs;
}

/**
 * Variante de `getR2` que devolve `undefined` em vez de lançar quando o
 * binding está ausente — para fluxos best-effort (logos, cópia de conferência)
 * e handlers que preferem responder 500/503 graciosamente.
 *
 * Única fonte dessas duas semânticas (achado D2 do antigo ARQUIVOS.md — ver docs/HISTORICO.md): `getR2` lança,
 * `tryGetR2` retorna `undefined` — o nome diz o comportamento, não o caminho
 * do import.
 */
export function tryGetR2(platform: PlatformLike | undefined): _R2Bucket | undefined {
	const env = platform?.env || platform;
	return env?.escalas_docs;
}

/**
 * Verifica se o bucket R2 está configurado (sem lançar erro).
 * Útil para retornar 500 gracefully quando o binding está ausente.
 */
export function hasR2(platform: PlatformLike | undefined): boolean {
	const env = platform?.env || platform;
	return !!env?.escalas_docs;
}
