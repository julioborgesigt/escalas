import { redirect, fail, error } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
	getDB,
	buscarPolicial,
	atualizarPolicial,
	listarLotacoes,
	listarUnidades,
	promoverPolicial,
	vincularAdminGeral,
	desvincularAdminGeral,
	ehAdminGeralVinculado,
	auditar,
	contextoDeEvento
} from '$lib/db';
import { policialUpdateSchema } from '$lib/schemas/policial';
import { isAdminGeral, isAdminSeccional, isAdminUnidade } from '$lib/auth';
import { lotacoesAdministradas, lotacaoNoEscopo } from '$lib/server/policial-permissao';
import { decifrarCpfDoDB } from '$lib/crypto/cpf-cripto';

export const load: PageServerLoad = async ({ locals, params, platform }) => {
	const u = locals.usuario;
	if (!u) redirect(302, '/login');

	if (!isAdminGeral(u)) {
		redirect(302, '/');
	}

	const id = Number(params.id);
	if (isNaN(id)) error(400, 'ID inválido');

	const db = getDB(platform);
	const policial = await buscarPolicial(db, id);
	if (!policial) error(404, 'Policial não encontrado');

	const isAdm = isAdminGeral(u);
	const isSeccional = isAdminSeccional(u);
	const isUnidade = isAdminUnidade(u);

	const [lotacoes, todasUnidades, ehAdminGeral] = await Promise.all([
		isAdm ? listarLotacoes(db) : Promise.resolve<string[]>([]),
		isAdm || isSeccional || isUnidade ? listarUnidades(db) : Promise.resolve([]),
		ehAdminGeralVinculado(db, id)
	]);

	// CPF é cifrado em repouso (LGPD) — decifra para o formulário de edição
	// (público restrito a Admin Geral).
	const cpfClaro = await decifrarCpfDoDB(policial.cpf, platform?.env);

	return {
		policial: {
			...policial,
			cpf: cpfClaro || null,
			papel: policial.papel ?? null,
			papel_unidade_id: policial.papel_unidade_id ?? null
		},
		lotacoes,
		unidades: todasUnidades,
		isAdmin: isAdm,
		isAdminOrSeccional: isAdm || isSeccional,
		isAdminUnidade: isUnidade,
		ehAdminGeral
	};
};

/** Remove campos sensíveis (CPF/senha) antes de gravar um snapshot no log. */
function semCamposSensiveis(o: Record<string, unknown>): Record<string, unknown> {
	const copia: Record<string, unknown> = { ...o };
	delete copia.cpf;
	delete copia.senha;
	delete copia.cpf_index;
	return copia;
}

export const actions: Actions = {
	salvar: async (event) => {
		const { request, locals, platform, params } = event;
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });
		if (!isAdminGeral(u)) {
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
			await atualizarPolicial(
				db,
				id,
				{ ...parsed.data, email: data.email ?? undefined },
				platform?.env
			);
			const { contexto, env } = contextoDeEvento(event);
			await auditar(
				db,
				{
					acao: 'editar_policial',
					usuario: u,
					entidade: 'policial',
					entidade_id: id,
					alvo_tipo: 'policial',
					alvo_id: id,
					alvo_nome: parsed.data.nome,
					detalhes: `Policial editado: ${parsed.data.nome} (mat. ${parsed.data.matricula})`,
					dados_antes: semCamposSensiveis(alvo),
					dados_depois: semCamposSensiveis({ ...parsed.data, email: data.email ?? undefined }),
					...contexto
				},
				{ env }
			);
			return { success: true };
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : 'Erro desconhecido';
			if (message.includes('UNIQUE')) {
				return fail(409, { error: 'Matrícula já cadastrada', fields: data });
			}
			return fail(500, { error: 'Erro interno ao atualizar policial', fields: data });
		}
	},

	salvarPapel: async (event) => {
		const { request, locals, platform, params } = event;
		const u = locals.usuario;
		if (!u || !isAdminGeral(u))
			return fail(403, { error: 'Apenas o Admin Geral pode alterar papéis' });

		const id = Number(params.id);
		if (isNaN(id)) return fail(400, { error: 'ID inválido' });

		const formData = await request.formData();
		const papel = (formData.get('papel')?.toString() || null) as
			'admin_seccional' | 'admin_unidade' | null;
		const papelUnidadeIdStr = formData.get('papel_unidade_id')?.toString();
		const papelUnidadeId = papelUnidadeIdStr ? Number(papelUnidadeIdStr) : null;

		const db = getDB(platform);
		const alvo = await buscarPolicial(db, id);
		await promoverPolicial(db, id, papel, papelUnidadeId);

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'mudar_papel',
				usuario: u,
				entidade: 'policial',
				entidade_id: id,
				alvo_tipo: 'policial',
				alvo_id: id,
				alvo_nome: alvo?.nome ?? null,
				detalhes: `Papel alterado para ${papel ?? 'nenhum'}${papelUnidadeId ? ` (unidade ${papelUnidadeId})` : ''}`,
				dados_antes: {
					papel: alvo?.papel ?? null,
					papel_unidade_id: alvo?.papel_unidade_id ?? null
				},
				dados_depois: { papel, papel_unidade_id: papelUnidadeId },
				...contexto
			},
			{ env }
		);
		return { success: true };
	},

	// Admin Geral agora é uma conta VINCULADA em `administradores` (login pela
	// matrícula, sem senha própria). O policial passa a poder logar escolhendo
	// "Administrador" com a mesma matrícula/senha. Cumulativo com o `papel`.
	toggleAdminGeral: async (event) => {
		const { request, locals, platform, params } = event;
		const u = locals.usuario;
		if (!u || !isAdminGeral(u))
			return fail(403, { error: 'Apenas o Admin Geral pode conceder Admin Geral' });

		const id = Number(params.id);
		if (isNaN(id)) return fail(400, { error: 'ID inválido' });

		const ativar = formData2Bool((await request.formData()).get('ativar'));
		const db = getDB(platform);
		const policial = await buscarPolicial(db, id);
		if (!policial) return fail(404, { error: 'Policial não encontrado' });

		try {
			if (ativar) {
				await vincularAdminGeral(db, policial);
			} else {
				await desvincularAdminGeral(db, id);
			}
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : 'Erro desconhecido';
			if (msg.includes('UNIQUE')) {
				return fail(409, {
					error: 'Já existe um administrador com este login/matrícula.'
				});
			}
			return fail(500, { error: 'Erro ao atualizar a condição de Admin Geral' });
		}

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'toggle_admin_geral',
				usuario: u,
				entidade: 'policial',
				entidade_id: id,
				alvo_tipo: 'policial',
				alvo_id: id,
				alvo_nome: policial.nome,
				resultado: 'sucesso',
				detalhes: `${ativar ? 'Concedido' : 'Removido'} Admin Geral para ${policial.nome} (mat. ${policial.matricula})`,
				metadados: { ativar },
				...contexto
			},
			{ env }
		);
		return { success: true };
	}
};

function formData2Bool(v: FormDataEntryValue | null): boolean {
	const s = String(v ?? '').toLowerCase();
	return s === '1' || s === 'true' || s === 'on';
}
