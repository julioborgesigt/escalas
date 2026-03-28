import { error } from '@sveltejs/kit';
import { getDB, buscarGiseModeloFormulario, listarTodasRespostasGise, buscarSeccionaisUnidades } from '$lib/db';

export async function load({ locals, platform }) {
	if (!locals.usuario || locals.usuario.tipo !== 'admin') {
		throw error(403, 'Acesso restrito ao Administrador Geral');
	}

	const db = getDB(platform);
	const [lista, modeloRow, seccionais] = await Promise.all([
		listarTodasRespostasGise(db),
		buscarGiseModeloFormulario(db),
		buscarSeccionaisUnidades(db)
	]);

	const modelo = JSON.parse(modeloRow?.config || '[]');

	return {
		lista,
		modelo,
		seccionais
	};
}
