import { json } from '@sveltejs/kit';
import type { RequestEvent } from './$types';
import { getDB, getR2, hasR2, buscarDocumentoEscala, excluirDocumentoEscala, buscarEscala } from '$lib/db';
import { registrarAuditComContexto } from '$lib/db';
import { contentDisposition } from '$lib/server/api';
import { logger } from '$lib/server/logger';

export const GET = async ({ platform, params, locals }: RequestEvent) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });

	const id = parseInt(params.id!);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const documento = await buscarDocumentoEscala(db, id);
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

	const id = parseInt(params.id!);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const escala = await buscarEscala(db, id);
	if (!escala) return json({ error: 'Escala não encontrada' }, { status: 404 });

	// Somente admin ou o dono da lotação pode revogar
	if (u.tipo !== 'admin' && u.lotacao !== escala.lotacao) {
		return json({ error: 'Apenas administradores podem revogar assinaturas' }, { status: 403 });
	}

	const documento = await buscarDocumentoEscala(db, id);
	if (!documento) {
		return json({ message: 'Nenhuma assinatura encontrada para revogar' });
	}

	// Deletar do R2
	if (hasR2(platform)) {
		const bucket = getR2(platform);
		try {
			await bucket.delete(documento.r2_key);
		} catch (e) {
			logger.error('[escalas/revogar] Erro ao deletar do R2', {
				escala_id: id,
				r2_key: documento.r2_key,
				error: e instanceof Error ? e.message : String(e)
			});
		}
	}

	// Deletar do banco
	await excluirDocumentoEscala(db, id);

	await registrarAuditComContexto(db, {
		usuario: u,
		acao: 'revogar_assinatura',
		entidade: 'escala',
		entidade_id: id,
		detalhes: `Assinatura da escala ${id} revogada.`
	});

	return json({ success: true, message: 'Assinatura digital revogada com sucesso' });
};
