/**
 * GET /auditoria/export — exporta a trilha de auditoria filtrada em CSV.
 * Restrito ao Admin Geral. Honra os mesmos filtros do console.
 */
import type { RequestHandler } from './$types';
import { getDB, listarAuditLog, metaDaAcao } from '$lib/db';
import type { AuditLog } from '$lib/server/schema';
import { requireAdmin, contentDisposition } from '$lib/server/api';

const MAX_EXPORT = 5000;

/** Célula CSV: neutraliza fórmulas (CSV injection) e escapa aspas. */
function csvCell(v: unknown): string {
	const s = v == null ? '' : String(v);
	const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
	return '"' + safe.replace(/"/g, '""') + '"';
}

const COLUNAS: [string, (l: AuditLog) => unknown][] = [
	['seq', (l) => l.seq],
	['data_hora_utc', (l) => l.created_at],
	['categoria', (l) => l.categoria],
	['severidade', (l) => l.severidade],
	['resultado', (l) => l.resultado],
	['acao', (l) => l.acao],
	['acao_label', (l) => metaDaAcao(l.acao).label],
	['ator_tipo', (l) => l.actor_tipo],
	['ator', (l) => l.usuario_nome],
	['ator_papel', (l) => l.usuario_papel],
	['entidade', (l) => l.entidade],
	['entidade_id', (l) => l.entidade_id],
	['alvo_tipo', (l) => l.alvo_tipo],
	['alvo_id', (l) => l.alvo_id],
	['alvo_nome', (l) => l.alvo_nome],
	['detalhes', (l) => l.detalhes],
	['ip_anonimizado', (l) => l.ip],
	['user_agent', (l) => l.user_agent],
	['request_id', (l) => l.request_id],
	['rota', (l) => l.rota],
	['metodo', (l) => l.metodo],
	['hash_registro', (l) => l.hash_registro]
];

export const GET: RequestHandler = async ({ locals, platform, url }) => {
	const u = requireAdmin(locals);
	if (u instanceof Response) return u;

	const db = getDB(platform);
	const q = url.searchParams;
	const ate = q.get('ate');

	const { logs } = await listarAuditLog(db, {
		categoria: q.get('categoria') || undefined,
		acao: q.get('acao') || undefined,
		severidade: q.get('severidade') || undefined,
		resultado: q.get('resultado') || undefined,
		actor_tipo: q.get('actor_tipo') || undefined,
		busca: q.get('busca') || undefined,
		de: q.get('de') || undefined,
		ate: ate && ate.length === 10 ? `${ate} 23:59:59` : ate || undefined,
		page: 1,
		limit: MAX_EXPORT
	});

	const header = COLUNAS.map(([h]) => h).join(',');
	const linhas = logs.map((l) => COLUNAS.map(([, f]) => csvCell(f(l))).join(','));
	// BOM para o Excel reconhecer UTF-8; CRLF é o padrão de fim de linha em CSV.
	const csv = '﻿' + [header, ...linhas].join('\r\n');

	const nome = `auditoria-${new Date().toISOString().slice(0, 10)}.csv`;
	return new Response(csv, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': contentDisposition(nome),
			'Cache-Control': 'private, no-store'
		}
	});
};
