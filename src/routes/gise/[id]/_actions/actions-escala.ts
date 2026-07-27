import { fail } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import {
	getDB,
	getR2,
	buscarGiseEscala,
	atualizarGiseEscala,
	reabrirGiseEscala,
	verificarConflitoHorarioPorGise,
	auditar,
	contextoDeEvento
} from '$lib/db';
import { isAdminGeral } from '$lib/auth';
import { invalidarPapelGiseMultiplos, coletarAfetadosGise } from '$lib/server/gise-papel-cache';
import {
	agendarSyncBaseEquipeAposFinalizar,
	executarSyncBaseEquipeGiseComResultado,
	type BaseEquipeEnv
} from '$lib/server/gise-base-equipe-sync';
import { policiais, giseDocumentos, giseEscalas } from '$lib/server/schema';
import { limparR2DaGise } from '$lib/server/r2-cleanup';
import { eq } from 'drizzle-orm';
import { saiuDaFaseDeEdicao } from './shared';

type Event = RequestEvent<{ id: string }>;

/**
 * Form actions da ESCALA GISE em si (quadro de supervisão, datas, ciclo de
 * status e exclusão). Todas restritas ao Admin Geral.
 */
export const actionsEscala = {
	/**
	 * Define supervisor, assessor e os dois SEINT.
	 *
	 * As regras de cargo vêm da estrutura da corporação: supervisão é de delegado
	 * (DPC) e as demais funções são de OIP. É também aqui que a GISE sai de
	 * `em_definicao_supervisor` — ter supervisor é o que a torna preenchível
	 * pelas seccionais.
	 */
	salvarSupervisores: async (event: Event) => {
		const { request, locals, platform, params } = event;
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

		// Devolve o próprio `fail(...)` para o chamador repassar — evita repetir o
		// bloco de consulta + validação nos três papéis de OIP.
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

		// O assessor recebe aviso por e-mail a cada seccional que finaliza o
		// preenchimento; sem endereço confirmado a função não faz sentido, por isso
		// a confirmação é obrigatória quando há assessor.
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

		// Ninguém pode estar em duas escalas no mesmo horário — inclusive no quadro
		// de supervisão, que não passa pelas validações de equipe.
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

		// Invalida o cache de papel de quem SAIU e de quem ENTROU: os dois lados
		// mudam de acesso ao `/res-gise`.
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

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'editar_gise',
				usuario: u,
				entidade: 'gise',
				entidade_id: giseId,
				alvo_tipo: 'gise',
				alvo_id: giseId,
				detalhes: `Quadro de supervisão da GISE ${giseId} definido`,
				dados_antes: {
					supervisor_id: gise.supervisor_id,
					assessor_id: gise.assessor_id,
					seint1_id: gise.seint1_id,
					seint2_id: gise.seint2_id
				},
				dados_depois: {
					supervisor_id: supervisorId,
					assessor_id: assessorId,
					seint1_id: seint1Id,
					seint2_id: seint2Id
				},
				...contexto
			},
			{ env }
		);

		return { success: true };
	},

	/**
	 * Textos do breve relatório desta GISE. String vazia grava `null`, que faz o
	 * documento cair no texto padrão de `/gise/config`.
	 */
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

	/**
	 * Data e horário-base da escala. Mudou depois que o PDF foi gerado? O
	 * documento é descartado e a GISE volta a `em_preenchimento` — a resposta
	 * avisa a tela (`assinatura_revogada`) para o usuário entender o retrocesso.
	 */
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

		const updateData: {
			data_inicio: string;
			hora_entrada: string;
			hora_saida: string;
			feriado: boolean;
			status?: 'em_preenchimento';
		} = {
			data_inicio: dataInicio,
			hora_entrada: horaEntrada,
			hora_saida: horaSaida,
			feriado: feriado
		};

		let deveResetarStatus = false;
		if (saiuDaFaseDeEdicao(gise.status)) {
			await db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId));
			updateData.status = 'em_preenchimento';
			deveResetarStatus = true;
		}

		await atualizarGiseEscala(db, giseId, updateData);
		return { success: true, assinatura_revogada: deveResetarStatus };
	},

	/** Envia a escala para a assinatura do supervisor. */
	solicitarAssinatura: async ({ locals, platform, params }: Event) => {
		const u = locals.usuario;
		if (!u || !isAdminGeral(u)) return fail(403, { error: 'Apenas Admin Geral' });

		const giseId = parseInt(params.id);
		if (isNaN(giseId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);
		await atualizarGiseEscala(db, giseId, { status: 'aguardando_assinatura' });
		return { success: true };
	},

	/** Desfaz o pedido enquanto ninguém assinou (só vale em `aguardando_assinatura`). */
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

	/**
	 * Encerra a GISE. Dispara, sem bloquear a resposta, o envio da base de equipe
	 * para a planilha institucional (`agendarSyncBaseEquipeAposFinalizar`).
	 */
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

		// Coleta os policiais ANTES de mexer no status: é a lista de caches de papel
		// a invalidar depois.
		const afetados = await coletarAfetadosGise(db, giseId);
		await atualizarGiseEscala(db, giseId, { status: 'finalizada' });
		await invalidarPapelGiseMultiplos(afetados);

		agendarSyncBaseEquipeAposFinalizar(platform, db, giseId);

		return { success: true };
	},

	/** Reenvio manual da base de equipe, para quando o envio automático falhou. */
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

	/**
	 * Devolve uma escala já em operação para edição. Não vale para
	 * `aguardando_assinatura` — nesse ponto o caminho é `revogarPedidoAssinatura`.
	 */
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

	/** Exclui a GISE e tudo que ela gerou (linhas em cascata + arquivos no R2). */
	excluirGise: async ({ locals, platform, params }: Event) => {
		const u = locals.usuario;
		if (!u || !isAdminGeral(u)) return fail(403, { error: 'Apenas Admin Geral' });

		const giseId = parseInt(params.id);
		if (isNaN(giseId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);
		const gise = await buscarGiseEscala(db, giseId);
		if (!gise) return fail(404, { error: 'GISE não encontrada' });

		const afetados = await coletarAfetadosGise(db, giseId);

		// Limpeza unificada do R2 (blobs + conferências + selfies) — mesmo helper
		// usado por reabrir/revogar. Além de remover a duplicação, corrige o furo
		// em que as cópias de conferência (`conferencia/<hash>.pdf`, prefixo PLANO)
		// escapavam da varredura por prefixo `gise/...` e ficavam órfãs.
		const r2 = getR2(platform);
		const filesDeleted = r2 ? await limparR2DaGise(db, r2, gise) : 0;

		await db.delete(giseEscalas).where(eq(giseEscalas.id, giseId));
		await invalidarPapelGiseMultiplos(afetados);
		return { success: true, files_deleted: filesDeleted };
	}
};
