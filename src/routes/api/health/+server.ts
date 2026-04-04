import { json } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import { sql } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';

export const GET = async ({ platform }: RequestEvent) => {
	const checks: Record<string, 'ok' | 'error'> = {};
	let healthy = true;

	// Check D1 database
	try {
		const db = getDB(platform);
		await db.run(sql`SELECT 1`);
		checks.database = 'ok';
	} catch {
		checks.database = 'error';
		healthy = false;
	}

	// Check R2 bucket binding
	try {
		const env = (platform as any)?.env;
		if (env?.escalas_docs) {
			checks.r2 = 'ok';
		} else {
			checks.r2 = 'error';
			healthy = false;
		}
	} catch {
		checks.r2 = 'error';
		healthy = false;
	}

	return json(
		{ status: healthy ? 'healthy' : 'degraded', checks, timestamp: new Date().toISOString() },
		{ status: healthy ? 200 : 503 }
	);
};
