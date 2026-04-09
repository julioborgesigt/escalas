import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { getDB, getR2, hasR2, buscarGiseModeloFormulario, isMembroGiseAtiva, buscarRespostaGise, salvarRespostaGise, buscarGiseEscala, verificarTodosSairam, verificarTodosRelatoriosEnviados, atualizarGiseEscala, salvarEntradaGise, salvarSaidaGise, salvarGiseModeloFormulario, buscarExigirCodigoEmailAssinatura } from '$lib/db';
import { verificarDesafio2FA } from '$lib/auth';
import { giseEscalas, giseMembros, giseEquipes, giseSeccionais, gisePresencas, giseDocumentos, unidades, giseAssinaturasRelatorios, giseRespostasFormulario } from '$lib/server/schema';
import { eq, and, inArray, desc, like, sql } from 'drizzle-orm';

export const load = async ({ locals, platform, url }: any) => {
	const u = locals.usuario;
	if (!u) throw redirect(302, '/login');

	const isAdminGeral = u.tipo === 'admin';
	const statusFilter = url.searchParams.get('status') || ''; // 'ativas' ou 'finalizadas'
	const mesFilter = url.searchParams.get('mes') || ''; // YYYY-MM
	const dataFilter = url.searchParams.get('data') || ''; // YYYY-MM-DD

	const db = getDB(platform);

	// Checar se é supervisor de alguma GISE
	const giseSupervisor = await db.select({ id: giseEscalas.id })
		.from(giseEscalas)
		.where(eq(giseEscalas.supervisor_id, u.id))
		.limit(1)
		.get();
	const isSupervisorGise = !!giseSupervisor;

	// Apenas admin geral e membros de GISE podem acessar
	if (u.tipo !== 'admin') {
		const result = await db.select({ id: giseMembros.id }).from(giseMembros).where(eq(giseMembros.policial_id, u.id)).limit(1).get();
		if (!result && !isSupervisorGise) throw redirect(302, '/');
	}

	let minhasEscalas: any[] = [];
	let listaAdmin: any[] = [];

	const effectiveStatus = statusFilter || 'ativas';

	if (u.tipo === 'policial' && !isSupervisorGise) {
		const rawEscalas = await db
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
			.where(and(
				eq(giseMembros.policial_id, u.id),
				mesFilter ? like(giseEscalas.data_inicio, `${mesFilter}%`) : sql`1=1`,
				dataFilter ? eq(giseEscalas.data_inicio, dataFilter) : sql`1=1`
			))
			.orderBy(desc(giseEscalas.data_inicio))
			.all();

		const giseIds = [...new Set(rawEscalas.map(e => e.id))];

		let presencasMap = new Map<number, any>();
		let docsAssinadosMap = new Map<number, boolean>();
		let extrasAssinadosMap = new Map<string, boolean>();
		let respostasEquipeMap = new Map<string, boolean>();

		if (giseIds.length > 0) {
			// 4 queries independentes em paralelo
			const [presencas, docs, extras, respostas] = await Promise.all([
				db.select().from(gisePresencas)
					.where(and(inArray(gisePresencas.gise_id, giseIds), eq(gisePresencas.policial_id, u.id))).all(),
				db.select({ gise_id: giseDocumentos.gise_id })
					.from(giseDocumentos)
					.where(inArray(giseDocumentos.gise_id, giseIds)).all(),
				db.select({ gise_id: giseAssinaturasRelatorios.gise_id, seccional_id: giseAssinaturasRelatorios.seccional_id })
					.from(giseAssinaturasRelatorios)
					.where(and(inArray(giseAssinaturasRelatorios.gise_id, giseIds), eq(giseAssinaturasRelatorios.tipo, 'extraordinario'))).all(),
				db.select({ gise_id: giseRespostasFormulario.gise_id, equipe_id: giseRespostasFormulario.equipe_id })
					.from(giseRespostasFormulario)
					.where(inArray(giseRespostasFormulario.gise_id, giseIds)).all()
			]);

			presencas.forEach((p: any) => presencasMap.set(p.gise_id, p));
			docs.forEach((doc: any) => docsAssinadosMap.set(doc.gise_id, true));
			extras.forEach((ext: any) => extrasAssinadosMap.set(`${ext.gise_id}_${ext.seccional_id}`, true));
			respostas.forEach((res: any) => respostasEquipeMap.set(`${res.gise_id}_${res.equipe_id}`, true));
		}

		for (const e of rawEscalas) {
			const presenca = presencasMap.get(e.id);
			const isFinished = (presenca && presenca.saida_timestamp) || e.status === 'finalizada';

			if (effectiveStatus === 'ativas' && isFinished) continue;
			if (effectiveStatus === 'finalizadas' && !isFinished) continue;

			const docAssinado = docsAssinadosMap.get(e.id);
			const extraAssinado = extrasAssinadosMap.get(`${e.id}_${e.seccional_id}`);
			const respostaEquipe = respostasEquipeMap.get(`${e.id}_${e.equipe_id}`);

			// Prioridade de horário: equipe > seccional > escala
			const hEnt = e.eq_hora_entrada ?? e.sec_hora_entrada ?? e.hora_entrada ?? '08:00';
			const hSai = e.eq_hora_saida ?? e.sec_hora_saida ?? e.hora_saida ?? '16:00';

			minhasEscalas.push({
				...e,
				presenca,
				assinada: !!docAssinado,
				extraAssinado: !!extraAssinado,
				equipeRespondida: !!respostaEquipe,
				horarioPrevisto: { inicio: hEnt, fim: hSai }
			});
		}
	} else {
		// Admin Geral / Supervisor: Lista escalas de acordo com o filtro principal
		let rawAdmin: any[] = [];
		let giseIdsAdmin: number[] = [];

		if (statusFilter === 'ativas' || statusFilter === 'finalizadas') {
			let filters = [];
			if (statusFilter === 'ativas') {
				filters.push(inArray(giseEscalas.status, [
					'em_definicao_supervisor',
					'em_preenchimento',
					'aguardando_assinatura',
					'em_andamento',
					'aguardando_relatorios',
					'aguardando_assinatura_relat',
					'pronta_para_finalizar'
				]));
			} else if (statusFilter === 'finalizadas') {
				filters.push(eq(giseEscalas.status, 'finalizada'));
			}

			if (mesFilter) filters.push(like(giseEscalas.data_inicio, `${mesFilter}%`));
			if (dataFilter) filters.push(eq(giseEscalas.data_inicio, dataFilter));

			// Se for supervisor, ver apenas as suas GISEs, senão vê tudo
			if (!isAdminGeral && isSupervisorGise) {
				filters.push(eq(giseEscalas.supervisor_id, u.id));
			}

			rawAdmin = await db.select({
				id: giseEscalas.id,
				data_inicio: giseEscalas.data_inicio,
				status: giseEscalas.status,
				seccional_id: giseSeccionais.seccional_id,
				seccional_nome: unidades.nome,
				equipe_id: giseEquipes.id,
				equipe_tipo: giseEquipes.tipo
			})
				.from(giseEquipes)
				.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
				.innerJoin(unidades, eq(giseSeccionais.seccional_id, unidades.id))
				.innerJoin(giseEscalas, eq(giseSeccionais.gise_id, giseEscalas.id))
				.where(and(...filters))
				.orderBy(giseEscalas.data_inicio)
				.all();

			giseIdsAdmin = [...new Set(rawAdmin.map(r => r.id))];
		}

		let respostasEquipeMapAdmin = new Map<string, boolean>();
		let extrasAssinadosMapAdmin = new Map<string, boolean>();

		if (giseIdsAdmin.length > 0) {
			// 2 queries independentes em paralelo
			const [respostas, extras] = await Promise.all([
				db.select({ gise_id: giseRespostasFormulario.gise_id, equipe_id: giseRespostasFormulario.equipe_id })
					.from(giseRespostasFormulario)
					.where(inArray(giseRespostasFormulario.gise_id, giseIdsAdmin)).all(),
				db.select({ gise_id: giseAssinaturasRelatorios.gise_id, seccional_id: giseAssinaturasRelatorios.seccional_id })
					.from(giseAssinaturasRelatorios)
					.where(and(inArray(giseAssinaturasRelatorios.gise_id, giseIdsAdmin), eq(giseAssinaturasRelatorios.tipo, 'extraordinario'))).all()
			]);
			respostas.forEach((res: any) => respostasEquipeMapAdmin.set(`${res.gise_id}_${res.equipe_id}`, true));
			extras.forEach((ext: any) => extrasAssinadosMapAdmin.set(`${ext.gise_id}_${ext.seccional_id}`, true));
		}

		for (const row of rawAdmin) {
			const respostaEquipe = respostasEquipeMapAdmin.get(`${row.id}_${row.equipe_id}`);
			const extraAssinado = extrasAssinadosMapAdmin.get(`${row.id}_${row.seccional_id}`);

			listaAdmin.push({
				...row,
				equipeRespondida: !!respostaEquipe,
				extraAssinado: !!extraAssinado,
				isAdminView: true
			});
		}
	}

	const defaultGiseQuestions = [
		{ id: 1, texto: '1. DIGITE A VTR E A PLACA', tipo: 'vtr_placa', key: 'vtr_placa', filhos: [] },
		{ id: 2, texto: '2. DIGITE O KM INCIAL DA VTR', tipo: 'numero', key: 'km_inicial', filhos: [] },
		{ id: 3, texto: '3. DIGITE O KM FINAL DA VTR', tipo: 'numero', key: 'km_final', filhos: [] },
		{ id: 4, texto: '4. Houve PROCEDIMENTOS em flagrante realizados?', tipo: 'prisoes_maiores', key: 'procedimentos_flagrante_bool', subtexto_qtd: '4.1 QUANTIDADE:', subtexto_lista: '4.2 INFORMAR NOMES E PROCEDIMENTOS:', filhos: [] },
		{ id: 5, texto: '5. Houve MANDADOS cumpridos (MAIORES)?', tipo: 'mandados_maiores', key: 'mandados_cumpridos', subtexto_qtd: '5.1 QUANTIDADE:', subtexto_lista: '5.2 INFORMAR NOMES E MANDADOS:', filhos: [] },
		{ id: 6, texto: '6. Houve APREENSÕES cumpridas (MENORES)?', tipo: 'apreensoes_menores', key: 'apreensoes_cumpridas', subtexto_qtd: '6.1 QUANTIDADE:', subtexto_lista: '6.2 INFORMAR NOMES E PROCESSOS:', filhos: [] },
		{ id: 7, texto: '7. Nº PRISÕES/APREENSÕES em flagrante (por preso)', tipo: 'select_99', key: 'prisoes_apreensoes_flagrante', filhos: [] },
		{ id: 8, texto: '8. Houve tentativa de cumprimento de mandado?', tipo: 'sim_nao', key: 'tentativa_mandado', filhos: [] },
		{ id: 9, texto: '9. Houve mandado de busca e apreensão?', tipo: 'sim_nao', key: 'busca_apreensao', filhos: [] },
		{ id: 10, texto: '10. Houve apreensão de drogas?', tipo: 'drogas_complex', key: 'apreensoes_drogas', subtexto_tipo: '10.1 TIPO DE DROGA:', subtexto_detalhe: '10.1.1 PESO DA DROGA, POR TIPO:', filhos: [] },
		{ id: 11, texto: '11. Houve APREENSÃO DE ARMAS/MUNIÇÕES?', tipo: 'armas_complex', key: 'apreensoes_armas_bool', subtexto_tipo: '11.1 TIPO DE ARMA:', subtexto_qtd: '11.1.1 QUANTIDADE:', filhos: [] },
		{ id: 12, texto: '12. Local de Crime', tipo: 'select_99', key: 'local_crime', filhos: [] },
		{ id: 13, texto: '13. Ordem de Missão Cumprida', tipo: 'select_99', key: 'ordem_missao', filhos: [] },
		{ id: 14, texto: '14. Levantamento de Alvos', tipo: 'select_99', key: 'levantamento_alvos', filhos: [] },
		{ id: 15, texto: '15. Oitivas Realizadas', tipo: 'select_99', key: 'oitivas', filhos: [] },
		{ id: 16, texto: '16. Representação Prisão', tipo: 'select_99', key: 'representacao_prisao', filhos: [] },
		{ id: 17, texto: '17. Representação Busca', tipo: 'select_99', key: 'representacao_busca', filhos: [] },
		{ id: 18, texto: '18. Nº Abordagens', tipo: 'select_99', key: 'abordagens', filhos: [] },
		{ id: 19, texto: '19. Descreva resumidamente as diligências', tipo: 'textarea', key: 'descricao', filhos: [] },
	];

	const defaultSeintQuestions = [
		{
			id: 1, texto: '1. Houve EXTRAÇÃO DE DADOS DE APARELHOS CELULARES?', tipo: 'sim_nao', key: 'extracao_celulares', filhos: [
				{ id: 101, texto: '1.1 Quantidade de aparelhos analisados (1 a 99)', tipo: 'numero', key: 'extracao_qtd', filhos: [] },
				{ id: 102, texto: '1.2 Listagem de aparelhos analisados (Modelo, Nº proc, Delegacia, Concluída)', tipo: 'textarea', key: 'extracao_lista', filhos: [] }
			]
		},
		{
			id: 2, texto: '2. Houve ANÁLISE DE DADOS DE EXTRAÇÃO?', tipo: 'sim_nao', key: 'analise_extracao', filhos: [
				{ id: 201, texto: '2.1 Quantidade de aparelhos analisados (1 a 99)', tipo: 'numero', key: 'analise_qtd', filhos: [] },
				{ id: 202, texto: '2.2 Listagem de aparelhos analisados (Tamanho, Modelo, Nº proc, Delegacia)', tipo: 'textarea', key: 'analise_lista', filhos: [] }
			]
		},
		{
			id: 3, texto: '3. Houve PRODUÇÃO DE RELATÓRIOS?', tipo: 'sim_nao', key: 'producao_relatorios', filhos: [
				{ id: 301, texto: '3.1 Quantidade de relatórios produzidos (1 a 99)', tipo: 'numero', key: 'relatorios_qtd', filhos: [] },
				{ id: 302, texto: '3.2 Listagem de relatórios produzidos (Nº Relatório, Alvos, Proc. Vinculado, Delegacia)', tipo: 'textarea', key: 'relatorios_lista', filhos: [] }
			]
		},
		{
			id: 4, texto: '4. Houve LEVANTAMENTO DE DADOS DE ALVOS FORAGIDOS?', tipo: 'sim_nao', key: 'levantamento_foragidos', filhos: [
				{ id: 401, texto: '4.1 Quantidade de levantamentos produzidos (1 a 99)', tipo: 'numero', key: 'levantamentos_qtd', filhos: [] },
				{ id: 402, texto: '4.2 Listagem de relatórios produzidos (Nome do Alvo, Proc. Vinculado, Delegacia, Resultado)', tipo: 'textarea', key: 'levantamentos_lista', filhos: [] }
			]
		},
		{
			id: 5, texto: '5. Houve INTERCEPTAÇÃO TELEFÔNICA?', tipo: 'sim_nao', key: 'interceptacao_tel', filhos: [
				{ id: 501, texto: '5.1 Quantidade de INTERCEPTAÇÃO TELEFÔNICA (1 a 99)', tipo: 'numero', key: 'interceptacao_qtd', filhos: [] },
				{
					id: 502, texto: '5.2 Existem OPERAÇÕES que necessitaram de acompanhamento?', tipo: 'sim_nao', key: 'operacoes_acompanhamento_bool', filhos: [
						{ id: 503, texto: '5.2.1 Listagem de OPERAÇÕES (Nome da operação e Delegacia de origem)', tipo: 'textarea', key: 'operacoes_lista', filhos: [] }
					]
				}
			]
		}
	];

	const giseIdSelected = url.searchParams.get('giseId') ? parseInt(url.searchParams.get('giseId')!) : null;
	const equipeIdSelected = url.searchParams.get('equipeId') ? parseInt(url.searchParams.get('equipeId')!) : null;

	const [[modeloOp, modeloSeint], respostaRow] = await Promise.all([
		Promise.all([
			buscarGiseModeloFormulario(db, 'operacional'),
			buscarGiseModeloFormulario(db, 'seint')
		]),
		giseIdSelected && !isNaN(giseIdSelected)
			? buscarRespostaGise(db, giseIdSelected, u.tipo === 'policial' ? u.id : null, equipeIdSelected ?? undefined)
			: Promise.resolve(null)
	]);

	let respostasData: Record<string, unknown> = {};
	if (respostaRow?.respostas) {
		try { respostasData = JSON.parse(respostaRow.respostas); } catch { /* ignora JSON inválido */ }
	}

	return {
		minhasEscalas,
		listaAdmin,
		isSupervisorGise,
		giseIdSelected,
		equipeIdSelected,
		respostas: respostasData,
		// Se o banco retornar null (ex: migration não rodada ou sem registros ainda), usa o default code-fixed
		modeloOperacional: (modeloOp && modeloOp.config) ? JSON.parse(modeloOp.config) : defaultGiseQuestions,
		modeloSeint: (modeloSeint && modeloSeint.config) ? JSON.parse(modeloSeint.config) : defaultSeintQuestions,
		modeloPadraoOperacional: defaultGiseQuestions,
		modeloPadraoSeint: defaultSeintQuestions
	};
};

