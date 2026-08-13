/**
 * GET    /api/gise/[id]/documento-assinado  → baixar PDF assinado do R2
 * DELETE /api/gise/[id]/documento-assinado  → revogar assinatura
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getDB,
	getR2,
	hasR2,
	buscarGiseDocumento,
	buscarGiseEscala,
	buscarGiseDetalhado,
	reabrirGiseEscala,
	auditar,
	contextoDeEvento
} from '$lib/db';
import { requireAuth, requireAdmin, badRequest, notFound, forbidden } from '$lib/server/api';
import { verificarPermissaoGise } from '$lib/server/gise/permissao';
import {
	podeBaixarComManifesto,
	responderPdfAssinado
} from '$lib/server/assinatura/copia-conferencia';
import { gerarRascunhoGisePdf } from '$lib/server/assinatura/conferencia-pdf';
import { limparR2DaGise } from '$lib/server/r2-cleanup';

export const GET: RequestHandler = async ({ platform, params, locals, url }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const id = parseInt(params.id!);
	if (isNaN(id)) return badRequest('ID inválido');

	const db = getDB(platform);

	const gise = await buscarGiseEscala(db, id);
	if (!gise) return notFound('Escala GISE');

	const perm = await verificarPermissaoGise(db, gise, u);
	if (!perm.permitido) return forbidden(perm.motivo ?? 'Sem permissão para acessar esta GISE.');

	const documento = await buscarGiseDocumento(db, id);
	if (!documento) return notFound('Documento assinado');

	const querManifesto = url.searchParams.get('manifesto') === 'true';
	return responderPdfAssinado({
		platform,
		r2Key: documento.r2_key,
		verificacaoHash: documento.verificacao_hash ?? null,
		assinanteNome: documento.assinante_nome,
		querManifesto,
		podeManifesto: podeBaixarComManifesto(u, documento.assinante_id),
		nomeManifesto: `gise_${id}_assinada_manifesto.pdf`,
		nomeConferencia: `conferencia_gise_${id}.pdf`,
		logContexto: 'gise/documento-assinado',
		origin: url.origin,
		gerarRascunho: async () => {
			const giseDetalhado = await buscarGiseDetalhado(db, id);
			if (!giseDetalhado) return notFound('Escala GISE');
			return gerarRascunhoGisePdf(db, giseDetalhado, platform);
		}
	});
};

export const DELETE: RequestHandler = async (event) => {
	const { platform, params, locals } = event;
	const u = requireAdmin(locals);
	if (u instanceof Response) return u;

	const id = parseInt(params.id!);
	if (isNaN(id)) return badRequest('ID inválido');

	const db = getDB(platform);
	const documento = await buscarGiseDocumento(db, id);
	if (!documento) return notFound('Assinatura');

	// Deletar do R2 TODOS os objetos da GISE (blobs + conferências + selfies de
	// presença) ANTES de reabrir. R2-2/R2-3: reabrirGiseEscala apaga as linhas de
	// documentos/presenças/relatórios — se limpássemos só o blob deste documento,
	// selfies biométricas e cópias de conferência ficariam órfãs e irrastreáveis.
	if (hasR2(platform)) {
		const gise = await buscarGiseEscala(db, id);
		if (gise) await limparR2DaGise(db, getR2(platform), gise);
	}

	// Reabrir escala (deleta documento, reseta seccionais, volta status)
	await reabrirGiseEscala(db, id);

	const { contexto, env } = contextoDeEvento(event);
	await auditar(
		db,
		{
			acao: 'revogar_assinatura',
			usuario: u,
			entidade: 'gise',
			entidade_id: id,
			alvo_tipo: 'gise',
			alvo_id: id,
			detalhes: `Assinatura da GISE ${id} revogada (assinante: ${documento.assinante_nome})`,
			metadados: { verificacao_hash: documento.verificacao_hash },
			...contexto
		},
		{ env }
	);

	return json({ success: true, message: 'Assinatura digital revogada com sucesso' });
};
