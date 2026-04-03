import { eq, and, or, isNull, asc, sql } from 'drizzle-orm';
import { policiais, unidades } from '../server/schema';
import type * as schema from '../server/schema';
import { limparMatricula, limparCPF } from '../utils';
import type { Database } from './core';

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

export async function buscarPolicial(
	db: Database,
	id: number
): Promise<schema.Policial | undefined> {
	return db.select().from(policiais).where(eq(policiais.id, id)).get();
}

export async function criarPolicial(
	db: Database,
	data: {
		nome: string;
		matricula: string;
		cargo: string;
		cpf?: string | null;
		telefone?: string;
		lotacao?: string;
		regime?: string;
		classe?: string;
		papel?: string | null;
		papel_unidade_id?: number | null;
	}
) {
	return db.insert(policiais).values({
		nome: data.nome,
		matricula: limparMatricula(data.matricula),
		cargo: data.cargo as 'DPC' | 'OIP',
		cpf: data.cpf ? limparCPF(data.cpf) : null,
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
	data: Partial<{
		nome: string;
		matricula: string;
		cargo: string;
		cpf: string;
		telefone: string;
		lotacao: string;
		ativo: number;
		regime: string;
		classe: string;
	}>
) {
	const updateData: Record<string, unknown> = {};

	if (data.nome !== undefined) updateData.nome = data.nome;
	if (data.matricula !== undefined) updateData.matricula = limparMatricula(data.matricula);
	if (data.cargo !== undefined) updateData.cargo = data.cargo;
	if (data.cpf !== undefined) updateData.cpf = data.cpf ? limparCPF(data.cpf) : null;
	if (data.telefone !== undefined) updateData.telefone = data.telefone;
	if (data.lotacao !== undefined) updateData.lotacao = data.lotacao;
	if (data.ativo !== undefined) updateData.ativo = data.ativo;
	if (data.regime !== undefined) updateData.regime = data.regime;
	if (data.classe !== undefined) updateData.classe = data.classe;

	updateData.updated_at = sql`datetime('now', '-3 hours')`;

	return db.update(policiais).set(updateData).where(eq(policiais.id, id));
}

export async function excluirPolicial(db: Database, id: number) {
	return db.delete(policiais).where(eq(policiais.id, id));
}

export async function listarLotacoes(db: Database): Promise<string[]> {
	const result = await db.select({ nome: unidades.nome }).from(unidades).orderBy(asc(unidades.nome));
	return result.map((r) => r.nome);
}

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
			updated_at: sql`datetime('now', '-3 hours')`
		})
		.where(eq(policiais.id, policialId));
}
