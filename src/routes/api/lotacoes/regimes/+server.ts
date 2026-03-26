import { json } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import { unidades } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

// Retorna as unidades com seus regimes (para pre-fill do formulário de nova escala)
export const GET: RequestHandler = async ({ platform, locals }) => {
	const db = getDB(platform);

	if (locals.usuario?.tipo === 'policial') {
		// Policial: retorna somente a própria unidade
		const lotacao = locals.usuario.lotacao as string;
		const unidade = await db.select().from(unidades).where(eq(unidades.nome, lotacao)).get();
		if (!unidade) return json([]);
		return json([{
			nome: unidade.nome,
			tem_plantao: unidade.tem_plantao,
			tem_expediente: unidade.tem_expediente,
			tem_fds: unidade.tem_fds,
			cidade: unidade.cidade
		}]);
	}

	// Admin: retorna todas
	const todas = await db.select({
		nome: unidades.nome,
		tem_plantao: unidades.tem_plantao,
		tem_expediente: unidades.tem_expediente,
		tem_fds: unidades.tem_fds,
		cidade: unidades.cidade
	}).from(unidades).all();

	return json(todas);
};
