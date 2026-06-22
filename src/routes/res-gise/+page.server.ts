import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { ResGiseMinhaEscalaLinha, ResGiseListaAdminLinha } from '$lib/types';
import {
	getDB,
	getR2,
	hasR2,
	buscarGiseModeloFormulario,
	buscarRespostaGise,
	salvarRespostaGise,
	buscarGiseEscala,
	sincronizarStatusGiseAposPresencaRelatorios,
	salvarEntradaGise,
	salvarSaidaGise,
	salvarGiseModeloFormulario,
	buscarExigirCodigoEmailAssinatura,
	buscarRestringirSmartphone,
	isSupervisaoGiseAtiva,
	isSupervisorGiseAtiva,
	auditar,
	contextoDeEvento
} from '$lib/db';
import { buscarUnidadeIdSupervisaoExtra } from '$lib/server/gise-supervisao-extra';
import { verificarDesafio2FA } from '$lib/auth';
import { logger } from '$lib/server/logger';
import { uploadSelfieDataUri } from '$lib/server/selfie-upload';
import {
	parseRespostasFormularioJsonLoose,
	parseRespostasFormularioJsonStrict
} from '$lib/schemas/gise-respostas-form';
import {
	giseEscalas,
	giseMembros,
	giseEquipes,
	giseSeccionais,
	gisePresencas,
	giseDocumentos,
	unidades,
	giseAssinaturasRelatorios,
	giseRespostasFormulario
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
	if (!u) throw redirect(302, '/login');

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
		if (!result && !isSupervisorGise && !isSupervisaoGise) throw redirect(302, '/');
	}

	const minhasEscalas: ResGiseMinhaEscalaLinha[] = [];
	const listaAdmin: ResGiseListaAdminLinha[] = [];

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
			const isFinished = (presenca && presenca.saida_timestamp) || e.status === 'finalizada';

			if (effectiveStatus === 'ativas' && isFinished) continue;
			if (effectiveStatus === 'finalizadas' && !isFinished) continue;

			const docAssinado = docsAssinadosMap.get(e.id);
			const secKeyExtra =
				e.seccional_id === 0 && supervisaoExtraUnidadeId != null
					? supervisaoExtraUnidadeId
					: e.seccional_id;
			const extraAssinado = extrasAssinadosMap.get(`${e.id}_${secKeyExtra}`);
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

	const defaultGiseQuestions = [
		{ id: 1, texto: '1. DIGITE A VTR E A PLACA', tipo: 'vtr_placa', key: 'vtr_placa', filhos: [] },
		{ id: 2, texto: '2. DIGITE O KM INCIAL DA VTR', tipo: 'numero', key: 'km_inicial', filhos: [] },
		{ id: 3, texto: '3. DIGITE O KM FINAL DA VTR', tipo: 'numero', key: 'km_final', filhos: [] },
		{
			id: 4,
			texto: '4. Houve PROCEDIMENTOS em flagrante realizados?',
			tipo: 'prisoes_maiores',
			key: 'procedimentos_flagrante_bool',
			subtexto_qtd: '4.1 QUANTIDADE:',
			subtexto_lista: '4.2 INFORMAR NOMES E PROCEDIMENTOS:',
			filhos: []
		},
		{
			id: 5,
			texto: '5. Houve MANDADOS cumpridos (MAIORES)?',
			tipo: 'mandados_maiores',
			key: 'mandados_cumpridos',
			subtexto_qtd: '5.1 QUANTIDADE:',
			subtexto_lista: '5.2 INFORMAR NOMES E MANDADOS:',
			filhos: []
		},
		{
			id: 6,
			texto: '6. Houve APREENSÕES cumpridas (MENORES)?',
			tipo: 'apreensoes_menores',
			key: 'apreensoes_cumpridas',
			subtexto_qtd: '6.1 QUANTIDADE:',
			subtexto_lista: '6.2 INFORMAR NOMES E PROCESSOS:',
			filhos: []
		},
		{
			id: 7,
			texto: '7. Nº PRISÕES/APREENSÕES em flagrante (por preso)',
			tipo: 'select_99',
			key: 'prisoes_apreensoes_flagrante',
			filhos: []
		},
		{
			id: 8,
			texto: '8. Houve tentativa de cumprimento de mandado?',
			tipo: 'sim_nao',
			key: 'tentativa_mandado',
			filhos: []
		},
		{
			id: 9,
			texto: '9. Houve mandado de busca e apreensão?',
			tipo: 'sim_nao',
			key: 'busca_apreensao',
			filhos: []
		},
		{
			id: 10,
			texto: '10. Houve apreensão de drogas?',
			tipo: 'drogas_complex',
			key: 'apreensoes_drogas',
			subtexto_tipo: '10.1 TIPO DE DROGA:',
			subtexto_detalhe: '10.1.1 PESO DA DROGA, POR TIPO:',
			filhos: []
		},
		{
			id: 11,
			texto: '11. Houve APREENSÃO DE ARMAS/MUNIÇÕES?',
			tipo: 'armas_complex',
			key: 'apreensoes_armas_bool',
			subtexto_tipo: '11.1 TIPO DE ARMA:',
			subtexto_qtd: '11.1.1 QUANTIDADE:',
			filhos: []
		},
		{ id: 12, texto: '12. Local de Crime', tipo: 'select_99', key: 'local_crime', filhos: [] },
		{
			id: 13,
			texto: '13. Ordem de Missão Cumprida',
			tipo: 'select_99',
			key: 'ordem_missao',
			filhos: []
		},
		{
			id: 14,
			texto: '14. Levantamento de Alvos',
			tipo: 'select_99',
			key: 'levantamento_alvos',
			filhos: []
		},
		{ id: 15, texto: '15. Oitivas Realizadas', tipo: 'select_99', key: 'oitivas', filhos: [] },
		{
			id: 16,
			texto: '16. Representação Prisão',
			tipo: 'select_99',
			key: 'representacao_prisao',
			filhos: []
		},
		{
			id: 17,
			texto: '17. Representação Busca',
			tipo: 'select_99',
			key: 'representacao_busca',
			filhos: []
		},
		{ id: 18, texto: '18. Nº Abordagens', tipo: 'select_99', key: 'abordagens', filhos: [] },
		{
			id: 19,
			texto: '19. Descreva resumidamente as diligências',
			tipo: 'textarea',
			key: 'descricao',
			filhos: []
		}
	];

	const defaultSeintQuestions = [
		{
			id: 1,
			texto: '1. Houve EXTRAÇÃO DE DADOS DE APARELHOS CELULARES?',
			tipo: 'sim_nao',
			key: 'extracao_celulares',
			filhos: [
				{
					id: 101,
					texto: '1.1 Quantidade de aparelhos analisados (1 a 99)',
					tipo: 'numero',
					key: 'extracao_qtd',
					filhos: []
				},
				{
					id: 102,
					texto: '1.2 Listagem de aparelhos analisados (Modelo, Nº proc, Delegacia, Concluída)',
					tipo: 'textarea',
					key: 'extracao_lista',
					filhos: []
				}
			]
		},
		{
			id: 2,
			texto: '2. Houve ANÁLISE DE DADOS DE EXTRAÇÃO?',
			tipo: 'sim_nao',
			key: 'analise_extracao',
			filhos: [
				{
					id: 201,
					texto: '2.1 Quantidade de aparelhos analisados (1 a 99)',
					tipo: 'numero',
					key: 'analise_qtd',
					filhos: []
				},
				{
					id: 202,
					texto: '2.2 Listagem de aparelhos analisados (Tamanho, Modelo, Nº proc, Delegacia)',
					tipo: 'textarea',
					key: 'analise_lista',
					filhos: []
				}
			]
		},
		{
			id: 3,
			texto: '3. Houve PRODUÇÃO DE RELATÓRIOS?',
			tipo: 'sim_nao',
			key: 'producao_relatorios',
			filhos: [
				{
					id: 301,
					texto: '3.1 Quantidade de relatórios produzidos (1 a 99)',
					tipo: 'numero',
					key: 'relatorios_qtd',
					filhos: []
				},
				{
					id: 302,
					texto:
						'3.2 Listagem de relatórios produzidos (Nº Relatório, Alvos, Proc. Vinculado, Delegacia)',
					tipo: 'textarea',
					key: 'relatorios_lista',
					filhos: []
				}
			]
		},
		{
			id: 4,
			texto: '4. Houve LEVANTAMENTO DE DADOS DE ALVOS FORAGIDOS?',
			tipo: 'sim_nao',
			key: 'levantamento_foragidos',
			filhos: [
				{
					id: 401,
					texto: '4.1 Quantidade de levantamentos produzidos (1 a 99)',
					tipo: 'numero',
					key: 'levantamentos_qtd',
					filhos: []
				},
				{
					id: 402,
					texto:
						'4.2 Listagem de relatórios produzidos (Nome do Alvo, Proc. Vinculado, Delegacia, Resultado)',
					tipo: 'textarea',
					key: 'levantamentos_lista',
					filhos: []
				}
			]
		},
		{
			id: 5,
			texto: '5. Houve INTERCEPTAÇÃO TELEFÔNICA?',
			tipo: 'sim_nao',
			key: 'interceptacao_tel',
			filhos: [
				{
					id: 501,
					texto: '5.1 Quantidade de INTERCEPTAÇÃO TELEFÔNICA (1 a 99)',
					tipo: 'numero',
					key: 'interceptacao_qtd',
					filhos: []
				},
				{
					id: 502,
					texto: '5.2 Existem OPERAÇÕES que necessitaram de acompanhamento?',
					tipo: 'sim_nao',
					key: 'operacoes_acompanhamento_bool',
					filhos: [
						{
							id: 503,
							texto: '5.2.1 Listagem de OPERAÇÕES (Nome da operação e Delegacia de origem)',
							tipo: 'textarea',
							key: 'operacoes_lista',
							filhos: []
						}
					]
				}
			]
		}
	];

	const giseIdSelected = url.searchParams.get('giseId')
		? parseInt(url.searchParams.get('giseId')!)
		: null;
	const equipeIdSelected = url.searchParams.get('equipeId')
		? parseInt(url.searchParams.get('equipeId')!)
		: null;

	const [[modeloOp, modeloSeintRow], respostaRow, restringirSmartphone] = await Promise.all([
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
		buscarRestringirSmartphone(db)
	]);

	let respostasData: Record<string, unknown> = {};
	if (respostaRow?.respostas) {
		respostasData = parseRespostasFormularioJsonLoose(respostaRow.respostas);
		const raw = respostaRow.respostas.trim();
		if (raw && raw !== '{}' && Object.keys(respostasData).length === 0) {
			logger.warn('res-gise load: respostas não é objeto JSON válido', {
				giseId: giseIdSelected,
				amostra: raw.slice(0, 80)
			});
		}
	}

	let modeloOperacional = defaultGiseQuestions;
	if (modeloOp?.config) {
		try {
			modeloOperacional = JSON.parse(modeloOp.config);
		} catch (err) {
			logger.warn('[res-gise] modelo operacional JSON inválido', { err: String(err) });
		}
	}
	let modeloSeint = defaultSeintQuestions;
	if (modeloSeintRow?.config) {
		try {
			modeloSeint = JSON.parse(modeloSeintRow.config);
		} catch (err) {
			logger.warn('[res-gise] modelo seint JSON inválido', { err: String(err) });
		}
	}

	return {
		minhasEscalas,
		listaAdmin,
		isSupervisorGise,
		isSupervisaoGise,
		supervisaoExtraUnidadeId,
		giseIdSelected,
		equipeIdSelected,
		respostas: respostasData,
		restringirSmartphone,
		modeloOperacional,
		modeloSeint,
		modeloPadraoOperacional: defaultGiseQuestions,
		modeloPadraoSeint: defaultSeintQuestions
	};
};

export const actions: Actions = {
	salvarResposta: async ({ request, locals, platform }) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const formData = await request.formData();
		const giseId = parseInt(formData.get('giseId') as string);
		const equipeId = formData.get('equipeId')
			? parseInt(formData.get('equipeId') as string)
			: undefined;
		const respostasStr = formData.get('respostas') as string;

		if (isNaN(giseId) || !respostasStr) {
			return fail(400, { error: 'Dados inválidos', giseId, equipeId });
		}

		const parsed = parseRespostasFormularioJsonStrict(respostasStr);
		if (!parsed.ok) {
			return fail(400, { error: 'Respostas em formato inválido', giseId, equipeId });
		}

		const db = getDB(platform);
		await salvarRespostaGise(db, giseId, u.id, JSON.stringify(parsed.data), equipeId);

		await sincronizarStatusGiseAposPresencaRelatorios(db, giseId);

		return { success: true, giseId, equipeId };
	},

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

		const exigirCodigoEmail = await buscarExigirCodigoEmailAssinatura(db);
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

		const exigirCodigoEmail = await buscarExigirCodigoEmailAssinatura(db);
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
