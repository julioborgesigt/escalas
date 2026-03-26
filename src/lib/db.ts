import { eq, and, or, isNull, sql, desc, asc, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './server/schema';
import {
	policiais,
	escalas,
	escalaPoliciais,
	unidades,
	escalaDocumentos
} from './server/schema';
import type { EscalaPolicialComDados, EscalaListagem } from './types';
import { limparMatricula } from './utils';

export type Database = ReturnType<typeof getDB>;

export function getDB(platform: any) {
	const p = platform as App.Platform | undefined;
	if (!p?.env?.escalas_db) {
		throw new Error('Database not available. Make sure D1 is configured.');
	}
	return drizzle(p.env.escalas_db, { schema });
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
	data: { nome: string; matricula: string; cargo: string; telefone?: string; lotacao?: string; regime?: string; classe?: string }
) {
	return db.insert(policiais).values({
		nome: data.nome,
		matricula: limparMatricula(data.matricula),
		cargo: data.cargo as 'DPC' | 'OIP',
		telefone: data.telefone || '',
		lotacao: data.lotacao || '',
		regime: (data.regime as 'plantao' | 'expediente' | 'ambos') || 'ambos',
		classe: data.classe || ''
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
