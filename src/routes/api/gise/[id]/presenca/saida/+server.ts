import { json } from '@sveltejs/kit';
import { getDB, salvarSaidaGise } from '$lib/db';

export const POST = async ({ locals, params, request, platform }: any) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });

	const giseId = parseInt(params.id);
	const { dia, rubrica } = await request.json();
	
	if (!dia || !rubrica) return json({ error: 'Dia e rubrica são obrigatórios' }, { status: 400 });

	const db = getDB(platform);
	await salvarSaidaGise(db, giseId, u.id, dia, rubrica);
	return json({ ok: true });
};
