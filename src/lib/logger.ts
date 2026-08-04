/**
 * Logger estruturado (browser e worker): JSON compatível com Cloudflare Logs / Logpush.
 * Use `$lib/logger` em código compartilhado; `$lib/server/logger` envolve esta
 * API com contexto de request e persistência em `app_log` (ver seu cabeçalho).
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
