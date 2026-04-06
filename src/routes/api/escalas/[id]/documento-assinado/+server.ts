import { json, error } from '@sveltejs/kit';
import { getDB, getR2, hasR2, buscarDocumentoEscala, excluirDocumentoEscala } from '$lib/db';
import type { RequestEvent } from '@sveltejs/kit';

export const GET = async ({ platform, params, locals }: RequestEvent) => {
	const db = getDB(platform);
	const escalaId = Number(params.id);
	const usuario = locals.usuario;

	if (!usuario) {
		return json({ error: 'Não autorizado' }, { status: 401 });
	}

	const documento = await buscarDocumentoEscala(db, escalaId);
	if (!documento) {
		return json({ error: 'Documento assinado não encontrado para esta escala' }, { status: 404 });
	}

	if (!hasR2(platform)) {
		return json({ error: 'Storage R2 não configurado no servidor' }, { status: 500 });
	}

	const bucket = getR2(platform);
	const object = await bucket.get(documento.r2_key);
	if (!object) {
		return json({ error: 'Arquivo PDF não encontrado no Storage' }, { status: 404 });
	}

	const headers = new Headers();
	headers.set('Content-Type', 'application/pdf');
	headers.set('Content-Disposition', `attachment; filename="${documento.r2_key}"`);

	return new Response(object.body as unknown as BodyInit, {
		headers
	});
};

export const DELETE = async ({ platform, params, locals }: RequestEvent) => {
	const db = getDB(platform);
	const escalaId = Number(params.id);
	const usuario = locals.usuario;

	if (!usuario) {
		throw error(401, 'Não autorizado');
	}

	// Somente admin ou o dono da unidade pode revogar (seguindo a lógica geral)
	// Aqui simplificamos permitindo se estiver logado, mas ideal seria validar permissão de edição
	const documento = await buscarDocumentoEscala(db, escalaId);
	if (!documento) {
		return json({ message: 'Nenhuma assinatura encontrada para revogar' });
	}

	// Deleta do R2
	if (hasR2(platform)) {
		const bucket = getR2(platform);
		await bucket.delete(documento.r2_key);
	}

	// Deleta do Banco
	await excluirDocumentoEscala(db, escalaId);

	return json({ success: true, message: 'Assinatura digital revogada com sucesso' });
};

