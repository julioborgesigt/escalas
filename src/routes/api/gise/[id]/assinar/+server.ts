/**
 * POST /api/gise/[id]/assinar
 *
 * @deprecated Use /api/gise/[id]/assinar-simples, preparar-assinatura ou finalizar-assinatura.
 * Mantido para compatibilidade, redireciona para assinar-simples.
 */

import type { RequestHandler } from './$types';
import { apiError, ErrorCode } from '$lib/server/api';

export const POST: RequestHandler = async () => {
	return apiError(
		'Este endpoint foi substituído. Use /assinar-simples, /preparar-assinatura ou /finalizar-assinatura.',
		410,
		ErrorCode.NOT_FOUND
	);
};
