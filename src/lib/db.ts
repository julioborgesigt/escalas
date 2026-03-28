import { eq, and, or, isNull, sql, desc, asc, inArray, ne } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './server/schema';
import {
	policiais,
	escalas,
	escalaPoliciais,
	unidades,
	escalaDocumentos,
	giseEscalas,
	giseSeccionais,
	giseEquipes,
	giseMembros,
	giseDocumentos,
	giseModeloFormulario,
	giseRespostasFormulario,
	gisePresencas
} from './server/schema';
import type { EscalaPolicialComDados, EscalaListagem } from './types';
import { limparMatricula } from './utils';

export type Database = ReturnType<typeof getDB>;

export function getDB(platform: any) {
	const env = (platform?.env || platform) as any;
	if (!env?.escalas_db) {
		throw new Error('Database not available. Make sure D1 is configured.');
	}
	return drizzle(env.escalas_db, { schema });
}

// ---- Policiais ----

export async function listarPoliciais(
	db: Database,
	lotacao?: string,
	semLotacao?: boolean
): Promise<schema.Policial[]> {
	const conditions = [eq(policiais.ativo, 1)];

	if (semLotacao) {
		conditions.push(or(eq(policiais.lotacao, ''), isNull(policiais.lotacao))!);
	} else if (lotacao) {
		conditions.push(eq(policiais.lotacao, lotacao));
	}

	return db
		.select()
		.from(policiais)
		.where(and(...conditions))
		.orderBy(asc(policiais.cargo), asc(policiais.nome));
}

export async function buscarPolicial(db: Database, id: number): Promise<schema.Policial | undefined> {
	return db.select().from(policiais).where(eq(policiais.id, id)).get();
}

export async function criarPolicial(
	db: Database,
	data: { nome: string; matricula: string; cargo: string; telefone?: string; lotacao?: string; regime?: string; classe?: string; papel?: string | null; papel_unidade_id?: number | null }
) {
	return db.insert(policiais).values({
		nome: data.nome,
		matricula: limparMatricula(data.matricula),
		cargo: data.cargo as 'DPC' | 'OIP',
		telefone: data.telefone || '',
		lotacao: data.lotacao || '',
		regime: (data.regime as 'plantao' | 'expediente' | 'ambos') || 'ambos',
		classe: data.classe || '',
		papel: (data.papel as any) || null,
		papel_unidade_id: data.papel_unidade_id || null
	});
}

export async function atualizarPolicial(
	db: Database,
	id: number,
	data: Partial<{ nome: string; matricula: string; cargo: string; telefone: string; lotacao: string; ativo: number; regime: string; classe: string }>
) {
	const updateData: Record<string, unknown> = {};

	if (data.nome !== undefined) updateData.nome = data.nome;
	if (data.matricula !== undefined) updateData.matricula = limparMatricula(data.matricula);
	if (data.cargo !== undefined) updateData.cargo = data.cargo;
	if (data.telefone !== undefined) updateData.telefone = data.telefone;
	if (data.lotacao !== undefined) updateData.lotacao = data.lotacao;
	if (data.ativo !== undefined) updateData.ativo = data.ativo;
	if (data.regime !== undefined) updateData.regime = data.regime;
	if (data.classe !== undefined) updateData.classe = data.classe;

	updateData.updated_at = sql`datetime('now')`;

	return db.update(policiais).set(updateData).where(eq(policiais.id, id));
}

export async function excluirPolicial(db: Database, id: number) {
	return db.delete(policiais).where(eq(policiais.id, id));
}

export async function listarLotacoes(db: Database): Promise<string[]> {
	const result = await db
		.select({ nome: unidades.nome })
		.from(unidades)
		.orderBy(asc(unidades.nome));
	return result.map((r) => r.nome);
}

// ---- Unidades ----

export async function listarUnidades(db: Database): Promise<schema.Unidade[]> {
	return db.select().from(unidades).orderBy(asc(unidades.nome));
}

export async function criarUnidade(db: Database, data: { nome: string; tipo: 'seccional' | 'delegacia'; seccional_id: number | null; tem_plantao: boolean; tem_expediente: boolean; tem_fds: boolean; cidade: string; }) {
	const values: any = { 
		nome: data.nome.trim(),
		tipo: data.tipo,
		tem_plantao: data.tem_plantao,
		tem_expediente: data.tem_expediente,
		tem_fds: data.tem_fds,
		cidade: data.cidade || ''
	};
	if (data.seccional_id) {
		values.seccional_id = data.seccional_id;
	}
	return db.insert(unidades).values(values);
}

export async function atualizarUnidade(
	db: Database, 
	id: number, 
	data: { nome: string; tipo: 'seccional' | 'delegacia'; seccional_id: number | null; tem_plantao: boolean; tem_expediente: boolean; tem_fds: boolean; cidade: string; }
): Promise<{ nomeAntigo: string }> {
	const unidade = await db.select({ nome: unidades.nome }).from(unidades).where(eq(unidades.id, id)).get();
	if (!unidade) throw new Error('Unidade não encontrada');
	const nomeAntigo = unidade.nome;
	const nomeTrimmed = data.nome.trim();

	await db.update(unidades).set({ 
		nome: nomeTrimmed,
		tipo: data.tipo,
		seccional_id: data.seccional_id,
		tem_plantao: data.tem_plantao,
		tem_expediente: data.tem_expediente,
		tem_fds: data.tem_fds,
		cidade: data.cidade || ''
	}).where(eq(unidades.id, id));
	// Cascata: atualizar lotação em policiais e escalas
	await db.update(policiais).set({ lotacao: nomeTrimmed }).where(eq(policiais.lotacao, nomeAntigo));
	await db.update(escalas).set({ lotacao: nomeTrimmed }).where(eq(escalas.lotacao, nomeAntigo));
	return { nomeAntigo };
}

