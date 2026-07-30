/**
 * `/res-gise` — a tela do POLICIAL na GISE (o Admin Geral só observa).
 *
 * Reúne, para o usuário logado, todas as escalas GISE em que ele aparece, em
 * dois papéis que vêm de origens diferentes no banco:
 *
 * - **membro de equipe** — linhas de `gise_membros`, com seccional e unidade;
 * - **quadro de supervisão** (supervisor, assessor, SEINT) — não tem equipe;
 *   essas linhas são sintetizadas com `equipe_id = 0` e `seccional_id = 0`, e o
 *   `0` é depois traduzido para `supervisaoExtraUnidadeId` na hora de casar
 *   assinaturas de relatório de extra.
 *
 * As duas mutações de presença — confirmar entrada e confirmar saída — são de
 * assinatura AVANÇADA (Lei 14.063/2020 art. 4º II): exigem rubrica, 2FA por
 * e-mail quando a flag está ligada, e gravam IP/GPS/foto como prova. Cada action
 * revalida a participação do policial na escala: a UI esconde o botão, mas o
 * POST direto precisa ser recusado no servidor.
 *
 * A terceira tarefa do policial, o relatório de produtividade, NÃO mora mais
 * aqui: o formulário virou a rota `/res-gise/relatorio/[giseId]`, com o `load` e
 * a action dele. Esta tela só mostra o estado da entrega (carimbos de envio e
 * retificação) e leva até lá.
 */

import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { ResGiseMinhaEscalaLinha, GiseModeloPerguntaConfig } from '$lib/types';
import {
	getDB,
	getR2,
	hasR2,
	buscarGiseModeloFormulario,
	buscarRespostaGise,
	buscarGiseEscala,
	resolverParticipacaoGisePolicial,
	sincronizarStatusGiseAposPresencaRelatorios,
	salvarEntradaGise,
	salvarSaidaGise,
	salvarGiseModeloFormulario,
	buscarRestringirSmartphone,
	isSupervisaoGiseAtiva,
	isSupervisorGiseAtiva,
	auditar,
	contextoDeEvento,
	DEFAULT_SEINT_QUESTIONS,
	DEFAULT_QUESTIONS_FORM_OPERACIONAL
} from '$lib/db';
import { buscarUnidadeIdSupervisaoExtra } from '$lib/server/gise-supervisao-extra';
import { lerFlagsAssinatura } from '$lib/server/cfg-ass-cache';
import { verificarDesafio2FA } from '$lib/auth';
import { logger } from '$lib/server/logger';
import { uploadSelfieDataUri } from '$lib/server/selfie-upload';
import {
	giseEscalas,
	giseMembros,
	giseEquipes,
	giseSeccionais,
	gisePresencas,
	giseDocumentos,
	unidades,
	giseAssinaturasRelatorios,
	giseRespostasFormulario,
	policiais
} from '$lib/server/schema';
import { eq, and, inArray, desc, like, sql } from 'drizzle-orm';
interface GiseEscalaItem {
	id: number;
	data_inicio: string;
	status: string;
	hora_entrada: string | null;
	hora_saida: string | null;
	equipe_id: number;
	sec_hora_entrada: string | null;
	sec_hora_saida: string | null;
	eq_hora_entrada: string | null;
	eq_hora_saida: string | null;
	equipe_tipo: 'operacional' | 'seint' | 'assessor' | 'supervisor';
	seccional_id: number;
	seccional_nome: string;
}

