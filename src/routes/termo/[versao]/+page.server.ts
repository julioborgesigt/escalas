import { error } from '@sveltejs/kit';
import {
	CONTEUDO_HTML,
	VERSAO,
	VIGENTE_DESDE,
	calcularHashTermo
} from '$lib/server/termo/termo-vigente';
import { sanitizeTermoHtml } from '$lib/server/termo/sanitize';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, setHeaders }) => {
	if (params.versao !== VERSAO) {
		// No futuro, manter versões anteriores arquivadas; por ora só a vigente.
		throw error(404, `Versão ${params.versao} do termo não encontrada.`);
	}

	const hash = await calcularHashTermo();

	// Conteúdo imutável → cacheia agressivamente.
	setHeaders({
		'Cache-Control': 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800'
	});

	return {
		versao: VERSAO,
		vigenteDesde: VIGENTE_DESDE,
		conteudoHtml: sanitizeTermoHtml(CONTEUDO_HTML),
		hash
	};
};
