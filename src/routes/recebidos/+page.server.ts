import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
	getDB,
	listarEscalas,
	listarUnidades,
	marcarVisto,
	excluirEscala,
	buscarDocumentoEscala,
	excluirDocumentoEscala,
	getR2,
	hasR2,
	registrarAuditComContexto
} from '$lib/db';

export const load: PageServerLoad = async ({ locals, platform }) => {
	const u = locals.usuario;
	if (!u) throw redirect(302, '/login');
	if (u.tipo !== 'admin') throw redirect(302, '/');

	const db = getDB(platform);

	// Busca escalas assinadas (todas, sem filtro de tempo — filtro é client-side)
	const [resultado, unidadesLista] = await Promise.all([
		listarEscalas(
			db,
			undefined,
			'assinada',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			{
				limit: undefined,
				page: undefined
			}
		),
		listarUnidades(db)
	]);

	return {
		escalas: resultado.escalas,
		unidades: unidadesLista
	};
};

export const actions: Actions = {
	toggleVisto: async ({ request, locals, platform }) => {
		const u = locals.usuario;
		if (u?.tipo !== 'admin') return fail(403, { error: 'Não autorizado' });

		const data = await request.formData();
		const escalaId = Number(data.get('escala_id'));
		const visto = data.get('visto') === 'true';

		if (isNaN(escalaId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);
		await marcarVisto(db, escalaId, visto);
		return { success: true, escalaId, visto };
	},

	excluir: async ({ request, locals, platform }) => {
		const u = locals.usuario;
		if (u?.tipo !== 'admin') return fail(403, { error: 'Não autorizado' });

		const data = await request.formData();
		const escalaId = Number(data.get('escala_id'));
		if (isNaN(escalaId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);

		// Deleta documento do R2 e banco
		if (hasR2(platform)) {
			const bucket = getR2(platform);
			const documento = await buscarDocumentoEscala(db, escalaId);
			if (documento) await bucket.delete(documento.r2_key);
		}
		await excluirDocumentoEscala(db, escalaId);
		await excluirEscala(db, escalaId);

		await registrarAuditComContexto(db, {
			usuario: u,
			acao: 'excluir_escala',
			entidade: 'escala',
			entidade_id: escalaId,
			detalhes: `Escala excluída da cx. de entrada: ID ${escalaId}`
		});

		return { success: true };
	}
};
