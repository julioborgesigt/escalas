import { json } from '@sveltejs/kit';
import { getDB, buscarDocumentoEscala } from '$lib/db';
import type { RequestEvent } from '@sveltejs/kit';

export const GET = async ({ platform, params, locals }: RequestEvent) => {
	const db = getDB(platform);
	const escalaId = Number(params.id);

	if (!locals.usuario) {
		return json({ error: 'Não autorizado' }, { status: 401 });
	}

	const documento = await buscarDocumentoEscala(db, escalaId);
	if (!documento) {
		return json({ existe: false });
	}

	return json({
		existe: true,
		assinante_nome: documento.assinante_nome,
		assinante_cpf: documento.assinante_cpf,
		data: documento.created_at
	});
};
