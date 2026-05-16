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
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });
	if (!podeOIPSolicitar(u)) return json({ error: 'Sem permissão' }, { status: 403 });

	const id = Number(params.id);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Corpo inválido' }, { status: 400 });
	}

	const parsed = solicitarSchema.safeParse(body);
	if (!parsed.success) {
		return json({ error: parsed.error.issues[0].message }, { status: 400 });
	}

	const { tipo, destinatario_id } = parsed.data;

	if (tipo === 'respondencia' && !destinatario_id) {
		return json({ error: 'Informe o destinatário para assinatura em respondência' }, { status: 400 });
	}

	const db = getDB(platform);
	const escala = await buscarEscala(db, id);
	if (!escala) return json({ error: 'Escala não encontrada' }, { status: 404 });

	if (escala.tipo === 'fds') {
		return json({ error: 'Escalas de FDS não requerem assinatura' }, { status: 400 });
	}

	// admin_unidade só pode solicitar para sua própria unidade
	if (u.tipo !== 'admin' && u.papel === 'admin_unidade' && u.lotacao !== escala.lotacao) {
		return json({ error: 'Sem permissão para esta escala' }, { status: 403 });
	}

	// Valida destinatário para respondência: deve ser DPC com papel administrativo
	if (tipo === 'respondencia' && destinatario_id) {
		const dest = await buscarPolicial(db, destinatario_id);
		if (!dest || dest.cargo !== 'DPC' || !dest.papel) {
			return json(
				{ error: 'Destinatário inválido: deve ser um delegado (DPC) com papel de administrador' },
				{ status: 400 }
			);
		}
	}

	await criarSolicitacaoAssinatura(db, id, u.id, tipo, destinatario_id);
	return json({ success: true });
};

export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });

	const id = Number(params.id);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const escala = await buscarEscala(db, id);
	if (!escala) return json({ error: 'Escala não encontrada' }, { status: 404 });

	if (u.tipo !== 'admin') {
		const sol = await buscarSolicitacaoAssinatura(db, id);
		if (!sol) return json({ error: 'Nenhuma solicitação ativa' }, { status: 404 });

		const podeCancel =
			sol.solicitante_id === u.id ||
			(u.papel === 'admin_unidade' && u.lotacao === escala.lotacao) ||
			u.papel === 'admin_seccional';

		if (!podeCancel) return json({ error: 'Sem permissão para cancelar' }, { status: 403 });
	}

	await excluirSolicitacaoAssinatura(db, id);
	return json({ success: true });
};
