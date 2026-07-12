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
 * Única fonte dessas duas semânticas (achado D2 do ARQUIVOS.md): `getR2` lança,
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
