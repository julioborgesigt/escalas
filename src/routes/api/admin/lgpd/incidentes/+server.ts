/**
 * GET  /api/admin/lgpd/incidentes — lista incidentes (admin geral)
 * POST /api/admin/lgpd/incidentes — registra novo incidente (admin geral)
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, registrarAuditComContexto } from '$lib/db';
import { isAdminGeral } from '$lib/auth';
import { registrarIncidente, listarIncidentes } from '$lib/db/lgpd-incidentes';

export const GET: RequestHandler = async ({ platform, locals }) => {
	const u = locals.usuario;
	if (!u || !isAdminGeral(u)) return json({ error: 'Acesso restrito' }, { status: 403 });

	const db = getDB(platform);
	const incidentes = await listarIncidentes(db);
	return json({ incidentes });
};

export const POST: RequestHandler = async ({ platform, locals, request }) => {
	const u = locals.usuario;
	if (!u || !isAdminGeral(u)) return json({ error: 'Acesso restrito' }, { status: 403 });

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'JSON inválido' }, { status: 400 });
	}

	const campos = ['titulo', 'descricao', 'tipo_incidente', 'data_descoberta', 'dados_afetados', 'gravidade', 'responsavel_nome', 'responsavel_email'];
	for (const c of campos) {
		if (!body[c]) return json({ error: `Campo obrigatório: ${c}` }, { status: 400 });
	}

	const db = getDB(platform);
	const incidente = await registrarIncidente(db, {
		titulo: String(body.titulo),
		descricao: String(body.descricao),
		tipo_incidente: body.tipo_incidente as any,
		data_ocorrencia: body.data_ocorrencia ? String(body.data_ocorrencia) : null,
		data_descoberta: String(body.data_descoberta),
		dados_afetados: String(body.dados_afetados),
		usuarios_afetados_estimativa: body.usuarios_afetados_estimativa ? Number(body.usuarios_afetados_estimativa) : null,
		gravidade: body.gravidade as any,
		responsavel_nome: String(body.responsavel_nome),
		responsavel_email: String(body.responsavel_email),
		medidas_tomadas: body.medidas_tomadas ? String(body.medidas_tomadas) : null,
		created_by_id: u.id,
		created_by_nome: u.nome
	});

	await registrarAuditComContexto(db, {
		usuario: u,
		acao: 'registrar_incidente',
		entidade: 'lgpd_incidente',
		entidade_id: incidente.id,
		detalhes: `Gravidade: ${incidente.gravidade} · Prazo ANPD: ${incidente.prazo_notificacao_anpd}`
	});

	return json({ ok: true, incidente }, { status: 201 });
};
