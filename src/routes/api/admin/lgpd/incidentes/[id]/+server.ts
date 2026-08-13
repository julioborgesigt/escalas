/**
 * GET   /api/admin/lgpd/incidentes/[id] — detalhe do incidente
 * PATCH /api/admin/lgpd/incidentes/[id] — atualiza status/campos
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, registrarAuditComContexto } from '$lib/db';
import { buscarIncidente, atualizarIncidente } from '$lib/db/lgpd';
import { requireAdmin, badRequest, notFound, validateBody } from '$lib/server/api';
import { atualizarIncidenteSchema } from '$lib/schemas';

export const GET: RequestHandler = async ({ platform, locals, params }) => {
	const u = requireAdmin(locals);
	if (u instanceof Response) return u;

	const id = Number(params.id);
	if (isNaN(id)) return badRequest('ID inválido');

	const db = getDB(platform);
	const incidente = await buscarIncidente(db, id);
	if (!incidente) return notFound('Incidente');

	return json({ incidente });
};

export const PATCH: RequestHandler = async ({ platform, locals, params, request }) => {
	const u = requireAdmin(locals);
	if (u instanceof Response) return u;

	const id = Number(params.id);
	if (isNaN(id)) return badRequest('ID inválido');

	// Schema Zod: enums fechados (status, gravidade), tamanho máximo, refine
	// que exige ao menos um campo no PATCH. Antes, `body.status as any`
	// passava `'qualquer_coisa'` direto para a coluna typed.
	const v = await validateBody(request, atualizarIncidenteSchema);
	if (!v.ok) return v.response;
	const data = v.data;

	const db = getDB(platform);
	const incidente = await buscarIncidente(db, id);
	if (!incidente) return notFound('Incidente');

	const atualizado = await atualizarIncidente(db, id, data);

	await registrarAuditComContexto(db, {
		usuario: u,
		acao: 'atualizar_incidente',
		entidade: 'lgpd_incidente',
		entidade_id: id,
		detalhes: `Status: ${atualizado?.status} · Gravidade: ${atualizado?.gravidade}`
	});

	return json({ ok: true, incidente: atualizado });
};