export async function excluirUnidade(db: Database, id: number) {
	return db.delete(unidades).where(eq(unidades.id, id));
}

// ---- Escalas ----

export async function listarEscalas(
	db: Database,
	lotacao?: string,
	status?: 'pendente' | 'assinada',
	mes?: number,
	ano?: number,
	tipo?: string,
	visto?: boolean,
	criadaEmDepoisDe?: string // ISO date string
): Promise<EscalaListagem[]> {
	const conditions = [];

	if (lotacao) {
		conditions.push(eq(escalas.lotacao, lotacao));
	}

	if (mes) {
		const monthStr = mes.toString().padStart(2, '0');
		conditions.push(sql`strftime('%m', ${escalas.data_inicio}) = ${monthStr}`);
	}

	if (ano) {
		conditions.push(sql`strftime('%Y', ${escalas.data_inicio}) = ${ano.toString()}`);
	}

	if (tipo && tipo !== 'todos') {
		conditions.push(eq(escalas.tipo, tipo as any));
	}

	if (visto !== undefined) {
		conditions.push(eq(escalas.visto_por_admin, visto ? 1 : 0));
	}

	if (criadaEmDepoisDe) {
		conditions.push(sql`${escalas.created_at} >= ${criadaEmDepoisDe}`);
	}

	const query = conditions.length > 0 ?
		db.select().from(escalas).where(and(...conditions)).orderBy(desc(escalas.created_at)) :
		db.select().from(escalas).orderBy(desc(escalas.created_at));

	const results = await query;
	if (results.length === 0) return [];

	const escalaIds = results.map(e => e.id);
	const docs = await db.select({ escala_id: escalaDocumentos.escala_id })
		.from(escalaDocumentos)
		.where(inArray(escalaDocumentos.escala_id, escalaIds));
	
	const assinadas = new Set(docs.map(d => d.escala_id));

	let mapeadas = results.map(e => ({
		...e,
		is_assinada: assinadas.has(e.id)
	}));

	if (status === 'pendente') {
		mapeadas = mapeadas.filter(e => !e.is_assinada);
	} else if (status === 'assinada') {
		mapeadas = mapeadas.filter(e => e.is_assinada);
	}

	return mapeadas;
}

export async function buscarEscala(db: Database, id: number): Promise<schema.Escala | undefined> {
	return db.select().from(escalas).where(eq(escalas.id, id)).get();
}

export async function criarEscala(
	db: Database,
	data: Omit<schema.NovaEscala, 'id' | 'created_at'>
) {
	return db.insert(escalas).values(data).returning({ id: escalas.id });
}

export async function excluirEscala(db: Database, id: number) {
	return db.delete(escalas).where(eq(escalas.id, id));
}

export async function verificarEscalaExistente(
	db: Database,
	lotacao: string,
	tipo: 'plantao' | 'expediente' | 'fds',
	dataInicio: string
): Promise<schema.Escala | undefined> {
	if (tipo === 'fds') {
		// Para FDS: verifica mesma data de início (mesmo sábado)
		return db
			.select()
			.from(escalas)
			.where(and(eq(escalas.lotacao, lotacao), eq(escalas.tipo, tipo), eq(escalas.data_inicio, dataInicio)))
			.get();
	} else {
		// Para plantão/expediente: verifica mesmo mês/ano
		const mesAno = dataInicio.substring(0, 7); // "YYYY-MM"
		return db
			.select()
			.from(escalas)
			.where(
				and(
					eq(escalas.lotacao, lotacao),
					eq(escalas.tipo, tipo),
					sql`substr(${escalas.data_inicio}, 1, 7) = ${mesAno}`
				)
			)
			.get();
	}
}

export async function marcarVisto(db: Database, id: number, visto: boolean) {
	return db
		.update(escalas)
		.set({ visto_por_admin: visto ? 1 : 0 })
		.where(eq(escalas.id, id));
}

// ---- Escala Policiais ----

export async function adicionarPolicialEscala(
	db: Database,
	escalaId: number,
	policialId: number,
	dataPlantao: string,
	dataSaida: string,
	horaEntrada: string,
	horaSaida: string,
	observacoes: string = '',
	equipe: string = ''
) {
	return db.insert(escalaPoliciais).values({
		escala_id: escalaId,
		policial_id: policialId,
		data_plantao: dataPlantao,
		data_saida: dataSaida,
		hora_entrada: horaEntrada,
		hora_saida: horaSaida,
		observacoes,
		equipe
	});
}

export async function adicionarMultiplasDatasPlantao(
	db: Database,
	escalaId: number,
	policialId: number,
	datas: Array<{ data_plantao: string; data_saida: string }>,
	horaEntrada: string,
	horaSaida: string,
	equipe: string = '',
	observacoes: string = ''
): Promise<void> {
	if (datas.length === 0) return;
	const BATCH_SIZE = 10;
	for (let i = 0; i < datas.length; i += BATCH_SIZE) {
		const lote = datas.slice(i, i + BATCH_SIZE);
		await db.insert(escalaPoliciais).values(
			lote.map((d) => ({
				escala_id: escalaId,
				policial_id: policialId,
				data_plantao: d.data_plantao,
				data_saida: d.data_saida,
				hora_entrada: horaEntrada,
				hora_saida: horaSaida,
				equipe,
				observacoes
			}))
		);
	}
}

