import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getDB,
	buscarEscala,
	buscarPolicial,
	criarSolicitacaoAssinatura,
	buscarSolicitacaoAssinatura,
	excluirSolicitacaoAssinatura,
	auditar,
	contextoDeEvento
} from '$lib/db';
import { z } from 'zod';
import { requireAuth, badRequest, forbidden, notFound, validateBody } from '$lib/server/api';
import { lotacoesAdministradas, lotacaoNoEscopo } from '$lib/server/policial-permissao';

const solicitarSchema = z.object({
	tipo: z.enum(['unidade', 'respondencia']),
	destinatario_id: z.number().int().positive().optional()
});

function podeOIPSolicitar(u: App.Locals['usuario']) {
	if (!u) return false;
	if (u.tipo === 'admin') return true;
	return (u.papel === 'admin_seccional' || u.papel === 'admin_unidade') && u.cargo === 'OIP';
}

export const POST: RequestHandler = async (event) => {
	const { params, locals, platform, request } = event;
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

	// Admins de escopo (seccional/unidade) só solicitam para escalas DENTRO do seu
	// escopo administrativo. Antes só `admin_unidade` era verificado — `admin_seccional`
	// podia criar solicitação para qualquer unidade/seccional. Admin geral é irrestrito.
	if (u.tipo !== 'admin') {
		const escopo = await lotacoesAdministradas(db, u);
		if (!lotacaoNoEscopo(escopo, escala.lotacao)) {
			return forbidden('Sem permissão para esta escala');
		}
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

	const { contexto, env } = contextoDeEvento(event);
	await auditar(
		db,
		{
			acao: 'solicitar_assinatura_escala',
			usuario: u,
			entidade: 'escala',
			entidade_id: id,
			alvo_tipo: 'escala',
			alvo_id: id,
			detalhes: `Solicitação de assinatura (${tipo}) para a escala ${id}`,
			metadados: { tipo, destinatario_id: destinatario_id ?? null },
			...contexto
		},
		{ env }
	);
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

		// O próprio solicitante pode cancelar; admins de escopo só dentro do seu
		// escopo administrativo (antes `admin_seccional` cancelava qualquer escala).
		const escopo = await lotacoesAdministradas(db, u);
		const podeCancel = sol.solicitante_id === u.id || lotacaoNoEscopo(escopo, escala.lotacao);

		if (!podeCancel) return forbidden('Sem permissão para cancelar');
	}

	await excluirSolicitacaoAssinatura(db, id);
	return json({ success: true });
};
