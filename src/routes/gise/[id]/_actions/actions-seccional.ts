/**
 * Form actions das SECCIONAIS de uma GISE em `/gise/[id]`.
 *
 * Montagem (adicionar/remover) é do Admin Geral; o preenchimento
 * (`finalizarSeccional`, horários) é do admin da própria seccional — daí os
 * guards mistos de `isAdminGeral` × `isAdminSeccional` + `papel_unidade_id`.
 */

import { fail } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import {
	getDB,
	buscarGiseEscala,
	atualizarGiseEscala,
	atualizarGiseSeccional,
	excluirGiseSeccional,
	verificarGiseCompleta,
	revogarAssinaturasSeccional,
	adicionarGiseSeccionalUnidade
} from '$lib/db';
import { isAdminGeral, isAdminSeccional } from '$lib/auth';
import { logger } from '$lib/server/logger';
import { enviarNotificacaoAssessorGisePreenchimentoSeccional } from '$lib/server/email';
import { montarTextoNotificacaoAssessorGise } from '$lib/server/gise-assessor-notificacao-text';
import {
	policiais,
	giseEscalas,
	giseSeccionais,
	giseSeccionalUnidades,
	giseEquipes,
	giseMembros,
	unidades,
	giseDocumentos
} from '$lib/server/schema';
import { eq, and, asc, inArray } from 'drizzle-orm';
import { getInt, saiuDaFaseDeEdicao } from './shared';

type Event = RequestEvent<{ id: string }>;

