import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../server/schema';

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