export async function atualizarEscalaPolicial(
	db: Database,
	id: number,
	dataPlantao: string,
	dataSaida: string,
	horaEntrada: string,
	horaSaida: string,
	observacoes: string = ''
) {
	return db
		.update(escalaPoliciais)
		.set({
			data_plantao: dataPlantao,
			data_saida: dataSaida,
			hora_entrada: horaEntrada,
			hora_saida: horaSaida,
			observacoes
		})
		.where(eq(escalaPoliciais.id, id));
}

export async function removerPolicialEscala(db: Database, id: number) {
	return db.delete(escalaPoliciais).where(eq(escalaPoliciais.id, id));
}

export async function adicionarTodosPoliciais(
	db: Database,
	escalaId: number,
	lotacao: string,
	regime: 'plantao' | 'expediente',
	dataPlantao: string,
	dataSaida: string,
	horaEntrada: string,
	horaSaida: string
): Promise<number> {
	// Busca todos os policiais ativos da lotação e filtra por regime em JS
	// para evitar incompatibilidades do D1 com OR em queries parametrizadas
	const todos = await db
		.select({ id: policiais.id, regime: policiais.regime })
		.from(policiais)
		.where(
			and(
				eq(policiais.ativo, 1),
				eq(policiais.lotacao, lotacao)
			)
		);

	console.log(`[adicionarTodosPoliciais] escala=${escalaId} lotacao="${lotacao}" regime="${regime}" total_ativos=${todos.length}`);

	const candidatos = todos.filter(
		(p) => p.regime === regime || p.regime === 'ambos' || p.regime === null
	);

	console.log(`[adicionarTodosPoliciais] candidatos compatíveis=${candidatos.length}`);

	if (candidatos.length === 0) return 0;

	// Verifica quais já estão na escala (qualquer data) para não duplicar
	const jaNaEscala = await db
		.select({ policial_id: escalaPoliciais.policial_id })
		.from(escalaPoliciais)
		.where(eq(escalaPoliciais.escala_id, escalaId));

	const idsJaAdicionados = new Set(jaNaEscala.map((e) => e.policial_id));
	const novos = candidatos.filter((p) => !idsJaAdicionados.has(p.id));

	if (novos.length === 0) return 0;

	// D1 limita a 100 variáveis bound por query.
	// Cada linha usa 7 params → máximo de 14 linhas por lote (14×7=98).
	const BATCH_SIZE = 10;
	for (let i = 0; i < novos.length; i += BATCH_SIZE) {
		const lote = novos.slice(i, i + BATCH_SIZE);
		await db.insert(escalaPoliciais).values(
			lote.map((p) => ({
				escala_id: escalaId,
				policial_id: p.id,
				data_plantao: dataPlantao,
				data_saida: dataSaida,
				hora_entrada: horaEntrada,
				hora_saida: horaSaida
			}))
		);
	}

	return novos.length;
}

export async function listarPoliciaisEscala(
	db: Database,
	escalaId: number
): Promise<EscalaPolicialComDados[]> {
	const result = await db
		.select({
			id: escalaPoliciais.id,
			escala_id: escalaPoliciais.escala_id,
			policial_id: escalaPoliciais.policial_id,
			data_plantao: escalaPoliciais.data_plantao,
			data_saida: escalaPoliciais.data_saida,
			horario: escalaPoliciais.horario,
			hora_entrada: escalaPoliciais.hora_entrada,
			hora_saida: escalaPoliciais.hora_saida,
			observacoes: escalaPoliciais.observacoes,
			nome: policiais.nome,
			matricula: policiais.matricula,
			cargo: policiais.cargo,
			telefone: policiais.telefone,
			lotacao: policiais.lotacao,
			regime: policiais.regime,
			classe: policiais.classe,
			equipe: escalaPoliciais.equipe
		})
		.from(escalaPoliciais)
		.innerJoin(policiais, eq(escalaPoliciais.policial_id, policiais.id))
		.where(eq(escalaPoliciais.escala_id, escalaId))
		.orderBy(asc(escalaPoliciais.data_plantao), desc(policiais.cargo), asc(policiais.nome));

	return result as EscalaPolicialComDados[];
}

// ---- Documentos de Escalas (R2) ----

export async function salvarDocumentoEscala(
	db: Database,
	escalaId: number,
	r2Key: string,
	assinanteNome: string,
	assinanteCpf?: string,
	verificacaoHash?: string
) {
	return db.insert(escalaDocumentos)
		.values({
			escala_id: escalaId,
			r2_key: r2Key,
			assinante_nome: assinanteNome,
			assinante_cpf: assinanteCpf || '',
			verificacao_hash: verificacaoHash
		})
		.onConflictDoUpdate({
			target: escalaDocumentos.escala_id,
			set: {
				r2_key: r2Key,
				assinante_nome: assinanteNome,
				assinante_cpf: assinanteCpf || '',
				verificacao_hash: verificacaoHash,
				created_at: sql`datetime('now')`
			}
		});
}

export async function buscarDocumentoEscala(db: Database, escalaId: number): Promise<schema.EscalaDocumento | undefined> {
	return db.select().from(escalaDocumentos).where(eq(escalaDocumentos.escala_id, escalaId)).get();
}

export async function excluirDocumentoEscala(db: Database, escalaId: number) {
	return db.delete(escalaDocumentos).where(eq(escalaDocumentos.escala_id, escalaId));
}

export async function buscarDocumentoPorHash(db: Database, hash: string): Promise<schema.EscalaDocumento | undefined> {
	return db.select().from(escalaDocumentos).where(eq(escalaDocumentos.verificacao_hash, hash)).get();
}

