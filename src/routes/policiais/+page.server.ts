import { redirect, fail } from '@sveltejs/kit';
import { ehViolacaoUnique } from '$lib/server/db-errors';
import type { PageServerLoad, Actions } from './$types';
import {
	getDB,
	listarPoliciais,
	buscarPolicial,
	buscarPolicialPorMatricula,
	criarPolicial,
	excluirPolicial,
	listarUnidades,
	registrarAuditComContexto,
	auditar,
	contextoDeEvento,
	vincularAdminGeral,
	desvincularAdminGeral
} from '$lib/db';
import { policialSchema } from '$lib/schemas/policial';
import { isAdminGeral } from '$lib/auth';
import { lotacoesAdministradas, lotacaoNoEscopo } from '$lib/server/policial-permissao';
import { decifrarCpfDoDB } from '$lib/crypto/cpf-cripto';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	const u = locals.usuario;
	if (!u) redirect(302, '/login');

	if (!isAdminGeral(u)) {
		redirect(302, '/');
	}

	const db = getDB(platform);
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
		lotacaoUsuario: u.lotacao
	};
};

export const actions: Actions = {
	criar: async (event) => {
		const { request, locals, platform } = event;
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

		// Papel administrativo exige a unidade/seccional de responsabilidade.
		if (papel && !papelUnidadeId) {
			return fail(400, {
				error: 'Selecione a unidade de responsabilidade para o papel administrativo.'
			});
		}

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
			// Conceder Admin Geral já no cadastro (cria a conta vinculada). Como o
			// id só existe após o insert, busca pela matrícula.
			const concederAdminGeral = ['1', 'true', 'on'].includes(
				String(data.get('conceder_admin_geral') ?? '').toLowerCase()
			);
			if (concederAdminGeral) {
				const novo = await buscarPolicialPorMatricula(db, matricula);
				if (novo) await vincularAdminGeral(db, novo);
			}
			const { contexto, env } = contextoDeEvento(event);
			await registrarAuditComContexto(db, {
				usuario: u,
				acao: 'criar_policial',
				entidade: 'policial',
				alvo_tipo: 'policial',
				alvo_nome: nome,
				detalhes: `Criado policial: ${nome} (matrícula: ${matricula})`,
				...contexto,
				env
			});
			return { success: true };
		} catch (e: unknown) {
			// A violação de índice único fica em `e.cause` (ver `db-errors.ts`).
			if (ehViolacaoUnique(e)) {
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
	excluir: async (event) => {
		const { request, locals, platform } = event;
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

		// Remove também a conta Admin Geral vinculada (se houver), evitando um
		// login admin órfão apontando para um policial inexistente.
		await desvincularAdminGeral(db, policialId);
		await excluirPolicial(db, policialId);

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'excluir_policial',
				usuario: u,
				entidade: 'policial',
				entidade_id: policialId,
				alvo_tipo: 'policial',
				alvo_id: policialId,
				alvo_nome: policial.nome,
				detalhes: `Policial excluído: ${policial.nome} (mat. ${policial.matricula})`,
				...contexto
			},
			{ env }
		);
		return { success: true };
	}
};
