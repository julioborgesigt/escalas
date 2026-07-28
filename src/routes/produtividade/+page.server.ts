/**
 * `load` do painel de PRODUTIVIDADE — restrito ao Admin Geral.
 *
 * Entrega a lista COMPLETA de respostas do período, não uma página: a tela
 * recombina os mesmos dados a cada filtro, e agregar no cliente evita uma ida
 * ao servidor por clique. O custo é o payload crescer com o histórico — é
 * dívida conhecida, com a solução (agregar no servidor) registrada abaixo.
 */
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
		error(403, 'Acesso restrito ao Administrador Geral');
	}

	const db = getDB(platform);

	const mes = Number(url.searchParams.get('mes')) || undefined;
	const ano = Number(url.searchParams.get('ano')) || undefined;

	// O dashboard agrega o conjunto COMPLETO de respostas (stats/rankings/charts
	// e filtros de ano/seccional são computados no cliente): busca a 1ª página
	// no batch principal e as demais em paralelo. Antes, só a 1ª página
	// (`?page=` que a UI nunca enviava, 200 linhas) era retornada — com mais de
	// 200 respostas os números erravam silenciosamente (auditoria 2026-07-16,
	// achado B-1). Médio prazo: agregar no servidor para o payload parar de
	// crescer com o histórico.
	const [primeira, modeloOpRow, modeloSeintRow, seccionais] = await Promise.all([
		listarTodasRespostasGise(db, { page: 1, limit: 500, mes, ano }),
		buscarGiseModeloFormulario(db, 'operacional'),
		buscarGiseModeloFormulario(db, 'seint'),
		buscarSeccionaisUnidades(db)
	]);
	const paginasRestantes =
		primeira.totalPages > 1
			? await Promise.all(
					Array.from({ length: primeira.totalPages - 1 }, (_, i) =>
						listarTodasRespostasGise(db, { page: i + 2, limit: 500, mes, ano })
					)
				)
			: [];

	return {
		lista: [...primeira.respostas, ...paginasRestantes.flatMap((p) => p.respostas)],
		modeloOperacional: JSON.parse(modeloOpRow?.config || '[]'),
		modeloSeint: JSON.parse(modeloSeintRow?.config || '[]'),
		seccionais
	};
}
