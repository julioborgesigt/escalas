import { redirect } from '@sveltejs/kit';
import { getDB, buscarGiseModeloFormulario, isMembroGiseAtiva } from '$lib/db';
import { giseEscalas, giseMembros, giseEquipes, giseSeccionais, gisePresencas, giseDocumentos } from '$lib/server/schema';
import { eq, and, ne, or } from 'drizzle-orm';

export const load = async ({ locals, platform }: any) => {
	const u = locals.usuario;
	if (!u) throw redirect(302, '/login');

	const db = getDB(platform);

	// Apenas admin geral e membros de GISE ativa podem acessar
	if (u.tipo !== 'admin') {
		const isMembro = await isMembroGiseAtiva(db, u.id);
		if (!isMembro) throw redirect(302, '/');
	}

	// Se for admin, talvez queira ver estatísticas?
	// Por enquanto, se for admin geral, carregamos o modelo.
	// Se for policial, carregamos as escalas que ele participou.

	let minhasEscalas: any[] = [];
	if (u.tipo === 'policial') {
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
				eq_h_sai_dom: giseEquipes.hora_saida_domingo
			})
			.from(giseMembros)
			.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
			.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
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
				const sabadoAssinado = d === 'domingo' ? await db.select({ id: giseDocumentos.id }).from(giseDocumentos).where(and(eq(giseDocumentos.gise_id, e.id), or(eq(giseDocumentos.dia, 'sabado'), eq(giseDocumentos.dia, 'ambos')))).get() : true;
				
				// Checar se ALGUÉM da mesma EQUIPE já respondeu
				const respostaEquipe = await db.select({ id: giseRespostasFormulario.id })
					.from(giseRespostasFormulario)
					.innerJoin(giseMembros, eq(giseRespostasFormulario.policial_id, giseMembros.policial_id))
					.where(and(
						eq(giseRespostasFormulario.gise_id, e.id),
						eq(giseRespostasFormulario.dia, d),
						eq(giseMembros.equipe_id, e.equipe_id)
					))
					.get();

				// Prioridade de horário: equipe > seccional > escala
				const hEnt = (d === 'sabado' ? (e.eq_h_ent_sab ?? e.sec_h_ent_sab ?? e.h_ent_sab) : (e.eq_h_ent_dom ?? e.sec_h_ent_dom ?? e.h_ent_dom)) || '08:00';
				const hSai = (d === 'sabado' ? (e.eq_h_sai_sab ?? e.sec_h_sai_sab ?? e.h_sai_sab) : (e.eq_h_sai_dom ?? e.sec_h_sai_dom ?? e.h_sai_dom)) || '16:00';

				minhasEscalas.push({
					...e,
					dia: d,
					presenca,
					sabadoAssinado: !!sabadoAssinado,
					equipeRespondida: !!respostaEquipe,
					horarioPrevisto: { inicio: hEnt, fim: hSai }
				});
			}
		}
	}

	const modelo = await buscarGiseModeloFormulario(db);

	return {
		minhasEscalas,
		modeloConteudo: modelo ? JSON.parse(modelo.config) : []
	};
};

