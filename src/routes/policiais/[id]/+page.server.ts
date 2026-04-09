import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
	getDB,
	buscarPolicial,
	atualizarPolicial,
	listarLotacoes,
	listarUnidades,
	promoverPolicial
} from '$lib/db';
import { policialUpdateSchema } from '$lib/schemas/policial';
import { isAdminGeral, isAdminSeccional, isAdminUnidade } from '$lib/auth';
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';

export const load: PageServerLoad = async ({ locals, params, platform }) => {
	const u = locals.usuario;
	if (!u) throw redirect(302, '/login');

	const id = Number(params.id);
	if (isNaN(id)) throw new Error('ID inválido');

	const db = getDB(platform);
	const policial = await buscarPolicial(db, id);
	if (!policial) throw new Error('Policial não encontrado');

	const isAdm = isAdminGeral(u);
	const isSeccional = isAdminSeccional(u);
	const isUnidade = isAdminUnidade(u);

	const [lotacoes, todasUnidades] = await Promise.all([
		isAdm ? listarLotacoes(db) : Promise.resolve<string[]>([]),
		(isAdm || isSeccional || isUnidade) ? listarUnidades(db) : Promise.resolve([])
	]);

	const policialData = {
		...policial,
		papel: policial.papel ?? null,
		papel_unidade_id: policial.papel_unidade_id ?? null
	};

	const form = await superValidate(policialData, zod4(policialUpdateSchema));

	return {
		form,
		policial: policialData,
		lotacoes,
		unidades: todasUnidades,
		isAdmin: isAdm,
		isAdminOrSeccional: isAdm || isSeccional,
		isAdminUnidade: isUnidade
	};
};

export const actions: Actions = {
	salvar: async ({ request, locals, platform, params }) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const id = Number(params.id);
		if (isNaN(id)) return fail(400, { error: 'ID inválido' });

		const form = await superValidate(request, zod4(policialUpdateSchema));
		if (!form.valid) {
			return fail(400, { form });
		}

		const db = getDB(platform);
		try {
			await atualizarPolicial(db, id, { ...form.data, email: form.data.email ?? undefined });
			return message(form, JSON.stringify({ type: 'success' }));
		} catch (e: unknown) {
			const errorMsg = e instanceof Error ? e.message : 'Erro desconhecido';
			if (errorMsg.includes('UNIQUE')) {
				return message(form, JSON.stringify({ type: 'error', error: 'Matrícula já cadastrada' }), { status: 409 });
			}
			return message(form, JSON.stringify({ type: 'error', error: 'Erro interno ao atualizar policial' }), { status: 500 });
		}
	},

	salvarPapel: async ({ request, locals, platform, params }) => {
		const u = locals.usuario;
		if (!u || u.tipo !== 'admin') return fail(403, { error: 'Apenas administradores' });

		const id = Number(params.id);
		if (isNaN(id)) return fail(400, { error: 'ID inválido' });

		const formData = await request.formData();
		const papel = (formData.get('papel')?.toString() || null) as 'admin_seccional' | 'admin_unidade' | null;
		const papelUnidadeIdStr = formData.get('papel_unidade_id')?.toString();
		const papelUnidadeId = papelUnidadeIdStr ? Number(papelUnidadeIdStr) : null;

		const db = getDB(platform);
		await promoverPolicial(db, id, papel, papelUnidadeId);
		return { success: true };
	}
};
