import { json } from '@sveltejs/kit';
import { getDB, salvarSaidaGise, buscarGiseEscala, verificarTodosSairam, verificarTodosRelatoriosEnviados, atualizarGiseEscala } from '$lib/db';

export const POST = async ({ locals, params, request, platform, getClientAddress }: any) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });

	const giseId = parseInt(params.id);
	const { rubrica, latitude, longitude } = await request.json();

	if (!rubrica) return json({ error: 'Rubrica é obrigatória' }, { status: 400 });

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const db = getDB(platform);
	await salvarSaidaGise(db, giseId, u.id, rubrica, ip, ua, latitude, longitude);

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
