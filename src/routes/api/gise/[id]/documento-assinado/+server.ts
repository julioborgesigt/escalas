/**
 * GET    /api/gise/[id]/documento-assinado  → baixar PDF assinado do R2
 * DELETE /api/gise/[id]/documento-assinado  → revogar assinatura
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, getR2, hasR2, buscarGiseDocumento, reabrirGiseEscala } from '$lib/db';
import {
	contentDisposition,
	requireAuth,
	requireAdmin,
	badRequest,
	notFound,
	serverError
} from '$lib/server/api';

// TODO(audit P0.3): adicionar verificação de permissão GISE no GET — hoje
// qualquer usuário autenticado pode baixar o PDF assinado de qualquer GISE
// trocando o [id]. Mesmo padrão que foi corrigido em /api/escalas/[id]/
// documento-assinado. Requer modelo de permissão GISE (papel + lotação).
export const GET: RequestHandler = async ({ platform, params, locals }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const id = parseInt(params.id!);
	if (isNaN(id)) return badRequest('ID inválido');

	const db = getDB(platform);

	const documento = await buscarGiseDocumento(db, id);
	if (!documento) return notFound('Documento assinado');

	if (!hasR2(platform)) {
		return serverError('[gise/documento-assinado] R2 não configurado', new Error('R2_NOT_CONFIGURED'));
	}

	const bucket = getR2(platform);
	const object = await bucket.get(documento.r2_key);
	if (!object) return notFound('Arquivo PDF no Storage');

	return new Response(object.body as unknown as BodyInit, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': contentDisposition(documento.r2_key)
		}
	});
};

export const DELETE: RequestHandler = async ({ platform, params, locals }) => {
	const u = requireAdmin(locals);
	if (u instanceof Response) return u;

	const id = parseInt(params.id!);
	if (isNaN(id)) return badRequest('ID inválido');

	const db = getDB(platform);
	const documento = await buscarGiseDocumento(db, id);
	if (!documento) return notFound('Assinatura');

	// Deletar do R2
	if (hasR2(platform)) {
		const bucket = getR2(platform);
		await bucket.delete(documento.r2_key);
	}

	// Reabrir escala (deleta documento, reseta seccionais, volta status)
	await reabrirGiseEscala(db, id);

	return json({ success: true, message: 'Assinatura digital revogada com sucesso' });
};
