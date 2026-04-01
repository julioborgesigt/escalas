import { json } from '@sveltejs/kit';
import { getDB, salvarEntradaGise } from '$lib/db';

export const POST = async ({ locals, params, request, platform, getClientAddress }: any) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });

	const giseId = parseInt(params.id);
	const { rubrica, latitude, longitude } = await request.json();

	if (!rubrica) return json({ error: 'Rubrica é obrigatória' }, { status: 400 });

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const db = getDB(platform);
	await salvarEntradaGise(db, giseId, u.id, rubrica, ip, ua, latitude, longitude);
	return json({ ok: true });
};
