import { eq, and, or, sql, desc, asc, inArray, like, isNull, isNotNull } from 'drizzle-orm';
import {
	escalas,
	escalaPoliciais,
	escalaDocumentos,
	policiais
} from '../server/schema';
import type * as schema from '../server/schema';
import type { EscalaPolicialComDados, EscalaListagem } from '../types';
import type { Database } from './core';

/** Escapa caracteres especiais do LIKE para evitar wildcard injection */
function escapeLike(str: string): string {
	return str.replace(/[%_\\]/g, '\\$&');
}

export async function listarEscalas(
	db: Database,
	lotacao?: string,
	status?: 'pendente' | 'assinada',
	mes?: number,
	ano?: number,
	tipo?: string,
	visto?: boolean,
	criadaEmDepoisDe?: string,
	opts?: {
		busca?: string;
		page?: number;
		limit?: number;
	}
): Promise<{
	escalas: EscalaListagem[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}> {
	const conditions: ReturnType<typeof eq>[] = [];

	if (lotacao) conditions.push(eq(escalas.lotacao, lotacao));
	if (mes) {
		const monthStr = mes.toString().padStart(2, '0');
		conditions.push(sql`strftime('%m', ${escalas.data_inicio}) = ${monthStr}` as any);
	}
	if (ano) conditions.push(sql`strftime('%Y', ${escalas.data_inicio}) = ${ano.toString()}` as any);
	if (tipo && tipo !== 'todos') conditions.push(eq(escalas.tipo, tipo as 'plantao' | 'expediente' | 'fds'));
	if (visto !== undefined) conditions.push(eq(escalas.visto_por_admin, visto ? 1 : 0));
	if (criadaEmDepoisDe) conditions.push(sql`${escalas.created_at} >= ${criadaEmDepoisDe}` as any);

	// Busca por título ou cidade
	if (opts?.busca) {
		const buscaEscapada = escapeLike(opts.busca.trim());
		conditions.push(
			or(
				like(escalas.titulo, `%${buscaEscapada}%`),
				like(escalas.cidade, `%${buscaEscapada}%`)
			)!
		);
	}

	// Filtro de status aplicado no WHERE via LEFT JOIN com escalaDocumentos
	// pendente = sem documento assinado, assinada = com documento
	if (status === 'pendente') {
		// Subquery: escalas que NÃO têm documento
		const subq = db
			.select({ escala_id: escalaDocumentos.escala_id })
			.from(escalaDocumentos);
		conditions.push(sql`${escalas.id} NOT IN (${subq})` as any);
	} else if (status === 'assinada') {
		// Subquery: escalas que têm documento
		const subq = db
			.select({ escala_id: escalaDocumentos.escala_id })
			.from(escalaDocumentos);
		conditions.push(sql`${escalas.id} IN (${subq})` as any);
	}

	const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

	const page = Math.max(1, opts?.page ?? 1);
	const limit = Math.min(100, Math.max(1, opts?.limit ?? 20));
	const offset = (page - 1) * limit;

	// Window function elimina o round-trip separado de COUNT (igual ao listarPoliciais)
	const results = await db
		.select({
			id: escalas.id,
			titulo: escalas.titulo,
			cidade: escalas.cidade,
			data_inicio: escalas.data_inicio,
			data_fim: escalas.data_fim,
			horario: escalas.horario,
			hora_entrada: escalas.hora_entrada,
			hora_saida: escalas.hora_saida,
			lotacao: escalas.lotacao,
			tipo: escalas.tipo,
			visto_por_admin: escalas.visto_por_admin,
			finalizada_em: escalas.finalizada_em,
			created_at: escalas.created_at,
			total: sql<number>`count(*) OVER()`
		})
		.from(escalas)
		.where(whereClause)
		.orderBy(desc(escalas.created_at))
		.limit(limit)
		.offset(offset);

	const total = results.length > 0 ? Number(results[0].total) : 0;
	const totalPages = Math.ceil(total / limit);

	if (results.length === 0) {
		return { escalas: [], total, page, limit, totalPages };
	}

	const escalaIds = results.map((e) => e.id);
	const docs = await db
		.select({ escala_id: escalaDocumentos.escala_id })
		.from(escalaDocumentos)
		.where(inArray(escalaDocumentos.escala_id, escalaIds));

	const assinadas = new Set(docs.map((d) => d.escala_id));

	const mapeadas = results.map(({ total: _t, ...e }) => ({
		...e,
		is_assinada: assinadas.has(e.id)
	}));

	return { escalas: mapeadas, total, page, limit, totalPages };
}

export async function buscarEscala(
	db: Database,
	id: number
): Promise<schema.Escala | undefined> {
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
		return db
			.select()
			.from(escalas)
			.where(and(eq(escalas.lotacao, lotacao), eq(escalas.tipo, tipo), eq(escalas.data_inicio, dataInicio)))
			.get();
	}
	// Range query em vez de substr() para aproveitar índices em data_inicio
	const mesAno = dataInicio.substring(0, 7);
	const [ano, mes] = mesAno.split('-').map(Number);
	const proximoMes = mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, '0')}-01`;

	return db
		.select()
		.from(escalas)
		.where(
			and(
				eq(escalas.lotacao, lotacao),
				eq(escalas.tipo, tipo),
				sql`${escalas.data_inicio} >= ${mesAno + '-01'}`,
				sql`${escalas.data_inicio} < ${proximoMes}`
			)
		)
		.get();
}

export async function marcarVisto(db: Database, id: number, visto: boolean) {
	return db.update(escalas).set({ visto_por_admin: visto ? 1 : 0 }).where(eq(escalas.id, id));
}

export async function finalizarEscalaFDS(db: Database, id: number): Promise<void> {
	const agora = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);
	await db.update(escalas).set({ finalizada_em: agora }).where(eq(escalas.id, id));
}

export async function desfinalizarEscalaFDS(db: Database, id: number): Promise<void> {
	await db.update(escalas).set({ finalizada_em: null }).where(eq(escalas.id, id));
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

	// Batch insert em vez de loop individual
	await db.insert(escalaPoliciais).values(
		datas.map(d => ({
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
		.set({ data_plantao: dataPlantao, data_saida: dataSaida, hora_entrada: horaEntrada, hora_saida: horaSaida, observacoes })
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
	// Filtrar no banco em vez de carregar tudo para o JS
	const candidatos = await db
		.select({ id: policiais.id })
		.from(policiais)
		.where(
			and(
				eq(policiais.ativo, 1),
				eq(policiais.lotacao, lotacao),
				or(
					eq(policiais.regime, regime),
					isNull(policiais.regime)
				)
			)
		);

	if (candidatos.length === 0) return 0;

	const jaNaEscala = await db
		.select({ policial_id: escalaPoliciais.policial_id })
		.from(escalaPoliciais)
		.where(eq(escalaPoliciais.escala_id, escalaId));

	const idsJaAdicionados = new Set(jaNaEscala.map((e) => e.policial_id));
	const novos = candidatos.filter((p) => !idsJaAdicionados.has(p.id));

	if (novos.length === 0) return 0;

	// Batch insert único dentro de transação para atomicidade
	await db.transaction(async (tx) => {
		await tx.insert(escalaPoliciais).values(
			novos.map((p) => ({
				escala_id: escalaId,
				policial_id: p.id,
				data_plantao: dataPlantao,
				data_saida: dataSaida,
				hora_entrada: horaEntrada,
				hora_saida: horaSaida
			}))
		);
	});

	return novos.length;
}

/**
 * Constrói a query de listagem de policiais de uma escala SEM executá-la.
 * Útil para uso com `db.batch([mutation, listarPoliciaisEscalaQuery(...)])`,
 * que combina mutação + listagem em um único round-trip ao D1.
 */
export function listarPoliciaisEscalaQuery(db: Database, escalaId: number) {
	return db
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
}

export async function listarPoliciaisEscala(
	db: Database,
	escalaId: number
): Promise<EscalaPolicialComDados[]> {
	const result = await listarPoliciaisEscalaQuery(db, escalaId);
	return result as EscalaPolicialComDados[];
}
