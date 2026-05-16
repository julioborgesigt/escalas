/**
 * GET   /api/admin/lgpd/solicitacoes/[id] — detalhe da solicitação
 * PATCH /api/admin/lgpd/solicitacoes/[id] — responde/atualiza status
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, registrarAuditComContexto } from '$lib/db';
import { buscarSolicitacao, responderSolicitacao } from '$lib/db/lgpd-solicitacoes';
import { requireAdmin, badRequest, notFound, conflict } from '$lib/server/api';

const STATUS_VALIDOS = ['em_analise', 'concluida', 'indeferida'] as const;

export const GET: RequestHandler = async ({ platform, locals, params }) => {
	const u = requireAdmin(locals);
	if (u instanceof Response) return u;

	const id = Number(params.id);
	if (isNaN(id)) return badRequest('ID inválido');

	const db = getDB(platform);
	const solicitacao = await buscarSolicitacao(db, id);
	if (!solicitacao) return notFound('Solicitação');

	return json({ solicitacao });
};

export const PATCH: RequestHandler = async ({ platform, locals, params, request }) => {
	const u = requireAdmin(locals);
	if (u instanceof Response) return u;

	const id = Number(params.id);
	if (isNaN(id)) return badRequest('ID inválido');

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return badRequest('JSON inválido');
	}

	const status = String(body.status ?? '');
	if (!STATUS_VALIDOS.includes(status as any)) {
		return badRequest(`status inválido. Use: ${STATUS_VALIDOS.join(', ')}`);
	}
	if (!body.resposta) return badRequest('Campo obrigatório: resposta');

	const db = getDB(platform);
	const solicitacao = await buscarSolicitacao(db, id);
	if (!solicitacao) return notFound('Solicitação');
	if (solicitacao.status === 'concluida' || solicitacao.status === 'indeferida') {
		return conflict('Solicitação já encerrada');
	}

	const atualizada = await responderSolicitacao(db, id, status as any, String(body.resposta), u.nome);

	await registrarAuditComContexto(db, {
		usuario: u,
		acao: 'responder_solicitacao_lgpd',
		entidade: 'lgpd_solicitacao',
		entidade_id: id,
		detalhes: `Status: ${status} · Tipo: ${solicitacao.tipo_direito} · Titular: ${solicitacao.solicitante_nome}`
	});

	return json({ ok: true, solicitacao: atualizada });
};
