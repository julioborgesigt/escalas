import type { PageServerLoad } from './$types';
import { redirect, error } from '@sveltejs/kit';
import { getDB, buscarGiseDetalhado, listarPoliciais, isSupervisorGiseAtiva } from '$lib/db';
import { isAdminGeral, isAdminSeccional } from '$lib/auth';
import { unidades, policiais } from '$lib/server/schema';
import { eq, asc, inArray, or, and } from 'drizzle-orm';

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
		throw redirect(302, '/');
	}

	try {
		const gise = await buscarGiseDetalhado(db, id);
		if (!gise) throw error(404, 'Escala GISE não encontrada');

		// Lista de policiais disponíveis para alocação
		let policiaisListResult: any[] = [];
		if (isGeral) {
			policiaisListResult = await listarPoliciais(db);
		} else if (isSeccional && u.papel_unidade_id) {
			const unidadesSubordinadas = await db
				.select({ nome: unidades.nome })
				.from(unidades)
				.where(
					or(
						eq(unidades.seccional_id, u.papel_unidade_id),
						eq(unidades.id, u.papel_unidade_id)
					)
				);
			const nomesUnidades = unidadesSubordinadas.map(un => un.nome);
			if (nomesUnidades.length > 0) {
				policiaisListResult = await db
					.select()
					.from(policiais)
					.where(and(eq(policiais.ativo, 1), inArray(policiais.lotacao, nomesUnidades)))
					.orderBy(asc(policiais.cargo), asc(policiais.nome));
			}
		}

		const todasUnidades = await db.select().from(unidades).orderBy(asc(unidades.nome));

		return {
			gise,
			policiais: policiaisListResult,
			todasUnidades,
			papelGise: isGeral ? 'admin_geral' : isSeccional ? 'admin_seccional' : 'supervisor',
			minhaSeccionalId: u.papel_unidade_id ?? null,
			usuarioAtual: { nome: u.nome, id: u.id }
		};
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e; // re-throw SvelteKit errors
		const msg = e instanceof Error ? e.message : String(e);
		console.error('[gise/load]', msg);
		throw error(500, `Erro ao carregar GISE: ${msg}`);
	}
};