type GisePresenca = typeof gisePresencas.$inferSelect;

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	const u = locals.usuario;
	if (!u) redirect(302, '/login');

	// Filtros da tela. "Ativa × finalizada" NÃO é o status da escala: uma GISE em
	// andamento já é "finalizada" para quem bateu a saída (ver `isFinished`).
	const statusFilter = url.searchParams.get('status') || ''; // 'ativas' ou 'finalizadas'
	const mesFilter = url.searchParams.get('mes') || ''; // YYYY-MM
	const dataFilter = url.searchParams.get('data') || ''; // YYYY-MM-DD

	const db = getDB(platform);

	const supervisaoExtraUnidadeId = await buscarUnidadeIdSupervisaoExtra(db);

	// Supervisor DPC com GISE ativa (não finalizada) — mesmo critério do menu / cache de papel
	const isSupervisorGise = u.tipo === 'policial' ? await isSupervisorGiseAtiva(db, u.id) : false;
	const isSupervisaoGise = u.tipo === 'policial' ? await isSupervisaoGiseAtiva(db, u.id) : false;

	// Admin geral, membros de equipe, supervisor DPC ativo na GISE ou quadro de supervisão (assessor/SEINT)
	if (u.tipo !== 'admin') {
		const result = await db
			.select({ id: giseMembros.id })
			.from(giseMembros)
			.where(eq(giseMembros.policial_id, u.id))
			.limit(1)
			.get();
		if (!result && !isSupervisorGise && !isSupervisaoGise) redirect(302, '/');
	}

	const minhasEscalas: ResGiseMinhaEscalaLinha[] = [];

	const effectiveStatus = statusFilter || 'ativas';

	if (u.tipo === 'policial') {
		const rawEscalas = (await db
			.select({
				id: giseEscalas.id,
				data_inicio: giseEscalas.data_inicio,
				status: giseEscalas.status,
				hora_entrada: giseEscalas.hora_entrada,
				hora_saida: giseEscalas.hora_saida,
				equipe_id: giseEquipes.id,
				// Horas por nível (equipe > seccional > escala)
				sec_hora_entrada: giseSeccionais.hora_entrada,
				sec_hora_saida: giseSeccionais.hora_saida,
				eq_hora_entrada: giseEquipes.hora_entrada,
				eq_hora_saida: giseEquipes.hora_saida,
				equipe_tipo: giseEquipes.tipo,
				seccional_id: giseSeccionais.seccional_id,
				seccional_nome: unidades.nome
			})
			.from(giseMembros)
			.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
			.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
			.innerJoin(unidades, eq(giseSeccionais.seccional_id, unidades.id))
			.innerJoin(giseEscalas, eq(giseSeccionais.gise_id, giseEscalas.id))
			.where(
				and(
					eq(giseMembros.policial_id, u.id),
					mesFilter ? like(giseEscalas.data_inicio, `${mesFilter}%`) : sql`1=1`,
					dataFilter ? eq(giseEscalas.data_inicio, dataFilter) : sql`1=1`
				)
			)
			.orderBy(desc(giseEscalas.data_inicio))
			.all()) as unknown as GiseEscalaItem[];

		// Segunda origem: o policial no quadro de supervisão da escala. Sem equipe
		// e sem seccional, os campos são preenchidos com `0`/NULL para caber no
		// mesmo shape das linhas de equipe e seguir por um único caminho abaixo.
		const rawSupervisoes = (await db
			.select({
				id: giseEscalas.id,
				data_inicio: giseEscalas.data_inicio,
				status: giseEscalas.status,
				hora_entrada: giseEscalas.hora_entrada,
				hora_saida: giseEscalas.hora_saida,
				equipe_id: sql`0`.as('equipe_id'),
				sec_hora_entrada: sql`NULL`.as('sec_hora_entrada'),
				sec_hora_saida: sql`NULL`.as('sec_hora_saida'),
				eq_hora_entrada: sql`NULL`.as('eq_hora_entrada'),
				eq_hora_saida: sql`NULL`.as('eq_hora_saida'),
				equipe_tipo: sql<string>`CASE WHEN ${giseEscalas.assessor_id} = ${u.id} THEN 'assessor' ELSE 'seint' END`,
				seccional_id: sql`0`.as('seccional_id'),
				seccional_nome: sql`'Supervisão Geral'`.as('seccional_nome')
			})
			.from(giseEscalas)
			.where(
				and(
					sql`(${giseEscalas.assessor_id} = ${u.id} OR ${giseEscalas.seint1_id} = ${u.id} OR ${giseEscalas.seint2_id} = ${u.id})`,
					mesFilter ? like(giseEscalas.data_inicio, `${mesFilter}%`) : sql`1=1`,
					dataFilter ? eq(giseEscalas.data_inicio, dataFilter) : sql`1=1`
				)
			)
			.all()) as unknown as GiseEscalaItem[];

		rawEscalas.push(...rawSupervisoes);

		// DPC supervisor da escala: mesma UX de assessor (entrada/saída, sem formulário de produtividade aqui)
		if (isSupervisorGise) {
			const rawSupervisorDpc = (await db
				.select({
					id: giseEscalas.id,
					data_inicio: giseEscalas.data_inicio,
					status: giseEscalas.status,
					hora_entrada: giseEscalas.hora_entrada,
					hora_saida: giseEscalas.hora_saida,
					equipe_id: sql`0`.as('equipe_id'),
					sec_hora_entrada: sql`NULL`.as('sec_hora_entrada'),
					sec_hora_saida: sql`NULL`.as('sec_hora_saida'),
					eq_hora_entrada: sql`NULL`.as('eq_hora_entrada'),
					eq_hora_saida: sql`NULL`.as('eq_hora_saida'),
					equipe_tipo: sql<string>`'supervisor'`,
					seccional_id: sql`0`.as('seccional_id'),
					seccional_nome: sql`'Supervisão Geral'`.as('seccional_nome')
				})
				.from(giseEscalas)
				.where(
					and(
						eq(giseEscalas.supervisor_id, u.id),
						mesFilter ? like(giseEscalas.data_inicio, `${mesFilter}%`) : sql`1=1`,
						dataFilter ? eq(giseEscalas.data_inicio, dataFilter) : sql`1=1`
					)
				)
				.all()) as unknown as GiseEscalaItem[];
			for (const row of rawSupervisorDpc) {
				if (!rawEscalas.some((r) => r.id === row.id)) rawEscalas.push(row);
			}
		}

		// Ordenar novamente já que fundimos duas listas
		rawEscalas.sort(
			(a, b) => new Date(b.data_inicio).getTime() - new Date(a.data_inicio).getTime()
		);

		const giseIds = [...new Set(rawEscalas.map((e) => e.id))];

		const presencasMap = new Map<number, GisePresenca>();
		const docsAssinadosMap = new Map<number, boolean>();
		const extrasAssinadosMap = new Map<string, boolean>();
		const respostasEquipeMap = new Map<string, boolean>();
		const respostasPolicialMap = new Map<string, boolean>();

		// Um lote por informação, em paralelo, em vez de N consultas por escala:
		// presença do usuário, escalas com documento assinado, extras assinados e
		// relatórios já enviados. Viram mapas para consulta O(1) no laço seguinte.
		if (giseIds.length > 0) {
			// 4 queries independentes em paralelo
			const [presencas, docs, extras, respostas] = await Promise.all([
				db
					.select()
					.from(gisePresencas)
					.where(and(inArray(gisePresencas.gise_id, giseIds), eq(gisePresencas.policial_id, u.id)))
					.all(),
				db
					.select({ gise_id: giseDocumentos.gise_id })
					.from(giseDocumentos)
					.where(inArray(giseDocumentos.gise_id, giseIds))
					.all(),
				db
					.select({
						gise_id: giseAssinaturasRelatorios.gise_id,
						seccional_id: giseAssinaturasRelatorios.seccional_id
					})
					.from(giseAssinaturasRelatorios)
					.where(
						and(
							inArray(giseAssinaturasRelatorios.gise_id, giseIds),
							eq(giseAssinaturasRelatorios.tipo, 'extraordinario')
						)
					)
					.all(),
				db
					.select({
						gise_id: giseRespostasFormulario.gise_id,
						equipe_id: giseRespostasFormulario.equipe_id,
						policial_id: giseRespostasFormulario.policial_id
					})
					.from(giseRespostasFormulario)
					.where(inArray(giseRespostasFormulario.gise_id, giseIds))
					.all()
			]);

			presencas.forEach((p) => presencasMap.set(p.gise_id, p));
			docs.forEach((doc) => docsAssinadosMap.set(doc.gise_id, true));
			extras.forEach((ext) => extrasAssinadosMap.set(`${ext.gise_id}_${ext.seccional_id}`, true));
			respostas.forEach((res) => {
				if (res.equipe_id != null) {
					respostasEquipeMap.set(`${res.gise_id}_${res.equipe_id}`, true);
				}
				if (res.policial_id != null) {
					respostasPolicialMap.set(`${res.gise_id}_${res.policial_id}`, true);
				}
			});
		}

		for (const e of rawEscalas) {
			const presenca = presencasMap.get(e.id);
			// Para o policial, a escala "acabou" quando ELE bateu a saída — mesmo que
			// a GISE siga aberta para os demais. O outro caso é a escala finalizada
			// pelo Admin Geral.
			const isFinished = (presenca && presenca.saida_timestamp) || e.status === 'finalizada';

			if (effectiveStatus === 'ativas' && isFinished) continue;
			if (effectiveStatus === 'finalizadas' && !isFinished) continue;

			const docAssinado = docsAssinadosMap.get(e.id);
			// Linha do quadro de supervisão (`seccional_id === 0`) casa com a unidade
			// sintética do extra da supervisão; as demais, com a própria seccional.
			const secKeyExtra =
				e.seccional_id === 0 && supervisaoExtraUnidadeId != null
					? supervisaoExtraUnidadeId
					: e.seccional_id;
			const extraAssinado = extrasAssinadosMap.get(`${e.id}_${secKeyExtra}`);
			// Quem deve o relatório muda por papel: no quadro de supervisão só o SEINT
			// entrega (e a resposta é individual, sem equipe); supervisor e assessor
			// não devem nada, por isso `true`. Nas equipes, a entrega é do time.
			const respostaEquipe =
				e.seccional_id === 0
					? e.equipe_tipo === 'seint'
						? !!respostasPolicialMap.get(`${e.id}_${u.id}`)
						: true
					: !!respostasEquipeMap.get(`${e.id}_${e.equipe_id}`);

			// Prioridade de horário: equipe > seccional > escala
			const hEnt = e.eq_hora_entrada ?? e.sec_hora_entrada ?? e.hora_entrada ?? '08:00';
			const hSai = e.eq_hora_saida ?? e.sec_hora_saida ?? e.hora_saida ?? '16:00';

			minhasEscalas.push({
				...e,
				hora_entrada: e.hora_entrada ?? '08:00',
				hora_saida: e.hora_saida ?? '16:00',
				presenca,
				assinada: !!docAssinado,
				extraAssinado: !!extraAssinado,
				equipeRespondida: !!respostaEquipe,
				horarioPrevisto: { inicio: hEnt, fim: hSai }
			});
		}
	}
	const giseIdSelected = url.searchParams.get('giseId')
		? parseInt(url.searchParams.get('giseId')!)
		: null;
	const equipeIdSelected = url.searchParams.get('equipeId')
		? parseInt(url.searchParams.get('equipeId')!)
		: null;

	const [[modeloOp, modeloSeintRow], respostaRow, restringirSmartphone, rubricaRow] =
		await Promise.all([
			Promise.all([
				buscarGiseModeloFormulario(db, 'operacional'),
				buscarGiseModeloFormulario(db, 'seint')
			]),
			giseIdSelected && !isNaN(giseIdSelected)
				? buscarRespostaGise(
						db,
						giseIdSelected,
						u.tipo === 'policial' ? u.id : null,
						equipeIdSelected ?? undefined
					)
				: Promise.resolve(null),
			buscarRestringirSmartphone(db),
			// Rubrica reutilizável do policial (cadastro p/ assinatura A3 no desktop).
			u.tipo === 'policial'
				? db
						.select({ rubrica: policiais.rubrica })
						.from(policiais)
						.where(eq(policiais.id, u.id))
						.get()
				: Promise.resolve(null)
		]);

	let modeloOperacional = DEFAULT_QUESTIONS_FORM_OPERACIONAL;
	if (modeloOp?.config) {
		try {
			modeloOperacional = JSON.parse(modeloOp.config);
		} catch (err) {
			logger.warn('[res-gise] modelo operacional JSON inválido', { err: String(err) });
		}
	}
	let modeloSeint = DEFAULT_SEINT_QUESTIONS;
	if (modeloSeintRow?.config) {
		try {
			modeloSeint = JSON.parse(modeloSeintRow.config);
		} catch (err) {
			logger.warn('[res-gise] modelo seint JSON inválido', { err: String(err) });
		}
	}

	/**
	 * Versão anterior de cada modelo, para o "Restaurar anterior" do editor.
	 * `null` quando nunca houve uma segunda gravação — ou quando o JSON está
	 * corrompido, caso em que é melhor desabilitar o botão do que oferecer uma
	 * restauração que quebraria o editor.
	 */
	function parseAnterior(raw: string | null | undefined, rotulo: string) {
		if (!raw) return null;
		try {
			return JSON.parse(raw) as GiseModeloPerguntaConfig[];
		} catch (err) {
			logger.warn(`[res-gise] modelo anterior ${rotulo} JSON inválido`, { err: String(err) });
			return null;
		}
	}

	return {
		minhasEscalas,
		isSupervisorGise,
		isSupervisaoGise,
		supervisaoExtraUnidadeId,
		// Carimbo de envio (created_at) e da última retificação (updated_at) da
		// resposta de produtividade — exibidos no card "Relatório Entregue". O
		// BLOB das respostas não vem mais daqui: quem edita é o wizard em
		// `/res-gise/relatorio/[giseId]`, que carrega o seu próprio.
		respostaEnviadaEm: respostaRow?.created_at ?? null,
		respostaAtualizadaEm: respostaRow?.updated_at ?? null,
		restringirSmartphone,
		minhaRubrica: rubricaRow?.rubrica ?? null,
		modeloOperacional,
		modeloSeint,
		modeloAnteriorOperacional: parseAnterior(modeloOp?.config_anterior, 'operacional'),
		modeloAnteriorSeint: parseAnterior(modeloSeintRow?.config_anterior, 'seint')
	};
};

