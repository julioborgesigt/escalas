/**
 * POST /api/lgpd/solicitar — titular submete solicitação de direitos (art. 18 LGPD)
 * GET  /api/lgpd/solicitar — lista solicitações do próprio usuário
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, registrarAuditComContexto } from '$lib/db';
import { criarSolicitacao, listarSolicitacoesPorUsuario } from '$lib/db/lgpd';
import { requireAuth, validateBody } from '$lib/server/api';
import { novaSolicitacaoTitularSchema } from '$lib/schemas';

export const GET: RequestHandler = async ({ platform, locals }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const db = getDB(platform);
	const solicitacoes = await listarSolicitacoesPorUsuario(db, u.tipo, u.id);
	return json({ solicitacoes });
};

export const POST: RequestHandler = async ({ platform, locals, request }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	// Schema Zod: enum fechado em `tipo_direito` (8 valores LGPD), limite de
	// 5000 chars em `descricao`. Bloqueia mass-assignment de `solicitante_*`
	// — esses campos sempre vêm da sessão.
	const v = await validateBody(request, novaSolicitacaoTitularSchema);
	if (!v.ok) return v.response;
	const { tipo_direito, descricao } = v.data;

	const db = getDB(platform);
	const solicitacao = await criarSolicitacao(db, {
		solicitante_tipo: u.tipo,
		solicitante_id: u.id,
		solicitante_nome: u.nome,
		tipo_direito,
		descricao: descricao ?? null
	});

	await registrarAuditComContexto(db, {
		usuario: u,
		acao: 'solicitar_direito_lgpd',
		entidade: 'lgpd_solicitacao',
		entidade_id: solicitacao.id,
		detalhes: `Tipo: ${tipo_direito} · Prazo: ${solicitacao.prazo_resposta}`
	});

	return json(
		{
			ok: true,
			solicitacao,
			mensagem: `Solicitação registrada. Prazo de resposta: ${solicitacao.prazo_resposta} (15 dias úteis). Dúvidas: dpis@pc.ce.gov.br`
		},
		{ status: 201 }
	);
};
