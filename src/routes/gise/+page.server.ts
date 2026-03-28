import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { getDB, listarGiseEscalas, buscarGiseAtiva, isSupervisorGiseAtiva, isMembroGiseAtiva } from '$lib/db';
import { isAdminGeral, isAdminSeccional } from '$lib/auth';

export const load: PageServerLoad = async ({ locals, platform }) => {
	const u = locals.usuario;
	if (!u) throw redirect(302, '/login');

	const db = getDB(platform);

	const isGeral = isAdminGeral(u);
	const isSeccional = isAdminSeccional(u);

	let isSupervisor = false;
	let isMembro = false;
	if (u.tipo === 'policial') {
		[isSupervisor, isMembro] = await Promise.all([
			isSupervisorGiseAtiva(db, u.id),
			isMembroGiseAtiva(db, u.id)
		]);
	}

	// Servidores sem qualquer vínculo com GISE: redirecionar
	if (!isGeral && !isSeccional && !isSupervisor && !isMembro) {
		throw redirect(302, '/');
	}

	const escalas = await listarGiseEscalas(db);
	const ativa = await buscarGiseAtiva(db);

	let papelGise: 'admin_geral' | 'admin_seccional' | 'supervisor' | 'membro';
	if (isGeral) papelGise = 'admin_geral';
	else if (isSeccional) papelGise = 'admin_seccional';
	else if (isSupervisor) papelGise = 'supervisor';
	else papelGise = 'membro';

	return {
		escalas,
		ativa,
		papelGise
	};
};
