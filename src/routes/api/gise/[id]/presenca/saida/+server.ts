import { json } from '@sveltejs/kit';
import { getDB, salvarSaidaGise, buscarGiseEscala, verificarTodosSairam, verificarTodosRelatoriosEnviados, atualizarGiseEscala } from '$lib/db';

export const POST = async ({ locals, params, request, platform, getClientAddress }: any) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });

	const giseId = parseInt(params.id);
	const { rubrica, latitude, longitude, selfieBase64 } = await request.json();

	if (!rubrica) return json({ error: 'Rubrica é obrigatória' }, { status: 400 });

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const db = getDB(platform);
	const giseOrig = await buscarGiseEscala(db, giseId);
	if (!giseOrig) return json({ error: 'Escala não encontrada' }, { status: 404 });

	let selfieKey: string | undefined = undefined;
	const r2 = platform?.env?.escalas_docs;

	if (r2 && selfieBase64) {
		const regex = /^data:image\/(jpeg|png|jpg);base64,/;
		const matches = selfieBase64.match(regex);
		if (matches) {
			const ext = matches[1] === 'png' ? 'png' : 'jpg';
			const dataBase64 = selfieBase64.replace(regex, '');
			const binaryString = atob(dataBase64);
			const bytes = new Uint8Array(binaryString.length);
			for (let i = 0; i < binaryString.length; i++) {
				bytes[i] = binaryString.charCodeAt(i);
			}

			const [yyyy, mm, dd] = giseOrig.data_inicio.split('-');
			const folder = `gise/${yyyy}-${mm}/${dd}/${giseId}/selfies`;
			selfieKey = `${folder}/presenca_${u.id}_saida.${ext}`;
			
			await r2.put(selfieKey, bytes, { httpMetadata: { contentType: `image/${ext}` } });
		}
	}

	await salvarSaidaGise(db, giseId, u.id, rubrica, ip, ua, latitude, longitude, selfieKey);

	// Verificar transição de status após saída
	const gise = await buscarGiseEscala(db, giseId);
	if (gise && gise.status === 'em_andamento') {
		const todosSairam = await verificarTodosSairam(db, giseId);
		if (todosSairam) {
			const todosEnviaram = await verificarTodosRelatoriosEnviados(db, giseId);
			await atualizarGiseEscala(db, giseId, {
				status: todosEnviaram ? 'aguardando_assinatura_relat' : 'aguardando_relatorios'
			});
		}
	}

	return json({ ok: true });
};
