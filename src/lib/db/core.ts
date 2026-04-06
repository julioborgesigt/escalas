import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../server/schema';
import type { R2Bucket as _R2Bucket } from '@cloudflare/workers-types';

export type Database = ReturnType<typeof getDB>;

// Platform type is loose because Cloudflare Workers types (D1Database, R2Bucket)
// only resolve at deploy time via wrangler, not during svelte-check.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getDB(platform: any): ReturnType<typeof drizzle<typeof schema>> {
	const env = platform?.env || platform;
	if (!env?.escalas_db) {
		throw new Error('Database not available. Make sure D1 is configured.');
	}
	return drizzle(env.escalas_db, { schema });
}

/**
 * Retorna o binding do bucket R2 para armazenamento de documentos.
 * Usa `any` para platform porque os tipos do Cloudflare só resolvem
 * em tempo de deploy (wrangler), não durante svelte-check local.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getR2(platform: any): _R2Bucket {
	const env = platform?.env || platform;
	if (!env?.escalas_docs) {
		throw new Error('R2 bucket not available. Make sure escalas-docs is configured.');
	}
	return env.escalas_docs as _R2Bucket;
}

/**
 * Verifica se o bucket R2 está configurado (sem lançar erro).
 * Útil para retornar 500 gracefully quando o binding está ausente.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function hasR2(platform: any): boolean {
	const env = platform?.env || platform;
	return !!env?.escalas_docs;
}
