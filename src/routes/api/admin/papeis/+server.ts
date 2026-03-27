/**
 * API de Gerenciamento de Papéis (RBAC)
 *
 * GET  /api/admin/papeis?lotacao=X  → lista policiais com seus papéis
 * POST /api/admin/papeis            → promove/rebaixa um policial
 *
 * Regras:
 *  - Admin Geral pode promover a: admin_seccional, admin_unidade (qualquer)
 *  - Admin Seccional pode promover a: admin_seccional (somente da sua própria seccional)
 *                                     admin_unidade (somente da sua seccional)  — Feature 6
 *  - Admin Unidade pode promover a: admin_unidade (somente dentro da sua unidade) — Feature 7
 *  - Nenhum papel pode promover a Supervisor via esta rota (é feito na escala GISE)
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, promoverPolicial, listarPoliciais } from '$lib/db';
import { isAdminGeral, isAdminSeccional, isAdminUnidade } from '$lib/auth';
import { eq } from 'drizzle-orm';
import { policiais, unidades } from '$lib/server/schema';

export const GET: RequestHandler = async ({ locals, url, platform }) => {
	const u = locals.usuario;
	if (!u || (u.tipo !== 'admin' && !isAdminSeccional(u) && !isAdminUnidade(u))) {
		return json({ error: 'Sem permissão' }, { status: 403 });
	}

	const db = getDB(platform);
	const lotacao = url.searchParams.get('lotacao') ?? undefined;

	let filtroLotacao: string | undefined;
	if (isAdminGeral(u)) {
		filtroLotacao = lotacao;
	} else if (isAdminSeccional(u)) {
		// Admin Seccional vê policiais da sua seccional e suas delegacias subordinadas
		filtroLotacao = lotacao ?? undefined;
	} else if (isAdminUnidade(u) && u.papel_unidade_id) {
		// Admin Unidade vê apenas policiais da sua própria unidade
		const unidade = await db
			.select({ nome: unidades.nome })
			.from(unidades)
			.where(eq(unidades.id, u.papel_unidade_id))
			.get();
		filtroLotacao = unidade?.nome ?? undefined;
	}

	const lista = await listarPoliciais(db, filtroLotacao);
	return json(lista);
};

export const POST: RequestHandler = async ({ locals, request, platform }) => {
	const u = locals.usuario;
	if (!u || (u.tipo !== 'admin' && !isAdminSeccional(u) && !isAdminUnidade(u))) {
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

	// --- Feature 7: Admin Unidade só pode promover a admin_unidade dentro da sua unidade ---
	if (isAdminUnidade(u)) {
		if (papel !== null && papel !== 'admin_unidade') {
			return json({ error: 'Admin Unidade só pode promover a Admin Unidade' }, { status: 403 });
		}

		// Verificar que o policial pertence à mesma unidade do admin
		if (u.papel_unidade_id) {
			const unidade = await db
				.select({ nome: unidades.nome })
				.from(unidades)
				.where(eq(unidades.id, u.papel_unidade_id))
				.get();

			const policial = await db
				.select({ lotacao: policiais.lotacao })
				.from(policiais)
				.where(eq(policiais.id, policial_id))
				.get();
			if (!policial) return json({ error: 'Policial não encontrado' }, { status: 404 });

			if (!unidade || policial.lotacao !== unidade.nome) {
				return json({ error: 'Policial fora da sua unidade' }, { status: 403 });
			}

			// papel_unidade_id deve ser o da própria unidade do admin
			const unidadeAlvoId = papel_unidade_id ?? u.papel_unidade_id;
			if (unidadeAlvoId !== u.papel_unidade_id) {
				return json({ error: 'Só pode promover para a sua própria unidade' }, { status: 403 });
			}

			await promoverPolicial(db, policial_id, papel, papel === null ? null : u.papel_unidade_id);
			return json({ ok: true });
		}

		return json({ error: 'Configuração de unidade inválida' }, { status: 400 });
	}

	// --- Feature 6 + regras existentes: Admin Seccional ---
	if (isAdminSeccional(u)) {
		if (papel !== null && papel !== 'admin_unidade' && papel !== 'admin_seccional') {
			return json({ error: 'Papel inválido' }, { status: 400 });
		}

		// Verificar que o policial pertence à jurisdição da seccional do admin
		const policial = await db
			.select({ lotacao: policiais.lotacao })
			.from(policiais)
			.where(eq(policiais.id, policial_id))
			.get();
		if (!policial) return json({ error: 'Policial não encontrado' }, { status: 404 });

		if (u.papel_unidade_id) {
			const seccional = await db
				.select({ nome: unidades.nome })
				.from(unidades)
				.where(eq(unidades.id, u.papel_unidade_id))
				.get();

			const policialNaSeccional = policial.lotacao === seccional?.nome;
			const unidadePolicial = await db
				.select({ seccional_id: unidades.seccional_id })
				.from(unidades)
				.where(eq(unidades.nome, policial.lotacao))
				.get();
			const policialNaDelegacia = unidadePolicial?.seccional_id === u.papel_unidade_id;

			if (!policialNaSeccional && !policialNaDelegacia) {
				return json({ error: 'Policial fora da sua jurisdição' }, { status: 403 });
			}

			// Feature 6: Admin Seccional pode promover a admin_seccional apenas para a sua própria seccional
			if (papel === 'admin_seccional') {
				const unidadeAlvo = papel_unidade_id
					? await db.select({ tipo: unidades.tipo, id: unidades.id }).from(unidades).where(eq(unidades.id, papel_unidade_id)).get()
					: null;

				// A unidade alvo deve ser a seccional do próprio admin
				if (!papel_unidade_id || papel_unidade_id !== u.papel_unidade_id) {
					return json({ error: 'Admin Seccional só pode nomear outro Admin Seccional para a sua própria seccional' }, { status: 403 });
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
