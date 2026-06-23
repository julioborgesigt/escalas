/**
 * GET    /api/gise/[id]/documento-assinado  → baixar PDF assinado do R2
 * DELETE /api/gise/[id]/documento-assinado  → revogar assinatura
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getDB,
	getR2,
	hasR2,
	buscarGiseDocumento,
	buscarGiseEscala,
	buscarGiseDetalhado,
	reabrirGiseEscala,
	auditar,
	contextoDeEvento
} from '$lib/db';
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
import { podeBaixarComManifesto, gerarCopiaConferencia } from '$lib/server/copia-conferencia';
import { gerarRascunhoGisePdf } from '$lib/server/conferencia-pdf';

export const GET: RequestHandler = async ({ platform, params, locals, url }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const id = parseInt(params.id!);
	if (isNaN(id)) return badRequest('ID inválido');

	const db = getDB(platform);

	const gise = await buscarGiseEscala(db, id);
	if (!gise) return notFound('Escala GISE');

	const perm = await verificarPermissaoGise(db, gise, u);
	if (!perm.permitido) return forbidden(perm.motivo ?? 'Sem permissão para acessar esta GISE.');

	const documento = await buscarGiseDocumento(db, id);
	if (!documento) return notFound('Documento assinado');

	const querManifesto = url.searchParams.get('manifesto') === 'true';

	// Admin com ?manifesto=true: blob forense íntegro (com CPF/IP/GPS/selfie) do R2.
	if (querManifesto && podeBaixarComManifesto(u)) {
		if (!hasR2(platform)) {
			return serverError(
				'[gise/documento-assinado] R2 não configurado',
				new Error('R2_NOT_CONFIGURED')
			);
		}
		const bucket = getR2(platform);
		const object = await bucket.get(documento.r2_key);
		if (!object) return notFound('Arquivo PDF no Storage');
		return new Response(object.body as unknown as BodyInit, {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': contentDisposition(`gise_${id}_assinada_manifesto.pdf`),
				'Cache-Control': 'private, no-store'
			}
		});
	}

	// Padrão: cópia de conferência (sem manifesto forense).
	const giseDetalhado = await buscarGiseDetalhado(db, id);
	if (!giseDetalhado) return notFound('Escala GISE');
	const rascunho = await gerarRascunhoGisePdf(db, giseDetalhado, platform);
	const hash = documento.verificacao_hash ?? undefined;
	const buffer = await gerarCopiaConferencia({
		pdfRascunho: rascunho,
		assinanteNome: documento.assinante_nome,
		verificationHash: hash,
		verificationUrl: hash ? `${url.origin}/validar/${hash}` : undefined
	});
	return new Response(buffer as unknown as BodyInit, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': contentDisposition(`conferencia_gise_${id}.pdf`),
			'Cache-Control': 'private, no-store'
		}
	});
};

export const DELETE: RequestHandler = async (event) => {
	const { platform, params, locals } = event;
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

	const { contexto, env } = contextoDeEvento(event);
	await auditar(
		db,
		{
			acao: 'revogar_assinatura',
			usuario: u,
			entidade: 'gise',
			entidade_id: id,
			alvo_tipo: 'gise',
			alvo_id: id,
			detalhes: `Assinatura da GISE ${id} revogada (assinante: ${documento.assinante_nome})`,
			metadados: { verificacao_hash: documento.verificacao_hash },
			...contexto
		},
		{ env }
	);

	return json({ success: true, message: 'Assinatura digital revogada com sucesso' });
};
