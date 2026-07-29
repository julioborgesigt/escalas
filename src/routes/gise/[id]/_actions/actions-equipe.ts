import { fail } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import {
	getDB,
	buscarGiseEscala,
	atualizarGiseEscala,
	atualizarGiseEquipe,
	excluirGiseEquipe,
	criarGiseEquipe,
	revogarAssinaturasSeccional
} from '$lib/db';
import { isAdminGeral } from '$lib/auth';
import { giseDocumentos, giseEquipes } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import { getInt, saiuDaFaseDeEdicao } from './shared';

/**
 * Form actions das EQUIPES da GISE (bloco de cada seccional em `/gise/[id]`).
 *
 * Todas exigem Admin Geral: a composição de equipes define quantas vagas cada
 * unidade tem na escala, e o admin seccional só preenche as vagas
 * (ver `actions-membros.ts`).
 *
 * Depois que a GISE sai do rascunho, cada action invalida o que a mudança
 * atinge — documento inteiro ou assinaturas da seccional (ver
 * `saiuDaFaseDeEdicao`).
 */

type Event = RequestEvent<{ id: string }>;

export const actionsEquipe = {
	/** Muda o número de vagas (DPC/OIP) de uma equipe já existente. */
	salvarSlotsEquipe: async ({ request, locals, platform, params }: Event) => {
		const u = locals.usuario;
		if (!u || !isAdminGeral(u)) return fail(403, { error: 'Apenas Admin Geral' });

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const equipeId = getInt(formData, 'equipeId');
		if (isNaN(giseId) || isNaN(equipeId)) return fail(400, { error: 'IDs inválidos' });

		const slotsDpc = parseInt(formData.get('slots_dpc') as string);
		const slotsOip = parseInt(formData.get('slots_oip') as string);

		if (isNaN(slotsDpc) || isNaN(slotsOip)) return fail(400, { error: 'Dados inválidos' });

		const db = getDB(platform);
		await atualizarGiseEquipe(db, equipeId, slotsDpc, slotsOip);

		const gise = await buscarGiseEscala(db, giseId);
		// Mudar vagas altera o corpo da escala inteira: o PDF gerado deixa de valer
		// e a GISE volta para preenchimento.
		if (gise && saiuDaFaseDeEdicao(gise.status)) {
			await db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId));
			await atualizarGiseEscala(db, giseId, { status: 'em_preenchimento' });
		}

		return { success: true };
	},

	/** Horário próprio da equipe (sobrepõe o da seccional e o da escala). */
	salvarHorariosEquipe: async ({ request, locals, platform, params }: Event) => {
		const u = locals.usuario;
		if (!u || !isAdminGeral(u)) return fail(403, { error: 'Apenas Admin Geral' });

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const eqId = getInt(formData, 'eqId');
		if (isNaN(giseId) || isNaN(eqId)) return fail(400, { error: 'IDs inválidos' });

		const horaEntrada = formData.get('hora_entrada') as string | null;
		const horaSaida = formData.get('hora_saida') as string | null;

		const db = getDB(platform);
		const gise = await buscarGiseEscala(db, giseId);
		if (!gise) return fail(404, { error: 'GISE não encontrada' });
		if (gise.status === 'finalizada') return fail(400, { error: 'Escala finalizada' });

		await atualizarGiseEquipe(db, eqId, undefined, undefined, {
			hora_entrada: horaEntrada,
			hora_saida: horaSaida
		});

		// Horário entra no relatório de extra da seccional — revoga só as
		// assinaturas dela, sem derrubar o resto da escala.
		if (saiuDaFaseDeEdicao(gise.status)) {
			const equipe = await db
				.select({ gise_seccional_id: giseEquipes.gise_seccional_id })
				.from(giseEquipes)
				.where(eq(giseEquipes.id, eqId))
				.get();
			if (equipe) {
				await revogarAssinaturasSeccional(db, giseId, equipe.gise_seccional_id);
			}
		}

		return { success: true };
	},

	/** Cria uma equipe (operacional ou SEINT) dentro de uma seccional. */
	adicionarEquipe: async ({ request, locals, platform, params }: Event) => {
		const u = locals.usuario;
		if (!u || !isAdminGeral(u)) return fail(403, { error: 'Apenas Admin Geral' });

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const secId = getInt(formData, 'secId');
		if (isNaN(giseId) || isNaN(secId)) return fail(400, { error: 'IDs inválidos' });

		const tipo = formData.get('tipo') as 'operacional' | 'seint';
		const slotsDpc = parseInt(formData.get('slots_dpc') as string);
		const slotsOip = parseInt(formData.get('slots_oip') as string);

		if (!tipo || (tipo !== 'operacional' && tipo !== 'seint'))
			return fail(400, { error: 'Tipo inválido' });

		// `null` = equipe ainda sem unidade escolhida (slot em aberto na seccional).
		const unidadeIdRaw = formData.get('unidadeId') as string;
		const unidadeId = unidadeIdRaw ? parseInt(unidadeIdRaw) : null;

		const db = getDB(platform);
		const gise = await buscarGiseEscala(db, giseId);
		if (!gise) return fail(404, { error: 'GISE não encontrada' });
		if (gise.status === 'finalizada') return fail(400, { error: 'Escala finalizada' });

		await criarGiseEquipe(
			db,
			secId,
			tipo,
			isNaN(slotsDpc) ? 0 : slotsDpc,
			isNaN(slotsOip) ? 0 : slotsOip,
			unidadeId
		);

		// Equipe nova = escala diferente da que foi para assinatura.
		if (saiuDaFaseDeEdicao(gise.status)) {
			await db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId));
			await atualizarGiseEscala(db, giseId, { status: 'em_preenchimento' });
		}

		return { success: true };
	},

	/** Remove a equipe (e, em cascata, seus membros). */
	removerEquipe: async ({ request, locals, platform, params }: Event) => {
		const u = locals.usuario;
		if (!u || !isAdminGeral(u)) return fail(403, { error: 'Apenas Admin Geral' });

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const equipeId = getInt(formData, 'equipeId');
		if (isNaN(giseId) || isNaN(equipeId)) return fail(400, { error: 'IDs inválidos' });

		const db = getDB(platform);
		const gise = await buscarGiseEscala(db, giseId);
		if (!gise) return fail(404, { error: 'GISE não encontrada' });
		if (gise.status === 'finalizada') return fail(400, { error: 'Escala finalizada' });

		// Lê a seccional ANTES de excluir — depois a linha não existe mais e não
		// haveria como saber quais assinaturas revogar.
		const equipe = await db
			.select({ gise_seccional_id: giseEquipes.gise_seccional_id })
			.from(giseEquipes)
			.where(eq(giseEquipes.id, equipeId))
			.get();

		await excluirGiseEquipe(db, equipeId);

		if (equipe && saiuDaFaseDeEdicao(gise.status)) {
			await revogarAssinaturasSeccional(db, giseId, equipe.gise_seccional_id);
		}

		return { success: true };
	}
};
