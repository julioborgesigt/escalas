import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
	getDB,
	listarPoliciais,
	criarPolicial,
	atualizarPolicial,
	excluirPolicial,
	listarUnidades,
	registrarAuditComContexto
} from '$lib/db';
import { policialSchema } from '$lib/schemas/policial';
import { gerarSenhaAleatoriaHash } from '$lib/auth';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	const u = locals.usuario;
	if (!u) throw redirect(302, '/login');

	if (u.tipo !== 'admin' && u.papel !== 'admin_seccional' && u.papel !== 'admin_unidade') {
		throw redirect(302, '/');
	}

	const db = getDB(platform);
	const isAdmin = u.tipo === 'admin';
	let lotacaoParam = url.searchParams.get('lotacao') || undefined;
	const cargo = url.searchParams.get('cargo') || undefined;
	const busca = url.searchParams.get('busca') || undefined;
	const page = url.searchParams.get('page') ? Number(url.searchParams.get('page')) : undefined;

	let seccional = url.searchParams.get('seccional');
	let seccionalId = seccional && seccional !== 'todas' ? Number(seccional) : undefined;

	// Se não for admin geral, restringir escopo
	if (!isAdmin) {
		if (u.papel === 'admin_seccional' && u.papel_unidade_id) {
			// Seccional Admin: fixar seccional se não houver unidade específica
			if (!lotacaoParam) {
				seccionalId = u.papel_unidade_id;
				seccional = String(u.papel_unidade_id);
			}
		} else if (u.papel === 'admin_unidade') {
			// Unit Admin: fixar unidade
			lotacaoParam = u.lotacao;
		}
	}

	const [resultado, unidades] = await Promise.all([
		listarPoliciais(db, lotacaoParam, false, {
			busca,
			cargo,
			seccionalId,
			page,
			limit: 20
		}),
		listarUnidades(db)
	]);

	return {
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
			busca: busca ?? '',
			seccional: seccional ?? 'todas'
		},
		isAdmin,
		lotacaoUsuario: u.lotacao
	};
};

export const actions: Actions = {
	criar: async ({ request, locals, platform }) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const data = await request.formData();

		const nome = data.get('nome')?.toString() || '';
		const matricula = data.get('matricula')?.toString() || '';
		const cargoVal = data.get('cargo')?.toString() as 'DPC' | 'OIP';
		const cpf = data.get('cpf')?.toString() || '';
		const telefone = data.get('telefone')?.toString() || '';
		const classe = data.get('classe')?.toString() || '';
		const regime = data.get('regime')?.toString() as 'plantao' | 'expediente' | 'ambos';
		const lotacao = data.get('lotacao')?.toString() || '';
		const email = data.get('email')?.toString() || null;
		const papel = data.get('papel')?.toString() || null;
		const papelUnidadeId = data.get('papel_unidade_id')
			? Number(data.get('papel_unidade_id'))
			: null;

		// Policial só pode cadastrar na sua lotação
		if (u.tipo === 'policial' && lotacao !== u.lotacao) {
			return fail(403, { error: 'Você só pode cadastrar policiais na sua lotação' });
		}

		const parsed = policialSchema.safeParse({
			nome,
			matricula,
			cargo: cargoVal,
			cpf: cpf || null,
			telefone,
			lotacao,
			regime,
			classe,
			papel: papel || null,
			papel_unidade_id: papelUnidadeId || null,
			email: email || null
		});

		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0].message,
				fields: { nome, matricula, cargo: cargoVal, cpf, telefone, classe, regime, lotacao, email }
			});
		}

		const db = getDB(platform);
		try {
			await criarPolicial(db, { ...parsed.data, email: email || null });
			await registrarAuditComContexto(db, {
				usuario: u,
				acao: 'criar_policial',
				entidade: 'policial',
				detalhes: `Criado policial: ${nome} (matrícula: ${matricula})`
			});
			return { success: true };
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : String(e);
			if (message.includes('UNIQUE')) {
				return fail(409, {
					error: 'Matrícula já cadastrada',
					fields: { nome, matricula, cargo: cargoVal, cpf, telefone, classe, regime, lotacao, email }
				});
			}
			return fail(500, {
				error: 'Erro interno ao criar policial',
				fields: { nome, matricula, cargo: cargoVal, cpf, telefone, classe, regime, lotacao, email }
			});
		}
	},
	atualizar: async ({ request, locals, platform }) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });
		if (u.tipo !== 'admin' && u.papel !== 'admin_seccional' && u.papel !== 'admin_unidade') {
			return fail(403, { error: 'Sem permissão para editar policiais' });
		}

		const data = await request.formData();
		const policialId = Number(data.get('policial_id'));
		if (Number.isNaN(policialId)) return fail(400, { error: 'Policial inválido' });

		const nome = data.get('nome')?.toString() || '';
		const matricula = data.get('matricula')?.toString() || '';
		const cargoVal = data.get('cargo')?.toString() as 'DPC' | 'OIP';
		const cpf = data.get('cpf')?.toString() || '';
		const telefone = data.get('telefone')?.toString() || '';
		const classe = data.get('classe')?.toString() || '';
		const regime = data.get('regime')?.toString() as 'plantao' | 'expediente' | 'ambos';
		const lotacao = data.get('lotacao')?.toString() || '';
		const email = data.get('email')?.toString() || null;
		const papel = data.get('papel')?.toString() || null;
		const papelUnidadeId = data.get('papel_unidade_id')
			? Number(data.get('papel_unidade_id'))
			: null;

		const parsed = policialSchema.safeParse({
			nome,
			matricula,
			cargo: cargoVal,
			cpf: cpf || null,
			telefone,
			lotacao,
			regime,
			classe,
			papel: papel || null,
			papel_unidade_id: papelUnidadeId || null,
			email: email || null
		});
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0].message
			});
		}

		const db = getDB(platform);
		try {
			await atualizarPolicial(db, policialId, {
				...parsed.data,
				email: email || null
			});
			await registrarAuditComContexto(db, {
				usuario: u,
				acao: 'editar_policial',
				entidade: 'policial',
				entidade_id: policialId,
				detalhes: `Atualizado policial: ${nome} (matrícula: ${matricula})`
			});
			return { success: true };
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : String(e);
			if (message.includes('UNIQUE')) {
				return fail(409, { error: 'Matrícula já cadastrada' });
			}
			return fail(500, { error: 'Erro interno ao atualizar policial' });
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
