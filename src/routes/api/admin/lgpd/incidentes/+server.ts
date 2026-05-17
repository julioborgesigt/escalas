/**
 * GET  /api/admin/lgpd/incidentes — lista incidentes (admin geral)
 * POST /api/admin/lgpd/incidentes — registra novo incidente (admin geral)
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, registrarAuditComContexto } from '$lib/db';
import { registrarIncidente, listarIncidentes } from '$lib/db/lgpd-incidentes';
import { requireAdmin, validateBody } from '$lib/server/api';
import { novoIncidenteSchema } from '$lib/schemas';

export const GET: RequestHandler = async ({ platform, locals }) => {
	const u = requireAdmin(locals);
	if (u instanceof Response) return u;

	const db = getDB(platform);
	const incidentes = await listarIncidentes(db);
	return json({ incidentes });
};

export const POST: RequestHandler = async ({ platform, locals, request }) => {
	const u = requireAdmin(locals);
	if (u instanceof Response) return u;

	// Antes: `Record<string, unknown>` cru + `String(body.X)` campo a campo.
	// Sem schema Zod, valores fora dos enums (gravidade, tipo_incidente)
	// virariam string arbitrária no banco; `usuarios_afetados_estimativa`
	// aceitava qualquer coisa; `created_by_id` podia ser sobrescrito via
	// mass-assignment (em vez de vir da sessão). Schema agora corta isso.
	const v = await validateBody(request, novoIncidenteSchema);
	if (!v.ok) return v.response;
	const data = v.data;

	const db = getDB(platform);
	const incidente = await registrarIncidente(db, {
		titulo: data.titulo,
		descricao: data.descricao,
		tipo_incidente: data.tipo_incidente,
		data_ocorrencia: data.data_ocorrencia ?? null,
		data_descoberta: data.data_descoberta,
		dados_afetados: data.dados_afetados,
		usuarios_afetados_estimativa: data.usuarios_afetados_estimativa ?? null,
		gravidade: data.gravidade,
		responsavel_nome: data.responsavel_nome,
		responsavel_email: data.responsavel_email,
		medidas_tomadas: data.medidas_tomadas ?? null,
		// `created_by_*` vem SEMPRE da sessão — nunca do body. Mass-assignment
		// blockado pelo schema (campos não declarados são strippados pelo Zod).
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
