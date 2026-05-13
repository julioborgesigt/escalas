import type { PageServerLoad, Actions } from './$types';
import { redirect, error, fail } from '@sveltejs/kit';
import {
	getDB,
	getR2,
	buscarGiseDetalhado,
	buscarPresencasGise,
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
	verificarConflitoHorarioPolicial,
	verificarConflitoHorarioPorGise,
	revogarAssinaturasSeccional,
	reabrirGiseEscala,
	buscarRestringirSmartphone,
	adicionarGiseSeccionalUnidade,
	atualizarGiseSeccionalUnidade,
	removerGiseSeccionalUnidade
} from '$lib/db';
import { isAdminGeral, isAdminSeccional, isAdminUnidade } from '$lib/auth';
import { invalidarPapelGise, invalidarPapelGiseMultiplos, coletarAfetadosGise } from '$lib/server/gise-papel-cache';
import {
	agendarSyncBaseEquipeAposFinalizar,
	executarSyncBaseEquipeGiseComResultado,
	type BaseEquipeEnv
} from '$lib/server/gise-base-equipe-sync';
import { logger } from '$lib/server/logger';
import { enviarNotificacaoAssessorGisePreenchimentoSeccional } from '$lib/server/email';
import { montarTextoNotificacaoAssessorGise } from '$lib/server/gise-assessor-notificacao-text';
import { buscarUnidadeIdSupervisaoExtra } from '$lib/server/gise-supervisao-extra';
import { getBreveRelatorioEnvMergido } from '$lib/server/breve-relatorio-env';
import { unidades, policiais, giseEscalas, giseDocumentos, gisePresencas, giseAssinaturasRelatorios, giseMembros, giseEquipes, giseSeccionais, giseSeccionalUnidades, giseRespostasFormulario } from '$lib/server/schema';
import { eq, asc, inArray, and, isNull } from 'drizzle-orm';

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