// ---- RBAC: Papéis de Policiais ----

export async function promoverPolicial(
	db: Database,
	policialId: number,
	papel: 'admin_seccional' | 'admin_unidade' | null,
	papelUnidadeId: number | null
) {
	return db
		.update(policiais)
		.set({
			papel: papel ?? null,
			papel_unidade_id: papelUnidadeId ?? null,
			updated_at: sql`datetime('now')`
		})
		.where(eq(policiais.id, policialId));
}

// ---- GISE ----

export interface GiseDetalhado extends schema.GiseEscala {
	seccionais: Array<
		schema.GiseSeccional & {
			seccional_nome: string;
			unidade_operacional_nome: string | null;
			equipes: Array<schema.GiseEquipe & { membros: Array<schema.GiseMembro & { policial_nome: string; policial_cargo: string; policial_matricula: string }> }>;
		}
	>;
	supervisor_sabado_nome: string | null;
	supervisor_sabado_matricula: string | null;
	supervisor_domingo_nome: string | null;
	supervisor_domingo_matricula: string | null;
	documentos: {
		sabado: schema.GiseDocumento | null;
		domingo: schema.GiseDocumento | null;
		ambos?: schema.GiseDocumento | null;
	};
}

export async function listarGiseEscalas(db: Database): Promise<schema.GiseEscala[]> {
	return db.select().from(giseEscalas).orderBy(desc(giseEscalas.data_inicio));
}

export async function buscarGiseEscala(db: Database, id: number): Promise<schema.GiseEscala | undefined> {
	return db.select().from(giseEscalas).where(eq(giseEscalas.id, id)).get();
}

export async function buscarGiseAtiva(db: Database): Promise<schema.GiseEscala | undefined> {
	return db
		.select()
		.from(giseEscalas)
		.where(ne(giseEscalas.status, 'finalizada'))
		.orderBy(desc(giseEscalas.data_inicio))
		.get();
}

export async function criarGiseEscala(
	db: Database,
	dataInicio: string,
	dataFim: string,
	horaEntrada: string,
	horaSaida: string,
	horaEntradaSabado?: string,
	horaSaidaSabado?: string,
	horaEntradaDomingo?: string,
	horaSaidaDomingo?: string
): Promise<number> {
	const result = await db
		.insert(giseEscalas)
		.values({
			data_inicio: dataInicio,
			data_fim: dataFim,
			hora_entrada: horaEntrada,
			hora_saida: horaSaida,
			hora_entrada_sabado: horaEntradaSabado ?? horaEntrada,
			hora_saida_sabado: horaSaidaSabado ?? horaSaida,
			hora_entrada_domingo: horaEntradaDomingo ?? horaEntrada,
			hora_saida_domingo: horaSaidaDomingo ?? horaSaida
		})
		.returning({ id: giseEscalas.id });
	return result[0].id;
}

