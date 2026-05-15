/**
 * GET   /api/admin/lgpd/solicitacoes/[id] — detalhe da solicitação
 * PATCH /api/admin/lgpd/solicitacoes/[id] — responde/atualiza status
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, registrarAuditComContexto } from '$lib/db';
import { isAdminGeral } from '$lib/auth';
import { buscarSolicitacao, responderSolicitacao } from '$lib/db/lgpd-solicitacoes';

const STATUS_VALIDOS = ['em_analise', 'concluida', 'indeferida'] as const;

export const GET: RequestHandler = async ({ platform, locals, params }) => {
	const u = locals.usuario;
	if (!u || !isAdminGeral(u)) return json({ error: 'Acesso restrito' }, { status: 403 });

	const id = Number(params.id);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const solicitacao = await buscarSolicitacao(db, id);
	if (!solicitacao) return json({ error: 'Solicitação não encontrada' }, { status: 404 });

	return json({ solicitacao });
};

export const PATCH: RequestHandler = async ({ platform, locals, params, request }) => {
	const u = locals.usuario;
	if (!u || !isAdminGeral(u)) return json({ error: 'Acesso restrito' }, { status: 403 });

	const id = Number(params.id);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'JSON inválido' }, { status: 400 });
	}

	const status = String(body.status ?? '');
	if (!STATUS_VALIDOS.includes(status as any)) {
		return json({ error: `status inválido. Use: ${STATUS_VALIDOS.join(', ')}` }, { status: 400 });
	}
	if (!body.resposta) {
		return json({ error: 'Campo obrigatório: resposta' }, { status: 400 });
	}

	const db = getDB(platform);
	const solicitacao = await buscarSolicitacao(db, id);
	if (!solicitacao) return json({ error: 'Solicitação não encontrada' }, { status: 404 });
	if (solicitacao.status === 'concluida' || solicitacao.status === 'indeferida') {
		return json({ error: 'Solicitação já encerrada' }, { status: 409 });
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
