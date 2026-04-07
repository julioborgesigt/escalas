import type { PageServerLoad, Actions } from './$types';
import { redirect, fail } from '@sveltejs/kit';
import { getDB, listarGiseEscalas, buscarGiseAtiva, isSupervisorGiseAtiva, isMembroGiseAtiva, criarGiseEscala, clonarGiseParaData, upsertGiseSeccional } from '$lib/db';
import { isAdminGeral, isAdminSeccional } from '$lib/auth';
import { eq } from 'drizzle-orm';
import { unidades } from '$lib/server/schema';

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

	const supervisorId = (!isGeral && !isSeccional && isSupervisor && !isMembro) ? u.id : undefined;
	const policialId = (!isGeral && !isSeccional) ? u.id : undefined;
	const escalas = await listarGiseEscalas(db, supervisorId, policialId);
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

export const actions: Actions = {
	criar: async ({ request, locals, platform }) => {
		const u = locals.usuario;
		if (!isAdminGeral(u)) return fail(403, { error: 'Apenas o Administrador Geral pode criar escalas GISE' });

		const data = await request.formData();
		const data_inicio = data.get('data_inicio')?.toString() || '';
		const data_fim = data.get('data_fim')?.toString() || data_inicio;
		const hora_entrada = data.get('hora_entrada')?.toString() || '08:00';
		const hora_saida = data.get('hora_saida')?.toString() || '16:00';
		const modo = (data.get('modo')?.toString() || 'completa') as 'completa' | 'clonada';
		const clonar_de = data.get('clonar_de') ? Number(data.get('clonar_de')) : undefined;

		if (!data_inicio) return fail(400, { error: 'data_inicio é obrigatório' });

		const db = getDB(platform);

		// Gerar array de datas
		const datas: string[] = [];
		const cursor = new Date(data_inicio + 'T00:00:00Z');
		const dataFimObj = new Date(data_fim + 'T00:00:00Z');
		while (cursor <= dataFimObj) {
			datas.push(cursor.toISOString().slice(0, 10));
			cursor.setUTCDate(cursor.getUTCDate() + 1);
		}

		try {
			const ids: number[] = [];

			if (modo === 'clonada' && clonar_de) {
				for (const d of datas) {
					const novoId = await clonarGiseParaData(db, clonar_de, d, 'clonada', hora_entrada, hora_saida);
					ids.push(novoId);
				}
			} else {
				// Buscar seccionais
				const seccionais = await db.select({ id: unidades.id, nome: unidades.nome })
					.from(unidades).where(eq(unidades.tipo, 'seccional')).all();

				for (const d of datas) {
					const novaId = await criarGiseEscala(db, d, hora_entrada, hora_saida, 'em_definicao_supervisor');
					ids.push(novaId);

					for (const sec of seccionais) {
						await upsertGiseSeccional(db, novaId, sec.id);
					}
				}
			}

			return { success: true, count: ids.length, ids };
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			return fail(500, { error: msg });
		}
	}
};
