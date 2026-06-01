import { eq, and, or, isNull, asc, sql, like } from 'drizzle-orm';
import { policiais, unidades } from '../server/schema';
import type * as schema from '../server/schema';
import { limparMatricula, limparCPF } from '../utils';
import { gerarSenhaAleatoriaHash } from '../auth';
import type { Database } from './core';

/** Escapa caracteres especiais do LIKE para evitar wildcard injection */
function escapeLike(str: string): string {
	return str.replace(/[%_\\]/g, '\\$&');
}

export async function listarPoliciais(
	db: Database,
	lotacao?: string,
	semLotacao?: boolean,
	opts?: {
		busca?: string;
		cargo?: string;
		seccionalId?: number;
		somentePapel?: boolean;
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
	} else if (lotacao && lotacao !== '__todas__') {
		baseConditions.push(eq(policiais.lotacao, lotacao));
	}

	if (opts?.seccionalId) {
		// Busca policiais em qualquer unidade que pertença à seccional escolhida
		const seccionalUnits = db
			.select({ nome: unidades.nome })
			.from(unidades)
			.where(or(eq(unidades.id, opts.seccionalId), eq(unidades.seccional_id, opts.seccionalId)));

		baseConditions.push(sql`${policiais.lotacao} IN (${seccionalUnits})`);
	}

	// Busca por nome ou matrícula
	if (opts?.busca) {
		const buscaEscapada = escapeLike(opts.busca.trim());
		baseConditions.push(
			or(
				like(policiais.nome, `%${buscaEscapada}%`),
				like(policiais.matricula, `%${buscaEscapada}%`)
			)!
		);
	}

	// Filtro por cargo
	if (opts?.cargo) {
		baseConditions.push(eq(policiais.cargo, opts.cargo as 'DPC' | 'OIP'));
	}

	// Somente policiais com papel administrativo (admin_seccional ou admin_unidade)
	if (opts?.somentePapel) {
		baseConditions.push(sql`${policiais.papel} IS NOT NULL`);
	}

	// Paginação com valores padrão
	const page = opts?.page ?? 1;
	const limit = opts?.limit ?? 20;
	const offset = (page - 1) * limit;

	// Query única com window function: count + data em uma só ida ao banco
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
			email_pessoal: policiais.email_pessoal,
			email_pessoal_verificado: policiais.email_pessoal_verificado,
			created_at: policiais.created_at,
			updated_at: policiais.updated_at,
			total: sql<number>`count(*) OVER()`
		})
		.from(policiais)
		.where(and(...baseConditions))
		.orderBy(asc(policiais.cargo), asc(policiais.nome))
		.limit(limit)
		.offset(offset);

	const total = results.length > 0 ? (results[0].total ?? 0) : 0;
	const totalPages = Math.ceil(total / limit);

	// Remove campo extra 'total' antes de retornar
	const policiaisList = results.map(({ total: _t, ...rest }) => rest);

	return {
		policiais: policiaisList,
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

/**
 * Lookup por matrícula (já normalizada). Usado pelo webhook de sync para
 * detectar se o registro já existe — e, com isso, preservar campos
 * privilegiados que NÃO devem ser tocados pelo payload externo (papel).
 */
export async function buscarPolicialPorMatricula(
	db: Database,
	matricula: string
): Promise<schema.Policial | undefined> {
	return db
		.select()
		.from(policiais)
		.where(eq(policiais.matricula, limparMatricula(matricula)))
		.get();
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
		email_pessoal?: string | null;
		ativo?: number;
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
		regime: (data.regime as 'plantao' | 'expediente') || 'plantao',
		classe: data.classe || '',
		senha: senhaHash,
		primeiro_acesso: 1,
		papel: (data.papel as 'admin_seccional' | 'admin_unidade' | null) || null,
		papel_unidade_id: data.papel_unidade_id || null,
		email: data.email || null,
		email_pessoal: data.email_pessoal || null,
		email_pessoal_verificado: 0,
		ativo: data.ativo ?? 1
	});
}

export async function upsertPolicial(
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
		email_pessoal?: string | null;
		ativo?: number;
	}
) {
	const matriculaLimpa = limparMatricula(data.matricula);
	const cpfLimpo = data.cpf ? limparCPF(data.cpf) : null;
	const senhaHash = await gerarSenhaAleatoriaHash();

	return db
		.insert(policiais)
		.values({
			nome: data.nome,
			matricula: matriculaLimpa,
			cargo: data.cargo as 'DPC' | 'OIP',
			cpf: cpfLimpo,
			telefone: data.telefone || '',
			lotacao: data.lotacao || '',
			regime: (data.regime as 'plantao' | 'expediente') || 'plantao',
			classe: data.classe || '',
			senha: senhaHash,
			primeiro_acesso: 1,
			papel: (data.papel as 'admin_seccional' | 'admin_unidade' | null) || null,
			papel_unidade_id: data.papel_unidade_id ?? null,
			email: data.email || null,
			email_pessoal: data.email_pessoal || null,
			email_pessoal_verificado: 0,
			ativo: data.ativo ?? 1
		})
		.onConflictDoUpdate({
			target: policiais.matricula,
			set: {
				nome: data.nome,
				cargo: data.cargo as 'DPC' | 'OIP',
				cpf: cpfLimpo,
				telefone: data.telefone || '',
				lotacao: data.lotacao || '',
				regime: (data.regime as 'plantao' | 'expediente') || 'plantao',
				classe: data.classe || '',
				papel: (data.papel as 'admin_seccional' | 'admin_unidade' | null) || null,
				papel_unidade_id: data.papel_unidade_id ?? null,
				email: data.email ? data.email : sql`email`,
				email_pessoal: data.email_pessoal ? data.email_pessoal : sql`email_pessoal`,
				email_pessoal_verificado: data.email_pessoal ? 0 : sql`email_pessoal_verificado`,
				ativo: data.ativo ?? 1,
				updated_at: sql`datetime('now', '-3 hours')`
			}
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
		papel: 'admin_seccional' | 'admin_unidade' | null;
		papel_unidade_id: number | null;
		email: string | null;
		email_pessoal: string | null;
		email_pessoal_verificado: number;
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
	if (data.papel !== undefined) updateData.papel = data.papel;
	if (data.papel_unidade_id !== undefined) updateData.papel_unidade_id = data.papel_unidade_id;
	if (data.email !== undefined) updateData.email = data.email;
	if (data.email_pessoal !== undefined) updateData.email_pessoal = data.email_pessoal;
	if (data.email_pessoal_verificado !== undefined) {
		updateData.email_pessoal_verificado = data.email_pessoal_verificado;
	}

	updateData.updated_at = sql`datetime('now', '-3 hours')`;

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
