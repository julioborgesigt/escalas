import { describe, it, expect } from 'vitest';
import {
	requestStore,
	capturarLogPendente,
	serializarContexto,
	MAX_LOGS_POR_REQUEST,
	MAX_CONTEXTO_CHARS,
	type RequestCtx
} from '../request-context';
import { logger } from '../logger';

function novoCtx(): RequestCtx {
	return { requestId: 'abc12345', userId: 'anon', path: '/teste', logsPendentes: [] };
}

describe('serializarContexto', () => {
	it('retorna null para contexto ausente ou vazio', () => {
		expect(serializarContexto(undefined)).toBeNull();
		expect(serializarContexto({})).toBeNull();
	});

	it('serializa contexto simples como JSON', () => {
		expect(serializarContexto({ a: 1, b: 'x' })).toBe('{"a":1,"b":"x"}');
	});

	it('trunca JSONs acima do limite', () => {
		const grande = { blob: 'x'.repeat(MAX_CONTEXTO_CHARS * 2) };
		const out = serializarContexto(grande);
		expect(out).not.toBeNull();
		expect(out!.length).toBeLessThanOrEqual(MAX_CONTEXTO_CHARS + 1); // +1 pela reticência
		expect(out!.endsWith('…')).toBe(true);
	});

	it('não lança em contexto com referência circular (perde o contexto, não o log)', () => {
		const circular: Record<string, unknown> = {};
		circular.eu = circular;
		expect(serializarContexto(circular)).toBeNull();
	});
});

describe('capturarLogPendente', () => {
	it('é no-op fora de uma request (ALS vazio)', () => {
		expect(() => capturarLogPendente('warn', 'fora de request')).not.toThrow();
	});

	it('acumula entradas no buffer da request atual', () => {
		const ctx = novoCtx();
		requestStore.run(ctx, () => {
			capturarLogPendente('warn', 'aviso', { detalhe: 1 });
			capturarLogPendente('error', 'erro');
		});
		expect(ctx.logsPendentes).toHaveLength(2);
		expect(ctx.logsPendentes[0]).toMatchObject({
			level: 'warn',
			message: 'aviso',
			contexto: '{"detalhe":1}'
		});
		expect(ctx.logsPendentes[1]).toMatchObject({ level: 'error', message: 'erro', contexto: null });
		// Formato do datetime('now') do SQLite: "YYYY-MM-DD HH:MM:SS"
		expect(ctx.logsPendentes[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
	});

	it('respeita o teto de entradas por request', () => {
		const ctx = novoCtx();
		requestStore.run(ctx, () => {
			for (let i = 0; i < MAX_LOGS_POR_REQUEST + 10; i++) {
				capturarLogPendente('warn', `msg ${i}`);
			}
		});
		expect(ctx.logsPendentes).toHaveLength(MAX_LOGS_POR_REQUEST);
	});
});

describe('logger do servidor → buffer de app_log', () => {
	it('warn e error entram no buffer; debug e info não', () => {
		const ctx = novoCtx();
		requestStore.run(ctx, () => {
			logger.debug('debug');
			logger.info('info');
			logger.warn('aviso', { a: 1 });
			logger.error('erro');
		});
		expect(ctx.logsPendentes.map((l) => l.level)).toEqual(['warn', 'error']);
	});

	it('persiste o contexto cru, sem duplicar requestId/userId (que viram colunas)', () => {
		const ctx = novoCtx();
		requestStore.run(ctx, () => {
			logger.warn('aviso', { a: 1 });
		});
		expect(ctx.logsPendentes[0].contexto).toBe('{"a":1}');
	});
});
