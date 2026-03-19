import { json } from '@sveltejs/kit';
import { getDB, listarEscalas, criarEscala, excluirEscala } from '$lib/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform, locals }) => {
	const db = getDB(platform);
	const usuario = locals.usuario;

	// Policial só vê escalas da sua lotação
	const lotacao = usuario?.tipo === 'policial' ? usuario.lotacao : undefined;
	const escalas = await listarEscalas(db, lotacao);
	return json(escalas);
};

export const POST: RequestHandler = async ({ platform, request, locals }) => {
	const db = getDB(platform);
	const usuario = locals.usuario;
	const data = await request.json();

	if (!data.titulo || !data.cidade || !data.data_inicio || !data.data_fim) {
		return json({ error: 'Campos obrigatórios: titulo, cidade, data_inicio, data_fim' }, { status: 400 });
	}

	const horaEntrada = data.hora_entrada || '08';
	const horaSaida = data.hora_saida || '08';

	// Policial cria escala da sua lotação; admin deve informar
	let lotacao = data.lotacao || '';
	if (usuario?.tipo === 'policial') {
		lotacao = usuario.lotacao!;
	}

	const result = await criarEscala(db, {
		titulo: data.titulo,
		cidade: data.cidade,
		data_inicio: data.data_inicio,
		data_fim: data.data_fim,
		horario: data.horario || `${horaEntrada}H A ${horaSaida}H`,
		hora_entrada: horaEntrada,
		hora_saida: horaSaida,
		lotacao
	});

	return json({ success: true, id: result.meta?.last_row_id }, { status: 201 });
};

export const DELETE: RequestHandler = async ({ platform, url, locals }) => {
	const db = getDB(platform);
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'ID obrigatório' }, { status: 400 });

	// Policial só pode excluir escalas da sua lotação
	if (locals.usuario?.tipo === 'policial') {
		const { buscarEscala } = await import('$lib/db');
		const escala = await buscarEscala(db, Number(id));
		if (escala && escala.lotacao !== locals.usuario.lotacao) {
			return json({ error: 'Sem permissão' }, { status: 403 });
		}
	}

	await excluirEscala(db, Number(id));
	return json({ success: true });
};
