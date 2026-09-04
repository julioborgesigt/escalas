/**
 * O contexto da request corrente, via `AsyncLocalStorage` — quem é, de onde
 * veio, e o que precisa ser gravado DEPOIS da resposta.
 *
 * Existe para resolver dois problemas de uma vez. O primeiro é a trilha de
 * auditoria: `requestId`, rota e usuário são herdados daqui pelas ~25 chamadas
 * legadas de `auditar` que não os recebiam por parâmetro — sem isso, seria
 * preciso tocar todos os call sites para manter a trilha consistente.
 *
 * O segundo é custo: `logger.warn`/`error` acumulam no buffer em vez de
 * escrever no D1 na hora, e `hooks.server.ts` persiste depois da resposta, no
 * `waitUntil`. Log técnico não pode competir com o caminho crítico da
 * requisição do usuário.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { timestampSqliteUtc } from '$lib/db/core';

/**
 * Entrada de log técnico capturada durante a request. `logger.warn`/`logger.error`
 * (via `capturarLogPendente`) acumulam aqui; hooks.server.ts persiste o buffer em
 * `app_log` após a resposta (waitUntil), sem custo no caminho crítico.
 */
export interface LogPendente {
	level: 'warn' | 'error';
	message: string;
	/** JSON serializado do contexto (já truncado), ou null. */
	contexto: string | null;
	/** UTC no formato do `datetime('now')` do SQLite — momento da emissão, não do flush. */
	created_at: string;
}

/**
 * Tetos de captura: um loop de warns não pode inflar o D1 nem estourar o limite
 * de parâmetros por statement. Excedentes continuam indo para console/Cloudflare
 * Logs — só a persistência em `app_log` é limitada.
 */
export const MAX_LOGS_POR_REQUEST = 20;
export const MAX_CONTEXTO_CHARS = 4000;

export interface RequestCtx {
	requestId: string;
	userId: string;
	path: string;
	/** Buffer de warn/error emitidos durante a request (flush em hooks.server.ts). */
	logsPendentes: LogPendente[];
}

export const requestStore = new AsyncLocalStorage<RequestCtx>();

/** Retorna o contexto da requisição atual, ou undefined fora de uma requisição. */
export const getRequestCtx = () => requestStore.getStore();

/** Serializa o contexto do logger para persistência, truncando JSONs gigantes. */
export function serializarContexto(ctx?: Record<string, unknown>): string | null {
	if (!ctx || Object.keys(ctx).length === 0) return null;
	try {
		const s = JSON.stringify(ctx);
		return s.length > MAX_CONTEXTO_CHARS ? s.slice(0, MAX_CONTEXTO_CHARS) + '…' : s;
	} catch {
		// Contexto com referência circular / BigInt: perde-se o contexto, não o log.
		return null;
	}
}

/**
 * Registra um warn/error no buffer da request atual para persistência posterior.
 * Fora de uma request (ALS vazio) é no-op — o log segue existindo no console.
 */
export function capturarLogPendente(
	level: LogPendente['level'],
	message: string,
	contexto?: Record<string, unknown>
): void {
	const ctx = requestStore.getStore();
	if (!ctx || ctx.logsPendentes.length >= MAX_LOGS_POR_REQUEST) return;
	ctx.logsPendentes.push({
		level,
		message,
		contexto: serializarContexto(contexto),
		created_at: timestampSqliteUtc()
	});
}
