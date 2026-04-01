import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../server/schema';

export type Database = ReturnType<typeof getDB>;

export function getDB(platform: any): ReturnType<typeof drizzle<typeof schema>> {
	const env = (platform?.env || platform) as any;
	if (!env?.escalas_db) {
		throw new Error('Database not available. Make sure D1 is configured.');
	}
	return drizzle(env.escalas_db, { schema });
}
