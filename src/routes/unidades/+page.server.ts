import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
	getDB,
	listarUnidades,
	criarUnidade,
	atualizarUnidade,
	excluirUnidade,
	auditar,
	contextoDeEvento
} from '$lib/db';
import { unidadeSchema } from '$lib/schemas';
import { eq } from 'drizzle-orm';
import { unidades, type Unidade } from '$lib/server/schema';
import { ehViolacaoUnique, mensagemComCausas } from '$lib/server/db-errors';
import { logger } from '$lib/server/logger';

/**
 * Cadastro de unidades (`/unidades`) — restrito ao SUPER ADMIN, não ao Admin
 * Geral: o nome da unidade é a chave que amarra lotação do policial, escala e
 * cabeçalho dos documentos, então renomear ou excluir tem efeito em cascata
 * pelo sistema inteiro.
 */

/**
 * Lê e valida os campos de unidade do FormData (mesmos campos em criar/editar).
 * Os `tem_*` chegam como `'on'` porque o modal os envia por input oculto.
 */
function lerUnidadeDoForm(data: FormData) {
	const nome = data.get('nome')?.toString() || '';
	const tipo = data.get('tipo')?.toString() as Unidade['tipo'];
	const cidade = data.get('cidade')?.toString() || '';
	const parsed = unidadeSchema.safeParse({
		nome,
		tipo,
		seccional_id: data.get('seccional_id') ? Number(data.get('seccional_id')) : null,
		tem_plantao: data.get('tem_plantao') === 'on',
		tem_expediente: data.get('tem_expediente') === 'on',
		tem_fds: data.get('tem_fds') === 'on',
		cidade
	});
	return { parsed, nome, tipo, cidade };
}

/**
 * Nome duplicado vira 409 legível; o resto é logado e sai como 500 genérico —
 * a mensagem crua do Drizzle traz o SQL e os parâmetros, que não devem chegar
 * à tela.
 */
function falhaDeGravacao(e: unknown, acao: string) {
	if (ehViolacaoUnique(e)) {
		return fail(409, { error: 'Já existe uma unidade com este nome' });
	}
	logger.error(`[unidades/${acao}]`, { error: mensagemComCausas(e) });
	return fail(500, { error: 'Erro ao salvar a unidade. Tente novamente.' });
}

export const load: PageServerLoad = async ({ locals, platform }) => {
	const u = locals.usuario;
	if (!u) redirect(302, '/login');

	if (!u.isSuperAdmin) {
		redirect(302, '/');
	}

	const db = getDB(platform);
	const lista = await listarUnidades(db);

	return {
		unidades: lista
	};
};

export const actions: Actions = {
	criar: async (event) => {
		const { request, locals, platform } = event;
		const u = locals.usuario;
		if (!u || !u.isSuperAdmin)
			return fail(403, { error: 'Apenas o Super Administrador pode cadastrar unidades' });

		const { parsed, nome, tipo, cidade } = lerUnidadeDoForm(await request.formData());
		if (!parsed.success) {
			// Devolve os campos preenchidos para o modal não perder o que foi digitado.
			return fail(400, {
				error: parsed.error.issues[0].message,
				fields: { nome, tipo, cidade }
			});
		}

		const db = getDB(platform);
		try {
			await criarUnidade(db, parsed.data);
			// `criarUnidade` não devolve o id; recupera pelo nome (único) para
			// registrar o alvo na auditoria.
			const novaId =
				(
					await db
						.select({ id: unidades.id })
						.from(unidades)
						.where(eq(unidades.nome, nome.trim()))
						.get()
				)?.id ?? null;
			const { contexto, env } = contextoDeEvento(event);
			await auditar(
				db,
				{
					acao: 'criar_unidade',
					usuario: u,
					entidade: 'unidade',
					entidade_id: novaId,
					alvo_tipo: 'unidade',
					alvo_id: novaId,
					alvo_nome: nome.trim(),
					detalhes: `Unidade criada: ${nome.trim()}`,
					dados_depois: parsed.data,
					...contexto
				},
				{ env }
			);
			return { success: true };
		} catch (e: unknown) {
			return falhaDeGravacao(e, 'criar');
		}
	},

	editar: async (event) => {
		const { request, locals, platform } = event;
		const u = locals.usuario;
		if (!u || !u.isSuperAdmin)
			return fail(403, { error: 'Apenas o Super Administrador pode editar unidades' });

		const data = await request.formData();
		const id = Number(data.get('id'));
		const { parsed } = lerUnidadeDoForm(data);
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0].message });
		}

		const db = getDB(platform);
		// Estado anterior para o diff da auditoria (a linha muda logo abaixo).
		const antes = await db.select().from(unidades).where(eq(unidades.id, id)).get();
		try {
			await atualizarUnidade(db, id, parsed.data);
			const { contexto, env } = contextoDeEvento(event);
			await auditar(
				db,
				{
					acao: 'editar_unidade',
					usuario: u,
					entidade: 'unidade',
					entidade_id: id,
					alvo_tipo: 'unidade',
					alvo_id: id,
					alvo_nome: parsed.data.nome.trim(),
					detalhes: `Unidade editada: ${parsed.data.nome.trim()}`,
					dados_antes: antes ?? undefined,
					dados_depois: parsed.data,
					...contexto
				},
				{ env }
			);
			return { success: true };
		} catch (e: unknown) {
			return falhaDeGravacao(e, 'editar');
		}
	},

	excluir: async (event) => {
		const { request, locals, platform } = event;
		const u = locals.usuario;
		if (!u || !u.isSuperAdmin)
			return fail(403, { error: 'Apenas o Super Administrador pode excluir unidades' });

		const data = await request.formData();
		const id = Number(data.get('unidade_id'));
		if (isNaN(id)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);

		// Buscar a unidade completa (nome + estado para o diff de auditoria)
		const unidade = await db.select().from(unidades).where(eq(unidades.id, id)).get();
		if (!unidade) return fail(404, { error: 'Unidade não encontrada' });

		// A checagem de vínculos mora em `excluirUnidade` (lib/db/unidades), que
		// recusa em vez de apagar. Antes ela era parcial e inline aqui: só olhava
		// `escalas.lotacao`, e deixava passar servidor lotado, papel administrativo
		// e unidade subordinada.
		const resultado = await excluirUnidade(db, id);
		if (!resultado.ok) return fail(409, { error: resultado.motivo });
		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'excluir_unidade',
				usuario: u,
				entidade: 'unidade',
				entidade_id: id,
				alvo_tipo: 'unidade',
				alvo_id: id,
				alvo_nome: unidade.nome,
				detalhes: `Unidade excluída: ${unidade.nome}`,
				dados_antes: unidade,
				...contexto
			},
			{ env }
		);
		return { success: true };
	}
};
