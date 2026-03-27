import type { PageServerLoad } from './$types';
import { redirect, error } from '@sveltejs/kit';
import { getDB, buscarGiseDetalhado, listarPoliciais, isSupervisorGiseAtiva } from '$lib/db';
import { isAdminGeral, isAdminSeccional } from '$lib/auth';
import { unidades } from '$lib/server/schema';
import { eq, asc } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals, params, platform }) => {
	const u = locals.usuario;
	if (!u) throw redirect(302, '/login');

	const id = parseInt(params.id);
	if (isNaN(id)) throw error(400, 'ID inválido');

	const db = getDB(platform);

	const isGeral = isAdminGeral(u);
	const isSeccional = isAdminSeccional(u);
	let isSupervisor = false;
	if (u.tipo === 'policial') {
		isSupervisor = await isSupervisorGiseAtiva(db, u.id);
	}

	if (!isGeral && !isSeccional && !isSupervisor) {
		throw redirect(302, '/escalas');
	}

	const gise = await buscarGiseDetalhado(db, id);
	if (!gise) throw error(404, 'Escala GISE não encontrada');

	// Lista de policiais disponíveis para alocação
	// Admin Seccional: só policiais da sua seccional
	// Admin Geral: todos
	const seccionalNome = isSeccional && u.papel_unidade_id
		? await db.select({ nome: unidades.nome }).from(unidades).where(eq(unidades.id, u.papel_unidade_id!)).get()
		: null;

	const policiais = isGeral
		? await listarPoliciais(db)
		: seccionalNome
			? await listarPoliciais(db, seccionalNome.nome)
			: [];

	// Lista de unidades (para definir unidade operacional)
	const todasUnidades = await db.select().from(unidades).orderBy(asc(unidades.nome));

	return {
		gise,
		policiais,
		todasUnidades,
		papelGise: isGeral ? 'admin_geral' : isSeccional ? 'admin_seccional' : 'supervisor',
		minhaSeccionalId: u.papel_unidade_id ?? null
	};
};