export async function buscarGiseDetalhado(db: Database, id: number): Promise<GiseDetalhado | null> {
	const gise = await db.select().from(giseEscalas).where(eq(giseEscalas.id, id)).get();
	if (!gise) return null;

	// Supervisores
	let supervisor_sabado_nome: string | null = null;
	let supervisor_sabado_matricula: string | null = null;
	let supervisor_domingo_nome: string | null = null;
	let supervisor_domingo_matricula: string | null = null;

	if (gise.supervisor_sabado_id) {
		const p = await db.select({ nome: policiais.nome, matricula: policiais.matricula }).from(policiais).where(eq(policiais.id, gise.supervisor_sabado_id)).get();
		supervisor_sabado_nome = p?.nome ?? null;
		supervisor_sabado_matricula = p?.matricula ?? null;
	}
	if (gise.supervisor_domingo_id && gise.supervisor_domingo_id !== gise.supervisor_sabado_id) {
		const p = await db.select({ nome: policiais.nome, matricula: policiais.matricula }).from(policiais).where(eq(policiais.id, gise.supervisor_domingo_id)).get();
		supervisor_domingo_nome = p?.nome ?? null;
		supervisor_domingo_matricula = p?.matricula ?? null;
	} else if (gise.supervisor_domingo_id) {
		supervisor_domingo_nome = supervisor_sabado_nome;
		supervisor_domingo_matricula = supervisor_sabado_matricula;
	}

	// Documentos
	const docs = await db.select().from(giseDocumentos).where(eq(giseDocumentos.gise_id, id));
	const documentos = {
		sabado: docs.find(d => d.dia === 'sabado') ?? null,
		domingo: docs.find(d => d.dia === 'domingo') ?? null,
		ambos: docs.find(d => d.dia === 'ambos') ?? null
	};

	// Seccionais
	const secsRows = await db
		.select({
			id: giseSeccionais.id,
			gise_id: giseSeccionais.gise_id,
			seccional_id: giseSeccionais.seccional_id,
			unidade_operacional_id: giseSeccionais.unidade_operacional_id,
			status: giseSeccionais.status,
			hora_entrada_sabado: giseSeccionais.hora_entrada_sabado,
			hora_saida_sabado: giseSeccionais.hora_saida_sabado,
			hora_entrada_domingo: giseSeccionais.hora_entrada_domingo,
			hora_saida_domingo: giseSeccionais.hora_saida_domingo,
			seccional_nome: unidades.nome
		})
		.from(giseSeccionais)
		.innerJoin(unidades, eq(giseSeccionais.seccional_id, unidades.id))
		.where(eq(giseSeccionais.gise_id, id))
		.orderBy(asc(unidades.nome));

	const seccionais = await Promise.all(
		secsRows.map(async (sec) => {
			let unidade_operacional_nome: string | null = null;
			if (sec.unidade_operacional_id) {
				const u = await db.select({ nome: unidades.nome }).from(unidades).where(eq(unidades.id, sec.unidade_operacional_id)).get();
				unidade_operacional_nome = u?.nome ?? null;
			}

			const equipesRows = await db
				.select()
				.from(giseEquipes)
				.where(eq(giseEquipes.gise_seccional_id, sec.id));

			const equipes = await Promise.all(
				equipesRows.map(async (eq_) => {
					const mRows = await db
						.select({
							id: giseMembros.id,
							equipe_id: giseMembros.equipe_id,
							policial_id: giseMembros.policial_id,
							dia: giseMembros.dia,
							policial_nome: policiais.nome,
							policial_cargo: policiais.cargo,
							policial_matricula: policiais.matricula,
							policial_telefone: policiais.telefone,
							policial_lotacao: policiais.lotacao,
							policial_classe: policiais.classe
						})
						.from(giseMembros)
						.innerJoin(policiais, eq(giseMembros.policial_id, policiais.id))
						.where(eq(giseMembros.equipe_id, eq_.id));

					const membros = await Promise.all(
						mRows.map(async (m) => {
							const presencas = await db.select().from(gisePresencas).where(and(eq(gisePresencas.gise_id, id), eq(gisePresencas.policial_id, m.policial_id))).all();
							return { ...m, presencas };
						})
					);
					return { ...eq_, membros };
				})
			);

			// Checar se houve qualquer resposta de formulário para esta seccional nestes dias
			const respSab = await db.select({ id: giseRespostasFormulario.id })
				.from(giseRespostasFormulario)
				.innerJoin(giseMembros, eq(giseRespostasFormulario.policial_id, giseMembros.policial_id))
				.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
				.where(and(
					eq(giseRespostasFormulario.gise_id, id),
					eq(giseRespostasFormulario.dia, 'sabado'),
					eq(giseEquipes.gise_seccional_id, sec.id)
				))
				.limit(1)
				.get();
			
			const respDom = await db.select({ id: giseRespostasFormulario.id })
				.from(giseRespostasFormulario)
				.innerJoin(giseMembros, eq(giseRespostasFormulario.policial_id, giseMembros.policial_id))
				.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
				.where(and(
					eq(giseRespostasFormulario.gise_id, id),
					eq(giseRespostasFormulario.dia, 'domingo'),
					eq(giseEquipes.gise_seccional_id, sec.id)
				))
				.limit(1)
				.get();

			return { 
				...sec, 
				unidade_operacional_nome, 
				equipes,
				temRespostasSabado: !!respSab,
				temRespostasDomingo: !!respDom
			};
		})
	);

	return { ...gise, seccionais, supervisor_sabado_nome, supervisor_sabado_matricula, supervisor_domingo_nome, supervisor_domingo_matricula, documentos };
}

export async function atualizarGiseEscala(
	db: Database,
	id: number,
	data: Partial<{
		data_inicio: string;
		data_fim: string;
		hora_entrada: string;
		hora_saida: string;
		hora_entrada_sabado: string;
		hora_saida_sabado: string;
		hora_entrada_domingo: string;
		hora_saida_domingo: string;
		status: 'em_preenchimento' | 'aguardando_assinatura' | 'assinada' | 'finalizada';
		supervisor_sabado_id: number | null;
		supervisor_domingo_id: number | null;
	}>
) {
	return db.update(giseEscalas).set(data).where(eq(giseEscalas.id, id));
}

export async function upsertGiseSeccional(
	db: Database,
	giseId: number,
	seccionalId: number,
	unidadeOperacionalId?: number | null
): Promise<number> {
	const existing = await db
		.select({ id: giseSeccionais.id })
		.from(giseSeccionais)
		.where(and(eq(giseSeccionais.gise_id, giseId), eq(giseSeccionais.seccional_id, seccionalId)))
		.get();

	if (existing) {
		if (unidadeOperacionalId !== undefined) {
			await db
				.update(giseSeccionais)
				.set({ unidade_operacional_id: unidadeOperacionalId })
				.where(eq(giseSeccionais.id, existing.id));
		}
		return existing.id;
	}

	const result = await db
		.insert(giseSeccionais)
		.values({
			gise_id: giseId,
			seccional_id: seccionalId,
			unidade_operacional_id: unidadeOperacionalId ?? null
		})
		.returning({ id: giseSeccionais.id });

	const secId = result[0].id;

	// Criar equipes padrão: Operacional (1 DPC + 3 OIP) e SEINT (0 DPC + 2 OIP)
	await db.insert(giseEquipes).values([
		{ gise_seccional_id: secId, tipo: 'operacional', slots_dpc: 1, slots_oip: 3 },
		{ gise_seccional_id: secId, tipo: 'seint', slots_dpc: 0, slots_oip: 2 }
	]);

	return secId;
}

export async function atualizarGiseSeccional(
	db: Database,
	id: number,
	data: Partial<{ 
		unidade_operacional_id: number | null; 
		status: 'pendente' | 'preenchida' | 'retificada' | 'preenchida_retificada';
		hora_entrada_sabado: string | null;
		hora_saida_sabado: string | null;
		hora_entrada_domingo: string | null;
		hora_saida_domingo: string | null;
	}>
) {
	return db.update(giseSeccionais).set(data).where(eq(giseSeccionais.id, id));
}
 
export async function excluirGiseSeccional(db: Database, id: number) {
	return db.delete(giseSeccionais).where(eq(giseSeccionais.id, id));
}
 
