import type { PageServerLoad, Actions } from './$types';
import { redirect, error, fail } from '@sveltejs/kit';
import {
	getDB,
	getR2,
	buscarGiseDetalhado,
	listarPoliciais,
	isSupervisorGiseAtiva,
	buscarAssinaturasRelatoriosGise,
	buscarGiseEscala,
	atualizarGiseEscala,
	atualizarGiseSeccional,
	atualizarGiseEquipe,
	adicionarGiseMembro,
	removerGiseMembro,
	verificarGiseCompleta,
	excluirGiseEquipe,
	excluirGiseSeccional,
	criarGiseEquipe,
	verificarSlotEquipe,
	verificarConflitoMembroGise,
	revogarAssinaturasSeccional,
	reabrirGiseEscala
} from '$lib/db';
import { isAdminGeral, isAdminSeccional } from '$lib/auth';
import { unidades, policiais, giseEscalas, giseDocumentos, gisePresencas, giseAssinaturasRelatorios, giseMembros, giseEquipes, giseSeccionais, giseRespostasFormulario } from '$lib/server/schema';
import { eq, asc, inArray, or, and } from 'drizzle-orm';

function getInt(fd: FormData, key: string): number {
	const v = fd.get(key);
	if (v === null || v === undefined) return NaN;
	return parseInt(v as string);
}

function getIntParam(url: URL, key: string): number {
	const v = url.searchParams.get(key);
	if (!v) return NaN;
	return parseInt(v);
}

export const load: PageServerLoad = async ({ locals, params, platform }) => {
	const u = locals.usuario;
	if (!u) throw redirect(302, '/login');

	const id = parseInt(params.id);
	if (isNaN(id)) throw error(400, 'ID inválido');

	const db = getDB(platform);

	const isGeral = isAdminGeral(u);
	const isSeccional = isAdminSeccional(u);
	let isSupervisor = false;
	if (u.tipo === 'policial') {
		isSupervisor = await isSupervisorGiseAtiva(db, u.id);
	}

	if (!isGeral && !isSeccional && !isSupervisor) {
		throw redirect(302, '/');
	}

	try {
		const policiaisPromise = isGeral
			? listarPoliciais(db).then(r => r.policiais)
			: isSeccional && u.papel_unidade_id
				? db
					.select({ nome: unidades.nome })
					.from(unidades)
					.where(or(eq(unidades.seccional_id, u.papel_unidade_id!), eq(unidades.id, u.papel_unidade_id!)))
					.then(async (unidadesSubordinadas) => {
						const nomesUnidades = unidadesSubordinadas.map(un => un.nome);
						if (nomesUnidades.length === 0) return [];
						return db
							.select()
							.from(policiais)
							.where(and(eq(policiais.ativo, 1), inArray(policiais.lotacao, nomesUnidades)))
							.orderBy(asc(policiais.cargo), asc(policiais.nome));
					})
				: Promise.resolve([]);

		const [gise, policiaisListResult, todasUnidades, assinaturasRelatorios] = await Promise.all([
			buscarGiseDetalhado(db, id),
			policiaisPromise,
			db.select().from(unidades).orderBy(asc(unidades.nome)),
			buscarAssinaturasRelatoriosGise(db, id)
		]);

		if (!gise) throw error(404, 'Escala GISE não encontrada');

		return {
			gise,
			policiais: policiaisListResult,
			todasUnidades,
			assinaturasRelatorios,
			papelGise: isGeral ? 'admin_geral' : (isSeccional ? 'admin_seccional' : (isSupervisor ? 'supervisor' : 'policial')),
			isGeral,
			isSeccional,
			isSupervisor,
			minhaSeccionalId: isSeccional ? u.papel_unidade_id : null,
			usuarioAtual: u
		};
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		const msg = e instanceof Error ? e.message : String(e);
		console.error('[gise/load]', msg);
		throw error(500, `Erro ao carregar GISE: ${msg}`);
	}
};

