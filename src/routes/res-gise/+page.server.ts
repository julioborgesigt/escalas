import { redirect } from '@sveltejs/kit';
import { getDB, buscarGiseModeloFormulario, isMembroGiseAtiva } from '$lib/db';
import { giseEscalas, giseMembros, giseEquipes, giseSeccionais, gisePresencas, giseDocumentos, unidades, giseAssinaturasRelatorios } from '$lib/server/schema';
import { eq, and, ne, or } from 'drizzle-orm';

export const load = async ({ locals, platform }: any) => {
	const u = locals.usuario;
	if (!u) throw redirect(302, '/login');

	const db = getDB(platform);

	// Checar se é supervisor de algum GISE
	const giseSupervisor = await db.select({ id: giseEscalas.id })
		.from(giseEscalas)
		.where(or(
			eq(giseEscalas.supervisor_sabado_id, u.id), 
			eq(giseEscalas.supervisor_domingo_id, u.id)
		))
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
				data_fim: giseEscalas.data_fim,
				status: giseEscalas.status,
				dia: giseMembros.dia,
				equipe_id: giseEquipes.id,
				// Horas (joins para prioridades)
				h_ent_sab: giseEscalas.hora_entrada_sabado,
				h_sai_sab: giseEscalas.hora_saida_sabado,
				h_ent_dom: giseEscalas.hora_entrada_domingo,
				h_sai_dom: giseEscalas.hora_saida_domingo,
				sec_h_ent_sab: giseSeccionais.hora_entrada_sabado,
				sec_h_sai_sab: giseSeccionais.hora_saida_sabado,
				sec_h_ent_dom: giseSeccionais.hora_entrada_domingo,
				sec_h_sai_dom: giseSeccionais.hora_saida_domingo,
				eq_h_ent_sab: giseEquipes.hora_entrada_sabado,
				eq_h_sai_sab: giseEquipes.hora_saida_sabado,
				eq_h_ent_dom: giseEquipes.hora_entrada_domingo,
				eq_h_sai_dom: giseEquipes.hora_saida_domingo,
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

		// Import schema only if needed, but we have them at the top
		const { giseRespostasFormulario } = await import('$lib/server/schema');

		// Split 'ambos' e checar presença
		for (const e of rawEscalas) {
			const dias = e.dia === 'ambos' ? ['sabado' as const, 'domingo' as const] : [e.dia as 'sabado' | 'domingo'];
			
			for (const d of dias) {
				const presenca = await db.select().from(gisePresencas).where(and(eq(gisePresencas.gise_id, e.id), eq(gisePresencas.policial_id, u.id), eq(gisePresencas.dia, d))).get();
				
				// Checar se o supervisor assinou o documento deste dia específico (ou 'ambos')
				const docAssinado = await db.select({ id: giseDocumentos.id })
					.from(giseDocumentos)
					.where(and(
						eq(giseDocumentos.gise_id, e.id), 
						or(eq(giseDocumentos.dia, d), eq(giseDocumentos.dia, 'ambos'))
					))
					.get();
				
				// Checar se o relatório EXTRAORDINÁRIO específico desta seccional foi assinado
				const extraAssinado = await db.select({ id: giseAssinaturasRelatorios.id })
					.from(giseAssinaturasRelatorios)
					.where(and(
						eq(giseAssinaturasRelatorios.gise_id, e.id),
						eq(giseAssinaturasRelatorios.seccional_id, e.seccional_id),
						eq(giseAssinaturasRelatorios.dia, d),
						eq(giseAssinaturasRelatorios.tipo, 'extraordinario')
					))
					.get();
				
				// Checar se ALGUÉM da mesma EQUIPE já respondeu (usando agora o equipe_id direto)
				const { giseRespostasFormulario } = await import('$lib/server/schema');
				const respostaEquipe = await db.select({ id: giseRespostasFormulario.id })
					.from(giseRespostasFormulario)
					.where(and(
						eq(giseRespostasFormulario.gise_id, e.id),
						eq(giseRespostasFormulario.dia, d),
						eq(giseRespostasFormulario.equipe_id, e.equipe_id)
					))
					.get();

				// Prioridade de horário: equipe > seccional > escala
				const hEnt = (d === 'sabado' ? (e.eq_h_ent_sab ?? e.sec_h_ent_sab ?? e.h_ent_sab) : (e.eq_h_ent_dom ?? e.sec_h_ent_dom ?? e.h_ent_dom)) || '08:00';
				const hSai = (d === 'sabado' ? (e.eq_h_sai_sab ?? e.sec_h_sai_sab ?? e.h_sai_sab) : (e.eq_h_sai_dom ?? e.sec_h_sai_dom ?? e.h_sai_dom)) || '16:00';

				minhasEscalas.push({
					...e,
					dia: d,
					presenca,
					assinada: !!docAssinado,
					extraAssinado: !!extraAssinado,
					equipeRespondida: !!respostaEquipe,
					horarioPrevisto: { inicio: hEnt, fimb: hSai }
				});
			}
		}
	} else {
		// Admin Geral: Lista todas as escalas e suas seccionais
		const rawAdmin = await db.select({
			id: giseEscalas.id,
			data_inicio: giseEscalas.data_inicio,
			data_fim: giseEscalas.data_fim,
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
		.orderBy(giseEscalas.data_inicio)
		.all();

		const { giseRespostasFormulario, giseMembros } = await import('$lib/server/schema');

		for (const row of rawAdmin) {
			for (const dia of ['sabado' as const, 'domingo' as const]) {
				const respostaEquipe = await db.select({ id: giseRespostasFormulario.id })
					.from(giseRespostasFormulario)
					.where(and(
						eq(giseRespostasFormulario.gise_id, row.id),
						eq(giseRespostasFormulario.dia, dia),
						eq(giseRespostasFormulario.equipe_id, row.equipe_id)
					))
					.get();

				const extraAssinado = await db.select({ id: giseAssinaturasRelatorios.id })
					.from(giseAssinaturasRelatorios)
					.where(and(
						eq(giseAssinaturasRelatorios.gise_id, row.id),
						eq(giseAssinaturasRelatorios.seccional_id, row.seccional_id),
						eq(giseAssinaturasRelatorios.dia, dia),
						eq(giseAssinaturasRelatorios.tipo, 'extraordinario')
					))
					.get();

				listaAdmin.push({
					...row,
					dia,
					equipeRespondida: !!respostaEquipe,
					extraAssinado: !!extraAssinado,
                    isAdminView: true
				});
			}
		}
	}

	const defaultGiseQuestions = [
		{ id: 1, texto: '1. DIGITE A VTR E A PLACA', tipo: 'vtr_placa', key: 'vtr_placa', filhos: [] },
		{ id: 2, texto: '2. DIGITE O KM INCIAL DA VTR', tipo: 'numero', key: 'km_inicial', filhos: [] },
		{ id: 3, texto: '3. DIGITE O KM FINAL DA VTR', tipo: 'numero', key: 'km_final', filhos: [] },
		{ id: 4, texto: '4. Nº de PROCEDIMENTOS em flagrante realizados', tipo: 'select_99', key: 'procedimentos_inteiros', filhos: [] },
		{ id: 5, texto: '5. Houve MANDADOS cumpridos (MAIORES)?', tipo: 'mandados_maiores', key: 'mandados_cumpridos', subtexto_qtd: '5.1 QUANTIDADE:', subtexto_lista: '5.2 INFORMAR NOMES E MANDADOS:', filhos: [] },
		{ id: 6, texto: '6. Houve APREENSÕES cumpridas (MENORES)?', tipo: 'apreensoes_menores', key: 'apreensoes_cumpridas', subtexto_qtd: '6.1 QUANTIDADE:', subtexto_lista: '6.2 INFORMAR NOMES E PROCESSOS:', filhos: [] },
		{ id: 7, texto: '7. Nº PRISÕES/APREENSÕES em flagrante (por preso)', tipo: 'select_99', key: 'prisoes_apreensoes_flagrante', filhos: [] },
		{ id: 8, texto: '8. Houve tentativa de cumprimento de mandado?', tipo: 'sim_nao', key: 'tentativa_mandado', filhos: [] },
		{ id: 9, texto: '9. Houve mandado de busca e apreensão?', tipo: 'sim_nao', key: 'busca_apreensao', filhos: [] },
		{ id: 10, texto: '10. Houve apreensão de drogas?', tipo: 'drogas_complex', key: 'apreensoes_drogas', subtexto_tipo: '10.1 TIPO DE DROGA:', subtexto_detalhe: '10.1.1 PESO DA DROGA, POR TIPO:', filhos: [] },
		{ id: 11, texto: '11. Apreensões Armas', tipo: 'select_99', key: 'apreensoes_armas', filhos: [] },
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
