import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { getDB, listarGiseEscalas, buscarGiseAtiva, isSupervisorGiseAtiva } from '$lib/db';
import { isAdminGeral, isAdminSeccional } from '$lib/auth';

export const load: PageServerLoad = async ({ locals, platform }) => {
	const u = locals.usuario;
	if (!u) throw redirect(302, '/login');

	const db = getDB(platform);

	// Determinar visibilidade e papel do usuário na GISE
	const isGeral = isAdminGeral(u);
	const isSeccional = isAdminSeccional(u);

	// Verificar se é supervisor ativo
	let isSupervisor = false;
	if (u.tipo === 'policial') {
		isSupervisor = await isSupervisorGiseAtiva(db, u.id);
	}

	// Servidores sem nenhum papel na GISE: aba oculta (redirect)
	if (!isGeral && !isSeccional && !isSupervisor) {
		throw redirect(302, '/escalas');
	}

	const escalas = await listarGiseEscalas(db);
	const ativa = await buscarGiseAtiva(db);

	return {
		escalas,
		ativa,
		papelGise: isGeral ? 'admin_geral' : isSeccional ? 'admin_seccional' : 'supervisor'
	};
};
