/**
 * POST /api/gise/[id]/assinar
 *
 * @deprecated Use /api/gise/[id]/assinar-simples, preparar-assinatura ou finalizar-assinatura.
 * Mantido para compatibilidade, redireciona para assinar-simples.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
	return json({
		error: 'Este endpoint foi substituído. Use /assinar-simples, /preparar-assinatura ou /finalizar-assinatura.'
	}, { status: 410 });
};
