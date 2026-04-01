import { eq, and, or, isNull, isNotNull, sql, desc, asc, inArray, ne } from 'drizzle-orm';
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
	verificacaoHash?: string,
	ipAddress?: string,
	userAgent?: string,
	latitude?: number,
	longitude?: number,
	selfieKey?: string,
	arquivoHash?: string
) {
	return db.insert(escalaDocumentos)
		.values({
			escala_id: escalaId,
			r2_key: r2Key,
			assinante_nome: assinanteNome,
			assinante_cpf: assinanteCpf || '',
			verificacao_hash: verificacaoHash,
			selfie_key: selfieKey,
			arquivo_hash: arquivoHash,
			ip_address: ipAddress,
			user_agent: userAgent,
			latitude,
			longitude
		})
		.onConflictDoUpdate({
			target: escalaDocumentos.escala_id,
			set: {
				r2_key: r2Key,
				assinante_nome: assinanteNome,
				assinante_cpf: assinanteCpf || '',
				verificacao_hash: verificacaoHash,
				selfie_key: selfieKey,
				arquivo_hash: arquivoHash,
				ip_address: ipAddress,
				user_agent: userAgent,
				latitude,
				longitude,
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

export async function buscarDocumentoPorHash(db: Database, hash: string) {
	// 1. Escalas comuns
	const esc = await db.select().from(escalaDocumentos).where(eq(escalaDocumentos.verificacao_hash, hash)).get();
	if (esc) return { ...esc, tipo_doc: 'escala' as const };

	// 2. Escalas GISE (gerais)
	const gise = await db.select().from(giseDocumentos).where(eq(giseDocumentos.verificacao_hash, hash)).get();
	if (gise) return { ...gise, escala_id: gise.gise_id, tipo_doc: 'gise' as const };

	// 3. Relatórios GISE (extraordinário/produtividade)
	const rel = await db.select().from(schema.giseAssinaturasRelatorios).where(eq(schema.giseAssinaturasRelatorios.verification_hash, hash)).get();
	if (rel) {
		return { 
			id: rel.id,
			escala_id: rel.gise_id, 
			assinante_nome: rel.assinante_nome,
			assinante_cpf: rel.assinante_cpf,
			created_at: rel.created_at,
			tipo_doc: 'gise_relatorio' as const,
			rel_tipo: rel.tipo,
			seccional_id: rel.seccional_id,
			ip_address: rel.ip_address,
			user_agent: rel.user_agent,
			latitude: rel.latitude,
			longitude: rel.longitude
		};
	}

	return undefined;
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
			temRespostas: boolean;
			equipes: Array<
				schema.GiseEquipe & {
					membros: Array<
						schema.GiseMembro & {
							policial_nome: string;
							policial_cargo: string;
							policial_matricula: string;
							policial_telefone: string | null;
							policial_lotacao: string | null;
							policial_classe: string | null;
							presenca: schema.GisePresenca | null;
						}
					>;
				}
			>;
		}
	>;
	supervisor_nome: string | null;
	supervisor_matricula: string | null;
	documento: schema.GiseDocumento | null;
}

export async function listarGiseEscalas(db: Database) {
	const escalas = await db.select().from(giseEscalas).orderBy(desc(giseEscalas.data_inicio)).all();
	const results = await Promise.all(escalas.map(async (e) => {
		const temSaida = await db.select({ id: gisePresencas.id })
			.from(gisePresencas)
			.where(and(eq(gisePresencas.gise_id, e.id), isNotNull(gisePresencas.saida_timestamp)))
			.limit(1).get();
		return { ...e, temSaidaConfirmada: !!temSaida };
	}));
	return results;
}

export async function buscarGiseEscala(db: Database, id: number): Promise<schema.GiseEscala | undefined> {
	return db.select().from(giseEscalas).where(eq(giseEscalas.id, id)).get();
}

export async function buscarGiseAtiva(db: Database) {
	const ativa = await db
		.select()
		.from(giseEscalas)
		.where(ne(giseEscalas.status, 'finalizada'))
		.orderBy(desc(giseEscalas.data_inicio))
		.get();
	
	if (!ativa) return undefined;

	const temSaida = await db.select({ id: gisePresencas.id })
		.from(gisePresencas)
		.where(and(eq(gisePresencas.gise_id, ativa.id), isNotNull(gisePresencas.saida_timestamp)))
		.limit(1).get();

	return { ...ativa, temSaidaConfirmada: !!temSaida };
}

export async function criarGiseEscala(
	db: Database,
	dataInicio: string,
	horaEntrada: string,
	horaSaida: string
): Promise<number> {
	const result = await db
		.insert(giseEscalas)
		.values({
			data_inicio: dataInicio,
			hora_entrada: horaEntrada,
			hora_saida: horaSaida
		})
		.returning({ id: giseEscalas.id });
	return result[0].id;
}

export async function buscarGiseDetalhado(db: Database, id: number): Promise<GiseDetalhado | null> {
	const gise = await db.select().from(giseEscalas).where(eq(giseEscalas.id, id)).get();
	if (!gise) return null;

	// Supervisor
	let supervisor_nome: string | null = null;
	let supervisor_matricula: string | null = null;
	if (gise.supervisor_id) {
		const p = await db.select({ nome: policiais.nome, matricula: policiais.matricula }).from(policiais).where(eq(policiais.id, gise.supervisor_id)).get();
		supervisor_nome = p?.nome ?? null;
		supervisor_matricula = p?.matricula ?? null;
	}

	// Documento
	const documento = await db.select().from(giseDocumentos).where(eq(giseDocumentos.gise_id, id)).get() ?? null;

	// Seccionais
	const secsRows = await db
		.select({
			id: giseSeccionais.id,
			gise_id: giseSeccionais.gise_id,
			seccional_id: giseSeccionais.seccional_id,
			unidade_operacional_id: giseSeccionais.unidade_operacional_id,
			status: giseSeccionais.status,
			hora_entrada: giseSeccionais.hora_entrada,
			hora_saida: giseSeccionais.hora_saida,
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
							const presenca = await db.select().from(gisePresencas).where(and(eq(gisePresencas.gise_id, id), eq(gisePresencas.policial_id, m.policial_id))).get() ?? null;
							return { ...m, presenca };
						})
					);
					return { ...eq_, membros };
				})
			);

			// Checar se houve resposta de formulário para esta seccional
			const temRespostas = !!(await db.select({ id: giseRespostasFormulario.id })
				.from(giseRespostasFormulario)
				.innerJoin(giseMembros, eq(giseRespostasFormulario.policial_id, giseMembros.policial_id))
				.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
				.where(and(
					eq(giseRespostasFormulario.gise_id, id),
					eq(giseEquipes.gise_seccional_id, sec.id)
				))
				.limit(1)
				.get());

			return {
				...sec,
				unidade_operacional_nome,
				equipes,
				temRespostas
			};
		})
	);

	return { ...gise, seccionais, supervisor_nome, supervisor_matricula, documento };
}

