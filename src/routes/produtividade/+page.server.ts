import { error } from '@sveltejs/kit';
import type { PageServerLoadEvent } from './$types';
import {
	getDB,
	buscarGiseModeloFormulario,
	listarTodasRespostasGise,
	buscarSeccionaisUnidades
} from '$lib/db';

export async function load({ locals, platform, url }: PageServerLoadEvent) {
	if (!locals.usuario || locals.usuario.tipo !== 'admin') {
		throw error(403, 'Acesso restrito ao Administrador Geral');
	}

	const db = getDB(platform);

	// Parse pagination from URL params
	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
	const mes = Number(url.searchParams.get('mes')) || undefined;
	const ano = Number(url.searchParams.get('ano')) || undefined;

	const [resultLista, modeloOpRow, modeloSeintRow, seccionais] = await Promise.all([
		listarTodasRespostasGise(db, { page, mes, ano }),
		buscarGiseModeloFormulario(db, 'operacional'),
		buscarGiseModeloFormulario(db, 'seint'),
		buscarSeccionaisUnidades(db)
	]);

	return {
		lista: resultLista.respostas,
		pagination: {
			page: resultLista.page,
			limit: resultLista.limit,
			total: resultLista.total,
			totalPages: resultLista.totalPages
		},
		modeloOperacional: JSON.parse(modeloOpRow?.config || '[]'),
		modeloSeint: JSON.parse(modeloSeintRow?.config || '[]'),
		seccionais
	};
}
