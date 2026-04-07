import { json } from '@sveltejs/kit';
import { getDB, excluirUnidade, atualizarUnidade } from '$lib/db';
import { unidades } from '$lib/server/schema';
import { unidadeSchema } from '$lib/schemas';
import { eq } from 'drizzle-orm';
import { escalas } from '$lib/server/schema';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ platform, params, request, locals }) => {
	if (locals.usuario?.tipo !== 'admin') {
		return json({ error: 'Apenas administradores podem editar unidades' }, { status: 403 });
	}

	const db = getDB(platform);
	const id = Number(params.id);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const data = await request.json();
	const parsed = unidadeSchema.safeParse(data);
	if (!parsed.success) {
		return json({ error: parsed.error.issues[0].message }, { status: 400 });
	}

	try {
		await atualizarUnidade(db, id, parsed.data);
		return json({ success: true });
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : 'Erro desconhecido';
		if (message.includes('UNIQUE')) {
			return json({ error: 'Já existe uma unidade com este nome' }, { status: 409 });
		}
		return json({ error: message }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ platform, params, locals }) => {
	if (locals.usuario?.tipo !== 'admin') {
		return json({ error: 'Apenas administradores podem excluir unidades' }, { status: 403 });
	}

	const db = getDB(platform);
	const id = Number(params.id);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	// Buscar nome da unidade
	const unidade = await db.select({ nome: unidades.nome }).from(unidades).where(eq(unidades.id, id)).get();
	if (!unidade) return json({ error: 'Unidade não encontrada' }, { status: 404 });

	// Verificar se há escalas vinculadas
	const escalasVinculadas = await db
		.select({ id: escalas.id })
		.from(escalas)
		.where(eq(escalas.lotacao, unidade.nome));

	const count = escalasVinculadas.length;
	if (count > 0) {
		return json({
			error: `Não é possível excluir: esta unidade possui ${count} escala${count !== 1 ? 's' : ''} vinculada${count !== 1 ? 's' : ''}. Exclua as escalas primeiro.`
		}, { status: 409 });
	}

	await excluirUnidade(db, id);
	return json({ success: true });
};
