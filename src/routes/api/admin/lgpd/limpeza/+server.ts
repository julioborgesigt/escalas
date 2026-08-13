/**
 * POST /api/admin/lgpd/limpeza — executa limpeza de retenção de dados (LGPD art. 16).
 * Acesso restrito ao Administrador Geral.
 */
import { json } from '@sveltejs/kit';
import { getDB, registrarAuditComContexto } from '$lib/db';
import { carregarConfigRetencao, executarLimpezaRetencao } from '$lib/db/lgpd';
import { requireAdmin } from '$lib/server/api';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform, locals }) => {
	const usuario = requireAdmin(locals);
	if (usuario instanceof Response) return usuario;

	const db = getDB(platform);
	const config = await carregarConfigRetencao(db);
	const resultado = await executarLimpezaRetencao(db, config);

	await registrarAuditComContexto(db, {
		usuario: { id: usuario.id, nome: usuario.nome, papel: 'admin' },
		acao: 'limpeza_retencao',
		entidade: 'lgpd',
		detalhes: JSON.stringify({ config, resultado })
	});

	return json({ ok: true, resultado, config });
};
