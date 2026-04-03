import { redirect } from '@sveltejs/kit';
import { getDB, buscarGiseModeloFormulario, isMembroGiseAtiva } from '$lib/db';
import { giseEscalas, giseMembros, giseEquipes, giseSeccionais, gisePresencas, giseDocumentos, unidades, giseAssinaturasRelatorios } from '$lib/server/schema';
import { eq, and, inArray } from 'drizzle-orm';

export const load = async ({ locals, platform, url }: any) => {
	const u = locals.usuario;
	if (!u) throw redirect(302, '/login');

	const isAdminGeral = u.tipo === 'admin';
	const statusFilter = url.searchParams.get('status') || ''; // 'ativas' ou 'finalizadas'

	const db = getDB(platform);

	// Checar se é supervisor de alguma GISE
	const giseSupervisor = await db.select({ id: giseEscalas.id })
		.from(giseEscalas)
		.where(eq(giseEscalas.supervisor_id, u.id))
		.limit(1)
		.get();
	const isSupervisorGise = !!giseSupervisor;

	// Apenas admin geral e membros de GISE ativa podem acessar o preenchimento de formulário
	if (u.tipo !== 'admin') {
		const isMembro = await isMembroGiseAtiva(db, u.id);
		if (!isMembro) throw redirect(302, '/');
	}

	let minhasEscalas: any[] = [];
	let listaAdmin: any[] = [];

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
			.where(eq(giseMembros.policial_id, u.id))
			.all();

		const giseIds = [...new Set(rawEscalas.map(e => e.id))];

		let presencasMap = new Map<number, any>();
		let docsAssinadosMap = new Map<number, boolean>();
		let extrasAssinadosMap = new Map<string, boolean>();
		let respostasEquipeMap = new Map<string, boolean>();

		if (giseIds.length > 0) {
			const presencas = await db.select().from(gisePresencas)
				.where(and(inArray(gisePresencas.gise_id, giseIds), eq(gisePresencas.policial_id, u.id))).all();
			presencas.forEach((p: any) => presencasMap.set(p.gise_id, p));

			const docs = await db.select({ gise_id: giseDocumentos.gise_id })
				.from(giseDocumentos)
				.where(inArray(giseDocumentos.gise_id, giseIds)).all();
			docs.forEach((doc: any) => docsAssinadosMap.set(doc.gise_id, true));

			const extras = await db.select({ gise_id: giseAssinaturasRelatorios.gise_id, seccional_id: giseAssinaturasRelatorios.seccional_id })
				.from(giseAssinaturasRelatorios)
				.where(and(inArray(giseAssinaturasRelatorios.gise_id, giseIds), eq(giseAssinaturasRelatorios.tipo, 'extraordinario'))).all();
			extras.forEach((ext: any) => extrasAssinadosMap.set(`${ext.gise_id}_${ext.seccional_id}`, true));

			const { giseRespostasFormulario } = await import('$lib/server/schema');
			const respostas = await db.select({ gise_id: giseRespostasFormulario.gise_id, equipe_id: giseRespostasFormulario.equipe_id })
				.from(giseRespostasFormulario)
				.where(inArray(giseRespostasFormulario.gise_id, giseIds)).all();
			respostas.forEach((res: any) => respostasEquipeMap.set(`${res.gise_id}_${res.equipe_id}`, true));
		}

		for (const e of rawEscalas) {
			const presenca = presencasMap.get(e.id);

			// Mostrar apenas escalas sem saída confirmada
			if (presenca && presenca.saida_timestamp) {
				continue;
			}

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
			const { giseRespostasFormulario } = await import('$lib/server/schema');

			const respostas = await db.select({ gise_id: giseRespostasFormulario.gise_id, equipe_id: giseRespostasFormulario.equipe_id })
				.from(giseRespostasFormulario)
				.where(inArray(giseRespostasFormulario.gise_id, giseIdsAdmin)).all();
			respostas.forEach((res: any) => respostasEquipeMapAdmin.set(`${res.gise_id}_${res.equipe_id}`, true));

			const extras = await db.select({ gise_id: giseAssinaturasRelatorios.gise_id, seccional_id: giseAssinaturasRelatorios.seccional_id })
				.from(giseAssinaturasRelatorios)
				.where(and(inArray(giseAssinaturasRelatorios.gise_id, giseIdsAdmin), eq(giseAssinaturasRelatorios.tipo, 'extraordinario'))).all();
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

	const modelo = await buscarGiseModeloFormulario(db);
	const modeloFinal = modelo ? JSON.parse(modelo.config) : defaultGiseQuestions;

	return {
		minhasEscalas,
		listaAdmin,
		isSupervisorGise,
		modeloConteudo: modeloFinal,
		modeloPadrao: defaultGiseQuestions
	};
};
