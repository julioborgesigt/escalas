/**
 * GET /api/sync/estado — carimbos leves para decidir se vale invalidar o `load`.
 *
 * Query: `?giseId=` (detalhe GISE), `?escalaId=` (detalhe escala).
 * Fatias por papel: admin → recebidos/painel/resGise; policial → resGise;
 * DPC admin → escalas; autenticado → giseList.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { eq, or } from 'drizzle-orm';
import { getDB } from '$lib/db';
import { requireAuth, badRequest, serverError } from '$lib/server/api';
import {
	resumoRecebidosAdmin,
	resumoEscalasPendentes,
	carimboGise,
	carimboPainel,
	carimboResGise,
	carimboGiseList,
	carimboEscala
} from '$lib/server/sync-estado';
import { unidades as unidadesTable } from '$lib/server/schema';

export const GET: RequestHandler = async ({ locals, platform, url }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	try {
		const db = getDB(platform);
		const giseIdRaw = url.searchParams.get('giseId');
		const giseId = giseIdRaw ? Number(giseIdRaw) : NaN;
		if (giseIdRaw && (!Number.isInteger(giseId) || giseId <= 0)) {
			return badRequest('giseId inválido');
		}
		const escalaIdRaw = url.searchParams.get('escalaId');
		const escalaId = escalaIdRaw ? Number(escalaIdRaw) : NaN;
		if (escalaIdRaw && (!Number.isInteger(escalaId) || escalaId <= 0)) {
			return badRequest('escalaId inválido');
		}

		const body: {
			recebidos?: { stamp: string; naoVistos: number };
			escalas?: { stamp: string; pendentes: number };
			gise?: { stamp: string };
			giseList?: { stamp: string };
			painel?: { stamp: string };
			resGise?: { stamp: string };
			escala?: { stamp: string };
		} = {};

		const tasks: Promise<void>[] = [
			carimboGiseList(db).then((stamp) => {
				body.giseList = { stamp };
			})
		];

		if (u.tipo === 'admin') {
			tasks.push(
				resumoRecebidosAdmin(db).then((r) => {
					body.recebidos = r;
				}),
				carimboPainel(db).then((stamp) => {
					body.painel = { stamp };
				}),
				carimboResGise(db, null).then((stamp) => {
					body.resGise = { stamp };
				})
			);
		}

		if (u.tipo === 'policial') {
			tasks.push(
				carimboResGise(db, u.id).then((stamp) => {
					body.resGise = { stamp };
				})
			);
		}

		if (
			u.tipo === 'policial' &&
			u.cargo === 'DPC' &&
			(u.papel === 'admin_seccional' || u.papel === 'admin_unidade')
		) {
			tasks.push(
				(async () => {
					let lotacoes: string[] | undefined;
					if (u.papel === 'admin_seccional' && u.papel_unidade_id) {
						const rows = await db
							.select({ nome: unidadesTable.nome })
							.from(unidadesTable)
							.where(
								or(
									eq(unidadesTable.id, u.papel_unidade_id),
									eq(unidadesTable.seccional_id, u.papel_unidade_id)
								)
							);
						lotacoes = rows.map((r) => r.nome);
					}
					body.escalas = await resumoEscalasPendentes(db, u, lotacoes);
				})()
			);
		}

		if (Number.isInteger(giseId) && giseId > 0) {
			tasks.push(
				carimboGise(db, giseId).then((stamp) => {
					if (stamp) body.gise = { stamp };
				})
			);
		}

		if (Number.isInteger(escalaId) && escalaId > 0) {
			tasks.push(
				carimboEscala(db, escalaId).then((stamp) => {
					if (stamp) body.escala = { stamp };
				})
			);
		}

		await Promise.all(tasks);
		return json(body);
	} catch (err) {
		return serverError('[sync/estado] Falha ao montar carimbos', err);
	}
};
