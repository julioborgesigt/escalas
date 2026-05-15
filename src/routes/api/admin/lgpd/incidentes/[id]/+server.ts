/**
 * GET   /api/admin/lgpd/incidentes/[id] — detalhe do incidente
 * PATCH /api/admin/lgpd/incidentes/[id] — atualiza status/campos
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, registrarAuditComContexto } from '$lib/db';
import { isAdminGeral } from '$lib/auth';
import { buscarIncidente, atualizarIncidente } from '$lib/db/lgpd-incidentes';

export const GET: RequestHandler = async ({ platform, locals, params }) => {
	const u = locals.usuario;
	if (!u || !isAdminGeral(u)) return json({ error: 'Acesso restrito' }, { status: 403 });

	const id = Number(params.id);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const incidente = await buscarIncidente(db, id);
	if (!incidente) return json({ error: 'Incidente não encontrado' }, { status: 404 });

	return json({ incidente });
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

	const db = getDB(platform);
	const incidente = await buscarIncidente(db, id);
	if (!incidente) return json({ error: 'Incidente não encontrado' }, { status: 404 });

	const atualizado = await atualizarIncidente(db, id, {
		titulo: body.titulo !== undefined ? String(body.titulo) : undefined,
		descricao: body.descricao !== undefined ? String(body.descricao) : undefined,
		status: body.status as any,
		gravidade: body.gravidade as any,
		medidas_tomadas: body.medidas_tomadas !== undefined ? String(body.medidas_tomadas) : undefined,
		notificado_anpd_em: body.notificado_anpd_em !== undefined ? String(body.notificado_anpd_em) : undefined,
		responsavel_nome: body.responsavel_nome !== undefined ? String(body.responsavel_nome) : undefined,
		responsavel_email: body.responsavel_email !== undefined ? String(body.responsavel_email) : undefined
	});

	await registrarAuditComContexto(db, {
		usuario: u,
		acao: 'atualizar_incidente',
		entidade: 'lgpd_incidente',
		entidade_id: id,
		detalhes: `Status: ${atualizado?.status} · Gravidade: ${atualizado?.gravidade}`
	});

	return json({ ok: true, incidente: atualizado });
};
