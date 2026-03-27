/**
 * API de Gerenciamento de Papéis (RBAC)
 *
 * GET  /api/admin/papeis?lotacao=X  → lista policiais com seus papéis
 * POST /api/admin/papeis            → promove/rebaixa um policial
 *
 * Regras:
 *  - Admin Geral pode promover a: admin_seccional, admin_unidade (qualquer)
 *  - Admin Seccional pode promover a: admin_unidade (somente da sua seccional)
 *  - Nenhum papel pode promover a Supervisor via esta rota (é feito na escala GISE)
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, promoverPolicial, listarPoliciais } from '$lib/db';
import { isAdminGeral, isAdminSeccional } from '$lib/auth';
import { eq } from 'drizzle-orm';
import { policiais, unidades } from '$lib/server/schema';

export const GET: RequestHandler = async ({ locals, url, platform }) => {
	const u = locals.usuario;
	if (!u || (u.tipo !== 'admin' && !isAdminSeccional(u))) {
		return json({ error: 'Sem permissão' }, { status: 403 });
	}

	const db = getDB(platform);
	const lotacao = url.searchParams.get('lotacao') ?? undefined;

	// Admin Seccional só vê policiais da sua subordinação
	const filtroLotacao = isAdminGeral(u) ? lotacao : (u.lotacao ?? undefined);

	const lista = await listarPoliciais(db, filtroLotacao);
	return json(lista);
};

export const POST: RequestHandler = async ({ locals, request, platform }) => {
	const u = locals.usuario;
	if (!u || (u.tipo !== 'admin' && !isAdminSeccional(u))) {
		return json({ error: 'Sem permissão' }, { status: 403 });
	}

	const db = getDB(platform);
	const body = await request.json();
	const { policial_id, papel, papel_unidade_id } = body as {
		policial_id: number;
		papel: 'admin_seccional' | 'admin_unidade' | null;
		papel_unidade_id?: number | null;
	};

	if (!policial_id) {
		return json({ error: 'policial_id obrigatório' }, { status: 400 });
	}

	// Admin Seccional só pode promover a admin_unidade e apenas policiais da sua seccional
	if (isAdminSeccional(u)) {
		if (papel === 'admin_seccional') {
			return json({ error: 'Admin Seccional não pode promover a Admin Seccional' }, { status: 403 });
		}
		if (papel !== null && papel !== 'admin_unidade') {
			return json({ error: 'Papel inválido' }, { status: 400 });
		}
		// Verificar que o policial é da seccional do admin
		const policial = await db
			.select({ lotacao: policiais.lotacao })
			.from(policiais)
			.where(eq(policiais.id, policial_id))
			.get();
		if (!policial) return json({ error: 'Policial não encontrado' }, { status: 404 });

		// Verificar se o policial pertence à seccional do admin (mesma lotação ou subordinadas)
		if (u.papel_unidade_id) {
			const seccional = await db
				.select({ nome: unidades.nome })
				.from(unidades)
				.where(eq(unidades.id, u.papel_unidade_id))
				.get();
			if (seccional && policial.lotacao !== seccional.nome) {
				// Verificar se é uma delegacia subordinada à seccional do admin
				const unidadePolicial = await db
					.select({ seccional_id: unidades.seccional_id })
					.from(unidades)
					.where(eq(unidades.nome, policial.lotacao))
					.get();
				if (!unidadePolicial || unidadePolicial.seccional_id !== u.papel_unidade_id) {
					return json({ error: 'Policial fora da sua jurisdição' }, { status: 403 });
				}
			}
		}
	}

	// Admin Geral: qualquer promoção
	if (isAdminGeral(u)) {
		if (papel && papel !== 'admin_seccional' && papel !== 'admin_unidade') {
			return json({ error: 'Papel inválido. Use admin_seccional ou admin_unidade' }, { status: 400 });
		}
	}

	await promoverPolicial(db, policial_id, papel, papel_unidade_id ?? null);
	return json({ ok: true });
};
