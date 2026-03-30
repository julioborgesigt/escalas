import { json } from '@sveltejs/kit';
import { getDB, salvarSaidaGise } from '$lib/db';

export const POST = async ({ locals, params, request, platform, getClientAddress }: any) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });

	const giseId = parseInt(params.id);
	const { dia, rubrica, latitude, longitude } = await request.json();
	
	if (!dia || !rubrica) return json({ error: 'Dia e rubrica são obrigatórios' }, { status: 400 });

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const db = getDB(platform);
	await salvarSaidaGise(db, giseId, u.id, dia, rubrica, ip, ua, latitude, longitude);
	return json({ ok: true });
};
