/**
 * GET    /api/gise/[id]/documento-assinado  → baixar PDF assinado do R2
 * DELETE /api/gise/[id]/documento-assinado  → revogar assinatura
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, getR2, hasR2, buscarGiseDocumento, buscarGiseEscala, reabrirGiseEscala } from '$lib/db';
import {
	contentDisposition,
	requireAuth,
	requireAdmin,
	badRequest,
	notFound,
	forbidden,
	serverError
} from '$lib/server/api';
import { verificarPermissaoGise } from '$lib/server/gise-permissao';

export const GET: RequestHandler = async ({ platform, params, locals }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const id = parseInt(params.id!);
	if (isNaN(id)) return badRequest('ID inválido');

	const db = getDB(platform);

	// Antes da P0.3 desta auditoria, GET só checava login: qualquer usuário
	// autenticado conseguia baixar o PDF assinado de qualquer GISE trocando
	// o [id]. Agora aplica o mesmo modelo de permissão usado por /download:
	// admin, quadro de supervisão (supervisor/assessor/seint1/seint2) ou
	// membro de equipe da própria GISE.
	const gise = await buscarGiseEscala(db, id);
	if (!gise) return notFound('Escala GISE');

	const perm = await verificarPermissaoGise(db, gise, u);
	if (!perm.permitido) return forbidden(perm.motivo ?? 'Sem permissão para acessar esta GISE.');

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