export const actionsSeccional = {
	/** Inclui uma seccional na GISE, já com um slot de unidade em branco. */
	adicionarSeccional: async ({ request, locals, platform, params }: Event) => {
		const u = locals.usuario;
		if (!u || !isAdminGeral(u)) return fail(403, { error: 'Apenas Admin Geral' });

		const giseId = parseInt(params.id);
		if (isNaN(giseId)) return fail(400, { error: 'ID inválido' });

		const formData = await request.formData();
		const seccionalId = parseInt(formData.get('seccionalId') as string);
		if (isNaN(seccionalId)) return fail(400, { error: 'seccionalId inválido' });

		const db = getDB(platform);
		const gise = await buscarGiseEscala(db, giseId);
		if (!gise) return fail(404, { error: 'GISE não encontrada' });

		const [novaSec] = await db
			.insert(giseSeccionais)
			.values({
				gise_id: giseId,
				seccional_id: seccionalId,
				status: 'pendente'
			})
			.returning({ id: giseSeccionais.id });

		// Slot vazio inicial: a tela sempre mostra ao menos uma linha de unidade
		// para preencher, em vez de uma seccional sem nada abaixo.
		if (novaSec) {
			await adicionarGiseSeccionalUnidade(db, novaSec.id, null);
		}

		return { success: true };
	},

	/**
	 * Remove a seccional da GISE e recalcula o status da escala: some uma parte
	 * do documento, então o PDF gerado é descartado; se as seccionais restantes
	 * já estiverem todas preenchidas, a escala volta direto para assinatura.
	 */
	removerSeccional: async ({ request, locals, platform, params }: Event) => {
		const u = locals.usuario;
		if (!u || !isAdminGeral(u)) return fail(403, { error: 'Apenas Admin Geral' });

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const secId = getInt(formData, 'secId');
		if (isNaN(giseId) || isNaN(secId)) return fail(400, { error: 'IDs inválidos' });

		const db = getDB(platform);
		const sec = await db
			.select({ id: giseSeccionais.id })
			.from(giseSeccionais)
			.where(and(eq(giseSeccionais.id, secId), eq(giseSeccionais.gise_id, giseId)))
			.get();
		if (!sec) return fail(404, { error: 'Seccional não encontrada' });

		await excluirGiseSeccional(db, secId);
		await db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId));

		const seccionaisRestantes = await db
			.select({ id: giseSeccionais.id })
			.from(giseSeccionais)
			.where(eq(giseSeccionais.gise_id, giseId))
			.all();

		let novoStatus: 'em_preenchimento' | 'aguardando_assinatura' = 'em_preenchimento';
		if (seccionaisRestantes.length > 0) {
			const todasPreenchidas = await verificarGiseCompleta(db, giseId);
			if (todasPreenchidas) novoStatus = 'aguardando_assinatura';
		}

		await atualizarGiseEscala(db, giseId, { status: novoStatus });
		return { success: true, gise_status: novoStatus };
	},

	/**
	 * A seccional declara seu preenchimento concluído.
	 *
	 * Só passa com a escala completa: toda unidade escolhida e cada uma com pelo
	 * menos um policial — checagens feitas aqui (e não no clique) porque o admin
	 * seccional pode ter várias abas abertas. Quando a última seccional finaliza,
	 * a GISE inteira vai para `aguardando_assinatura`.
	 */
	finalizarSeccional: async ({ request, locals, platform, params }: Event) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const secId = getInt(formData, 'secId');
		if (isNaN(giseId) || isNaN(secId)) return fail(400, { error: 'IDs inválidos' });

		const db = getDB(platform);
		const sec = await db
			.select()
			.from(giseSeccionais)
			.where(and(eq(giseSeccionais.id, secId), eq(giseSeccionais.gise_id, giseId)))
			.get();
		if (!sec) return fail(404, { error: 'Seccional não encontrada' });

		if (isAdminSeccional(u) && u.papel_unidade_id !== sec.seccional_id) {
			return fail(403, { error: 'Sem permissão' });
		}

		const slots = await db
			.select({ id: giseSeccionalUnidades.id, unidade_id: giseSeccionalUnidades.unidade_id })
			.from(giseSeccionalUnidades)
			.where(eq(giseSeccionalUnidades.gise_seccional_id, secId))
			.all();

		if (slots.length === 0)
			return fail(400, { error: 'Adicione ao menos uma unidade antes de finalizar' });

		const slotSemUnidade = slots.find((s) => s.unidade_id === null);
		if (slotSemUnidade)
			return fail(400, { error: 'Todos os slots devem ter uma unidade selecionada' });

		const slotIds = slots.map((s) => s.id);
		const membrosPorSlot = await db
			.select({ gise_unidade_id: giseEquipes.gise_unidade_id })
			.from(giseMembros)
			.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
			.where(inArray(giseEquipes.gise_unidade_id, slotIds))
			.all();

		const slotsComMembros = new Set(membrosPorSlot.map((m) => m.gise_unidade_id));
		const slotSemMembro = slots.find((s) => !slotsComMembros.has(s.id));
		if (slotSemMembro)
			return fail(400, { error: 'Cada unidade deve ter pelo menos 1 policial alocado' });

		// Preserva a marca de retificação: uma seccional que foi reaberta e
		// preenchida de novo continua distinguível da que acertou de primeira.
		const novoStatus = sec.status === 'retificada' ? 'preenchida_retificada' : 'preenchida';
		await atualizarGiseSeccional(db, secId, { status: novoStatus });

		const todasPreenchidas = await verificarGiseCompleta(db, giseId);
		let giseStatus = 'em_preenchimento';
		if (todasPreenchidas) {
			giseStatus = 'aguardando_assinatura';
			await atualizarGiseEscala(db, giseId, { status: 'aguardando_assinatura' });
		}

		const giseRow = await db
			.select({
				data_inicio: giseEscalas.data_inicio,
				assessor_id: giseEscalas.assessor_id,
				assessor_email_notificacao: giseEscalas.assessor_email_notificacao
			})
			.from(giseEscalas)
			.where(eq(giseEscalas.id, giseId))
			.get();

		const secComNome = await db
			.select({ nome: unidades.nome })
			.from(giseSeccionais)
			.innerJoin(unidades, eq(giseSeccionais.seccional_id, unidades.id))
			.where(eq(giseSeccionais.id, secId))
			.get();

		const todasSecs = await db
			.select({
				nome: unidades.nome,
				status: giseSeccionais.status
			})
			.from(giseSeccionais)
			.innerJoin(unidades, eq(giseSeccionais.seccional_id, unidades.id))
			.where(eq(giseSeccionais.gise_id, giseId))
			.orderBy(asc(unidades.nome));

		// Notificação ao assessor: e-mail configurado na GISE tem prioridade sobre
		// o cadastro do policial. Falha de envio é logada e ignorada — o
		// preenchimento já foi gravado e não pode ser desfeito por causa de e-mail.
		if (giseRow?.assessor_id && secComNome?.nome) {
			let destino =
				(giseRow.assessor_email_notificacao && giseRow.assessor_email_notificacao.trim()) || '';
			let nomeAssessor = 'Assessor';
			const polAss = await db
				.select({
					email_pessoal: policiais.email_pessoal,
					email: policiais.email,
					nome: policiais.nome
				})
				.from(policiais)
				.where(eq(policiais.id, giseRow.assessor_id))
				.get();
			nomeAssessor = polAss?.nome ?? nomeAssessor;
			if (!destino) {
				destino = (polAss?.email_pessoal?.trim() || polAss?.email?.trim() || '') ?? '';
			}
			if (destino) {
				try {
					const texto = montarTextoNotificacaoAssessorGise({
						dataInicioIso: giseRow.data_inicio,
						giseId,
						nomeSeccionalQueAcabouDeEnviar: secComNome.nome,
						seccionais: todasSecs.map((r) => ({ nome: r.nome, status: r.status }))
					});
					await enviarNotificacaoAssessorGisePreenchimentoSeccional(
						destino,
						nomeAssessor,
						texto,
						platform
					);
				} catch (e) {
					logger.warn('[gise/finalizarSeccional] Falha ao notificar assessor (operação segue OK)', {
						giseId,
						secId,
						error: e instanceof Error ? e.message : String(e)
					});
				}
			} else {
				logger.warn(
					'[gise/finalizarSeccional] Assessor sem e-mail para notificação; e-mail não enviado.',
					{
						giseId,
						assessor_id: giseRow.assessor_id
					}
				);
			}
		}

		return { success: true, gise_status: giseStatus };
	},

	/** Horário padrão da seccional (as equipes podem sobrepor o seu). */
	salvarHorariosSec: async ({ request, locals, platform, params }: Event) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const secId = getInt(formData, 'secId');
		if (isNaN(giseId) || isNaN(secId)) return fail(400, { error: 'IDs inválidos' });

		const horaEntrada = formData.get('hora_entrada') as string | null;
		const horaSaida = formData.get('hora_saida') as string | null;

		const db = getDB(platform);
		const gise = await buscarGiseEscala(db, giseId);
		if (!gise) return fail(404, { error: 'GISE não encontrada' });

		const sec = await db
			.select()
			.from(giseSeccionais)
			.where(and(eq(giseSeccionais.id, secId), eq(giseSeccionais.gise_id, giseId)))
			.get();
		if (!sec) return fail(404, { error: 'Seccional não encontrada' });

		if (isAdminSeccional(u) && u.papel_unidade_id !== sec.seccional_id) {
			return fail(403, { error: 'Sem permissão' });
		}

		await atualizarGiseSeccional(db, secId, {
			hora_entrada: horaEntrada || null,
			hora_saida: horaSaida || null
		});

		// Horário sai impresso no relatório de extra: mudou, as assinaturas desta
		// seccional caem.
		if (gise && saiuDaFaseDeEdicao(gise.status)) {
			await revogarAssinaturasSeccional(db, giseId, secId);
		}

		return { success: true };
	}
};
