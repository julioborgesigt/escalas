/**
 * Módulo de log de auditoria.
 *
 * Registra todas as ações relevantes no sistema para rastreabilidade:
 * - Criação/edição/exclusão de policiais
 * - Criação/edição/exclusão de escalas
 * - Login/logout
 * - Alteração de senha
 * - Assinatura/revogação de documentos
 * - Mudança de papel (RBAC)
 */

import { desc, eq, and, like, sql } from 'drizzle-orm';
import { auditLog } from '../server/schema';
import type { Database } from './core';
import type { AuditLog } from '../server/schema';
import { logger } from '../server/logger';

export type AcaoAudit =
	| 'login'
	| 'logout'
	| 'alterar_senha'
	| 'criar_policial'
	| 'editar_policial'
	| 'excluir_policial'
	| 'criar_escala'
	| 'editar_escala'
	| 'excluir_escala'
	| 'adicionar_policial_escala'
	| 'remover_policial_escala'
	| 'assinar_escala'
	| 'revogar_assinatura'
	| 'mudar_papel'
	| 'criar_unidade'
	| 'editar_unidade'
	| 'excluir_unidade'
	| 'criar_gise'
	| 'editar_gise'
	| 'finalizar_gise'
	| 'reabrir_gise'
	| 'falha_login'
	| 'solicitar_redefinicao_senha'
	| 'redefinir_senha';

interface AuditEntry {
	usuario_id: number | null;
	usuario_nome: string;
	usuario_papel?: string | null;
	acao: AcaoAudit;
	entidade: string;
	entidade_id?: number | null;
	detalhes?: string | null;
	ip?: string | null;
	user_agent?: string | null;
}

/**
 * Registra uma entrada no log de auditoria.
 * Não lança exceção — falhas são logadas em console para não bloquear o fluxo principal.
 */
export async function registrarAudit(
	db: Database,
	entry: AuditEntry
): Promise<void> {
	try {
		await db.insert(auditLog).values({
			usuario_id: entry.usuario_id,
			usuario_nome: entry.usuario_nome,
			usuario_papel: entry.usuario_papel ?? null,
			acao: entry.acao,
			entidade: entry.entidade,
			entidade_id: entry.entidade_id ?? null,
			detalhes: entry.detalhes ?? null,
			ip: entry.ip ?? null,
			user_agent: entry.user_agent ?? null
		});
	} catch (err) {
		// Nunca bloquear o fluxo principal por falha de auditoria
		logger.error('[audit] Falha ao registrar log', {
			acao: entry.acao,
			entidade: entry.entidade,
			error: err instanceof Error ? err.message : String(err)
		});
	}
}

/**
 * Helper que extrai contexto da request e delega para registrarAudit.
 */
export async function registrarAuditComContexto(
	db: Database,
	opts: {
		usuario: { id: number; nome: string; papel?: string | null } | null;
		acao: AcaoAudit;
		entidade: string;
		entidade_id?: number | null;
		detalhes?: string | null;
		ip?: string | null;
		user_agent?: string | null;
	}
): Promise<void> {
	return registrarAudit(db, {
		usuario_id: opts.usuario?.id ?? null,
		usuario_nome: opts.usuario?.nome ?? 'Sistema',
		usuario_papel: opts.usuario?.papel ?? null,
		acao: opts.acao,
		entidade: opts.entidade,
		entidade_id: opts.entidade_id,
		detalhes: opts.detalhes,
		ip: opts.ip,
		user_agent: opts.user_agent
	});
}

/** Escapa caracteres especiais do LIKE para evitar wildcard injection */
function escapeLike(str: string): string {
	return str.replace(/[%_\\]/g, '\\$&');
}

/**
 * Lista entradas do log de auditoria com filtros e paginação.
 */
export async function listarAuditLog(
	db: Database,
	opts?: {
		usuario_id?: number;
		entidade?: string;
		acao?: string;
		busca?: string;
		page?: number;
		limit?: number;
	}
): Promise<{
	logs: AuditLog[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}> {
	const conditions = [];

	if (opts?.usuario_id) {
		conditions.push(eq(auditLog.usuario_id, opts.usuario_id));
	}
	if (opts?.entidade) {
		conditions.push(eq(auditLog.entidade, opts.entidade));
	}
	if (opts?.acao) {
		conditions.push(eq(auditLog.acao, opts.acao));
	}
	if (opts?.busca) {
		const b = escapeLike(opts.busca);
		conditions.push(
			sql`${auditLog.usuario_nome} LIKE ${'%' + b + '%'} OR ${auditLog.detalhes} LIKE ${'%' + b + '%'}`
		);
	}

	const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

	const page = Math.max(1, opts?.page ?? 1);
	const limit = Math.min(100, Math.max(1, opts?.limit ?? 20));
	const offset = (page - 1) * limit;

	// Query única com window function: evita segunda query de count(*)
	const rows = await db
		.select({
			id: auditLog.id,
			usuario_id: auditLog.usuario_id,
			usuario_nome: auditLog.usuario_nome,
			usuario_papel: auditLog.usuario_papel,
			acao: auditLog.acao,
			entidade: auditLog.entidade,
			entidade_id: auditLog.entidade_id,
			detalhes: auditLog.detalhes,
			ip: auditLog.ip,
			user_agent: auditLog.user_agent,
			created_at: auditLog.created_at,
			total: sql<number>`count(*) OVER()`
		})
		.from(auditLog)
		.where(whereClause)
		.orderBy(desc(auditLog.created_at))
		.limit(limit)
		.offset(offset);

	const total = rows.length > 0 ? (rows[0].total ?? 0) : 0;
	const totalPages = Math.ceil(total / limit);

	// Remove o campo extra 'total' antes de retornar
	const logs = rows.map(({ total: _t, ...rest }) => rest);

	return { logs, total, page, limit, totalPages };
}
