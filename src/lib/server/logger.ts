import { logger as baseLogger } from '$lib/logger';
import { getRequestCtx, capturarLogPendente } from './request-context';

function withCtx(ctx?: Record<string, unknown>): Record<string, unknown> | undefined {
	const reqCtx = getRequestCtx();
	if (!reqCtx) return ctx;
	return { requestId: reqCtx.requestId, userId: reqCtx.userId, ...ctx };
}

/**
 * Além do console (Cloudflare Logs), warn/error são capturados no buffer da
 * request e persistidos em `app_log` ao final (hooks.server.ts) — visíveis no
 * console /auditoria/logs. O contexto persistido é o `ctx` cru: requestId/userId
 * já viram colunas próprias na tabela, não precisam duplicar no JSON.
 */
export const logger = {
	debug: (msg: string, ctx?: Record<string, unknown>) => baseLogger.debug(msg, withCtx(ctx)),
	info: (msg: string, ctx?: Record<string, unknown>) => baseLogger.info(msg, withCtx(ctx)),
	warn: (msg: string, ctx?: Record<string, unknown>) => {
		capturarLogPendente('warn', msg, ctx);
		baseLogger.warn(msg, withCtx(ctx));
	},
	error: (msg: string, ctx?: Record<string, unknown>) => {
		capturarLogPendente('error', msg, ctx);
		baseLogger.error(msg, withCtx(ctx));
	}
};
