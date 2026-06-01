import { fail } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import {
	getDB,
	buscarGiseEscala,
	atualizarGiseSeccionalUnidade,
	adicionarGiseSeccionalUnidade,
	removerGiseSeccionalUnidade,
	revogarAssinaturasSeccional
} from '$lib/db';
import { isAdminGeral, isAdminSeccional } from '$lib/auth';
import { giseSeccionalUnidades, giseSeccionais, giseEquipes } from '$lib/server/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { getInt } from './shared';

type Event = RequestEvent<{ id: string }>;

export const actionsUnidade = {
	selecionarUnidade: async ({ request, locals, platform, params }: Event) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const slotId = getInt(formData, 'slotId');
		const unidadeId = getInt(formData, 'unidadeId');
		if (isNaN(giseId) || isNaN(slotId) || isNaN(unidadeId))
			return fail(400, { error: 'IDs inválidos' });

		const db = getDB(platform);

		const slotInfo = await db
			.select({ gise_seccional_id: giseSeccionalUnidades.gise_seccional_id })
			.from(giseSeccionalUnidades)
			.where(eq(giseSeccionalUnidades.id, slotId))
			.get();
		if (!slotInfo) return fail(404, { error: 'Slot não encontrado' });

		const sec = await db
			.select()
			.from(giseSeccionais)
			.where(
				and(eq(giseSeccionais.id, slotInfo.gise_seccional_id), eq(giseSeccionais.gise_id, giseId))
			)
			.get();
		if (!sec) return fail(404, { error: 'Seccional não encontrada' });

		if (!isAdminGeral(u) && !isAdminSeccional(u)) {
			return fail(403, { error: 'Sem permissão' });
		}

		if (isAdminSeccional(u) && u.papel_unidade_id !== sec.seccional_id) {
			return fail(403, { error: 'Sem permissão' });
		}

		await atualizarGiseSeccionalUnidade(db, slotId, unidadeId);
		return { success: true };
	},

	adicionarUnidade: async ({ request, locals, platform, params }: Event) => {
		const u = locals.usuario;
		if (!u || !isAdminGeral(u)) return fail(403, { error: 'Apenas Admin Geral' });

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const secId = getInt(formData, 'secId');
		if (isNaN(giseId) || isNaN(secId)) return fail(400, { error: 'IDs inválidos' });

		const unidadeIdRaw = formData.get('unidadeId') as string;
		const unidadeId = unidadeIdRaw ? parseInt(unidadeIdRaw) : null;

		const db = getDB(platform);
		const sec = await db
			.select()
			.from(giseSeccionais)
			.where(and(eq(giseSeccionais.id, secId), eq(giseSeccionais.gise_id, giseId)))
			.get();
		if (!sec) return fail(404, { error: 'Seccional não encontrada' });

		await adicionarGiseSeccionalUnidade(db, secId, unidadeId);
		return { success: true };
	},

	removerUnidade: async ({ request, locals, platform, params }: Event) => {
		const u = locals.usuario;
		if (!u || !isAdminGeral(u)) return fail(403, { error: 'Apenas Admin Geral' });

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const secId = getInt(formData, 'secId');
		const linkId = getInt(formData, 'linkId');
		if (isNaN(giseId) || isNaN(secId) || isNaN(linkId))
			return fail(400, { error: 'IDs inválidos' });

		const db = getDB(platform);
		const sec = await db
			.select()
			.from(giseSeccionais)
			.where(and(eq(giseSeccionais.id, secId), eq(giseSeccionais.gise_id, giseId)))
			.get();
		if (!sec) return fail(404, { error: 'Seccional não encontrada' });

		if (linkId === 0) {
			await db
				.delete(giseEquipes)
				.where(and(eq(giseEquipes.gise_seccional_id, secId), isNull(giseEquipes.gise_unidade_id)));
		} else {
			await removerGiseSeccionalUnidade(db, linkId);
		}

		const gise = await buscarGiseEscala(db, giseId);
		if (gise && !['em_definicao_supervisor', 'em_preenchimento'].includes(gise.status)) {
			await revogarAssinaturasSeccional(db, giseId, secId);
		}

		return { success: true };
	}
};
