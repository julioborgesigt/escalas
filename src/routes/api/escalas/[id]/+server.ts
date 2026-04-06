/**
 * DELETE /api/escalas/[id] — excluir escala por path param.
 *
 * Regras:
 *  - Policial só pode excluir escalas da sua lotação
 *  - Admin pode excluir qualquer escala
 */

import { json } from '@sveltejs/kit';
import { getDB, buscarEscala, excluirEscala, registrarAuditComContexto } from '$lib/db';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ platform, params, locals }) => {
	const db = getDB(platform);
	const id = Number(params.id);
	if (!id || isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	// Policial só pode excluir escalas da sua lotação
	if (locals.usuario?.tipo === 'policial') {
		const escala = await buscarEscala(db, id);
		if (escala && escala.lotacao !== locals.usuario.lotacao) {
			return json({ error: 'Sem permissão' }, { status: 403 });
		}
	}

	await excluirEscala(db, id);

	if (locals.usuario) {
		await registrarAuditComContexto(db, {
			usuario: locals.usuario,
			acao: 'excluir_escala',
			entidade: 'escala',
			entidade_id: id,
			detalhes: `Escala excluída: ID ${id}`
		});
	}

	return json({ success: true });
};
