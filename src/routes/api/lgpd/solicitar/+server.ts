/**
 * POST /api/lgpd/solicitar — titular submete solicitação de direitos (art. 18 LGPD)
 * GET  /api/lgpd/solicitar — lista solicitações do próprio usuário
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, registrarAuditComContexto } from '$lib/db';
import { criarSolicitacao, listarSolicitacoesPorUsuario } from '$lib/db/lgpd-solicitacoes';

const TIPOS_VALIDOS = [
	'acesso', 'correcao', 'anonimizacao', 'portabilidade',
	'eliminacao', 'informacao_compartilhamento', 'revogacao_consentimento', 'oposicao'
] as const;

export const GET: RequestHandler = async ({ platform, locals }) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autenticado' }, { status: 401 });

	const db = getDB(platform);
	const solicitacoes = await listarSolicitacoesPorUsuario(db, u.tipo, u.id);
	return json({ solicitacoes });
};

export const POST: RequestHandler = async ({ platform, locals, request }) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autenticado' }, { status: 401 });

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'JSON inválido' }, { status: 400 });
	}

	const tipo_direito = String(body.tipo_direito ?? '');
	if (!TIPOS_VALIDOS.includes(tipo_direito as any)) {
		return json({ error: `tipo_direito inválido. Use: ${TIPOS_VALIDOS.join(', ')}` }, { status: 400 });
	}

	const db = getDB(platform);
	const solicitacao = await criarSolicitacao(db, {
		solicitante_tipo: u.tipo,
		solicitante_id: u.id,
		solicitante_nome: u.nome,
		tipo_direito: tipo_direito as any,
		descricao: body.descricao ? String(body.descricao) : null
	});

	await registrarAuditComContexto(db, {
		usuario: u,
		acao: 'solicitar_direito_lgpd',
		entidade: 'lgpd_solicitacao',
		entidade_id: solicitacao.id,
		detalhes: `Tipo: ${tipo_direito} · Prazo: ${solicitacao.prazo_resposta}`
	});

	return json({
		ok: true,
		solicitacao,
		mensagem: `Solicitação registrada. Prazo de resposta: ${solicitacao.prazo_resposta} (15 dias úteis). Dúvidas: lgpd@pc.ce.gov.br`
	}, { status: 201 });
};
