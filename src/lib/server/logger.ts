import { logger as baseLogger } from '$lib/logger';
import { getRequestCtx } from './request-context';

function withCtx(ctx?: Record<string, unknown>): Record<string, unknown> | undefined {
	const reqCtx = getRequestCtx();
	if (!reqCtx) return ctx;
	return { requestId: reqCtx.requestId, userId: reqCtx.userId, ...ctx };
}

export const logger = {
	debug: (msg: string, ctx?: Record<string, unknown>) => baseLogger.debug(msg, withCtx(ctx)),
	info: (msg: string, ctx?: Record<string, unknown>) => baseLogger.info(msg, withCtx(ctx)),
	warn: (msg: string, ctx?: Record<string, unknown>) => baseLogger.warn(msg, withCtx(ctx)),
	error: (msg: string, ctx?: Record<string, unknown>) => baseLogger.error(msg, withCtx(ctx))
};
