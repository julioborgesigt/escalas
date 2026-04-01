import { json } from '@sveltejs/kit';
import { getDB, buscarRespostaGise, salvarRespostaGise } from '$lib/db';

export const GET = async ({ locals, params, url, platform }: any) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });

	const giseId = parseInt(params.id);
	const equipeId = url.searchParams.get('equipeId') ? parseInt(url.searchParams.get('equipeId')) : undefined;
	const db = getDB(platform);

	const resposta = await buscarRespostaGise(db, giseId, u.id, equipeId);
	const raw = (resposta as any)?.respostas;

	try {
		return json(raw ? JSON.parse(raw) : {});
	} catch (e) {
		console.error('Erro ao processar JSON de respostas GISE:', e);
		return json({});
	}
};

export const POST = async ({ locals, params, request, platform }: any) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });

	const giseId = parseInt(params.id);
	const { respostas, equipeId } = await request.json();

	if (!respostas) return json({ error: 'Respostas são obrigatórias' }, { status: 400 });

	const db = getDB(platform);
	await salvarRespostaGise(db, giseId, u.id, JSON.stringify(respostas), equipeId);
	return json({ ok: true });
};
