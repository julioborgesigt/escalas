import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
	getDB,
	listarPoliciais,
	buscarPolicial,
	criarPolicial,
	atualizarPolicial,
	excluirPolicial,
	listarUnidades,
	registrarAuditComContexto
} from '$lib/db';
import { policialSchema } from '$lib/schemas/policial';
import { isAdminGeral } from '$lib/auth';
import { lotacoesAdministradas, lotacaoNoEscopo } from '$lib/server/policial-permissao';
import { decifrarCpfDoDB } from '$lib/crypto/cpf-cripto';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	const u = locals.usuario;
	if (!u) throw redirect(302, '/login');

	if (!isAdminGeral(u)) {
		throw redirect(302, '/');
	}

	const db = getDB(platform);
	const isAdmin = isAdminGeral(u);
	const lotacaoParam = url.searchParams.get('lotacao') || undefined;
	const cargo = url.searchParams.get('cargo') || undefined;
	const busca = url.searchParams.get('busca') || undefined;
	const page = url.searchParams.get('page') ? Number(url.searchParams.get('page')) : undefined;

	const seccional = url.searchParams.get('seccional');
	const seccionalId = seccional && seccional !== 'todas' ? Number(seccional) : undefined;

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

	// CPF é cifrado em repouso (LGPD) — decifra para o formulário de edição
	// inline da lista (público restrito a Admin Geral).
	const policiaisComCpf = await Promise.all(
		resultado.policiais.map(async (p) => ({
			...p,
			cpf: (await decifrarCpfDoDB(p.cpf, platform?.env)) || null
		}))
	);

	return {
		policiais: policiaisComCpf,
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
		if (!isAdminGeral(u)) {
			return fail(403, { error: 'Apenas o Admin Geral pode cadastrar policiais' });
		}

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
		const emailPessoal = data.get('email_pessoal')?.toString() || null;
		const papelRequisitado = data.get('papel')?.toString() || null;
		const papelUnidadeIdRequisitado = data.get('papel_unidade_id')
			? Number(data.get('papel_unidade_id'))
			: null;

		// Apenas Admin Geral pode atribuir papel administrativo. Para os demais,
		// ignoramos silenciosamente — o caminho legítimo é o endpoint dedicado
		// `?/salvarPapel` (em /policiais/[id], guardado por `u.tipo === 'admin'`).
		const papel = isAdminGeral(u) ? papelRequisitado : null;
		const papelUnidadeId = isAdminGeral(u) ? papelUnidadeIdRequisitado : null;

		const db = getDB(platform);

		// Escopo: admin_unidade só cria na própria lotação; admin_seccional só
		// dentro das unidades vinculadas à seccional dele.
		const escopo = await lotacoesAdministradas(db, u);
		if (!lotacaoNoEscopo(escopo, lotacao)) {
			return fail(403, {
				error: 'Você só pode cadastrar policiais nas unidades sob sua administração'
			});
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
			email: email || null,
			email_pessoal: emailPessoal || null
		});

		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0].message,
				fields: {
					nome,
					matricula,
					cargo: cargoVal,
					cpf,
					telefone,
					classe,
					regime,
					lotacao,
					email,
					emailPessoal
				}
			});
		}

		try {
			await criarPolicial(
				db,
				{
					...parsed.data,
					email: email || null,
					email_pessoal: emailPessoal || null
				},
				platform?.env
			);
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
					fields: {
						nome,
						matricula,
						cargo: cargoVal,
						cpf,
						telefone,
						classe,
						regime,
						lotacao,
						email,
						emailPessoal
					}
				});
			}
			return fail(500, {
				error: 'Erro interno ao criar policial',
				fields: {
					nome,
					matricula,
					cargo: cargoVal,
					cpf,
					telefone,
					classe,
					regime,
					lotacao,
					email,
					emailPessoal
				}
			});
		}
	},
	atualizar: async ({ request, locals, platform }) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });
		if (!isAdminGeral(u)) {
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
		const emailPessoal = data.get('email_pessoal')?.toString() || null;
		const papelRequisitado = data.get('papel')?.toString() || null;
		const papelUnidadeIdRequisitado = data.get('papel_unidade_id')
			? Number(data.get('papel_unidade_id'))
			: null;

		const db = getDB(platform);

		// Carrega o registro ANTES de validar para: (1) checar escopo do alvo,
		// (2) preservar `papel`/`papel_unidade_id` atuais quando o caller não é
		// Admin Geral (impede que admin_seccional/admin_unidade troque o papel
		// de outro policial via este endpoint — o caminho legítimo é `?/salvarPapel`).
		const policialAtual = await buscarPolicial(db, policialId);
		if (!policialAtual) return fail(404, { error: 'Policial não encontrado' });

		const escopo = await lotacoesAdministradas(db, u);
		if (!lotacaoNoEscopo(escopo, policialAtual.lotacao)) {
			return fail(403, { error: 'Sem permissão para editar este policial' });
		}
		// Nova lotação também precisa estar no escopo — bloqueia transferência
		// para fora da seccional/unidade do administrador.
		if (!lotacaoNoEscopo(escopo, lotacao)) {
			return fail(403, {
				error: 'Não é possível transferir o policial para fora das unidades sob sua administração'
			});
		}

		const papel = isAdminGeral(u) ? papelRequisitado : (policialAtual.papel ?? null);
		const papelUnidadeId = isAdminGeral(u)
			? papelUnidadeIdRequisitado
			: (policialAtual.papel_unidade_id ?? null);

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
			email: email || null,
			email_pessoal: emailPessoal || null
		});
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0].message
			});
		}

		try {
			const emailPessoalNormalizado = emailPessoal || null;
			const emailPessoalVerificado =
				(policialAtual.email_pessoal ?? null) === emailPessoalNormalizado
					? policialAtual.email_pessoal_verificado
					: 0;

			await atualizarPolicial(
				db,
				policialId,
				{
					...parsed.data,
					email: email || null,
					email_pessoal: emailPessoalNormalizado,
					email_pessoal_verificado: emailPessoalVerificado
				},
				platform?.env
			);
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
		if (!isAdminGeral(u))
			return fail(403, { error: 'Apenas o Admin Geral pode excluir policiais' });

		const data = await request.formData();
		const policialId = Number(data.get('policial_id'));
		if (isNaN(policialId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);

		// Escopo do alvo: admin_seccional/unidade só apaga policiais sob sua
		// administração. Admin Geral irrestrito.
		const policial = await buscarPolicial(db, policialId);
		if (!policial) return fail(404, { error: 'Policial não encontrado' });

		const escopo = await lotacoesAdministradas(db, u);
		if (!lotacaoNoEscopo(escopo, policial.lotacao)) {
			return fail(403, { error: 'Sem permissão para excluir este policial' });
		}

		await excluirPolicial(db, policialId);
		return { success: true };
	}
};