export const load: PageServerLoad = async ({ locals, params, platform, depends, parent }) => {
	depends('gise:detail');
	const u = locals.usuario;
	if (!u) throw redirect(302, '/login');

	const id = parseInt(params.id);
	if (isNaN(id)) throw error(400, 'ID inválido');

	const db = getDB(platform);

	const isGeral = isAdminGeral(u);
	const isSeccional = isAdminSeccional(u);

	// isSupervisorGise já resolvido pelo layout (evita query duplicada)
	const parentData = await parent();
	const isSupervisor = u.tipo === 'policial' ? (parentData.isSupervisorGise ?? false) : false;

	if (!isGeral && !isSeccional && !isSupervisor) {
		throw redirect(302, '/');
	}

	try {
		const gise = await buscarGiseDetalhado(db, id);
		if (!gise) throw error(404, 'Escala GISE não encontrada');

		const supportIds = [
			gise.supervisor_id,
			gise.assessor_id,
			gise.seint1_id,
			gise.seint2_id
		].filter((val): val is number => val !== null);

		// Antes carregávamos até 10 000 policiais aqui só para popular `<SearchableSelect>`
		// no cliente. Agora os selects buscam sob demanda em `/api/policiais/search`
		// (paginado, com RBAC). O servidor só envia o **mínimo necessário** para
		// renderizar labels dos valores já selecionados:
		//   - Os 4 supportIds (supervisor/assessor/SEINT1/SEINT2) — para o card de supervisão.
		//   - Membros já alocados são entregues via `gise.seccionais[].equipes[].membros`
		//     (já vêm com nome/matrícula em `buscarGiseDetalhado`), nada a fazer.
		const policiaisPromise: Promise<Array<{
			id: number;
			nome: string;
			matricula: string;
			cargo: 'DPC' | 'OIP';
			lotacao: string;
			email: string | null;
			email_pessoal: string | null;
		}>> =
			supportIds.length > 0
				? db
						.select({
							id: policiais.id,
							nome: policiais.nome,
							matricula: policiais.matricula,
							cargo: policiais.cargo,
							lotacao: policiais.lotacao,
							email: policiais.email,
							email_pessoal: policiais.email_pessoal
						})
						.from(policiais)
						.where(and(eq(policiais.ativo, 1), inArray(policiais.id, supportIds)))
						.orderBy(asc(policiais.nome))
				: Promise.resolve([]);

		const seintIdsParaRelatorio = [gise.seint1_id, gise.seint2_id].filter((x): x is number => x != null);

		/** E-mail do assessor já vinculado à GISE (pessoal ou institucional), só para Admin Geral — não depende da lista enxuta nem de `ativo`. */
		const assessorEmailRowPromise =
			isGeral && gise.assessor_id
				? db
						.select({
							email_pessoal: policiais.email_pessoal,
							email: policiais.email
						})
						.from(policiais)
						.where(eq(policiais.id, gise.assessor_id))
						.get()
				: Promise.resolve(null as { email_pessoal: string | null; email: string | null } | null);

		// Queries paralelas restantes
		const [
			policiaisListResult,
			todasUnidades,
			assinaturasRelatorios,
			restringirSmartphone,
			presencasGise,
			supervisaoExtraUnidadeId,
			respostasSeintSupervisaoRows,
			assessorEmailRow
		] = await Promise.all([
			policiaisPromise,
			db.select().from(unidades).orderBy(asc(unidades.nome)),
			buscarAssinaturasRelatoriosGise(db, id),
			buscarRestringirSmartphone(db),
			buscarPresencasGise(db, id),
			buscarUnidadeIdSupervisaoExtra(db),
			seintIdsParaRelatorio.length
				? db
						.select({ policial_id: giseRespostasFormulario.policial_id })
						.from(giseRespostasFormulario)
						.where(
							and(
								eq(giseRespostasFormulario.gise_id, id),
								inArray(giseRespostasFormulario.policial_id, seintIdsParaRelatorio),
								isNull(giseRespostasFormulario.equipe_id)
							)
						)
						.all()
				: Promise.resolve([] as { policial_id: number | null }[]),
			assessorEmailRowPromise
		]);

		const assessorEmailSugerido =
			isGeral && assessorEmailRow
				? assessorEmailRow.email_pessoal?.trim() || assessorEmailRow.email?.trim() || null
				: null;

		const seintSupervisaoComRelatorio = [
			...new Set(
				respostasSeintSupervisaoRows.map((r) => r.policial_id).filter((pid): pid is number => pid != null)
			)
		];

		return {
			gise,
			breveRelatorioEnv: await getBreveRelatorioEnvMergido(db),
			policiais: policiaisListResult,
			assessorEmailSugerido,
			todasUnidades,
			assinaturasRelatorios,
			presencasGise,
			supervisaoExtraUnidadeId,
			seintSupervisaoComRelatorio,
			papelGise: isGeral
				? 'admin_geral'
				: isSeccional
					? 'admin_seccional'
					: isSupervisor
						? 'supervisor'
						: 'policial',
			isGeral,
			isSeccional,
			isUnidade: isAdminUnidade(u),
			isSupervisor,
			isMembro: u.tipo === 'policial' ? (parentData.isMembroGise ?? false) : false,
			minhaSeccionalId: (isSeccional || isAdminUnidade(u)) ? u.papel_unidade_id : null,
			usuarioAtual: u,
			restringirSmartphone,
			exigirFotoAssinatura: parentData.exigirFotoAssinatura,
			exigirGpsAssinatura: parentData.exigirGpsAssinatura,
			exigirCodigoEmailAssinatura: parentData.exigirCodigoEmailAssinatura
		};
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		const msg = e instanceof Error ? e.message : String(e);
		logger.error('[gise/load] Erro ao carregar GISE', {
			gise_id: id,
			error: msg,
			stack: e instanceof Error ? e.stack : undefined
		});
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
		const assessorIdStr = formData.get('assessor_id') as string;
		const assessorId = assessorIdStr ? parseInt(assessorIdStr) : null;
		const seint1IdStr = formData.get('seint1_id') as string;
		const seint1Id = seint1IdStr ? parseInt(seint1IdStr) : null;
		const seint2IdStr = formData.get('seint2_id') as string;
		const seint2Id = seint2IdStr ? parseInt(seint2IdStr) : null;

		const db = getDB(platform);
		const gise = await buscarGiseEscala(db, giseId);
		if (!gise) return fail(404, { error: 'GISE não encontrada' });

		if (supervisorId !== null) {
			const p = await db.select({ cargo: policiais.cargo }).from(policiais).where(eq(policiais.id, supervisorId)).get();
			if (!p) return fail(404, { error: 'Supervisor não encontrado' });
			if (p.cargo !== 'DPC') return fail(400, { error: 'Apenas DPC pode ser Supervisor' });
		}
		
		const checkOip = async (id: number | null, label: string) => {
			if (id !== null) {
				const p = await db.select({ cargo: policiais.cargo }).from(policiais).where(eq(policiais.id, id)).get();
				if (!p) return fail(404, { error: `${label} não encontrado` });
				if (p.cargo !== 'OIP') return fail(400, { error: `${label} deve ser OIP` });
			}
			return null;
		};

		const errAssessor = await checkOip(assessorId, 'Assessor');
		if (errAssessor) return errAssessor;
		const errSeint1 = await checkOip(seint1Id, 'SEINT 1');
		if (errSeint1) return errSeint1;
		const errSeint2 = await checkOip(seint2Id, 'SEINT 2');
		if (errSeint2) return errSeint2;

		const assessorEmailRaw = ((formData.get('assessor_email_notificacao') as string | null) ?? '').trim();
		const confirmarRaw = formData.get('confirmar_email_assessor');
		// HTML: `value="1"` → "1"; alguns clientes enviam "on" para checkbox.
		const confirmarEmailAssessor = confirmarRaw === '1' || confirmarRaw === 'on';
		const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(assessorEmailRaw);

		if (assessorId !== null) {
			if (!confirmarEmailAssessor) {
				return fail(400, {
					error:
						'Marque a confirmação do e-mail do assessor (avisos de preenchimento das seccionais) ou remova o assessor.'
				});
			}
			if (!assessorEmailRaw) {
				return fail(400, { error: 'Informe o e-mail do assessor para receber avisos quando as seccionais enviarem a GISE.' });
			}
			if (!emailOk) {
				return fail(400, { error: 'E-mail do assessor inválido.' });
			}
		}

		const rolesParaVerificar: Array<[number | null, string]> = [
			[supervisorId, 'Supervisor'],
			[assessorId, 'Assessor'],
			[seint1Id, 'SEINT 1'],
			[seint2Id, 'SEINT 2']
		];
		for (const [pid, label] of rolesParaVerificar) {
			if (pid === null) continue;
			const horarioCheck = await verificarConflitoHorarioPorGise(db, giseId, pid);
			if (!horarioCheck.ok) return fail(400, { error: `${label}: ${horarioCheck.motivo}` });
		}

		const updateData = {
			supervisor_id: supervisorId,
			assessor_id: assessorId,
			seint1_id: seint1Id,
			seint2_id: seint2Id,
			assessor_email_notificacao: assessorId !== null ? assessorEmailRaw : null,
			...(gise.status === 'em_definicao_supervisor' ? { status: 'em_preenchimento' as const } : {})
		};

		await atualizarGiseEscala(db, giseId, updateData);

		// Cache invalidation: o "isSupervisor" muda quando o supervisor entra ou sai.
		// Invalida o anterior (lido antes do update) e o novo, se diferentes.
		await invalidarPapelGiseMultiplos([
			gise.supervisor_id,
			supervisorId,
			gise.assessor_id,
			assessorId,
			gise.seint1_id,
			seint1Id,
			gise.seint2_id,
			seint2Id
		]);

		return { success: true };
	},

	/** Textos do bloco "Breve relatório" nos PDFs de extra (por GISE; vazio = Config. GISE + padrão do sistema). */
	salvarBreveRelatorio: async ({ request, locals, platform, params }) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });
		if (!isAdminGeral(u)) return fail(403, { error: 'Apenas Admin Geral' });

		const giseId = parseInt(params.id);
		if (isNaN(giseId)) return fail(400, { error: 'ID inválido' });

		const formData = await request.formData();
		const titulo = (formData.get('breve_relatorio_titulo') as string | null)?.trim() ?? '';
		const textoSec = (formData.get('breve_relatorio_texto_seccional') as string | null)?.trim() ?? '';
		const textoSup = (formData.get('breve_relatorio_texto_supervisao') as string | null)?.trim() ?? '';

		const db = getDB(platform);
		const gise = await buscarGiseEscala(db, giseId);
		if (!gise) return fail(404, { error: 'GISE não encontrada' });

		await atualizarGiseEscala(db, giseId, {
			breve_relatorio_titulo: titulo ? titulo : null,
			breve_relatorio_texto_seccional: textoSec ? textoSec : null,
			breve_relatorio_texto_supervisao: textoSup ? textoSup : null
		});

		return { success: true };
	},

	// Admin Seccional: seleciona a unidade para um slot em branco criado pelo Admin Geral
	selecionarUnidade: async ({ request, locals, platform, params }) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const slotId = getInt(formData, 'slotId');
		const unidadeId = getInt(formData, 'unidadeId');
		if (isNaN(giseId) || isNaN(slotId) || isNaN(unidadeId)) return fail(400, { error: 'IDs inválidos' });

		const db = getDB(platform);

		// Verifica que o slot pertence a uma seccional desta GISE
		const slotInfo = await db
			.select({ gise_seccional_id: giseSeccionalUnidades.gise_seccional_id })
			.from(giseSeccionalUnidades)
			.where(eq(giseSeccionalUnidades.id, slotId))
			.get();
		if (!slotInfo) return fail(404, { error: 'Slot não encontrado' });

		const sec = await db.select().from(giseSeccionais)
			.where(and(eq(giseSeccionais.id, slotInfo.gise_seccional_id), eq(giseSeccionais.gise_id, giseId)))
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

		const [novaSec] = await db.insert(giseSeccionais).values({
			gise_id: giseId,
			seccional_id: seccionalId,
			status: 'pendente'
		}).returning({ id: giseSeccionais.id });

		if (novaSec) {
			await adicionarGiseSeccionalUnidade(db, novaSec.id, null);
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

		const horarioCheck = await verificarConflitoHorarioPolicial(db, equipeId, policialId);
		if (!horarioCheck.ok) return fail(400, { error: horarioCheck.motivo });

		await adicionarGiseMembro(db, equipeId, policialId);

		// Cache invalidation: o "isMembro" do policial muda agora.
		await invalidarPapelGise(policialId);

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

		// Join com giseSeccionais para obter seccional_id (unidades.id) e comparar corretamente
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

		// Cache invalidation: o "isMembro" do policial muda agora.
		await invalidarPapelGise(membroInfo.policial_id);

		if (!['em_definicao_supervisor', 'em_preenchimento'].includes(gise.status)) {
			await revogarAssinaturasSeccional(db, giseId, membroInfo.gise_seccional_id);
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

		// Valida que todos os slots têm unidade definida e pelo menos 1 membro
		const slots = await db
			.select({ id: giseSeccionalUnidades.id, unidade_id: giseSeccionalUnidades.unidade_id })
			.from(giseSeccionalUnidades)
			.where(eq(giseSeccionalUnidades.gise_seccional_id, secId))
			.all();

		if (slots.length === 0) return fail(400, { error: 'Adicione ao menos uma unidade antes de finalizar' });

		const slotSemUnidade = slots.find(s => s.unidade_id === null);
		if (slotSemUnidade) return fail(400, { error: 'Todos os slots devem ter uma unidade selecionada' });

		const slotIds = slots.map(s => s.id);
		const membrosPorSlot = await db
			.select({ gise_unidade_id: giseEquipes.gise_unidade_id })
			.from(giseMembros)
			.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
			.where(inArray(giseEquipes.gise_unidade_id, slotIds))
			.all();

		const slotsComMembros = new Set(membrosPorSlot.map(m => m.gise_unidade_id));
		const slotSemMembro = slots.find(s => !slotsComMembros.has(s.id));
		if (slotSemMembro) return fail(400, { error: 'Cada unidade deve ter pelo menos 1 policial alocado' });

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

		if (giseRow?.assessor_id && secComNome?.nome) {
			let destino = (giseRow.assessor_email_notificacao && giseRow.assessor_email_notificacao.trim()) || '';
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
				logger.warn('[gise/finalizarSeccional] Assessor sem e-mail para notificação; e-mail não enviado.', {
					giseId,
					assessor_id: giseRow.assessor_id
				});
			}
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

		// unidadeId = gise_seccional_unidades.id — equipe pertence a um slot de unidade
		const unidadeIdRaw = formData.get('unidadeId') as string;
		const unidadeId = unidadeIdRaw ? parseInt(unidadeIdRaw) : null;

		const db = getDB(platform);
		const gise = await buscarGiseEscala(db, giseId);
		if (!gise) return fail(404, { error: 'GISE não encontrada' });
		if (gise.status === 'finalizada') return fail(400, { error: 'Escala finalizada' });

		await criarGiseEquipe(
			db, secId, tipo,
			isNaN(slotsDpc) ? 0 : slotsDpc,
			isNaN(slotsOip) ? 0 : slotsOip,
			unidadeId
		);

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

	revogarPedidoAssinatura: async ({ locals, platform, params }) => {
		const u = locals.usuario;
		if (!u || !isAdminGeral(u)) return fail(403, { error: 'Apenas Admin Geral' });

		const giseId = parseInt(params.id);
		if (isNaN(giseId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);
		const gise = await buscarGiseEscala(db, giseId);
		if (!gise) return fail(404, { error: 'GISE não encontrada' });
		if (gise.status !== 'aguardando_assinatura') return fail(400, { error: 'Escala não está aguardando assinatura' });

		await atualizarGiseEscala(db, giseId, { status: 'em_preenchimento' });
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

		// Cache invalidation: ao finalizar, supervisor + todos membros perdem o
		// papel GISE — precisamos coletar antes do update.
		const afetados = await coletarAfetadosGise(db, giseId);
		await atualizarGiseEscala(db, giseId, { status: 'finalizada' });
		await invalidarPapelGiseMultiplos(afetados);

		agendarSyncBaseEquipeAposFinalizar(platform, db, giseId);

		return { success: true };
	},

	reenviarBaseEquipePlanilha: async ({ locals, platform, params }) => {
		const u = locals.usuario;
		if (!u || !isAdminGeral(u)) return fail(403, { error: 'Apenas Admin Geral' });

		const giseId = parseInt(params.id);
		if (isNaN(giseId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);
		const gise = await buscarGiseEscala(db, giseId);
		if (!gise) return fail(404, { error: 'GISE não encontrada' });
		if (gise.status !== 'finalizada') {
			return fail(400, { error: 'Só é possível enviar à planilha com a escala finalizada.' });
		}

		const r = await executarSyncBaseEquipeGiseComResultado(
			platform?.env as BaseEquipeEnv | undefined,
			db,
			giseId
		);
		if (!r.ok) {
			return fail(502, { error: r.error });
		}
		await atualizarGiseEscala(db, giseId, {
			planilha_base_equipe_alimentada_em: new Date().toISOString()
		});
		return { success: true, linhas: r.linhas };
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

		// Cache invalidation: ao reabrir uma GISE finalizada, supervisor + membros
		// voltam a ter papel ativo — coletamos os IDs antes da mudança de status.
		const afetados = await coletarAfetadosGise(db, giseId);
		await reabrirGiseEscala(db, giseId);
		await invalidarPapelGiseMultiplos(afetados);

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
		const feriado = formData.get('feriado') === 'true';

		if (!dataInicio || !horaEntrada || !horaSaida) {
			return fail(400, { error: 'Preencha todos os campos' });
		}

		const db = getDB(platform);
		const gise = await buscarGiseEscala(db, giseId);
		if (!gise) return fail(404, { error: 'GISE não encontrada' });

		const updateData: any = {
			data_inicio: dataInicio,
			hora_entrada: horaEntrada,
			hora_saida: horaSaida,
			feriado: feriado
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

		// Cache invalidation: coleta antes do CASCADE deletar tudo.
		const afetados = await coletarAfetadosGise(db, giseId);

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
				logger.warn('[gise/excluir] Erro ao listar prefixo R2', {
					gise_id: giseId,
					error: e instanceof Error ? e.message : String(e)
				});
			}

			if (fileKeys.size > 0) {
				await Promise.allSettled(Array.from(fileKeys).map(key => r2.delete(key)));
			}
		}

		await db.delete(giseEscalas).where(eq(giseEscalas.id, giseId));
		await invalidarPapelGiseMultiplos(afetados);
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
	},

	adicionarUnidade: async ({ request, locals, platform, params }) => {
		const u = locals.usuario;
		if (!u || !isAdminGeral(u)) return fail(403, { error: 'Apenas Admin Geral' });

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const secId = getInt(formData, 'secId');
		if (isNaN(giseId) || isNaN(secId)) return fail(400, { error: 'IDs inválidos' });

		// unidadeId é opcional: null = slot em branco para Adm Seccional preencher
		const unidadeIdRaw = formData.get('unidadeId') as string;
		const unidadeId = unidadeIdRaw ? parseInt(unidadeIdRaw) : null;

		const db = getDB(platform);
		const sec = await db.select().from(giseSeccionais)
			.where(and(eq(giseSeccionais.id, secId), eq(giseSeccionais.gise_id, giseId))).get();
		if (!sec) return fail(404, { error: 'Seccional não encontrada' });

		// Cria o slot + equipe operacional padrão vinculada
		await adicionarGiseSeccionalUnidade(db, secId, unidadeId);
		return { success: true };
	},

	removerUnidade: async ({ request, locals, platform, params }) => {
		const u = locals.usuario;
		if (!u || !isAdminGeral(u)) return fail(403, { error: 'Apenas Admin Geral' });

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const secId = getInt(formData, 'secId');
		const linkId = getInt(formData, 'linkId');
		if (isNaN(giseId) || isNaN(secId) || isNaN(linkId)) return fail(400, { error: 'IDs inválidos' });

		const db = getDB(platform);
		const sec = await db.select().from(giseSeccionais)
			.where(and(eq(giseSeccionais.id, secId), eq(giseSeccionais.gise_id, giseId))).get();
		if (!sec) return fail(404, { error: 'Seccional não encontrada' });

		// Se for slot legado (0), apagamos apenas as equipes orfãs
		if (linkId === 0) {
			const { isNull } = await import('drizzle-orm');
			await db.delete(giseEquipes).where(and(eq(giseEquipes.gise_seccional_id, secId), isNull(giseEquipes.gise_unidade_id)));
		} else {
			// CASCADE apaga equipes e membros do slot automaticamente
			await removerGiseSeccionalUnidade(db, linkId);
		}

		const gise = await buscarGiseEscala(db, giseId);
		if (gise && !['em_definicao_supervisor', 'em_preenchimento'].includes(gise.status)) {
			await revogarAssinaturasSeccional(db, giseId, secId);
		}

		return { success: true };
	}
};
