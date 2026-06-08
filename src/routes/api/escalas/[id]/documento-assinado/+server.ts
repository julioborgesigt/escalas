import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getDB,
	getR2,
	hasR2,
	buscarDocumentoEscala,
	excluirDocumentoEscala,
	buscarEscala,
	listarPoliciaisEscala
} from '$lib/db';
import { registrarAuditComContexto } from '$lib/db';
import {
	contentDisposition,
	requireAuth,
	badRequest,
	notFound,
	forbidden,
	serverError
} from '$lib/server/api';
import { logger } from '$lib/server/logger';
import { verificarPermissaoEscala } from '$lib/server/escala-permissao';
import { podeBaixarForense, gerarCopiaConferencia } from '$lib/server/copia-conferencia';
import { gerarRascunhoEscalaPdf } from '$lib/server/conferencia-pdf';

export const GET: RequestHandler = async ({ platform, params, locals, url }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const id = parseInt(params.id!);
	if (isNaN(id)) return badRequest('ID inválido');

	const db = getDB(platform);
	const escala = await buscarEscala(db, id);
	if (!escala) return notFound('Escala');

	// Confidencialidade entre lotações: só admin, mesma lotação, ou DPC admin
	// com solicitação direcionada pode baixar o PDF assinado. Sem esta checagem,
	// qualquer usuário autenticado conseguiria PDF de escala de outra unidade
	// apenas trocando o [id] na URL — vazamento de PII e quebra do LGPD.
	const perm = await verificarPermissaoEscala(db, id, escala.lotacao, u);
	if (!perm.permitido) return forbidden(perm.motivo ?? 'Sem permissão para acessar esta escala.');

	const documento = await buscarDocumentoEscala(db, id);
	if (!documento) return notFound('Documento assinado');

	// A2: o blob forense íntegro (manifesto com CPF/IP/GPS/selfie) é restrito ao
	// Super Admin. Os demais (mesmo com permissão na escala) recebem a cópia de
	// conferência regenerada, sem manifesto.
	if (!podeBaixarForense(u)) {
		const policiais = await listarPoliciaisEscala(db, id);
		const rascunho = await gerarRascunhoEscalaPdf(escala, policiais, platform);
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
				'Content-Disposition': contentDisposition(`conferencia_escala_${id}.pdf`),
				'Cache-Control': 'private, no-store'
			}
		});
	}

	if (!hasR2(platform)) {
		return serverError(
			'[escalas/documento-assinado] R2 não configurado',
			new Error('R2_NOT_CONFIGURED')
		);
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
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const id = parseInt(params.id!);
	if (isNaN(id)) return badRequest('ID inválido');

	const db = getDB(platform);
	const escala = await buscarEscala(db, id);
	if (!escala) return notFound('Escala');

	// Somente admin, dono da lotação ou DPC admin com solicitação pode revogar.
	// Mensagem genérica para não vazar quem TEM permissão (anti-enumeração).
	const perm = await verificarPermissaoEscala(db, id, escala.lotacao, u);
	if (!perm.permitido) return forbidden('Sem permissão para esta ação.');

	const documento = await buscarDocumentoEscala(db, id);
	if (!documento) return notFound('Assinatura');

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
