import { json } from '@sveltejs/kit';
import { getDB, buscarGiseModeloFormulario, salvarGiseModeloFormulario } from '$lib/db';
import { isAdminGeral } from '$lib/auth';

export const GET = async ({ locals, platform }: any) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });

	const db = getDB(platform);
	const modelo = await buscarGiseModeloFormulario(db);
	return json(modelo ? JSON.parse(modelo.config) : []);
};

export const POST = async ({ locals, request, platform }: any) => {
	const u = locals.usuario;
	if (!u || !isAdminGeral(u)) {
		return json({ error: 'Somente administradores gerais podem editar o modelo' }, { status: 403 });
	}

	const { config } = await request.json();
	if (!config) return json({ error: 'Configuração é obrigatória' }, { status: 400 });

	const db = getDB(platform);
	await salvarGiseModeloFormulario(db, JSON.stringify(config));
	return json({ ok: true });
};
