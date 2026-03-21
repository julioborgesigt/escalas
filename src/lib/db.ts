import { eq, and, or, isNull, sql, desc, asc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './server/schema';
import {
	policiais,
	escalas,
	escalaPoliciais,
	unidades
} from './server/schema';
import type { EscalaPolicialComDados } from './types';
import { limparMatricula } from './utils';

export type Database = ReturnType<typeof getDB>;

export function getDB(platform: App.Platform | undefined) {
	if (!platform?.env?.escalas_db) {
		throw new Error('Database not available. Make sure D1 is configured.');
	}
	return drizzle(platform.env.escalas_db, { schema });
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
	data: { nome: string; matricula: string; cargo: string; telefone?: string; lotacao?: string }
) {
	return db.insert(policiais).values({
		nome: data.nome,
		matricula: limparMatricula(data.matricula),
		cargo: data.cargo as 'DPC' | 'OIP',
		telefone: data.telefone || '',
		lotacao: data.lotacao || ''
	});
}

export async function atualizarPolicial(
	db: Database,
	id: number,
	data: Partial<{ nome: string; matricula: string; cargo: string; telefone: string; lotacao: string; ativo: number }>
) {
	const updateData: Record<string, unknown> = {};

	if (data.nome !== undefined) updateData.nome = data.nome;
	if (data.matricula !== undefined) updateData.matricula = limparMatricula(data.matricula);
	if (data.cargo !== undefined) updateData.cargo = data.cargo;
	if (data.telefone !== undefined) updateData.telefone = data.telefone;
	if (data.lotacao !== undefined) updateData.lotacao = data.lotacao;
	if (data.ativo !== undefined) updateData.ativo = data.ativo;

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

export async function criarUnidade(db: Database, nome: string) {
	return db.insert(unidades).values({ nome: nome.trim() });
}

export async function excluirUnidade(db: Database, id: number) {
	return db.delete(unidades).where(eq(unidades.id, id));
}

// ---- Escalas ----

export async function listarEscalas(db: Database, lotacao?: string): Promise<schema.Escala[]> {
	if (lotacao) {
		return db
			.select()
			.from(escalas)
			.where(eq(escalas.lotacao, lotacao))
			.orderBy(desc(escalas.data_inicio));
	}
	return db.select().from(escalas).orderBy(desc(escalas.data_inicio));
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

// ---- Escala Policiais ----

export async function adicionarPolicialEscala(
	db: Database,
	escalaId: number,
	policialId: number,
	dataPlantao: string,
	dataSaida: string,
	horaEntrada: string,
	horaSaida: string
) {
	return db.insert(escalaPoliciais).values({
		escala_id: escalaId,
		policial_id: policialId,
		data_plantao: dataPlantao,
		data_saida: dataSaida,
		hora_entrada: horaEntrada,
		hora_saida: horaSaida
	});
}

export async function atualizarEscalaPolicial(
	db: Database,
	id: number,
	dataPlantao: string,
	dataSaida: string,
	horaEntrada: string,
	horaSaida: string
) {
	return db
		.update(escalaPoliciais)
		.set({
			data_plantao: dataPlantao,
			data_saida: dataSaida,
			hora_entrada: horaEntrada,
			hora_saida: horaSaida
		})
		.where(eq(escalaPoliciais.id, id));
}

export async function removerPolicialEscala(db: Database, id: number) {
	return db.delete(escalaPoliciais).where(eq(escalaPoliciais.id, id));
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
			nome: policiais.nome,
			matricula: policiais.matricula,
			cargo: policiais.cargo,
			telefone: policiais.telefone,
			lotacao: policiais.lotacao
		})
		.from(escalaPoliciais)
		.innerJoin(policiais, eq(escalaPoliciais.policial_id, policiais.id))
		.where(eq(escalaPoliciais.escala_id, escalaId))
		.orderBy(asc(escalaPoliciais.data_plantao), desc(policiais.cargo), asc(policiais.nome));

	return result as EscalaPolicialComDados[];
}
