import { json } from '@sveltejs/kit';
import { getDB, buscarRespostaGise, salvarRespostaGise } from '$lib/db';

export const GET = async ({ locals, params, url, platform }: any) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });

	const giseId = parseInt(params.id);
	const dia = (url.searchParams.get('dia') as 'sabado' | 'domingo') || 'sabado';
	const db = getDB(platform);
	
	const resposta = await buscarRespostaGise(db, giseId, u.id, dia);
	return json(resposta ? JSON.parse(resposta.respostas) : {});
};

export const POST = async ({ locals, params, request, platform }: any) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });

	const giseId = parseInt(params.id);
	const { respostas, dia } = await request.json();
	
	if (!respostas) return json({ error: 'Respostas são obrigatórias' }, { status: 400 });
	if (!dia) return json({ error: 'O dia é obrigatório' }, { status: 400 });

	const db = getDB(platform);
	await salvarRespostaGise(db, giseId, u.id, dia, JSON.stringify(respostas));
	return json({ ok: true });
};