export async function atualizarGiseEquipe(
	db: Database,
	id: number,
	slots_dpc?: number,
	slots_oip?: number,
	customHours?: Partial<{
		hora_entrada_sabado: string | null;
		hora_saida_sabado: string | null;
		hora_entrada_domingo: string | null;
		hora_saida_domingo: string | null;
	}>
) {
	const data: any = {};
	if (slots_dpc !== undefined) data.slots_dpc = slots_dpc;
	if (slots_oip !== undefined) data.slots_oip = slots_oip;
	if (customHours) Object.assign(data, customHours);
	
	return db.update(giseEquipes).set(data).where(eq(giseEquipes.id, id));
}

export async function excluirGiseEquipe(db: Database, id: number) {
	return db.delete(giseEquipes).where(eq(giseEquipes.id, id));
}

export async function criarGiseEquipe(
	db: Database,
	giseSeccionalId: number,
	tipo: 'operacional' | 'seint',
	slots_dpc: number,
	slots_oip: number
) {
	const result = await db
		.insert(giseEquipes)
		.values({ gise_seccional_id: giseSeccionalId, tipo, slots_dpc, slots_oip })
		.returning({ id: giseEquipes.id });
	return result[0].id;
}

/** Reabre uma escala GISE assinada/finalizada: revoga assinatura, reseta seccionais */
export async function reabrirGiseEscala(db: Database, giseId: number) {
	// Remover documento de assinatura
	await db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId));
	// Resetar todas as seccionais para pendente
	await db
		.update(giseSeccionais)
		.set({ status: 'pendente' })
		.where(eq(giseSeccionais.gise_id, giseId));
	// Voltar status para em_preenchimento
	await atualizarGiseEscala(db, giseId, { status: 'em_preenchimento' });
}

export async function adicionarGiseMembro(
	db: Database,
	equipeId: number,
	policialId: number,
	dia: 'sabado' | 'domingo' | 'ambos' = 'ambos'
) {
	return db.insert(giseMembros).values({ equipe_id: equipeId, policial_id: policialId, dia });
}

export async function removerGiseMembro(db: Database, id: number) {
	return db.delete(giseMembros).where(eq(giseMembros.id, id));
}

/** Verifica se todas as seccionais de uma GISE estão preenchidas (nem pendentes nem retificadas) */
export async function verificarGiseCompleta(db: Database, giseId: number): Promise<boolean> {
	const naoPreenchidas = await db
		.select({ id: giseSeccionais.id })
		.from(giseSeccionais)
		.where(
			and(
				eq(giseSeccionais.gise_id, giseId),
				or(eq(giseSeccionais.status, 'pendente'), eq(giseSeccionais.status, 'retificada'))
			)
		);
	return naoPreenchidas.length === 0;
}

/** Clona a GISE para o próximo final de semana (sábado seguinte) */
export async function clonarGiseParaProximoFDS(
	db: Database,
	giseId: number
): Promise<number> {
	const gise = await db.select().from(giseEscalas).where(eq(giseEscalas.id, giseId)).get();
	if (!gise) throw new Error('GISE não encontrada');

	// Calcular próximo sábado
	const dataAtual = new Date(gise.data_inicio + 'T00:00:00Z');
	const proximoSabado = new Date(dataAtual.getTime() + 7 * 24 * 60 * 60 * 1000);
	const proximoDomingo = new Date(proximoSabado.getTime() + 24 * 60 * 60 * 1000);
	const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

	const novoId = await criarGiseEscala(
		db,
		fmtDate(proximoSabado),
		fmtDate(proximoDomingo),
		gise.hora_entrada,
		gise.hora_saida,
		gise.hora_entrada_sabado,
		gise.hora_saida_sabado,
		gise.hora_entrada_domingo,
		gise.hora_saida_domingo
	);

	// Clonar seccionais e suas equipes (sem membros, sem unidade operacional, sem supervisor)
	const secsOriginais = await db
		.select()
		.from(giseSeccionais)
		.where(eq(giseSeccionais.gise_id, giseId));

	for (const sec of secsOriginais) {
		const novaSecResult = await db
			.insert(giseSeccionais)
			.values({
				gise_id: novoId,
				seccional_id: sec.seccional_id,
				unidade_operacional_id: null,
				status: 'pendente'
			})
			.returning({ id: giseSeccionais.id });
		const novaSecId = novaSecResult[0].id;

		// Clonar equipes com seus slots (mas sem membros)
		const equipesOriginais = await db
			.select()
			.from(giseEquipes)
			.where(eq(giseEquipes.gise_seccional_id, sec.id));

		if (equipesOriginais.length > 0) {
			await db.insert(giseEquipes).values(
				equipesOriginais.map((eq_) => ({
					gise_seccional_id: novaSecId,
					tipo: eq_.tipo,
					slots_dpc: eq_.slots_dpc,
					slots_oip: eq_.slots_oip
				}))
			);
		}
	}

	return novoId;
}

/**
 * Feature 8: Verifica se uma equipe ainda tem slots disponíveis para o cargo do policial.
 * Retorna { ok: true } ou { ok: false, motivo: string }
 */
