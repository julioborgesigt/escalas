import { redirect, fail, error } from '@sveltejs/kit';
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
import { lotacoesAdministradas, lotacaoNoEscopo } from '$lib/server/policial-permissao';

export const load: PageServerLoad = async ({ locals, params, platform }) => {
	const u = locals.usuario;
	if (!u) throw redirect(302, '/login');

	if (!u.isSuperAdmin) {
		throw redirect(302, '/');
	}

	const id = Number(params.id);
	if (isNaN(id)) throw error(400, 'ID inválido');

	const db = getDB(platform);
	const policial = await buscarPolicial(db, id);
	if (!policial) throw error(404, 'Policial não encontrado');

	const isAdm = isAdminGeral(u);
	const isSeccional = isAdminSeccional(u);
	const isUnidade = isAdminUnidade(u);

	const [lotacoes, todasUnidades] = await Promise.all([
		isAdm ? listarLotacoes(db) : Promise.resolve<string[]>([]),
		isAdm || isSeccional || isUnidade ? listarUnidades(db) : Promise.resolve([])
	]);

	return {
		policial: {
			...policial,
			papel: policial.papel ?? null,
			papel_unidade_id: policial.papel_unidade_id ?? null
		},
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
		if (!u.isSuperAdmin) {
			return fail(403, { error: 'Sem permissão para editar policiais' });
		}

		const id = Number(params.id);
		if (isNaN(id)) return fail(400, { error: 'ID inválido' });

		const formData = await request.formData();
		const data = {
			nome: formData.get('nome')?.toString() || '',
			matricula: formData.get('matricula')?.toString() || '',
			cargo: formData.get('cargo')?.toString() as 'DPC' | 'OIP',
			cpf: formData.get('cpf')?.toString() || '',
			telefone: formData.get('telefone')?.toString() || '',
			lotacao: formData.get('lotacao')?.toString() || '',
			regime: formData.get('regime')?.toString() as 'plantao' | 'expediente' | 'ambos',
			classe: formData.get('classe')?.toString() || '',
			email: formData.get('email')?.toString() || null
		};

		const parsed = policialUpdateSchema.safeParse(data);
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0].message, fields: data });
		}

		const db = getDB(platform);
		const alvo = await buscarPolicial(db, id);
		if (!alvo) return fail(404, { error: 'Policial não encontrado', fields: data });

		const escopo = await lotacoesAdministradas(db, u);
		if (!lotacaoNoEscopo(escopo, alvo.lotacao)) {
			return fail(403, { error: 'Sem permissão para editar este policial', fields: data });
		}
		// Bloqueia transferência para fora do escopo do administrador (impede
		// admin_seccional/admin_unidade de "exportar" um policial e perder o
		// controle sobre ele depois).
		if (!lotacaoNoEscopo(escopo, data.lotacao)) {
			return fail(403, {
				error: 'Não é possível transferir o policial para fora das unidades sob sua administração',
				fields: data
			});
		}

		try {
			await atualizarPolicial(db, id, { ...parsed.data, email: data.email ?? undefined });
			return { success: true };
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : 'Erro desconhecido';
			if (message.includes('UNIQUE')) {
				return fail(409, { error: 'Matrícula já cadastrada', fields: data });
			}
			return fail(500, { error: 'Erro interno ao atualizar policial', fields: data });
		}
	},

	salvarPapel: async ({ request, locals, platform, params }) => {
		const u = locals.usuario;
		if (!u || !u.isSuperAdmin)
			return fail(403, { error: 'Apenas o Super Administrador pode alterar papéis' });

		const id = Number(params.id);
		if (isNaN(id)) return fail(400, { error: 'ID inválido' });

		const formData = await request.formData();
		const papel = (formData.get('papel')?.toString() || null) as
			| 'admin_seccional'
			| 'admin_unidade'
			| null;
		const papelUnidadeIdStr = formData.get('papel_unidade_id')?.toString();
		const papelUnidadeId = papelUnidadeIdStr ? Number(papelUnidadeIdStr) : null;

		const db = getDB(platform);
		await promoverPolicial(db, id, papel, papelUnidadeId);
		return { success: true };
	}
};
