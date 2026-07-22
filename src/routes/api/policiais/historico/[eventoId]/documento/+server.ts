import type { RequestHandler } from './$types';
import { getDB, getR2, hasR2, buscarEventoHistorico } from '$lib/db';
import {
	requireAdmin,
	badRequest,
	notFound,
	serverError,
	contentDisposition
} from '$lib/server/api';

/**
 * Baixa o documento PDF (Portaria/afastamento/desvinculação) anexado a um
 * evento do histórico funcional do policial. Restrito ao Admin Geral — a página
 * de gestão do policial já é exclusiva desse papel.
 */
export const GET: RequestHandler = async ({ platform, params, locals }) => {
	const u = requireAdmin(locals);
	if (u instanceof Response) return u;

	const eventoId = Number(params.eventoId);
	if (isNaN(eventoId)) return badRequest('ID inválido');

	const db = getDB(platform);
	const evento = await buscarEventoHistorico(db, eventoId);
	if (!evento || !evento.documento_r2_key) return notFound('Documento');

	if (!hasR2(platform)) {
		return serverError(
			'[policiais/historico/documento] R2 não configurado',
			new Error('R2_NOT_CONFIGURED')
		);
	}

	const objeto = await getR2(platform).get(evento.documento_r2_key);
	if (!objeto) return notFound('Arquivo PDF no Storage');

	return new Response(objeto.body as unknown as BodyInit, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': contentDisposition(
				evento.documento_nome || `documento_${eventoId}.pdf`
			),
			'Cache-Control': 'private, no-store'
		}
	});
};