export async function verificarSlotEquipe(
	db: Database,
	equipeId: number,
	policialId: number,
	dia: 'sabado' | 'domingo' | 'ambos'
): Promise<{ ok: boolean; motivo?: string }> {
	const equipe = await db.select().from(giseEquipes).where(eq(giseEquipes.id, equipeId)).get();
	if (!equipe) return { ok: false, motivo: 'Equipe não encontrada' };

	const policial = await db
		.select({ cargo: policiais.cargo })
		.from(policiais)
		.where(eq(policiais.id, policialId))
		.get();
	if (!policial) return { ok: false, motivo: 'Policial não encontrado' };

	// Contar membros já alocados na equipe para este cargo e dia compatível
	const membrosEquipe = await db
		.select({ policial_id: giseMembros.policial_id, dia: giseMembros.dia })
		.from(giseMembros)
		.innerJoin(policiais, eq(giseMembros.policial_id, policiais.id))
		.where(and(eq(giseMembros.equipe_id, equipeId), eq(policiais.cargo, policial.cargo)));

	// Contar ocupação: 'ambos' ocupa sábado e domingo; 'sabado'/'domingo' ocupa só o respectivo
	let ocupados = 0;
	for (const m of membrosEquipe) {
		if (dia === 'ambos') {
			// Novo membro para ambos os dias: conflita com qualquer alocação existente
			ocupados++;
		} else if (dia === 'sabado' && (m.dia === 'sabado' || m.dia === 'ambos')) {
			ocupados++;
		} else if (dia === 'domingo' && (m.dia === 'domingo' || m.dia === 'ambos')) {
			ocupados++;
		}
	}

	const limite = policial.cargo === 'DPC' ? equipe.slots_dpc : equipe.slots_oip;
	if (ocupados >= limite) {
		return {
			ok: false,
			motivo: `Vagas de ${policial.cargo} esgotadas nesta equipe (limite: ${limite})`
		};
	}

	return { ok: true };
}

/**
 * Feature 8: Verifica se o policial já está alocado em outra equipe desta GISE no mesmo dia.
 * Retorna { ok: true } ou { ok: false, motivo: string }
 */
export async function verificarConflitoMembroGise(
	db: Database,
	giseId: number,
	policialId: number,
	dia: 'sabado' | 'domingo' | 'ambos'
): Promise<{ ok: boolean; motivo?: string }> {
	const membros = await db
		.select({
			id: giseMembros.id,
			dia: giseMembros.dia,
			equipe_id: giseMembros.equipe_id,
			seccional_nome: unidades.nome
		})
		.from(giseMembros)
		.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.innerJoin(unidades, eq(giseSeccionais.seccional_id, unidades.id))
		.where(
			and(eq(giseMembros.policial_id, policialId), eq(giseSeccionais.gise_id, giseId))
		);

	for (const m of membros) {
		const conflito =
			dia === 'ambos' ||
			m.dia === 'ambos' ||
			(dia === 'sabado' && m.dia === 'sabado') ||
			(dia === 'domingo' && m.dia === 'domingo');

		if (conflito) {
			const diaLabel = m.dia === 'ambos' ? 'Sáb+Dom' : m.dia === 'sabado' ? 'Sábado' : 'Domingo';
			return {
				ok: false,
				motivo: `Policial já escalado nesta GISE (${diaLabel}) na seccional ${m.seccional_nome}`
			};
		}
	}

	return { ok: true };
}

export async function buscarRespostasProdutividadeSeccional(db: any, giseId: number, seccionalId: number, dia: 'sabado' | 'domingo') {
	const configRow = await db.select().from(giseModeloFormulario).get();
	const modeloPerguntas = configRow ? JSON.parse(configRow.config) : [];
	
	const rows = await db.select({
		equipe_id: giseMembros.equipe_id,
		respostas: giseRespostasFormulario.respostas
	})
	.from(giseRespostasFormulario)
	.innerJoin(giseMembros, eq(giseRespostasFormulario.policial_id, giseMembros.policial_id))
	.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
	.where(and(
		eq(giseRespostasFormulario.gise_id, giseId),
		eq(giseRespostasFormulario.dia, dia),
		eq(giseEquipes.gise_seccional_id, seccionalId)
	))
	.all();

	const allResults: { equipe_id: number, pergunta: string, resposta: string }[] = [];

	for (const r of rows) {
		const resps = JSON.parse(r.respostas);
		for (const p of modeloPerguntas) {
			const resp = resps[p.id];
			if (resp !== undefined) {
				allResults.push({
					equipe_id: r.equipe_id!,
					pergunta: p.texto,
					resposta: String(resp)
				});
			}
		}
	}

	return allResults;
}

export async function salvarGiseDocumento(
	db: Database,
	giseId: number,
	r2Key: string,
	assinanteId: number,
	assinanteNome: string,
	assinanteCpf: string,
	verificacaoHash: string,
	dia: 'sabado' | 'domingo' | 'ambos' = 'ambos',
	rubrica?: string
) {
	return db.insert(giseDocumentos).values({
		gise_id: giseId,
		dia,
		r2_key: r2Key,
		assinante_id: assinanteId,
		assinante_nome: assinanteNome,
		assinante_cpf: assinanteCpf,
		verificacao_hash: verificacaoHash,
		rubrica: rubrica || null
	}).onConflictDoUpdate({
		target: [giseDocumentos.gise_id, giseDocumentos.dia],
		set: {
			r2_key: r2Key,
			assinante_id: assinanteId,
			assinante_nome: assinanteNome,
			assinante_cpf: assinanteCpf,
			verificacao_hash: verificacaoHash,
			rubrica: rubrica || null,
			created_at: sql`datetime('now')`
		}
	});
}

export async function buscarGiseDocumento(db: Database, giseId: number): Promise<schema.GiseDocumento | undefined> {
	return db.select().from(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId)).get();
}

