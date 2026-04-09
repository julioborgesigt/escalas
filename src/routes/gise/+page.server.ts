import type { PageServerLoad, Actions } from './$types';
import { redirect, fail } from '@sveltejs/kit';
import { getDB, listarGiseEscalas, buscarGiseAtiva, isSupervisorGiseAtiva, isMembroGiseAtiva, criarGiseEscala, clonarGiseParaData, upsertGiseSeccional } from '$lib/db';
import { isAdminGeral, isAdminSeccional } from '$lib/auth';
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { giseCriarSchema } from '$lib/schemas';
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

	const form = await superValidate(zod4(giseCriarSchema));

	return {
		escalas,
		ativa,
		papelGise,
		form
	};
};

export const actions: Actions = {
	criar: async ({ request, locals, platform }) => {
		const u = locals.usuario;
		const form = await superValidate(request, zod4(giseCriarSchema));

		if (!isAdminGeral(u)) return fail(403, { form });

		if (!form.valid) {
			return fail(400, { form });
		}

		const data_inicio = form.data.data_inicio;
		const data_fim = form.data.data_fim || data_inicio;
		const hora_entrada = form.data.hora_entrada;
		const hora_saida = form.data.hora_saida;
		const modo = form.data.modo;
		const clonar_de = form.data.clonar_de;

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
					const novoId = await clonarGiseParaData(db, Number(clonar_de), d, 'clonada', hora_entrada, hora_saida);
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

			return message(form, JSON.stringify({ type: 'success', ids, count: ids.length }));
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			return message(form, JSON.stringify({ type: 'error', error: msg }), { status: 500 });
		}
	}
};
