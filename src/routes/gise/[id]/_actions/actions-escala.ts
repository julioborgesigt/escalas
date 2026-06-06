import { fail } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import {
	getDB,
	getR2,
	buscarGiseEscala,
	atualizarGiseEscala,
	reabrirGiseEscala,
	verificarConflitoHorarioPorGise
} from '$lib/db';
import { isAdminGeral } from '$lib/auth';
import { invalidarPapelGiseMultiplos, coletarAfetadosGise } from '$lib/server/gise-papel-cache';
import {
	agendarSyncBaseEquipeAposFinalizar,
	executarSyncBaseEquipeGiseComResultado,
	type BaseEquipeEnv
} from '$lib/server/gise-base-equipe-sync';
import { logger } from '$lib/server/logger';
import {
	policiais,
	giseDocumentos,
	gisePresencas,
	giseAssinaturasRelatorios,
	giseEscalas
} from '$lib/server/schema';
import { eq } from 'drizzle-orm';

type Event = RequestEvent<{ id: string }>;

export const actionsEscala = {
	salvarSupervisores: async ({ request, locals, platform, params }: Event) => {
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
			const p = await db
				.select({ cargo: policiais.cargo })
				.from(policiais)
				.where(eq(policiais.id, supervisorId))
				.get();
			if (!p) return fail(404, { error: 'Supervisor não encontrado' });
			if (p.cargo !== 'DPC') return fail(400, { error: 'Apenas DPC pode ser Supervisor' });
		}

		const checkOip = async (id: number | null, label: string) => {
			if (id !== null) {
				const p = await db
					.select({ cargo: policiais.cargo })
					.from(policiais)
					.where(eq(policiais.id, id))
					.get();
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

		const assessorEmailRaw = (
			(formData.get('assessor_email_notificacao') as string | null) ?? ''
		).trim();
		const confirmarRaw = formData.get('confirmar_email_assessor');
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
				return fail(400, {
					error:
						'Informe o e-mail do assessor para receber avisos quando as seccionais enviarem a GISE.'
				});
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

	salvarBreveRelatorio: async ({ request, locals, platform, params }: Event) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });
		if (!isAdminGeral(u)) return fail(403, { error: 'Apenas Admin Geral' });

		const giseId = parseInt(params.id);
		if (isNaN(giseId)) return fail(400, { error: 'ID inválido' });

		const formData = await request.formData();
		const titulo = (formData.get('breve_relatorio_titulo') as string | null)?.trim() ?? '';
		const textoSec =
			(formData.get('breve_relatorio_texto_seccional') as string | null)?.trim() ?? '';
		const textoSup =
			(formData.get('breve_relatorio_texto_supervisao') as string | null)?.trim() ?? '';

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

	salvarDatasHorarios: async ({ request, locals, platform, params }: Event) => {
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
		if (
			[
				'aguardando_assinatura',
				'em_andamento',
				'aguardando_relatorios',
				'aguardando_assinatura_relat',
				'pronta_para_finalizar',
				'finalizada'
			].includes(gise.status)
		) {
			await db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId));
			updateData.status = 'em_preenchimento';
			deveResetarStatus = true;
		}

		await atualizarGiseEscala(db, giseId, updateData);
		return { success: true, assinatura_revogada: deveResetarStatus };
	},

	solicitarAssinatura: async ({ locals, platform, params }: Event) => {
		const u = locals.usuario;
		if (!u || !isAdminGeral(u)) return fail(403, { error: 'Apenas Admin Geral' });

		const giseId = parseInt(params.id);
		if (isNaN(giseId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);
		await atualizarGiseEscala(db, giseId, { status: 'aguardando_assinatura' });
		return { success: true };
	},

	revogarPedidoAssinatura: async ({ locals, platform, params }: Event) => {
		const u = locals.usuario;
		if (!u || !isAdminGeral(u)) return fail(403, { error: 'Apenas Admin Geral' });

		const giseId = parseInt(params.id);
		if (isNaN(giseId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);
		const gise = await buscarGiseEscala(db, giseId);
		if (!gise) return fail(404, { error: 'GISE não encontrada' });
		if (gise.status !== 'aguardando_assinatura')
			return fail(400, { error: 'Escala não está aguardando assinatura' });

		await atualizarGiseEscala(db, giseId, { status: 'em_preenchimento' });
		return { success: true };
	},

	finalizarGise: async ({ locals, platform, params }: Event) => {
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

		const afetados = await coletarAfetadosGise(db, giseId);
		await atualizarGiseEscala(db, giseId, { status: 'finalizada' });
		await invalidarPapelGiseMultiplos(afetados);

		agendarSyncBaseEquipeAposFinalizar(platform, db, giseId);

		return { success: true };
	},

	reenviarBaseEquipePlanilha: async ({ locals, platform, params }: Event) => {
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

	reabrirEscala: async ({ locals, platform, params }: Event) => {
		const u = locals.usuario;
		if (!u || !isAdminGeral(u)) return fail(403, { error: 'Apenas Admin Geral' });

		const giseId = parseInt(params.id);
		if (isNaN(giseId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);
		const gise = await buscarGiseEscala(db, giseId);
		if (!gise) return fail(404, { error: 'GISE não encontrada' });

		const statusValidos = [
			'em_andamento',
			'aguardando_relatorios',
			'aguardando_assinatura_relat',
			'pronta_para_finalizar',
			'finalizada'
		];
		if (!statusValidos.includes(gise.status)) {
			return fail(400, { error: 'Status não permite reabrir' });
		}

		const afetados = await coletarAfetadosGise(db, giseId);
		await reabrirGiseEscala(db, giseId);
		await invalidarPapelGiseMultiplos(afetados);

		return { success: true };
	},

	excluirGise: async ({ locals, platform, params }: Event) => {
		const u = locals.usuario;
		if (!u || !isAdminGeral(u)) return fail(403, { error: 'Apenas Admin Geral' });

		const giseId = parseInt(params.id);
		if (isNaN(giseId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);
		const gise = await buscarGiseEscala(db, giseId);
		if (!gise) return fail(404, { error: 'GISE não encontrada' });

		const afetados = await coletarAfetadosGise(db, giseId);

		const fileKeys = new Set<string>();

		const [docs, presencas, assRelat] = await Promise.all([
			db
				.select({ r2: giseDocumentos.r2_key, selfie: giseDocumentos.selfie_key })
				.from(giseDocumentos)
				.where(eq(giseDocumentos.gise_id, giseId))
				.all(),
			db
				.select({
					entrada: gisePresencas.entrada_selfie_key,
					saida: gisePresencas.saida_selfie_key
				})
				.from(gisePresencas)
				.where(eq(gisePresencas.gise_id, giseId))
				.all(),
			db
				.select({ selfie: giseAssinaturasRelatorios.selfie_key })
				.from(giseAssinaturasRelatorios)
				.where(eq(giseAssinaturasRelatorios.gise_id, giseId))
				.all()
		]);

		docs.forEach((d) => {
			if (d.r2) fileKeys.add(d.r2);
			if (d.selfie) fileKeys.add(d.selfie);
		});
		presencas.forEach((p) => {
			if (p.entrada) fileKeys.add(p.entrada);
			if (p.saida) fileKeys.add(p.saida);
		});
		assRelat.forEach((a) => {
			if (a.selfie) fileKeys.add(a.selfie);
		});

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
				await Promise.allSettled(Array.from(fileKeys).map((key) => r2.delete(key)));
			}
		}

		await db.delete(giseEscalas).where(eq(giseEscalas.id, giseId));
		await invalidarPapelGiseMultiplos(afetados);
		return { success: true, files_deleted: fileKeys.size };
	}
};
