import { json } from '@sveltejs/kit';
import { getDB, salvarEntradaGise, buscarGiseEscala } from '$lib/db';

export const POST = async ({ locals, params, request, platform, getClientAddress }: any) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });

	const giseId = parseInt(params.id);
	const { rubrica, latitude, longitude, selfieBase64 } = await request.json();

	if (!rubrica) return json({ error: 'Rubrica é obrigatória' }, { status: 400 });

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const db = getDB(platform);
	const gise = await buscarGiseEscala(db, giseId);
	if (!gise) return json({ error: 'Escala não encontrada' }, { status: 404 });

	let selfieKey: string | undefined = undefined;
	const r2 = platform?.env?.escalas_docs;

	if (r2 && selfieBase64) {
		const regex = /^data:image\/(jpeg|png|jpg);base64,/;
		const matches = selfieBase64.match(regex);
		if (matches) {
			const ext = matches[1] === 'png' ? 'png' : 'jpg';
			const dataBase64 = selfieBase64.replace(regex, '');
			const bytes = Buffer.from(dataBase64, 'base64');

			const [yyyy, mm, dd] = gise.data_inicio.split('-');
			const folder = `gise/${yyyy}-${mm}/${dd}/${giseId}/selfies`;
			selfieKey = `${folder}/presenca_${u.id}_entrada.${ext}`;

			await r2.put(selfieKey, bytes, { httpMetadata: { contentType: `image/${ext}` } });
		}
	}

	await salvarEntradaGise(db, giseId, u.id, rubrica, ip, ua, latitude, longitude, selfieKey);
	return json({ ok: true });
};
