/**
 * POST /api/gise/[id]/assinar
 *
 * Supervisor assina digitalmente a escala GISE.
 * Só pode assinar se:
 *   - A escala está em status 'aguardando_assinatura'
 *   - O usuário é DPC designado como supervisor_sabado ou supervisor_domingo desta GISE
 *
 * Após a assinatura: status → 'assinada', escala liberada para download.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, buscarGiseEscala, atualizarGiseEscala, salvarGiseDocumento } from '$lib/db';
import { giseDocumentos } from '$lib/server/schema';
import { eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ locals, params, platform }) => {
	const u = locals.usuario;
	if (!u || u.tipo !== 'policial') {
		return json({ error: 'Não autorizado' }, { status: 401 });
	}

	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const gise = await buscarGiseEscala(db, id);
	if (!gise) return json({ error: 'Escala GISE não encontrada' }, { status: 404 });

	if (gise.status !== 'aguardando_assinatura') {
		return json({
			error: 'A escala não está concluída ou já foi assinada'
		}, { status: 400 });
	}

	// Verificar se o usuário é o supervisor designado
	const isSupervisor =
		gise.supervisor_sabado_id === u.id || gise.supervisor_domingo_id === u.id;
	if (!isSupervisor) {
		return json({ error: 'Apenas o Supervisor designado pode assinar esta escala' }, { status: 403 });
	}

	// Verificar cargo DPC
	if (u.cargo !== 'DPC') {
		return json({ error: 'Somente DPC pode assinar como Supervisor' }, { status: 403 });
	}

	// Gerar hash de verificação
	const hashInput = `gise-${id}-${u.id}-${Date.now()}`;
	const encoder = new TextEncoder();
	const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(hashInput));
	const hashHex = Array.from(new Uint8Array(hashBuffer))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');

	// Por ora, registrar assinatura sem PDF no R2 (r2_key vazio)
	// A geração do PDF pode ser implementada futuramente integrando o pipeline existente
	await salvarGiseDocumento(db, id, `gise/${id}/assinatura`, u.id, u.nome, hashHex);

	// Atualizar status para assinada
	await atualizarGiseEscala(db, id, { status: 'assinada' });

	return json({ ok: true, verificacao_hash: hashHex });
};
