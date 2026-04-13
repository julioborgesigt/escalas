/**
 * GET    /api/gise/[id]/documento-assinado  → baixar PDF assinado do R2
 * DELETE /api/gise/[id]/documento-assinado  → revogar assinatura
 */

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getDB, getR2, hasR2, buscarGiseDocumento, reabrirGiseEscala } from '$lib/db';
import { contentDisposition } from '$lib/server/api';

export const GET = async ({ platform, params, locals }: RequestEvent) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });

	const id = parseInt(params.id!);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);

	const documento = await buscarGiseDocumento(db, id);
	if (!documento) {
		return json({ error: 'Documento assinado não encontrado' }, { status: 404 });
	}

	if (!hasR2(platform)) {
		return json({ error: 'Storage R2 não configurado no servidor' }, { status: 500 });
	}

	const bucket = getR2(platform);
	const object = await bucket.get(documento.r2_key);
	if (!object) {
		return json({ error: 'Arquivo PDF não encontrado no Storage' }, { status: 404 });
	}

	return new Response(object.body as unknown as BodyInit, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': contentDisposition(documento.r2_key)
		}
	});
};

export const DELETE = async ({ platform, params, locals }: RequestEvent) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });

	// Somente admin geral pode revogar assinatura GISE
	if (u.tipo !== 'admin') {
		return json({ error: 'Apenas o Administrador Geral pode revogar a assinatura' }, { status: 403 });
	}

	const id = parseInt(params.id!);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const documento = await buscarGiseDocumento(db, id);
	if (!documento) {
		return json({ message: 'Nenhuma assinatura encontrada para revogar' });
	}

	// Deletar do R2
	if (hasR2(platform)) {
		const bucket = getR2(platform);
		await bucket.delete(documento.r2_key);
	}

	// Reabrir escala (deleta documento, reseta seccionais, volta status)
	await reabrirGiseEscala(db, id);

	return json({ success: true, message: 'Assinatura digital revogada com sucesso' });
};
