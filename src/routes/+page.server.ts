import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDB, isSupervisorGiseAtiva, isMembroGiseAtiva } from '$lib/db';

export const load: PageServerLoad = async ({ locals, platform }) => {
	const u = locals.usuario;
	if (!u) throw redirect(303, '/login');

	// Admin geral
	if (u.tipo === 'admin') throw redirect(303, '/painel');

	// Admin seccional ou unidade
	if (u.papel === 'admin_seccional' || u.papel === 'admin_unidade') {
		throw redirect(303, '/escalas');
	}

	// Policial sem papel admin: verificar vínculo com GISE ativa
	const db = getDB(platform);
	const [isSupervisor, isMembro] = await Promise.all([
		isSupervisorGiseAtiva(db, u.id),
		isMembroGiseAtiva(db, u.id)
	]);

	if (isSupervisor) throw redirect(303, '/gise');
	if (isMembro) throw redirect(303, '/res-gise');

	// Sem vínculo ativo: fica na raiz (sem acesso a nada)
	return {};
};
