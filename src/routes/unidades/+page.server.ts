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
import { unidades, escalas, type Unidade } from '$lib/server/schema';

export const load: PageServerLoad = async ({ locals, platform }) => {
	const u = locals.usuario;
	if (!u) redirect(302, '/login');

	if (!u.isSuperAdmin) {
		redirect(302, '/');
	}

	const db = getDB(platform);
	const lista = await listarUnidades(db);

	return {
		unidades: lista,
		isAdmin: true
	};
};

export const actions: Actions = {
	criar: async (event) => {
		const { request, locals, platform } = event;
		const u = locals.usuario;
		if (!u || !u.isSuperAdmin)
			return fail(403, { error: 'Apenas o Super Administrador pode cadastrar unidades' });

		const data = await request.formData();
		const nome = data.get('nome')?.toString() || '';
		const tipo = data.get('tipo')?.toString() as Unidade['tipo'];
		const seccional_id = data.get('seccional_id') ? Number(data.get('seccional_id')) : null;
		const tem_plantao = data.get('tem_plantao') === 'on';
		const tem_expediente = data.get('tem_expediente') === 'on';
		const tem_fds = data.get('tem_fds') === 'on';
		const cidade = data.get('cidade')?.toString() || '';

		const parsed = unidadeSchema.safeParse({
			nome,
			tipo,
			seccional_id,
			tem_plantao,
			tem_expediente,
			tem_fds,
			cidade
		});

		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0].message,
				fields: { nome, tipo, cidade }
			});
		}

		const db = getDB(platform);
		try {
			await criarUnidade(db, parsed.data);
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
			const message = e instanceof Error ? e.message : 'Erro desconhecido';
			if (message.includes('UNIQUE')) {
				return fail(409, { error: 'Já existe uma unidade com este nome' });
			}
			return fail(500, { error: message });
		}
	},

	editar: async (event) => {
		const { request, locals, platform } = event;
		const u = locals.usuario;
		if (!u || !u.isSuperAdmin)
			return fail(403, { error: 'Apenas o Super Administrador pode editar unidades' });

		const data = await request.formData();
		const id = Number(data.get('id'));
		const nome = data.get('nome')?.toString() || '';
		const tipo = data.get('tipo')?.toString() as Unidade['tipo'];
		const seccional_id = data.get('seccional_id') ? Number(data.get('seccional_id')) : null;
		const tem_plantao = data.get('tem_plantao') === 'on';
		const tem_expediente = data.get('tem_expediente') === 'on';
		const tem_fds = data.get('tem_fds') === 'on';
		const cidade = data.get('cidade')?.toString() || '';

		const parsed = unidadeSchema.safeParse({
			nome,
			tipo,
			seccional_id,
			tem_plantao,
			tem_expediente,
			tem_fds,
			cidade
		});

		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0].message });
		}

		const db = getDB(platform);
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
			const message = e instanceof Error ? e.message : 'Erro desconhecido';
			if (message.includes('UNIQUE')) {
				return fail(409, { error: 'Já existe uma unidade com este nome' });
			}
			return fail(500, { error: message });
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