export async function atualizarGiseEscala(
	db: Database,
	id: number,
	data: Partial<{
		data_inicio: string;
		hora_entrada: string;
		hora_saida: string;
		status: 'em_preenchimento' | 'aguardando_assinatura' | 'assinada' | 'finalizada';
		supervisor_id: number | null;
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
		hora_entrada: string | null;
		hora_saida: string | null;
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
		hora_entrada: string | null;
		hora_saida: string | null;
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

/** Reabre uma escala GISE assinada/finalizada: revoga assinatura, permite nova edição */
export async function reabrirGiseEscala(db: Database, giseId: number) {
	await db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId));
	await atualizarGiseEscala(db, giseId, { status: 'em_preenchimento' });
}

export async function adicionarGiseMembro(
	db: Database,
	equipeId: number,
	policialId: number
) {
	return db.insert(giseMembros).values({ equipe_id: equipeId, policial_id: policialId });
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

/** Clona uma escala GISE para uma nova data, copiando seccionais e equipes */
export async function clonarGiseParaData(
	db: Database,
	giseId: number,
	novaData: string,
	modo: 'clonada' | 'completa' = 'clonada'
): Promise<number> {
	const gise = await db.select().from(giseEscalas).where(eq(giseEscalas.id, giseId)).get();
	if (!gise) throw new Error('GISE não encontrada');

	const novoId = await criarGiseEscala(
		db,
		novaData,
		gise.hora_entrada,
		gise.hora_saida
	);

	let secsParaClonar: any[] = [];

	if (modo === 'clonada') {
		secsParaClonar = await db
			.select()
			.from(giseSeccionais)
			.where(eq(giseSeccionais.gise_id, giseId));
	} else {
		const todas = await db.select().from(unidades).where(eq(unidades.tipo, 'seccional')).all();
		secsParaClonar = todas.map(s => ({ seccional_id: s.id }));
	}

	for (const sec of secsParaClonar) {
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

		let equipesOriginais: any[] = [];

		if (modo === 'clonada' && sec.id) {
			equipesOriginais = await db
				.select()
				.from(giseEquipes)
				.where(eq(giseEquipes.gise_seccional_id, sec.id));
		}

		if (equipesOriginais.length > 0) {
			await db.insert(giseEquipes).values(
				equipesOriginais.map((eq_: any) => ({
					gise_seccional_id: novaSecId,
					tipo: eq_.tipo,
					slots_dpc: eq_.slots_dpc,
					slots_oip: eq_.slots_oip
				}))
			);
		} else {
			await db.insert(giseEquipes).values([
				{ gise_seccional_id: novaSecId, tipo: 'operacional', slots_dpc: 1, slots_oip: 3 },
				{ gise_seccional_id: novaSecId, tipo: 'seint', slots_dpc: 0, slots_oip: 2 }
			]);
		}
	}

	return novoId;
}

/**
 * Verifica se uma equipe ainda tem slots disponíveis para o cargo do policial.
 */
export async function verificarSlotEquipe(
	db: Database,
	equipeId: number,
	policialId: number
): Promise<{ ok: boolean; motivo?: string }> {
	const equipe = await db.select().from(giseEquipes).where(eq(giseEquipes.id, equipeId)).get();
	if (!equipe) return { ok: false, motivo: 'Equipe não encontrada' };

	const policial = await db
		.select({ cargo: policiais.cargo })
		.from(policiais)
		.where(eq(policiais.id, policialId))
		.get();
	if (!policial) return { ok: false, motivo: 'Policial não encontrado' };

	const membrosEquipe = await db
		.select({ policial_id: giseMembros.policial_id })
		.from(giseMembros)
		.innerJoin(policiais, eq(giseMembros.policial_id, policiais.id))
		.where(and(eq(giseMembros.equipe_id, equipeId), eq(policiais.cargo, policial.cargo)));

	const ocupados = membrosEquipe.length;
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
 * Verifica se o policial já está alocado em outra equipe desta GISE.
 */
export async function verificarConflitoMembroGise(
	db: Database,
	giseId: number,
	policialId: number
): Promise<{ ok: boolean; motivo?: string }> {
	const membros = await db
		.select({
			id: giseMembros.id,
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

	if (membros.length > 0) {
		return {
			ok: false,
			motivo: `Policial já escalado nesta GISE na seccional ${membros[0].seccional_nome}`
		};
	}

	return { ok: true };
}

export async function buscarRespostasProdutividadeSeccional(db: any, giseId: number, seccionalId: number) {
	const configRow = await db.select().from(giseModeloFormulario).get();
	const defaultQuestions = [
		{ id: 1, texto: '1. VTR E PLACA', tipo: 'vtr_placa', key: 'vtr_placa', filhos: [] },
		{ id: 2, texto: '2. KM INICIAL', tipo: 'numero', key: 'km_inicial', filhos: [] },
		{ id: 3, texto: '3. KM FINAL', tipo: 'numero', key: 'km_final', filhos: [] },
		{ id: 4, texto: '4. PROCEDIMENTOS FLAGRANTE', tipo: 'select_99', key: 'procedimentos_inteiros', filhos: [] },
		{ id: 5, texto: '5. MANDADOS CUMPRIDOS (MAIORES)', tipo: 'mandados_maiores', key: 'mandados_cumpridos', filhos: [] },
		{ id: 6, texto: '6. APREENSÕES CUMPRIDAS (MENORES)', tipo: 'apreensoes_menores', key: 'apreensoes_cumpridas', filhos: [] },
		{ id: 7, texto: '7. PRISÕES/APREENSÕES FLAGRANTE', tipo: 'select_99', key: 'prisoes_apreensoes_flagrante', filhos: [] },
		{ id: 8, texto: '8. TENTATIVA CUMPRIMENTO MANDADO', tipo: 'sim_nao', key: 'tentativa_mandado', filhos: [] },
		{ id: 9, texto: '9. MANDADO BUSCA E APREENSÃO', tipo: 'sim_nao', key: 'busca_apreensao', filhos: [] },
		{ id: 10, texto: '10. APREENSÃO DE DROGAS', tipo: 'drogas_complex', key: 'apreensoes_drogas', filhos: [] },
		{ id: 11, texto: '11. APREENSÕES ARMAS', tipo: 'select_99', key: 'apreensoes_armas', filhos: [] },
		{ id: 12, texto: '12. LOCAL DE CRIME', tipo: 'select_99', key: 'local_crime', filhos: [] },
		{ id: 13, texto: '13. ORDEM DE MISSÃO CUMPRIDA', tipo: 'select_99', key: 'ordem_missao', filhos: [] },
		{ id: 14, texto: '14. LEVANTAMENTO DE ALVOS', tipo: 'select_99', key: 'levantamento_alvos', filhos: [] },
		{ id: 15, texto: '15. OITIVAS REALIZADAS', tipo: 'select_99', key: 'oitivas', filhos: [] },
		{ id: 16, texto: '16. REPRESENTAÇÃO PRISÃO', tipo: 'select_99', key: 'representacao_prisao', filhos: [] },
		{ id: 17, texto: '17. REPRESENTAÇÃO BUSCA', tipo: 'select_99', key: 'representacao_busca', filhos: [] },
		{ id: 18, texto: '18. Nº ABORDAGENS', tipo: 'select_99', key: 'abordagens', filhos: [] },
		{ id: 19, texto: '19. RESUMO DILIGÊNCIAS', tipo: 'textarea', key: 'descricao', filhos: [] }
	];
	const modeloPerguntas = configRow ? JSON.parse(configRow.config) : defaultQuestions;

	const rows = await db.select({
		equipe_id: giseRespostasFormulario.equipe_id,
		respostas: giseRespostasFormulario.respostas
	})
	.from(giseRespostasFormulario)
	.innerJoin(giseEquipes, eq(giseRespostasFormulario.equipe_id, giseEquipes.id))
	.where(and(
		eq(giseRespostasFormulario.gise_id, giseId),
		eq(giseEquipes.gise_seccional_id, seccionalId)
	))
	.all();

	const allResults: { equipe_id: number, pergunta: string, resposta: string }[] = [];

	const processarPerguntas = (listaPerguntas: any[], resps: any, eqId: number) => {
		for (const p of listaPerguntas) {
			const resp = resps[p.key] ?? resps[String(p.id)] ?? resps[p.id];

			if (resp !== undefined && resp !== null && resp !== '') {
				allResults.push({
					equipe_id: eqId,
					pergunta: p.texto,
					resposta: String(resp)
				});

				if (resp === 'Sim') {
					if (p.tipo === 'mandados_maiores' && resps.mandados_lista) {
						resps.mandados_lista.forEach((item: any, idx: number) => {
							if (item.nome || item.mandado) {
								allResults.push({ equipe_id: eqId, pergunta: `  ↳ Mandado ${idx+1}`, resposta: `${item.nome} - ${item.mandado}` });
							}
						});
					}
					if (p.tipo === 'apreensoes_menores' && resps.apreensoes_lista) {
						resps.apreensoes_lista.forEach((item: any, idx: number) => {
							if (item.nome || item.mandado) {
								allResults.push({ equipe_id: eqId, pergunta: `  ↳ Apreensão ${idx+1}`, resposta: `${item.nome} - ${item.mandado}` });
							}
						});
					}
					if (p.tipo === 'drogas_complex' && resps.drogas_selecionadas) {
						resps.drogas_selecionadas.forEach((d: string) => {
							const peso = resps.drogas_detalhe?.[d] || '0';
							const unid = resps.drogas_unidade?.[d] || 'g';
							allResults.push({ equipe_id: eqId, pergunta: `  ↳ Droga: ${d}`, resposta: `${peso}${unid}` });
						});
					}

					if (p.filhos && p.filhos.length > 0) {
						processarPerguntas(p.filhos, resps, eqId);
					}
				}
			}
		}
	};

	for (const r of rows) {
		const resps = JSON.parse(r.respostas);
		processarPerguntas(modeloPerguntas, resps, r.equipe_id!);
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
	rubrica?: string,
	ipAddress?: string,
	userAgent?: string,
	latitude?: number,
	longitude?: number,
	selfieKey?: string,
	arquivoHash?: string
) {
	return db.insert(giseDocumentos).values({
		gise_id: giseId,
		r2_key: r2Key,
		assinante_id: assinanteId,
		assinante_nome: assinanteNome,
		assinante_cpf: assinanteCpf,
		verificacao_hash: verificacaoHash,
		selfie_key: selfieKey,
		arquivo_hash: arquivoHash,
		rubrica: rubrica || null,
		ip_address: ipAddress,
		user_agent: userAgent,
		latitude,
		longitude
	}).onConflictDoUpdate({
		target: [giseDocumentos.gise_id],
		set: {
			r2_key: r2Key,
			assinante_id: assinanteId,
			assinante_nome: assinanteNome,
			assinante_cpf: assinanteCpf,
			verificacao_hash: verificacaoHash,
			selfie_key: selfieKey,
			arquivo_hash: arquivoHash,
			rubrica: rubrica || null,
			ip_address: ipAddress,
			user_agent: userAgent,
			latitude,
			longitude,
			created_at: sql`datetime('now')`
		}
	});
}

export async function buscarGiseDocumento(db: Database, giseId: number): Promise<schema.GiseDocumento | undefined> {
	return db.select().from(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId)).get();
}

/** Verifica se um policial é supervisor da GISE ativa */
export async function isSupervisorGiseAtiva(db: Database, policialId: number): Promise<boolean> {
	const gise = await db
		.select({ sup: giseEscalas.supervisor_id })
		.from(giseEscalas)
		.where(ne(giseEscalas.status, 'finalizada'))
		.orderBy(desc(giseEscalas.data_inicio))
		.get();
	if (!gise) return false;
	return gise.sup === policialId;
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

export async function buscarRespostaGise(db: Database, giseId: number, policialId: number | null, equipeId?: number) {
	let targetEquipeId = equipeId;

	if (!targetEquipeId && policialId) {
		const meuMembro = await db.select({ equipe_id: giseMembros.equipe_id }).from(giseMembros).where(eq(giseMembros.policial_id, policialId)).get();
		if (!meuMembro) return null;
		targetEquipeId = meuMembro.equipe_id;
	}

	if (!targetEquipeId) return null;

	return db.select()
		.from(giseRespostasFormulario)
		.where(and(
			eq(giseRespostasFormulario.gise_id, giseId),
			eq(giseRespostasFormulario.equipe_id, targetEquipeId)
		))
		.get();
}

export async function salvarRespostaGise(db: Database, giseId: number, policialId: number, respostas: string, equipeId?: number) {
	const existente = await buscarRespostaGise(db, giseId, policialId, equipeId);

	if (existente) {
		const targetId = (existente as any).id;
		return db.update(giseRespostasFormulario)
			.set({ respostas, updated_at: sql`datetime('now')` })
			.where(eq(giseRespostasFormulario.id, targetId));
	}

	return db.insert(giseRespostasFormulario).values({
		gise_id: giseId,
		policial_id: policialId,
		equipe_id: equipeId ?? null,
		respostas,
		updated_at: sql`datetime('now')`
	});
}

export async function listarTodasRespostasGise(db: Database) {
	return db.select({
		id: giseRespostasFormulario.id,
		gise_id: giseRespostasFormulario.gise_id,
		policial_id: giseRespostasFormulario.policial_id,
		respostas: giseRespostasFormulario.respostas,
		updated_at: giseRespostasFormulario.updated_at,
		data_inicio: giseEscalas.data_inicio,
		seccional_id: giseSeccionais.seccional_id,
		seccional_nome: unidades.nome,
		equipe_id: giseEquipes.id,
		equipe_tipo: giseEquipes.tipo
	})
	.from(giseRespostasFormulario)
	.innerJoin(giseEquipes, eq(giseRespostasFormulario.equipe_id, giseEquipes.id))
	.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
	.innerJoin(unidades, eq(giseSeccionais.seccional_id, unidades.id))
	.innerJoin(giseEscalas, eq(giseSeccionais.gise_id, giseEscalas.id))
	.all();
}

// ---- GISE Presenças ----

export async function buscarPresencaGise(db: Database, giseId: number, policialId: number) {
	return db.select()
		.from(schema.gisePresencas)
		.where(and(
			eq(schema.gisePresencas.gise_id, giseId),
			eq(schema.gisePresencas.policial_id, policialId)
		))
		.get();
}

export async function salvarEntradaGise(db: Database, giseId: number, policialId: number, rubrica: string, ipAddress?: string, userAgent?: string, latitude?: number, longitude?: number) {
	return db.insert(schema.gisePresencas).values({
		gise_id: giseId,
		policial_id: policialId,
		entrada_timestamp: new Date().toISOString(),
		entrada_rubrica: rubrica,
		ip_address: ipAddress,
		user_agent: userAgent,
		latitude,
		longitude,
		updated_at: sql`datetime('now')`
	}).onConflictDoUpdate({
		target: [schema.gisePresencas.gise_id, schema.gisePresencas.policial_id],
		set: {
			entrada_timestamp: new Date().toISOString(),
			entrada_rubrica: rubrica,
			ip_address: ipAddress,
			user_agent: userAgent,
			latitude,
			longitude,
			updated_at: sql`datetime('now')`
		}
	});
}

export async function salvarSaidaGise(db: Database, giseId: number, policialId: number, rubrica: string, ipAddress?: string, userAgent?: string, latitude?: number, longitude?: number) {
	return db.update(schema.gisePresencas).set({
		saida_timestamp: new Date().toISOString(),
		saida_rubrica: rubrica,
		ip_address: ipAddress,
		user_agent: userAgent,
		latitude,
		longitude,
		updated_at: sql`datetime('now')`
	}).where(and(
		eq(schema.gisePresencas.gise_id, giseId),
		eq(schema.gisePresencas.policial_id, policialId)
	));
}

/** Verifica se um documento GISE já foi assinado. */
export async function isDailyGiseSigned(db: Database, giseId: number) {
	const doc = await db.select({ id: schema.giseDocumentos.id })
		.from(schema.giseDocumentos)
		.where(eq(schema.giseDocumentos.gise_id, giseId))
		.get();
	return !!doc;
}

export async function buscarPresencasGise(db: Database, giseId: number) {
	return db.select().from(schema.gisePresencas).where(eq(schema.gisePresencas.gise_id, giseId)).all();
}


export async function buscarSeccionaisUnidades(db: Database) {
	return db.select()
		.from(unidades)
		.where(eq(unidades.tipo, 'seccional'))
		.orderBy(asc(unidades.nome))
		.all();
}


// ---- GISE Assinaturas de Relatórios ----

export async function buscarAssinaturasRelatoriosGise(db: Database, giseId: number) {
	return db.select()
		.from(schema.giseAssinaturasRelatorios)
		.where(eq(schema.giseAssinaturasRelatorios.gise_id, giseId))
		.all();
}

export async function buscarAssinaturaRelatorioGise(
	db: Database,
	giseId: number,
	seccionalId: number,
	tipo: 'extraordinario' | 'produtividade'
) {
	return db.select()
		.from(schema.giseAssinaturasRelatorios)
		.where(and(
			eq(schema.giseAssinaturasRelatorios.gise_id, giseId),
			eq(schema.giseAssinaturasRelatorios.seccional_id, seccionalId),
			eq(schema.giseAssinaturasRelatorios.tipo, tipo)
		))
		.get();
}

export async function salvarAssinaturaRelatorioGise(
	db: Database,
	data: {
		gise_id: number;
		seccional_id: number;
		tipo: 'extraordinario' | 'produtividade';
		assinante_id?: number | null;
		assinante_nome: string;
		assinante_cpf?: string | null;
		tipo_assinatura: 'simples' | 'webpki' | 'serpro';
		rubrica?: string;
		verification_hash?: string;
		ip_address?: string;
		user_agent?: string;
		latitude?: number;
		longitude?: number;
		selfie_key?: string;
		arquivo_hash?: string;
	}
) {
	return db.insert(schema.giseAssinaturasRelatorios)
		.values({
			...data,
			assinante_id: data.assinante_id ?? null,
			assinante_cpf: data.assinante_cpf ?? ''
		})
		.onConflictDoUpdate({
			target: [
				schema.giseAssinaturasRelatorios.gise_id,
				schema.giseAssinaturasRelatorios.seccional_id,
				schema.giseAssinaturasRelatorios.tipo
			],
			set: {
				assinante_id: data.assinante_id ?? null,
				assinante_nome: data.assinante_nome,
				assinante_cpf: data.assinante_cpf ?? '',
				tipo_assinatura: data.tipo_assinatura,
				rubrica: data.rubrica,
				verification_hash: data.verification_hash,
				ip_address: data.ip_address,
				user_agent: data.user_agent,
				latitude: data.latitude,
				longitude: data.longitude,
				selfie_key: data.selfie_key,
				arquivo_hash: data.arquivo_hash,
				created_at: sql`datetime('now')`
			}
		});
}