export const actions: Actions = {
	/**
	 * Confirma a ENTRADA em serviço (assinatura avançada).
	 *
	 * Ordem obrigatória: 2FA → existência da escala → participação → foto → grava.
	 * Nada é persistido antes das três verificações, para que uma tentativa
	 * recusada não deixe rastro de presença.
	 */
	salvarEntrada: async (event) => {
		const { request, locals, platform, getClientAddress } = event;
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const formData = await request.formData();
		const giseId = parseInt(formData.get('giseId') as string);
		const rubrica = formData.get('rubrica') as string;
		const latitude = formData.get('latitude')
			? parseFloat(formData.get('latitude') as string)
			: undefined;
		const longitude = formData.get('longitude')
			? parseFloat(formData.get('longitude') as string)
			: undefined;
		const selfieBase64 = formData.get('selfieBase64') as string | null;
		const codigoEmail = formData.get('codigoEmail') as string | null;
		const desafioId = formData.get('desafioId') as string | null;

		if (isNaN(giseId) || !rubrica) {
			return fail(400, { error: 'Dados inválidos', giseId });
		}

		const ip = getClientAddress();
		const ua = request.headers.get('user-agent') || '';

		const db = getDB(platform);

		// Fonte ÚNICA das flags (mesma da UI e do signature-service): o cache
		// força exigirCodigoEmail=true independentemente da linha no banco —
		// requisito mínimo da assinatura avançada (Lei 14.063/2020 art. 4º II).
		// A leitura crua do banco (default '0' num banco recém-instalado)
		// deixava a presença pular o 2FA que a UI já coleta.
		const exigirCodigoEmail = (await lerFlagsAssinatura(platform)).exigirCodigoEmailAssinatura;
		if (exigirCodigoEmail) {
			if (!codigoEmail || !desafioId) {
				return fail(400, { error: 'Código de verificação por e-mail é obrigatório.', giseId });
			}
			const result2FA = await verificarDesafio2FA(db, desafioId, codigoEmail, ['assinatura']);
			if (result2FA === 'expirado')
				return fail(400, { error: 'O código de verificação expirou.', giseId });
			if (result2FA === 'esgotado')
				return fail(400, { error: 'Muitas tentativas. Solicite um novo código.', giseId });
			if (!result2FA) return fail(400, { error: 'Código de verificação inválido.', giseId });
			if (result2FA.usuarioId !== u.id)
				return fail(403, { error: 'Código não pertence ao usuário logado.', giseId });
		}

		const gise = await buscarGiseEscala(db, giseId);
		if (!gise) return fail(404, { error: 'Escala não encontrada', giseId });

		// Vínculo: só quem participa da GISE (membro de equipe, assessor/SEINT ou
		// supervisor DPC) registra a própria presença. A UI já esconde o botão de
		// quem não participa, mas a action precisa recusar por conta própria —
		// mesma regra que o endpoint do comprovante aplica. Sem isto, qualquer
		// policial autenticado gravava presença em qualquer GISE via POST direto.
		const part = await resolverParticipacaoGisePolicial(db, giseId, u.id);
		if (!part.participa)
			return fail(403, { error: 'Você não participa desta escala GISE.', giseId });

		let selfieKey: string | undefined = undefined;
		if (hasR2(platform) && selfieBase64) {
			const r2 = getR2(platform);
			const [yyyy, mm, dd] = gise.data_inicio.split('-');
			const folder = `gise/${yyyy}-${mm}/${dd}/${giseId}/selfies`;
			// Helper compartilhado: valida magic bytes, limita 5 MB e usa UUID
			// na chave para esconder o `policial_id` da URL do R2.
			const r = await uploadSelfieDataUri(r2, folder, selfieBase64);
			if (r.ok) selfieKey = r.key;
		}

		await salvarEntradaGise(db, giseId, u.id, rubrica, ip, ua, latitude, longitude, selfieKey);
		await sincronizarStatusGiseAposPresencaRelatorios(db, giseId);

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'presenca_gise_entrada',
				usuario: u,
				entidade: 'gise',
				entidade_id: giseId,
				alvo_tipo: 'policial',
				alvo_id: u.id,
				alvo_nome: u.nome,
				detalhes: `Registro de entrada na GISE ${giseId}`,
				metadados: { temSelfie: !!selfieKey, temGps: latitude != null && longitude != null },
				...contexto
			},
			{ env }
		);
		return { success: true, giseId };
	},

	/**
	 * Confirma a SAÍDA de serviço. Mesmas verificações da entrada — e é este
	 * carimbo que tira a escala da aba "Ativas" do policial e libera o relatório
	 * de extra da seccional.
	 */
	salvarSaida: async (event) => {
		const { request, locals, platform, getClientAddress } = event;
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const formData = await request.formData();
		const giseId = parseInt(formData.get('giseId') as string);
		const rubrica = formData.get('rubrica') as string;
		const latitude = formData.get('latitude')
			? parseFloat(formData.get('latitude') as string)
			: undefined;
		const longitude = formData.get('longitude')
			? parseFloat(formData.get('longitude') as string)
			: undefined;
		const selfieBase64 = formData.get('selfieBase64') as string | null;
		const codigoEmail = formData.get('codigoEmail') as string | null;
		const desafioId = formData.get('desafioId') as string | null;

		if (isNaN(giseId) || !rubrica) {
			return fail(400, { error: 'Dados inválidos', giseId });
		}

		const ip = getClientAddress();
		const ua = request.headers.get('user-agent') || '';

		const db = getDB(platform);

		// Fonte ÚNICA das flags (mesma da UI e do signature-service): o cache
		// força exigirCodigoEmail=true independentemente da linha no banco —
		// requisito mínimo da assinatura avançada (Lei 14.063/2020 art. 4º II).
		// A leitura crua do banco (default '0' num banco recém-instalado)
		// deixava a presença pular o 2FA que a UI já coleta.
		const exigirCodigoEmail = (await lerFlagsAssinatura(platform)).exigirCodigoEmailAssinatura;
		if (exigirCodigoEmail) {
			if (!codigoEmail || !desafioId) {
				return fail(400, { error: 'Código de verificação por e-mail é obrigatório.', giseId });
			}
			const result2FA = await verificarDesafio2FA(db, desafioId, codigoEmail, ['assinatura']);
			if (result2FA === 'expirado')
				return fail(400, { error: 'O código de verificação expirou.', giseId });
			if (result2FA === 'esgotado')
				return fail(400, { error: 'Muitas tentativas. Solicite um novo código.', giseId });
			if (!result2FA) return fail(400, { error: 'Código de verificação inválido.', giseId });
			if (result2FA.usuarioId !== u.id)
				return fail(403, { error: 'Código não pertence ao usuário logado.', giseId });
		}

		const giseOrig = await buscarGiseEscala(db, giseId);
		if (!giseOrig) return fail(404, { error: 'Escala não encontrada', giseId });

		// Vínculo: mesma regra da entrada (ver salvarEntrada).
		const part = await resolverParticipacaoGisePolicial(db, giseId, u.id);
		if (!part.participa)
			return fail(403, { error: 'Você não participa desta escala GISE.', giseId });

		let selfieKey: string | undefined = undefined;
		if (hasR2(platform) && selfieBase64) {
			const r2 = getR2(platform);
			const [yyyy, mm, dd] = giseOrig.data_inicio.split('-');
			const folder = `gise/${yyyy}-${mm}/${dd}/${giseId}/selfies`;
			const r = await uploadSelfieDataUri(r2, folder, selfieBase64);
			if (r.ok) selfieKey = r.key;
		}

		await salvarSaidaGise(db, giseId, u.id, rubrica, ip, ua, latitude, longitude, selfieKey);

		await sincronizarStatusGiseAposPresencaRelatorios(db, giseId);

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'presenca_gise_saida',
				usuario: u,
				entidade: 'gise',
				entidade_id: giseId,
				alvo_tipo: 'policial',
				alvo_id: u.id,
				alvo_nome: u.nome,
				detalhes: `Registro de saída na GISE ${giseId}`,
				metadados: { temSelfie: !!selfieKey, temGps: latitude != null && longitude != null },
				...contexto
			},
			{ env }
		);

		return { success: true, giseId };
	},

	/**
	 * Salva o MODELO do formulário de produtividade (perguntas), não as respostas.
	 * Restrito ao Admin Geral: vale para todas as escalas seguintes.
	 */
	salvarModelo: async ({ request, locals, platform }) => {
		const u = locals.usuario;
		if (!u || u.tipo !== 'admin') return fail(403, { error: 'Somente administradores gerais' });

		const formData = await request.formData();
		const configStr = formData.get('config') as string;
		const tipo = formData.get('tipo') as 'operacional' | 'seint';

		if (!configStr || !tipo || !['operacional', 'seint'].includes(tipo)) {
			return fail(400, { error: 'Dados inválidos' });
		}

		try {
			JSON.parse(configStr); // Validate JSON
		} catch (err) {
			logger.warn('[res-gise] salvarModelo: JSON inválido', { err: String(err) });
			return fail(400, { error: 'Configuração JSON inválida' });
		}

		const db = getDB(platform);
		await salvarGiseModeloFormulario(db, tipo, configStr);
		return { success: true };
	}
};
