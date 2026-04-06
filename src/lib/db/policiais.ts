import { eq, and, or, isNull, asc, sql, like } from 'drizzle-orm';
import { policiais, unidades } from '../server/schema';
import type * as schema from '../server/schema';
import { limparMatricula, limparCPF } from '../utils';
import { gerarSenhaAleatoriaHash } from '../auth';
import type { Database } from './core';

export async function listarPoliciais(
	db: Database,
	lotacao?: string,
	semLotacao?: boolean,
	opts?: {
		busca?: string;
		page?: number;
		limit?: number;
	}
): Promise<{
	policiais: Omit<schema.Policial, 'senha'>[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}> {
	const baseConditions = [eq(policiais.ativo, 1)];

	if (semLotacao) {
		baseConditions.push(or(eq(policiais.lotacao, ''), isNull(policiais.lotacao))!);
	} else if (lotacao) {
		baseConditions.push(eq(policiais.lotacao, lotacao));
	}

	// Busca por nome ou matrícula
	if (opts?.busca) {
		const buscaLimpa = opts.busca.trim();
		baseConditions.push(
			or(
				like(policiais.nome, `%${buscaLimpa}%`),
				like(policiais.matricula, `%${buscaLimpa}%`)
			)!
		);
	}

	// Contagem total (antes da paginação)
	const countResult = await db
		.select({ count: sql<number>`count(*)` })
		.from(policiais)
		.where(and(...baseConditions))
		.get();
	const total = Number(countResult?.count ?? 0);

	const page = Math.max(1, opts?.page ?? 1);
	const limit = Math.min(100, Math.max(1, opts?.limit ?? 20));
	const totalPages = Math.ceil(total / limit);
	const offset = (page - 1) * limit;

	const results = await db
		.select({
			id: policiais.id,
			nome: policiais.nome,
			matricula: policiais.matricula,
			cargo: policiais.cargo,
			cpf: policiais.cpf,
			telefone: policiais.telefone,
			lotacao: policiais.lotacao,
			ativo: policiais.ativo,
			regime: policiais.regime,
			classe: policiais.classe,
			primeiro_acesso: policiais.primeiro_acesso,
			papel: policiais.papel,
			papel_unidade_id: policiais.papel_unidade_id,
			email: policiais.email,
			created_at: policiais.created_at,
			updated_at: policiais.updated_at
		})
		.from(policiais)
		.where(and(...baseConditions))
		.orderBy(asc(policiais.cargo), asc(policiais.nome))
		.limit(limit)
		.offset(offset);

	return {
		policiais: results,
		total,
		page,
		limit,
		totalPages
	};
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
		email?: string | null;
	}
) {
	const senhaHash = await gerarSenhaAleatoriaHash();
	return db.insert(policiais).values({
		nome: data.nome,
		matricula: limparMatricula(data.matricula),
		cargo: data.cargo as 'DPC' | 'OIP',
		cpf: data.cpf ? limparCPF(data.cpf) : null,
		telefone: data.telefone || '',
		lotacao: data.lotacao || '',
		regime: (data.regime as 'plantao' | 'expediente' | 'ambos') || 'ambos',
		classe: data.classe || '',
		senha: senhaHash,
		primeiro_acesso: 1,
		papel: (data.papel as 'admin_seccional' | 'admin_unidade' | null) || null,
		papel_unidade_id: data.papel_unidade_id || null,
		email: data.email || null
	});
}

export async function atualizarPolicial(
	db: Database,
	id: number,
	data: Partial<{
		nome: string;
		matricula: string;
		cargo: string;
		cpf: string | null;
		telefone: string;
		lotacao: string;
		ativo: number;
		regime: string;
		classe: string;
		email: string | null;
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
	if (data.email !== undefined) updateData.email = data.email;

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
