import { fail } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import {
	getDB,
	buscarGiseEscala,
	adicionarGiseMembro,
	removerGiseMembro,
	verificarSlotEquipe,
	verificarConflitoMembroGise,
	verificarConflitoHorarioPolicial,
	revogarAssinaturasSeccional
} from '$lib/db';
import { isAdminSeccional } from '$lib/auth';
import { invalidarPapelGise } from '$lib/server/gise-papel-cache';
import { giseMembros, giseEquipes, giseSeccionais } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import { getInt } from './shared';

type Event = RequestEvent<{ id: string }>;

export const actionsMembros = {
	adicionarMembro: async ({ request, locals, platform, params }: Event) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const secId = getInt(formData, 'secId');
		if (isNaN(giseId) || isNaN(secId)) return fail(400, { error: 'IDs inválidos' });

		const equipeId = getInt(formData, 'equipe_id');
		const policialId = getInt(formData, 'policial_id');

		if (isNaN(equipeId) || isNaN(policialId)) return fail(400, { error: 'Dados inválidos' });

		const db = getDB(platform);
		const sec = await db.select().from(giseSeccionais)
			.where(eq(giseSeccionais.id, secId)).get();
		if (!sec || sec.gise_id !== giseId) return fail(404, { error: 'Seccional não encontrada' });

		if (isAdminSeccional(u) && u.papel_unidade_id !== sec.seccional_id) {
			return fail(403, { error: 'Sem permissão' });
		}

		const equipe = await db.select().from(giseEquipes)
			.where(eq(giseEquipes.id, equipeId)).get();
		if (!equipe || equipe.gise_seccional_id !== secId) return fail(404, { error: 'Equipe não encontrada' });

		const slotCheck = await verificarSlotEquipe(db, equipeId, policialId);
		if (!slotCheck.ok) return fail(400, { error: slotCheck.motivo });

		const conflitoCheck = await verificarConflitoMembroGise(db, giseId, policialId);
		if (!conflitoCheck.ok) return fail(400, { error: conflitoCheck.motivo });

		const horarioCheck = await verificarConflitoHorarioPolicial(db, equipeId, policialId);
		if (!horarioCheck.ok) return fail(400, { error: horarioCheck.motivo });

		await adicionarGiseMembro(db, equipeId, policialId);

		await invalidarPapelGise(policialId);

		const gise = await buscarGiseEscala(db, giseId);
		if (gise && !['em_definicao_supervisor', 'em_preenchimento'].includes(gise.status)) {
			await revogarAssinaturasSeccional(db, giseId, secId);
		}

		return { success: true };
	},

	removerMembro: async ({ request, locals, platform, params }: Event) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const memId = getInt(formData, 'memId');
		if (isNaN(giseId) || isNaN(memId)) return fail(400, { error: 'IDs inválidos' });

		const db = getDB(platform);
		const gise = await buscarGiseEscala(db, giseId);
		if (!gise) return fail(404, { error: 'GISE não encontrada' });

		if (!['em_definicao_supervisor', 'em_preenchimento', 'aguardando_assinatura'].includes(gise.status)) {
			return fail(400, { error: 'Escala fechada para edição' });
		}

		const membroInfo = await db
			.select({
				equipe_id: giseMembros.equipe_id,
				policial_id: giseMembros.policial_id,
				gise_seccional_id: giseEquipes.gise_seccional_id,
				seccional_id: giseSeccionais.seccional_id
			})
			.from(giseMembros)
			.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
			.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
			.where(eq(giseMembros.id, memId))
			.get();

		if (!membroInfo) return fail(404, { error: 'Membro não encontrado' });

		if (isAdminSeccional(u) && membroInfo.seccional_id !== u.papel_unidade_id) {
			return fail(403, { error: 'Sem permissão' });
		}

		await removerGiseMembro(db, memId);

		await invalidarPapelGise(membroInfo.policial_id);

		if (!['em_definicao_supervisor', 'em_preenchimento'].includes(gise.status)) {
			await revogarAssinaturasSeccional(db, giseId, membroInfo.gise_seccional_id);
		}

		return { success: true };
	}
};
