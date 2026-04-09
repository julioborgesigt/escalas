import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
	getDB,
	listarUnidades,
	criarUnidade,
	atualizarUnidade,
	excluirUnidade
} from '$lib/db';
import { unidadeSchema } from '$lib/schemas';
import { eq } from 'drizzle-orm';
import { unidades, escalas } from '$lib/server/schema';
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';

export const load: PageServerLoad = async ({ locals, platform }) => {
	const u = locals.usuario;
	if (!u) throw redirect(302, '/login');

	const db = getDB(platform);
	const lista = await listarUnidades(db);

	const formCriar = await superValidate(zod4(unidadeSchema), { id: 'criarForm' });
	const formEditar = await superValidate(zod4(unidadeSchema), { id: 'editarForm' });

	return {
		unidades: lista,
		isAdmin: u.tipo === 'admin',
		formCriar,
		formEditar
	};
};

export const actions: Actions = {
	criar: async ({ request, locals, platform }) => {
		const u = locals.usuario;
		const form = await superValidate(request, zod4(unidadeSchema), { id: 'criarForm' });

		if (u?.tipo !== 'admin') return fail(403, { error: 'Apenas administradores podem cadastrar unidades' });

		if (!form.valid) {
			return fail(400, { form });
		}

		const db = getDB(platform);
		try {
			await criarUnidade(db, form.data);
			return message(form, JSON.stringify({ type: 'success' }));
		} catch (e: unknown) {
			const errorMsg = e instanceof Error ? e.message : 'Erro desconhecido';
			if (errorMsg.includes('UNIQUE')) {
				return message(form, JSON.stringify({ type: 'error', error: 'Já existe uma unidade com este nome' }), { status: 409 });
			}
			return message(form, JSON.stringify({ type: 'error', error: `Erro ao criar: ${errorMsg}` }), { status: 500 });
		}
	},

	editar: async ({ request, locals, platform }) => {
		const u = locals.usuario;
		if (u?.tipo !== 'admin') return fail(403, { error: 'Apenas administradores podem editar unidades' });

		const formData = await request.formData();
		const id = Number(formData.get('id'));
		
		const form = await superValidate(formData, zod4(unidadeSchema), { id: 'editarForm' });

		if (!form.valid) {
			return fail(400, { form });
		}

		const db = getDB(platform);
		try {
			await atualizarUnidade(db, id, form.data);
			return message(form, JSON.stringify({ type: 'success' }));
		} catch (e: unknown) {
			const errorMsg = e instanceof Error ? e.message : 'Erro desconhecido';
			if (errorMsg.includes('UNIQUE')) {
				return message(form, JSON.stringify({ type: 'error', error: 'Já existe uma unidade com este nome' }), { status: 409 });
			}
			return message(form, JSON.stringify({ type: 'error', error: `Erro ao atualizar: ${errorMsg}` }), { status: 500 });
		}
	},

	excluir: async ({ request, locals, platform }) => {
		const u = locals.usuario;
		if (u?.tipo !== 'admin') return fail(403, { error: 'Apenas administradores podem excluir unidades' });

		const data = await request.formData();
		const id = Number(data.get('unidade_id'));
		if (isNaN(id)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);

		// Buscar nome da unidade
		const unidade = await db.select({ nome: unidades.nome }).from(unidades).where(eq(unidades.id, id)).get();
		if (!unidade) return fail(404, { error: 'Unidade não encontrada' });

		// Verificar se há escalas vinculadas
		const escalasVinculadas = await db
			.select({ id: escalas.id })
			.from(escalas)
			.where(eq(escalas.lotacao, unidade.nome));

		if (escalasVinculadas.length > 0) {
			const count = escalasVinculadas.length;
			return fail(409, {
				error: `Não é possível excluir: esta unidade possui ${count} escala${count !== 1 ? 's' : ''} vinculada${count !== 1 ? 's' : ''}. Exclua as escalas primeiro.`
			});
		}

		await excluirUnidade(db, id);
		return { success: true };
	}
};
