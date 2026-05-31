/**
 * Serve o logo institucional (brasão do Estado do Ceará) usado nas páginas
 * públicas de validação. A imagem fica no R2 (`assets/logo_ceara.jpg`) — o
 * bucket não tem acesso público, então servimos via binding, com cache longo.
 *
 * Rota pública (sob `/api/validar`, já liberada no hooks).
 */

import { getR2 } from '$lib/server/platform';
import { notFound, serverError } from '$lib/server/api';
import type { RequestHandler } from './$types';

const R2_KEY = 'assets/logo_ceara.jpg';

export const GET: RequestHandler = async ({ platform }) => {
	try {
		const r2 = getR2(platform);
		if (!r2) return notFound('Logo');
		const obj = await r2.get(R2_KEY);
		if (!obj) return notFound('Logo');
		return new Response(await obj.arrayBuffer(), {
			headers: {
				'Content-Type': 'image/jpeg',
				// Logo institucional muda raramente — cache agressivo no edge/navegador.
				'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800'
			}
		});
	} catch (err) {
		return serverError('[validar/logo] Falha ao servir o logo', err);
	}
};
