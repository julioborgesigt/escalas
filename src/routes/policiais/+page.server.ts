import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
	getDB,
	listarPoliciais,
	criarPolicial,
	excluirPolicial,
	listarUnidades,
	registrarAuditComContexto
} from '$lib/db';
import { policialSchema } from '$lib/schemas/policial';
import { gerarSenhaAleatoriaHash } from '$lib/auth';
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	const u = locals.usuario;
	if (!u) throw redirect(302, '/login');

	if (u.tipo !== 'admin' && u.papel !== 'admin_seccional' && u.papel !== 'admin_unidade') {
		throw redirect(302, '/');
	}

	const db = getDB(platform);
	const isAdmin = u.tipo === 'admin';
	const lotacaoParam = url.searchParams.get('lotacao') || undefined;
	const cargo = url.searchParams.get('cargo') || undefined;
	const busca = url.searchParams.get('busca') || undefined;
	const page = url.searchParams.get('page') ? Number(url.searchParams.get('page')) : undefined;

	const skipLoad = false; // Removido para garantir que policiais estejam sempre visíveis

	const [resultado, unidades, form] = await Promise.all([
		listarPoliciais(db, lotacaoParam, false, { busca, page, limit: 20 }),
		listarUnidades(db),
		superValidate(zod4(policialSchema))
	]);

	return {
		form,
		policiais: resultado.policiais,
		pagination: {
			page: resultado.page,
			limit: resultado.limit,
			total: resultado.total,
			totalPages: resultado.totalPages
		},
		unidades,
		filtros: {
			lotacao: lotacaoParam ?? '',
			cargo: cargo ?? '',
			busca: busca ?? ''
		},
		isAdmin,
		lotacaoUsuario: u.lotacao,
		skipLoad
	};
};

export const actions: Actions = {
	criar: async ({ request, locals, platform }) => {
		const u = locals.usuario;
		const form = await superValidate(request, zod4(policialSchema));

		if (!u) return fail(401, { error: 'Não autorizado' });

		if (!form.valid) {
			return fail(400, { form });
		}

		const { nome, matricula, lotacao } = form.data;

		// Policial só pode cadastrar na sua lotação
		if (u.tipo === 'policial' && lotacao !== u.lotacao) {
			return message(form, JSON.stringify({ type: 'error', error: 'Você só pode cadastrar policiais na sua lotação' }), { status: 403 });
		}

		const db = getDB(platform);
		try {
			await criarPolicial(db, { ...form.data, email: form.data.email || null });
			await registrarAuditComContexto(db, {
				usuario: u,
				acao: 'criar_policial',
				entidade: 'policial',
				detalhes: `Criado policial: ${nome} (matrícula: ${matricula})`
			});
			return message(form, JSON.stringify({ type: 'success' }));
		} catch (e: unknown) {
			const errorMsg = e instanceof Error ? e.message : String(e);
			if (errorMsg.includes('UNIQUE')) {
				return message(form, JSON.stringify({ type: 'error', error: 'Matrícula já cadastrada' }), { status: 409 });
			}
			return message(form, JSON.stringify({ type: 'error', error: 'Erro interno ao criar policial' }), { status: 500 });
		}
	},

	excluir: async ({ request, locals, platform }) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const data = await request.formData();
		const policialId = Number(data.get('policial_id'));
		if (isNaN(policialId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);

		if (u.tipo === 'policial') {
			const { buscarPolicial } = await import('$lib/db');
			const policial = await buscarPolicial(db, policialId);
			if (policial && policial.lotacao !== u.lotacao) {
				return fail(403, { error: 'Sem permissão' });
			}
		}

		await excluirPolicial(db, policialId);
		return { success: true };
	}
};
