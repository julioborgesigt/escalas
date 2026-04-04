import { eq, and, or, sql, desc, asc, inArray } from 'drizzle-orm';
import {
	escalas,
	escalaPoliciais,
	escalaDocumentos,
	policiais
} from '../server/schema';
import type * as schema from '../server/schema';
import type { EscalaPolicialComDados, EscalaListagem } from '../types';
import type { Database } from './core';

export async function listarEscalas(
	db: Database,
	lotacao?: string,
	status?: 'pendente' | 'assinada',
	mes?: number,
	ano?: number,
	tipo?: string,
	visto?: boolean,
	criadaEmDepoisDe?: string
): Promise<EscalaListagem[]> {
	const conditions = [];

	if (lotacao) conditions.push(eq(escalas.lotacao, lotacao));
	if (mes) {
		const monthStr = mes.toString().padStart(2, '0');
		conditions.push(sql`strftime('%m', ${escalas.data_inicio}) = ${monthStr}`);
	}
	if (ano) conditions.push(sql`strftime('%Y', ${escalas.data_inicio}) = ${ano.toString()}`);
	if (tipo && tipo !== 'todos') conditions.push(eq(escalas.tipo, tipo as any));
	if (visto !== undefined) conditions.push(eq(escalas.visto_por_admin, visto ? 1 : 0));
	if (criadaEmDepoisDe) conditions.push(sql`${escalas.created_at} >= ${criadaEmDepoisDe}`);

	const query =
		conditions.length > 0
			? db.select().from(escalas).where(and(...conditions)).orderBy(desc(escalas.created_at))
			: db.select().from(escalas).orderBy(desc(escalas.created_at));

	const results = await query;
	if (results.length === 0) return [];

	const escalaIds = results.map((e) => e.id);
	const docs = await db
		.select({ escala_id: escalaDocumentos.escala_id })
		.from(escalaDocumentos)
		.where(inArray(escalaDocumentos.escala_id, escalaIds));

	const assinadas = new Set(docs.map((d) => d.escala_id));

	let mapeadas = results.map((e) => ({ ...e, is_assinada: assinadas.has(e.id) }));

	if (status === 'pendente') mapeadas = mapeadas.filter((e) => !e.is_assinada);
	else if (status === 'assinada') mapeadas = mapeadas.filter((e) => e.is_assinada);

	return mapeadas;
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
	const mesAno = dataInicio.substring(0, 7);
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

export async function marcarVisto(db: Database, id: number, visto: boolean) {
	return db.update(escalas).set({ visto_por_admin: visto ? 1 : 0 }).where(eq(escalas.id, id));
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
	const BATCH_SIZE = 50;
	const batches = [];
	for (let i = 0; i < datas.length; i += BATCH_SIZE) {
		const lote = datas.slice(i, i + BATCH_SIZE);
		batches.push(
			db.insert(escalaPoliciais).values(
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
			)
		);
	}
	await Promise.all(batches);
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
	const todos = await db
		.select({ id: policiais.id, regime: policiais.regime })
		.from(policiais)
		.where(and(eq(policiais.ativo, 1), eq(policiais.lotacao, lotacao)));

	console.log(
		`[adicionarTodosPoliciais] escala=${escalaId} lotacao="${lotacao}" regime="${regime}" total_ativos=${todos.length}`
	);

	const candidatos = todos.filter(
		(p) => p.regime === regime || p.regime === 'ambos' || p.regime === null
	);

	console.log(`[adicionarTodosPoliciais] candidatos compatíveis=${candidatos.length}`);

	if (candidatos.length === 0) return 0;

	const jaNaEscala = await db
		.select({ policial_id: escalaPoliciais.policial_id })
		.from(escalaPoliciais)
		.where(eq(escalaPoliciais.escala_id, escalaId));

	const idsJaAdicionados = new Set(jaNaEscala.map((e) => e.policial_id));
	const novos = candidatos.filter((p) => !idsJaAdicionados.has(p.id));

	if (novos.length === 0) return 0;

	const BATCH_SIZE = 50;
	const batches = [];
	for (let i = 0; i < novos.length; i += BATCH_SIZE) {
		const lote = novos.slice(i, i + BATCH_SIZE);
		batches.push(
			db.insert(escalaPoliciais).values(
				lote.map((p) => ({
					escala_id: escalaId,
					policial_id: p.id,
					data_plantao: dataPlantao,
					data_saida: dataSaida,
					hora_entrada: horaEntrada,
					hora_saida: horaSaida
				}))
			)
		);
	}
	await Promise.all(batches);

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
