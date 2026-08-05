import { fail } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import {
	getDB,
	buscarGiseEscala,
	adicionarGiseMembro,
	removerGiseMembro,
	verificarSlotEquipe,
	verificarConflitoMembroGise,
	verificarConflitoHorarioPolicial
} from '$lib/db';
import { invalidarPapelGise } from '$lib/server/gise/papel-cache';
import { giseMembros, giseEquipes, giseSeccionais, policiais } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import { getInt, podePreencherSeccional } from './shared';
import { concluirMudancaGise, invalidarAssinaturasDaSeccional } from './desfecho';

/**
 * Form actions dos MEMBROS (policiais alocados às vagas das equipes) em
 * `/gise/[id]`.
 *
 * Diferente das equipes, aqui o admin seccional também escreve — desde que a
 * seccional seja a dele (`u.papel_unidade_id === sec.seccional_id`). É o passo
 * que cada seccional executa antes de "finalizar" seu preenchimento.
 */

type Event = RequestEvent<{ id: string }>;

export const actionsMembros = {
	/**
	 * Aloca um policial numa equipe. Três validações antes de gravar, todas na
	 * camada de dados: vaga livre no tipo certo (DPC/OIP), policial ainda não
	 * escalado nesta GISE e sem conflito de horário com outra escala.
	 */
	adicionarMembro: async (event: Event) => {
		const { request, locals, platform, params } = event;
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
		const sec = await db.select().from(giseSeccionais).where(eq(giseSeccionais.id, secId)).get();
		if (!sec || sec.gise_id !== giseId) return fail(404, { error: 'Seccional não encontrada' });

		if (!podePreencherSeccional(u, sec.seccional_id)) {
			return fail(403, { error: 'Sem permissão para montar equipes desta seccional' });
		}

		const equipe = await db.select().from(giseEquipes).where(eq(giseEquipes.id, equipeId)).get();
		if (!equipe || equipe.gise_seccional_id !== secId)
			return fail(404, { error: 'Equipe não encontrada' });

		const slotCheck = await verificarSlotEquipe(db, equipeId, policialId);
		if (!slotCheck.ok) return fail(400, { error: slotCheck.motivo });

		const conflitoCheck = await verificarConflitoMembroGise(db, giseId, policialId);
		if (!conflitoCheck.ok) return fail(400, { error: conflitoCheck.motivo });

		const horarioCheck = await verificarConflitoHorarioPolicial(db, equipeId, policialId);
		if (!horarioCheck.ok) return fail(400, { error: horarioCheck.motivo });

		await adicionarGiseMembro(db, equipeId, policialId);

		// O papel GISE do policial é cacheado (usado no guard de `/res-gise`);
		// sem invalidar, ele só enxergaria a escala nova quando o cache expirasse.
		await invalidarPapelGise(policialId);

		const gise = await buscarGiseEscala(db, giseId);
		const invalidacao = gise
			? await invalidarAssinaturasDaSeccional(db, giseId, secId, gise.status)
			: 'nada';

		const pol = await db
			.select({ nome: policiais.nome })
			.from(policiais)
			.where(eq(policiais.id, policialId))
			.get();

		await concluirMudancaGise(event, {
			db,
			giseId,
			usuario: u,
			acao: 'gise_membro_adicionado',
			alvo: { tipo: 'policial', id: policialId, nome: pol?.nome ?? null },
			detalhes: `${pol?.nome ?? `Policial ${policialId}`} alocado na equipe ${equipeId}`,
			invalidacao,
			metadados: { equipe_id: equipeId, gise_seccional_id: secId }
		});

		return { success: true };
	},

	/** Desaloca um policial. Bloqueado quando a GISE já entrou em operação. */
	removerMembro: async (event: Event) => {
		const { request, locals, platform, params } = event;
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const memId = getInt(formData, 'memId');
		if (isNaN(giseId) || isNaN(memId)) return fail(400, { error: 'IDs inválidos' });

		const db = getDB(platform);
		const gise = await buscarGiseEscala(db, giseId);
		if (!gise) return fail(404, { error: 'GISE não encontrada' });

		// Uma consulta só resolve as quatro perguntas: qual equipe, qual seccional
		// (para revogar assinaturas), de quem é o cache de papel a invalidar e o
		// nome que vai para a trilha. O nome PRECISA sair daqui: depois do delete
		// não haveria mais linha para saber quem foi desalocado.
		const membroInfo = await db
			.select({
				equipe_id: giseMembros.equipe_id,
				policial_id: giseMembros.policial_id,
				policial_nome: policiais.nome,
				gise_seccional_id: giseEquipes.gise_seccional_id,
				seccional_id: giseSeccionais.seccional_id
			})
			.from(giseMembros)
			.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
			.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
			.innerJoin(policiais, eq(giseMembros.policial_id, policiais.id))
			.where(eq(giseMembros.id, memId))
			.get();

		if (!membroInfo) return fail(404, { error: 'Membro não encontrado' });

		if (!podePreencherSeccional(u, membroInfo.seccional_id)) {
			return fail(403, { error: 'Sem permissão para montar equipes desta seccional' });
		}

		// Janela maior que a de edição livre: dá para corrigir a composição
		// enquanto a escala aguarda a assinatura do supervisor, mas não depois que
		// ela entra em operação (haveria presença/relatório do policial removido).
		if (
			!['em_definicao_supervisor', 'em_preenchimento', 'aguardando_assinatura'].includes(
				gise.status
			)
		) {
			return fail(400, { error: 'Escala fechada para edição' });
		}

		await removerGiseMembro(db, memId);

		await invalidarPapelGise(membroInfo.policial_id);

		const invalidacao = await invalidarAssinaturasDaSeccional(
			db,
			giseId,
			membroInfo.gise_seccional_id,
			gise.status
		);

		await concluirMudancaGise(event, {
			db,
			giseId,
			usuario: u,
			acao: 'gise_membro_removido',
			alvo: { tipo: 'policial', id: membroInfo.policial_id, nome: membroInfo.policial_nome },
			detalhes: `${membroInfo.policial_nome} desalocado da equipe ${membroInfo.equipe_id}`,
			invalidacao,
			metadados: {
				equipe_id: membroInfo.equipe_id,
				gise_seccional_id: membroInfo.gise_seccional_id,
				status_da_gise: gise.status
			}
		});

		return { success: true };
	}
};
