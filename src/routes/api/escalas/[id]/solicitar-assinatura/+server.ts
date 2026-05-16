import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getDB,
	buscarEscala,
	buscarPolicial,
	criarSolicitacaoAssinatura,
	buscarSolicitacaoAssinatura,
	excluirSolicitacaoAssinatura
} from '$lib/db';
import { z } from 'zod';
import { requireAuth, badRequest, forbidden, notFound, validateBody } from '$lib/server/api';

const solicitarSchema = z.object({
	tipo: z.enum(['unidade', 'respondencia']),
	destinatario_id: z.number().int().positive().optional()
});

function podeOIPSolicitar(u: App.Locals['usuario']) {
	if (!u) return false;
	if (u.tipo === 'admin') return true;
	return (u.papel === 'admin_seccional' || u.papel === 'admin_unidade') && u.cargo === 'OIP';
}

export const POST: RequestHandler = async ({ params, locals, platform, request }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;
	if (!podeOIPSolicitar(u)) return forbidden('Sem permissão');

	const id = Number(params.id);
	if (isNaN(id)) return badRequest('ID inválido');

	const v = await validateBody(request, solicitarSchema);
	if (!v.ok) return v.response;
	const { tipo, destinatario_id } = v.data;

	if (tipo === 'respondencia' && !destinatario_id) {
		return badRequest('Informe o destinatário para assinatura em respondência');
	}

	const db = getDB(platform);
	const escala = await buscarEscala(db, id);
	if (!escala) return notFound('Escala');

	if (escala.tipo === 'fds') {
		return badRequest('Escalas de FDS não requerem assinatura');
	}

	// admin_unidade só pode solicitar para sua própria unidade
	if (u.tipo !== 'admin' && u.papel === 'admin_unidade' && u.lotacao !== escala.lotacao) {
		return forbidden('Sem permissão para esta escala');
	}

	// Valida destinatário para respondência: deve ser DPC com papel administrativo
	if (tipo === 'respondencia' && destinatario_id) {
		const dest = await buscarPolicial(db, destinatario_id);
		if (!dest || dest.cargo !== 'DPC' || !dest.papel) {
			return badRequest(
				'Destinatário inválido: deve ser um delegado (DPC) com papel de administrador'
			);
		}
	}

	await criarSolicitacaoAssinatura(db, id, u.id, tipo, destinatario_id);
	return json({ success: true });
};

export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const id = Number(params.id);
	if (isNaN(id)) return badRequest('ID inválido');

	const db = getDB(platform);
	const escala = await buscarEscala(db, id);
	if (!escala) return notFound('Escala');

	if (u.tipo !== 'admin') {
		const sol = await buscarSolicitacaoAssinatura(db, id);
		if (!sol) return notFound('Solicitação');

		const podeCancel =
			sol.solicitante_id === u.id ||
			(u.papel === 'admin_unidade' && u.lotacao === escala.lotacao) ||
			u.papel === 'admin_seccional';

		if (!podeCancel) return forbidden('Sem permissão para cancelar');
	}

	await excluirSolicitacaoAssinatura(db, id);
	return json({ success: true });
};