/** Verifica se um policial é supervisor (sábado ou domingo) da GISE ativa */
export async function isSupervisorGiseAtiva(db: Database, policialId: number): Promise<boolean> {
	const gise = await db
		.select({ sup_sab: giseEscalas.supervisor_sabado_id, sup_dom: giseEscalas.supervisor_domingo_id })
		.from(giseEscalas)
		.where(ne(giseEscalas.status, 'finalizada'))
		.orderBy(desc(giseEscalas.data_inicio))
		.get();
	if (!gise) return false;
	return gise.sup_sab === policialId || gise.sup_dom === policialId;
}

/** Verifica se um policial é membro de alguma equipe na GISE ativa (não finalizada) */
export async function isMembroGiseAtiva(db: Database, policialId: number): Promise<boolean> {
	const result = await db
		.select({ id: giseMembros.id })
		.from(giseMembros)
		.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.innerJoin(giseEscalas, eq(giseSeccionais.gise_id, giseEscalas.id))
		.where(
			and(
				eq(giseMembros.policial_id, policialId),
				ne(giseEscalas.status, 'finalizada')
			)
		)
		.get();
	return !!result;
}

export async function buscarGiseModeloFormulario(db: Database) {
	return db.select().from(giseModeloFormulario).where(eq(giseModeloFormulario.id, 1)).get();
}

export async function salvarGiseModeloFormulario(db: Database, config: string) {
	return db.insert(giseModeloFormulario).values({
		id: 1,
		config,
		updated_at: sql`datetime('now')`
	}).onConflictDoUpdate({
		target: [giseModeloFormulario.id],
		set: {
			config,
			updated_at: sql`datetime('now')`
		}
	});
}

export async function buscarRespostaGise(db: Database, giseId: number, policialId: number, dia: 'sabado' | 'domingo' = 'sabado') {
	// Acha a equipe desse policial
	const meuMembro = await db.select({ equipe_id: giseMembros.equipe_id }).from(giseMembros).where(eq(giseMembros.policial_id, policialId)).get();
	if (!meuMembro) return null;

	// Acha qualquer resposta da mesma equipe
	return db.select()
		.from(giseRespostasFormulario)
		.innerJoin(giseMembros, eq(giseRespostasFormulario.policial_id, giseMembros.policial_id))
		.where(and(
			eq(giseRespostasFormulario.gise_id, giseId),
			eq(giseRespostasFormulario.dia, dia),
			eq(giseMembros.equipe_id, meuMembro.equipe_id)
		))
		.get() as any;
}

export async function salvarRespostaGise(db: Database, giseId: number, policialId: number, dia: 'sabado' | 'domingo', respostas: string) {
	// Checa se já existe uma resposta para a equipe
	const existente = await buscarRespostaGise(db, giseId, policialId, dia);
	
	if (existente) {
		const targetId = (existente as any).gise_respostas_formulario?.id || (existente as any).id;
		return db.update(giseRespostasFormulario)
			.set({ respostas, updated_at: sql`datetime('now')` })
			.where(eq(giseRespostasFormulario.id, targetId));
	}

	return db.insert(giseRespostasFormulario).values({
		gise_id: giseId,
		policial_id: policialId,
		dia,
		respostas,
		updated_at: sql`datetime('now')`
	});
}

// ---- GISE Presenças ----

export async function buscarPresencaGise(db: Database, giseId: number, policialId: number, dia: 'sabado' | 'domingo') {
	return db.select()
		.from(schema.gisePresencas)
		.where(and(
			eq(schema.gisePresencas.gise_id, giseId),
			eq(schema.gisePresencas.policial_id, policialId),
			eq(schema.gisePresencas.dia, dia)
		))
		.get();
}

export async function salvarEntradaGise(db: Database, giseId: number, policialId: number, dia: 'sabado' | 'domingo', rubrica: string) {
	return db.insert(schema.gisePresencas).values({
		gise_id: giseId,
		policial_id: policialId,
		dia,
		entrada_timestamp: new Date().toISOString(),
		entrada_rubrica: rubrica,
		updated_at: sql`datetime('now')`
	}).onConflictDoUpdate({
		target: [schema.gisePresencas.gise_id, schema.gisePresencas.policial_id, schema.gisePresencas.dia],
		set: {
			entrada_timestamp: new Date().toISOString(),
			entrada_rubrica: rubrica,
			updated_at: sql`datetime('now')`
		}
	});
}

export async function salvarSaidaGise(db: Database, giseId: number, policialId: number, dia: 'sabado' | 'domingo', rubrica: string) {
	return db.update(schema.gisePresencas).set({
		saida_timestamp: new Date().toISOString(),
		saida_rubrica: rubrica,
		updated_at: sql`datetime('now')`
	}).where(and(
		eq(schema.gisePresencas.gise_id, giseId),
		eq(schema.gisePresencas.policial_id, policialId),
		eq(schema.gisePresencas.dia, dia)
	));
}

/** Verifica se um documento GISE para um dia específico já foi assinado. */
export async function isDailyGiseSigned(db: Database, giseId: number, dia: 'sabado' | 'domingo') {
	const doc = await db.select({ id: schema.giseDocumentos.id })
		.from(schema.giseDocumentos)
		.where(and(
			eq(schema.giseDocumentos.gise_id, giseId),
			or(eq(schema.giseDocumentos.dia, dia), eq(schema.giseDocumentos.dia, 'ambos'))
		))
		.get();
	return !!doc;
}

export async function buscarPresencasGise(db: Database, giseId: number, dia?: 'sabado' | 'domingo') {
	if (dia) {
		return db.select()
			.from(schema.gisePresencas)
			.where(and(eq(schema.gisePresencas.gise_id, giseId), eq(schema.gisePresencas.dia, dia)))
			.all();
	}
	return db.select().from(schema.gisePresencas).where(eq(schema.gisePresencas.gise_id, giseId)).all();
}

