import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { getDB, listarPoliciais } from '$lib/db';
import { isAdminGeral, isAdminSeccional } from '$lib/auth';
import { unidades } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import { asc } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals, platform }) => {
	const u = locals.usuario;
	if (!u) throw redirect(302, '/login');

	const isGeral = isAdminGeral(u);
	const isSeccional = isAdminSeccional(u);

	if (!isGeral && !isSeccional) {
		throw redirect(302, '/');
	}

	const db = getDB(platform);

	// Policiais visíveis para este admin
	const policiais = isGeral
		? await listarPoliciais(db)
		: u.lotacao
			? await listarPoliciais(db, u.lotacao)
			: [];

	// Seccionais disponíveis (para Admin Geral ao vincular papel_unidade_id)
	const seccionais = isGeral
		? await db.select().from(unidades).where(eq(unidades.tipo, 'seccional')).orderBy(asc(unidades.nome))
		: [];

	const todasUnidades = isGeral
		? await db.select().from(unidades).orderBy(asc(unidades.nome))
		: [];

	return {
		policiais,
		seccionais,
		todasUnidades,
		isAdminGeral: isGeral
	};
};