export const actions: Actions = {
	salvarResposta: async ({ request, locals, platform, url }) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const formData = await request.formData();
		const giseId = parseInt(formData.get('giseId') as string);
		const equipeId = formData.get('equipeId') ? parseInt(formData.get('equipeId') as string) : undefined;
		const respostasStr = formData.get('respostas') as string;

		if (isNaN(giseId) || !respostasStr) {
			return fail(400, { error: 'Dados inválidos', giseId, equipeId });
		}

		let respostas: any;
		try {
			respostas = JSON.parse(respostasStr);
		} catch {
			return fail(400, { error: 'Respostas em formato inválido', giseId, equipeId });
		}

		const db = getDB(platform);
		await salvarRespostaGise(db, giseId, u.id, JSON.stringify(respostas), equipeId);

		// Verificar transição de status
		const gise = await buscarGiseEscala(db, giseId);
		if (gise && gise.status === 'aguardando_relatorios') {
			const [todosSairam, todosEnviaram] = await Promise.all([
				verificarTodosSairam(db, giseId),
				verificarTodosRelatoriosEnviados(db, giseId)
			]);
			if (todosSairam && todosEnviaram) {
				await atualizarGiseEscala(db, giseId, { status: 'aguardando_assinatura_relat' });
			}
		}

		return { success: true, giseId, equipeId };
	},

	salvarEntrada: async ({ request, locals, platform, getClientAddress }) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const formData = await request.formData();
		const giseId = parseInt(formData.get('giseId') as string);
		const rubrica = formData.get('rubrica') as string;
		const latitude = formData.get('latitude') ? parseFloat(formData.get('latitude') as string) : undefined;
		const longitude = formData.get('longitude') ? parseFloat(formData.get('longitude') as string) : undefined;
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
			const result2FA = await verificarDesafio2FA(db, desafioId, codigoEmail);
			if (result2FA === 'expirado') return fail(400, { error: 'O código de verificação expirou.', giseId });
			if (result2FA === 'esgotado') return fail(400, { error: 'Muitas tentativas. Solicite um novo código.', giseId });
			if (!result2FA) return fail(400, { error: 'Código de verificação inválido.', giseId });
			if (result2FA.usuarioId !== u.id) return fail(403, { error: 'Código não pertence ao usuário logado.', giseId });
		}

		const gise = await buscarGiseEscala(db, giseId);
		if (!gise) return fail(404, { error: 'Escala não encontrada', giseId });

		let selfieKey: string | undefined = undefined;
		if (hasR2(platform) && selfieBase64) {
			const r2 = getR2(platform);
			const regex = /^data:image\/(jpeg|png|jpg);base64,/;
			const matches = selfieBase64.match(regex);
			if (matches) {
				const ext = matches[1] === 'png' ? 'png' : 'jpg';
				const dataBase64 = selfieBase64.replace(regex, '');
				const bytes = Buffer.from(dataBase64, 'base64');

				const [yyyy, mm, dd] = gise.data_inicio.split('-');
				const folder = `gise/${yyyy}-${mm}/${dd}/${giseId}/selfies`;
				selfieKey = `${folder}/presenca_${u.id}_entrada.${ext}`;

				await r2.put(selfieKey, bytes, { httpMetadata: { contentType: `image/${ext}` } });
			}
		}

		await salvarEntradaGise(db, giseId, u.id, rubrica, ip, ua, latitude, longitude, selfieKey);
		return { success: true, giseId };
	},

	salvarSaida: async ({ request, locals, platform, getClientAddress }) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const formData = await request.formData();
		const giseId = parseInt(formData.get('giseId') as string);
		const rubrica = formData.get('rubrica') as string;
		const latitude = formData.get('latitude') ? parseFloat(formData.get('latitude') as string) : undefined;
		const longitude = formData.get('longitude') ? parseFloat(formData.get('longitude') as string) : undefined;
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
			const result2FA = await verificarDesafio2FA(db, desafioId, codigoEmail);
			if (result2FA === 'expirado') return fail(400, { error: 'O código de verificação expirou.', giseId });
			if (result2FA === 'esgotado') return fail(400, { error: 'Muitas tentativas. Solicite um novo código.', giseId });
			if (!result2FA) return fail(400, { error: 'Código de verificação inválido.', giseId });
			if (result2FA.usuarioId !== u.id) return fail(403, { error: 'Código não pertence ao usuário logado.', giseId });
		}

		const giseOrig = await buscarGiseEscala(db, giseId);
		if (!giseOrig) return fail(404, { error: 'Escala não encontrada', giseId });

		let selfieKey: string | undefined = undefined;
		if (hasR2(platform) && selfieBase64) {
			const r2 = getR2(platform);
			const regex = /^data:image\/(jpeg|png|jpg);base64,/;
			const matches = selfieBase64.match(regex);
			if (matches) {
				const ext = matches[1] === 'png' ? 'png' : 'jpg';
				const dataBase64 = selfieBase64.replace(regex, '');
				const bytes = Buffer.from(dataBase64, 'base64');

				const [yyyy, mm, dd] = giseOrig.data_inicio.split('-');
				const folder = `gise/${yyyy}-${mm}/${dd}/${giseId}/selfies`;
				selfieKey = `${folder}/presenca_${u.id}_saida.${ext}`;

				await r2.put(selfieKey, bytes, { httpMetadata: { contentType: `image/${ext}` } });
			}
		}

		await salvarSaidaGise(db, giseId, u.id, rubrica, ip, ua, latitude, longitude, selfieKey);

		// Verificar transição de status após saída
		const gise = await buscarGiseEscala(db, giseId);
		if (gise && gise.status === 'em_andamento') {
			const [todosSairam, todosEnviaram] = await Promise.all([
				verificarTodosSairam(db, giseId),
				verificarTodosRelatoriosEnviados(db, giseId)
			]);
			if (todosSairam) {
				await atualizarGiseEscala(db, giseId, {
					status: todosEnviaram ? 'aguardando_assinatura_relat' : 'aguardando_relatorios'
				});
			}
		}

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
		} catch {
			return fail(400, { error: 'Configuração JSON inválida' });
		}

		const db = getDB(platform);
		await salvarGiseModeloFormulario(db, tipo, configStr);
		return { success: true };
	}
};
