/**
 * Logger estruturado (browser e worker): JSON compatível com Cloudflare Logs / Logpush.
 * Use `$lib/logger` em código compartilhado; `$lib/server/logger` reexporta a mesma API.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
	level: LogLevel;
	message: string;
	timestamp: string;
	[key: string]: unknown;
}

function emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
	const entry: LogEntry = {
		level,
		message,
		timestamp: new Date().toISOString(),
		...context
	};

	switch (level) {
		case 'error':
			console.error(JSON.stringify(entry));
			break;
		case 'warn':
			console.warn(JSON.stringify(entry));
			break;
		default:
			console.warn(JSON.stringify(entry));
	}
}

export const logger = {
	debug: (message: string, context?: Record<string, unknown>) => emit('debug', message, context),
	info: (message: string, context?: Record<string, unknown>) => emit('info', message, context),
	warn: (message: string, context?: Record<string, unknown>) => emit('warn', message, context),
	error: (message: string, context?: Record<string, unknown>) => emit('error', message, context)
};

export function createRequestLogger(requestId: string, path: string) {
	const base = { requestId, path };
	return {
		debug: (msg: string, ctx?: Record<string, unknown>) => logger.debug(msg, { ...base, ...ctx }),
		info: (msg: string, ctx?: Record<string, unknown>) => logger.info(msg, { ...base, ...ctx }),
		warn: (msg: string, ctx?: Record<string, unknown>) => logger.warn(msg, { ...base, ...ctx }),
		error: (msg: string, ctx?: Record<string, unknown>) => logger.error(msg, { ...base, ...ctx })
	};
}
