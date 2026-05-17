/**
 * GET   /api/admin/lgpd/solicitacoes/[id] — detalhe da solicitação
 * PATCH /api/admin/lgpd/solicitacoes/[id] — responde/atualiza status
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, registrarAuditComContexto } from '$lib/db';
import { buscarSolicitacao, responderSolicitacao } from '$lib/db/lgpd-solicitacoes';
import { requireAdmin, badRequest, notFound, conflict, validateBody } from '$lib/server/api';
import { responderSolicitacaoSchema } from '$lib/schemas';

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

	// Schema Zod: enum fechado em `status`, tamanho mínimo/máximo em
	// `resposta`, rejeita campos extras (não dá pra sobrescrever
	// `solicitante_id`/`prazo_resposta` via mass-assignment). Antes,
	// `status as any` aceitava qualquer string e ia para o banco.
	const v = await validateBody(request, responderSolicitacaoSchema);
	if (!v.ok) return v.response;
	const { status, resposta } = v.data;

	const db = getDB(platform);
	const solicitacao = await buscarSolicitacao(db, id);
	if (!solicitacao) return notFound('Solicitação');
	if (solicitacao.status === 'concluida' || solicitacao.status === 'indeferida') {
		return conflict('Solicitação já encerrada');
	}

	const atualizada = await responderSolicitacao(db, id, status, resposta, u.nome);

	await registrarAuditComContexto(db, {
		usuario: u,
		acao: 'responder_solicitacao_lgpd',
		entidade: 'lgpd_solicitacao',
		entidade_id: id,
		detalhes: `Status: ${status} · Tipo: ${solicitacao.tipo_direito} · Titular: ${solicitacao.solicitante_nome}`
	});

	return json({ ok: true, solicitacao: atualizada });
};
