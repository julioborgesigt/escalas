import { json, type RequestHandler } from '@sveltejs/kit';
import { asc, eq, like, and } from 'drizzle-orm';
import { getDB } from '$lib/db';
import { unidades } from '$lib/server/schema';
import { requireAuth } from '$lib/server/api';

export const GET: RequestHandler = async ({ locals, platform, url }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const q = (url.searchParams.get('q') ?? '').trim();
	const tipo = (url.searchParams.get('tipo') ?? '').trim();
	const limitRaw = Number(url.searchParams.get('limit') ?? '20');
	const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 20;

	const db = getDB(platform);
	const conditions = [];

	if (q) {
		conditions.push(like(unidades.nome, `%${q}%`));
	}
	if (tipo === 'delegacia' || tipo === 'seccional' || tipo === 'departamento' || tipo === 'sub_departamento') {
		conditions.push(eq(unidades.tipo, tipo));
	}

	const rows = await db
		.select({ id: unidades.id, nome: unidades.nome, tipo: unidades.tipo })
		.from(unidades)
		.where(conditions.length ? and(...conditions) : undefined)
		.orderBy(asc(unidades.nome))
		.limit(limit);

	return json({
		items: rows
	});
};

