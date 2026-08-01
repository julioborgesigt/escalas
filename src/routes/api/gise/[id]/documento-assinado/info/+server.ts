/**
 * GET /api/gise/[id]/documento-assinado/info
 *
 * Retorna informações sobre o documento assinado da GISE (se existe, quem assinou, etc.)
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, buscarGiseEscala } from '$lib/db';
import * as schema from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import { requireAuth, badRequest, notFound, forbidden } from '$lib/server/api';
import { verificarPermissaoGise } from '$lib/server/gise/gise-permissao';
import { podeBaixarForense } from '$lib/server/assinatura/copia-conferencia';
import { mascararCPF } from '$lib/utils';
import { decifrarCpfDoDB } from '$lib/crypto/cpf-cripto';

export const GET: RequestHandler = async ({ params, locals, platform }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const id = parseInt(params.id!);
	if (isNaN(id)) return badRequest('ID inválido');

	const db = getDB(platform);

	// Antes da P0.3, qualquer usuário autenticado conseguia descobrir se uma
	// GISE foi assinada + nome/CPF do assinante + hash de validação trocando
	// o [id] — vazamento de PII e enumeração. Aplica a mesma permissão de
	// download.
	const gise = await buscarGiseEscala(db, id);
	if (!gise) return notFound('Escala GISE');

	const perm = await verificarPermissaoGise(db, gise, u);
	if (!perm.permitido) return forbidden(perm.motivo ?? 'Sem permissão para acessar esta GISE.');

	const doc = await db
		.select()
		.from(schema.giseDocumentos)
		.where(eq(schema.giseDocumentos.gise_id, id))
		.get();

	if (!doc) {
		return json({ existe: false });
	}

	// A2/LGPD: CPF completo do assinante só para o Super Admin; os demais (mesmo
	// com permissão na GISE) recebem o CPF mascarado, como na página /validar.
	// CPF cifrado em repouso (LGPD) — decifra antes de exibir/mascarar.
	const cpf = await decifrarCpfDoDB(doc.assinante_cpf, platform?.env);
	const cpfExibido = podeBaixarForense(u) ? cpf : mascararCPF(cpf);

	return json({
		existe: true,
		assinante_nome: doc.assinante_nome,
		assinante_cpf: cpfExibido,
		data: doc.created_at,
		verificacao_hash: doc.verificacao_hash
	});
};