export const actions: Actions = {
	salvarSupervisores: async ({ request, locals, platform, params }) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });
		if (!isAdminGeral(u)) return fail(403, { error: 'Apenas Admin Geral pode editar' });

		const giseId = parseInt(params.id);
		if (isNaN(giseId)) return fail(400, { error: 'ID inválido' });

		const formData = await request.formData();
		const supervisorIdStr = formData.get('supervisor_id') as string;
		const supervisorId = supervisorIdStr ? parseInt(supervisorIdStr) : null;

		const db = getDB(platform);
		const gise = await buscarGiseEscala(db, giseId);
		if (!gise) return fail(404, { error: 'GISE não encontrada' });

		if (supervisorId !== null) {
			const p = await db.select({ cargo: policiais.cargo }).from(policiais).where(eq(policiais.id, supervisorId)).get();
			if (!p) return fail(404, { error: 'Policial não encontrado' });
			if (p.cargo !== 'DPC') return fail(400, { error: 'Apenas DPC pode ser Supervisor' });
		}

		const updateData: any = { supervisor_id: supervisorId };
		if (gise.status === 'em_definicao_supervisor') {
			updateData.status = 'em_preenchimento';
		}

		await atualizarGiseEscala(db, giseId, updateData);
		return { success: true };
	},

	salvarUnidadeOperacional: async ({ request, locals, platform, params }) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const secId = getInt(formData, 'secId');
		if (isNaN(giseId) || isNaN(secId)) return fail(400, { error: 'IDs inválidos' });

		const unidadeOperacionalIdStr = formData.get('unidade_operacional_id') as string;
		const unidadeOperacionalId = unidadeOperacionalIdStr ? parseInt(unidadeOperacionalIdStr) : null;

		const db = getDB(platform);
		const sec = await db.select().from(giseSeccionais).where(and(eq(giseSeccionais.id, secId), eq(giseSeccionais.gise_id, giseId))).get();
		if (!sec) return fail(404, { error: 'Seccional não encontrada' });

		if (isAdminSeccional(u) && u.papel_unidade_id !== sec.seccional_id) {
			return fail(403, { error: 'Sem permissão' });
		}

		await atualizarGiseSeccional(db, secId, { unidade_operacional_id: unidadeOperacionalId });
		return { success: true };
	},

	adicionarSeccional: async ({ request, locals, platform, params }) => {
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

		await db.insert(giseSeccionais).values({
			gise_id: giseId,
			seccional_id: seccionalId,
			status: 'pendente'
		});

		const novaSec = await db.select({ id: giseSeccionais.id }).from(giseSeccionais)
			.where(and(eq(giseSeccionais.gise_id, giseId), eq(giseSeccionais.seccional_id, seccionalId)))
			.limit(1).get();

		if (novaSec) {
			await criarGiseEquipe(db, novaSec.id, 'operacional', 1, 3);
		}

		return { success: true };
	},

	removerSeccional: async ({ request, locals, platform, params }) => {
		const u = locals.usuario;
		if (!u || !isAdminGeral(u)) return fail(403, { error: 'Apenas Admin Geral' });

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const secId = getInt(formData, 'secId');
		if (isNaN(giseId) || isNaN(secId)) return fail(400, { error: 'IDs inválidos' });

		const db = getDB(platform);
		const sec = await db.select({ id: giseSeccionais.id })
			.from(giseSeccionais)
			.where(and(eq(giseSeccionais.id, secId), eq(giseSeccionais.gise_id, giseId)))
			.get();
		if (!sec) return fail(404, { error: 'Seccional não encontrada' });

		await excluirGiseSeccional(db, secId);
		await db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId));

		const seccionaisRestantes = await db.select({ id: giseSeccionais.id })
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

	adicionarMembro: async ({ request, locals, platform, params }) => {
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
			.where(and(eq(giseSeccionais.id, secId), eq(giseSeccionais.gise_id, giseId))).get();
		if (!sec) return fail(404, { error: 'Seccional não encontrada' });

		if (isAdminSeccional(u) && u.papel_unidade_id !== sec.seccional_id) {
			return fail(403, { error: 'Sem permissão' });
		}

		const equipe = await db.select().from(giseEquipes)
			.where(and(eq(giseEquipes.id, equipeId), eq(giseEquipes.gise_seccional_id, secId))).get();
		if (!equipe) return fail(404, { error: 'Equipe não encontrada' });

		const slotCheck = await verificarSlotEquipe(db, equipeId, policialId);
		if (!slotCheck.ok) return fail(400, { error: slotCheck.motivo });

		const conflitoCheck = await verificarConflitoMembroGise(db, giseId, policialId);
		if (!conflitoCheck.ok) return fail(400, { error: conflitoCheck.motivo });

		await adicionarGiseMembro(db, equipeId, policialId);

		const gise = await buscarGiseEscala(db, giseId);
		if (gise && !['em_definicao_supervisor', 'em_preenchimento'].includes(gise.status)) {
			await revogarAssinaturasSeccional(db, giseId, secId);
		}

		return { success: true };
	},

	removerMembro: async ({ request, locals, platform, params }) => {
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

		const membro = await db.select({ equipe_id: giseMembros.equipe_id })
			.from(giseMembros).where(eq(giseMembros.id, memId)).get();

		if (!membro) return fail(404, { error: 'Membro não encontrado' });

		if (isAdminSeccional(u)) {
			const equipeCheck = await db.select({ gise_seccional_id: giseEquipes.gise_seccional_id })
				.from(giseEquipes).where(eq(giseEquipes.id, membro.equipe_id)).get();
			if (!equipeCheck || equipeCheck.gise_seccional_id !== u.papel_unidade_id) {
				return fail(403, { error: 'Sem permissão' });
			}
		}

		await removerGiseMembro(db, memId);

		if (!['em_definicao_supervisor', 'em_preenchimento'].includes(gise.status)) {
			const equipe = await db.select({ gise_seccional_id: giseEquipes.gise_seccional_id })
				.from(giseEquipes).where(eq(giseEquipes.id, membro.equipe_id)).get();
			if (equipe) {
				await revogarAssinaturasSeccional(db, giseId, equipe.gise_seccional_id);
			}
		}

		return { success: true };
	},

	finalizarSeccional: async ({ request, locals, platform, params }) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const secId = getInt(formData, 'secId');
		if (isNaN(giseId) || isNaN(secId)) return fail(400, { error: 'IDs inválidos' });

		const db = getDB(platform);
		const sec = await db.select().from(giseSeccionais)
			.where(and(eq(giseSeccionais.id, secId), eq(giseSeccionais.gise_id, giseId))).get();
		if (!sec) return fail(404, { error: 'Seccional não encontrada' });

		if (isAdminSeccional(u) && u.papel_unidade_id !== sec.seccional_id) {
			return fail(403, { error: 'Sem permissão' });
		}

		const novoStatus = sec.status === 'retificada' ? 'preenchida_retificada' : 'preenchida';
		await atualizarGiseSeccional(db, secId, { status: novoStatus });

		const todasPreenchidas = await verificarGiseCompleta(db, giseId);
		let giseStatus = 'em_preenchimento';
		if (todasPreenchidas) {
			giseStatus = 'aguardando_assinatura';
			await atualizarGiseEscala(db, giseId, { status: 'aguardando_assinatura' });
		}

		return { success: true, gise_status: giseStatus };
	},

	salvarSlotsEquipe: async ({ request, locals, platform, params }) => {
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
		if (gise && !['em_definicao_supervisor', 'em_preenchimento'].includes(gise.status)) {
			await db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId));
			await atualizarGiseEscala(db, giseId, { status: 'em_preenchimento' });
		}

		return { success: true };
	},

	salvarHorariosSec: async ({ request, locals, platform, params }) => {
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

		const sec = await db.select().from(giseSeccionais)
			.where(and(eq(giseSeccionais.id, secId), eq(giseSeccionais.gise_id, giseId))).get();
		if (!sec) return fail(404, { error: 'Seccional não encontrada' });

		if (isAdminSeccional(u) && u.papel_unidade_id !== sec.seccional_id) {
			return fail(403, { error: 'Sem permissão' });
		}

		await atualizarGiseSeccional(db, secId, {
			hora_entrada: horaEntrada || null,
			hora_saida: horaSaida || null
		});

		if (gise && !['em_definicao_supervisor', 'em_preenchimento'].includes(gise.status)) {
			await revogarAssinaturasSeccional(db, giseId, secId);
		}

		return { success: true };
	},

	salvarHorariosEquipe: async ({ request, locals, platform, params }) => {
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

		if (!['em_definicao_supervisor', 'em_preenchimento'].includes(gise.status)) {
			const equipe = await db.select({ gise_seccional_id: giseEquipes.gise_seccional_id })
				.from(giseEquipes).where(eq(giseEquipes.id, eqId)).get();
			if (equipe) {
				await revogarAssinaturasSeccional(db, giseId, equipe.gise_seccional_id);
			}
		}

		return { success: true };
	},

	adicionarEquipe: async ({ request, locals, platform, params }) => {
		const u = locals.usuario;
		if (!u || !isAdminGeral(u)) return fail(403, { error: 'Apenas Admin Geral' });

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const secId = getInt(formData, 'secId');
		if (isNaN(giseId) || isNaN(secId)) return fail(400, { error: 'IDs inválidos' });

		const tipo = formData.get('tipo') as 'operacional' | 'seint';
		const slotsDpc = parseInt(formData.get('slots_dpc') as string);
		const slotsOip = parseInt(formData.get('slots_oip') as string);

		if (!tipo || (tipo !== 'operacional' && tipo !== 'seint')) return fail(400, { error: 'Tipo inválido' });

		const db = getDB(platform);
		const gise = await buscarGiseEscala(db, giseId);
		if (!gise) return fail(404, { error: 'GISE não encontrada' });
		if (gise.status === 'finalizada') return fail(400, { error: 'Escala finalizada' });

		await criarGiseEquipe(db, secId, tipo, isNaN(slotsDpc) ? 0 : slotsDpc, isNaN(slotsOip) ? 0 : slotsOip);

		if (!['em_definicao_supervisor', 'em_preenchimento'].includes(gise.status)) {
			await db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId));
			await atualizarGiseEscala(db, giseId, { status: 'em_preenchimento' });
		}

		return { success: true };
	},

	solicitarAssinatura: async ({ locals, platform, params }) => {
		const u = locals.usuario;
		if (!u || !isAdminGeral(u)) return fail(403, { error: 'Apenas Admin Geral' });

		const giseId = parseInt(params.id);
		if (isNaN(giseId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);
		await atualizarGiseEscala(db, giseId, { status: 'aguardando_assinatura' });
		return { success: true };
	},

	finalizarGise: async ({ locals, platform, params }) => {
		const u = locals.usuario;
		if (!u || !isAdminGeral(u)) return fail(403, { error: 'Apenas Admin Geral' });

		const giseId = parseInt(params.id);
		if (isNaN(giseId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);
		const gise = await buscarGiseEscala(db, giseId);
		if (!gise) return fail(404, { error: 'GISE não encontrada' });
		if (gise.status === 'finalizada') return fail(400, { error: 'Já finalizada' });

		if (!['pronta_para_finalizar', 'em_andamento'].includes(gise.status)) {
			return fail(400, { error: 'Status não permite finalizar' });
		}

		await atualizarGiseEscala(db, giseId, { status: 'finalizada' });
		return { success: true };
	},

	reabrirEscala: async ({ locals, platform, params }) => {
		const u = locals.usuario;
		if (!u || !isAdminGeral(u)) return fail(403, { error: 'Apenas Admin Geral' });

		const giseId = parseInt(params.id);
		if (isNaN(giseId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);
		const gise = await buscarGiseEscala(db, giseId);
		if (!gise) return fail(404, { error: 'GISE não encontrada' });

		const statusValidos = ['em_andamento', 'aguardando_relatorios', 'aguardando_assinatura_relat', 'pronta_para_finalizar', 'finalizada'];
		if (!statusValidos.includes(gise.status)) {
			return fail(400, { error: 'Status não permite reabrir' });
		}

		await reabrirGiseEscala(db, giseId);
		return { success: true };
	},

	salvarDatasHorarios: async ({ request, locals, platform, params }) => {
		const u = locals.usuario;
		if (!u || !isAdminGeral(u)) return fail(403, { error: 'Apenas Admin Geral' });

		const giseId = parseInt(params.id);
		if (isNaN(giseId)) return fail(400, { error: 'ID inválido' });

		const formData = await request.formData();
		const dataInicio = formData.get('data_inicio') as string;
		const horaEntrada = formData.get('hora_entrada') as string;
		const horaSaida = formData.get('hora_saida') as string;

		if (!dataInicio || !horaEntrada || !horaSaida) {
			return fail(400, { error: 'Preencha todos os campos' });
		}

		const db = getDB(platform);
		const gise = await buscarGiseEscala(db, giseId);
		if (!gise) return fail(404, { error: 'GISE não encontrada' });

		const updateData: any = {
			data_inicio: dataInicio,
			hora_entrada: horaEntrada,
			hora_saida: horaSaida
		};

		let deveResetarStatus = false;
		if ([
			'aguardando_assinatura', 'em_andamento', 'aguardando_relatorios',
			'aguardando_assinatura_relat', 'pronta_para_finalizar', 'finalizada'
		].includes(gise.status)) {
			await db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId));
			updateData.status = 'em_preenchimento';
			deveResetarStatus = true;
		}

		await atualizarGiseEscala(db, giseId, updateData);
		return { success: true, assinatura_revogada: deveResetarStatus };
	},

	excluirGise: async ({ locals, platform, params }) => {
		const u = locals.usuario;
		if (!u || !isAdminGeral(u)) return fail(403, { error: 'Apenas Admin Geral' });

		const giseId = parseInt(params.id);
		if (isNaN(giseId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);
		const gise = await buscarGiseEscala(db, giseId);
		if (!gise) return fail(404, { error: 'GISE não encontrada' });

		const fileKeys = new Set<string>();

		const [docs, presencas, assRelat] = await Promise.all([
			db.select({ r2: giseDocumentos.r2_key, selfie: giseDocumentos.selfie_key })
				.from(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId)).all(),
			db.select({ entrada: gisePresencas.entrada_selfie_key, saida: gisePresencas.saida_selfie_key })
				.from(gisePresencas).where(eq(gisePresencas.gise_id, giseId)).all(),
			db.select({ selfie: giseAssinaturasRelatorios.selfie_key })
				.from(giseAssinaturasRelatorios).where(eq(giseAssinaturasRelatorios.gise_id, giseId)).all()
		]);

		docs.forEach(d => { if (d.r2) fileKeys.add(d.r2); if (d.selfie) fileKeys.add(d.selfie); });
		presencas.forEach(p => { if (p.entrada) fileKeys.add(p.entrada); if (p.saida) fileKeys.add(p.saida); });
		assRelat.forEach(a => { if (a.selfie) fileKeys.add(a.selfie); });

		const r2 = getR2(platform);
		if (r2) {
			try {
				const [yyyy, mm, dd] = gise.data_inicio.split('-');
				const prefix = `gise/${yyyy}-${mm}/${dd}/${giseId}/`;
				let listed = await r2.list({ prefix });
				listed.objects.forEach((obj: any) => fileKeys.add(obj.key));
				while (listed.truncated) {
					listed = await r2.list({ prefix, cursor: listed.cursor });
					listed.objects.forEach((obj: any) => fileKeys.add(obj.key));
				}
			} catch (e) {
				console.warn('[GISE DELETE] Erro ao listar prefixo R2:', e);
			}

			if (fileKeys.size > 0) {
				await Promise.allSettled(Array.from(fileKeys).map(key => r2.delete(key)));
			}
		}

		await db.delete(giseEscalas).where(eq(giseEscalas.id, giseId));
		return { success: true, files_deleted: fileKeys.size };
	},

	removerEquipe: async ({ request, locals, platform, params }) => {
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

		const equipe = await db.select({ gise_seccional_id: giseEquipes.gise_seccional_id })
			.from(giseEquipes).where(eq(giseEquipes.id, equipeId)).get();

		await excluirGiseEquipe(db, equipeId);

		// Revogar se necessário
		if (equipe && !['em_definicao_supervisor', 'em_preenchimento'].includes(gise.status)) {
			await revogarAssinaturasSeccional(db, giseId, equipe.gise_seccional_id);
		}

		return { success: true };
	}
};
