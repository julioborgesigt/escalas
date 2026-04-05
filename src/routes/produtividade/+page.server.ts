import { error } from '@sveltejs/kit';
import { getDB, buscarGiseModeloFormulario, listarTodasRespostasGise, buscarSeccionaisUnidades } from '$lib/db';

export async function load({ locals, platform }) {
	if (!locals.usuario || locals.usuario.tipo !== 'admin') {
		throw error(403, 'Acesso restrito ao Administrador Geral');
	}

	const db = getDB(platform);
	const [lista, modeloOpRow, modeloSeintRow, seccionais] = await Promise.all([
		listarTodasRespostasGise(db),
		buscarGiseModeloFormulario(db, 'operacional'),
		buscarGiseModeloFormulario(db, 'seint'),
		buscarSeccionaisUnidades(db)
	]);

	return {
		lista,
		modeloOperacional: JSON.parse(modeloOpRow?.config || '[]'),
		modeloSeint: JSON.parse(modeloSeintRow?.config || '[]'),
		seccionais
	};
}
