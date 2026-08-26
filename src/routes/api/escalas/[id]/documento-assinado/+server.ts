/**
 * GET    /api/escalas/[id]/documento-assinado  → PDF (manifesto ou conferência)
 * DELETE /api/escalas/[id]/documento-assinado  → revogar assinatura
 *
 * Permissão e lookup ficam aqui; o pipeline de bytes é `responderPdfAssinado`.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getDB,
	getR2,
	hasR2,
	buscarDocumentoEscala,
	excluirDocumentoEscala,
	buscarEscala,
	listarPoliciaisEscala
} from '$lib/db';
import { registrarAuditComContexto } from '$lib/db';
import { requireAuth, badRequest, notFound, forbidden } from '$lib/server/api';
import { verificarPermissaoEscala, podeAssinarEscala } from '$lib/server/escalas/permissao';
import {
	podeBaixarComManifesto,
	responderPdfAssinado
} from '$lib/server/assinatura/copia-conferencia';
import { gerarRascunhoEscalaPdf } from '$lib/server/assinatura/conferencia-pdf';
import { limparR2DocumentoEscala } from '$lib/server/r2-cleanup';

export const GET: RequestHandler = async ({ platform, params, locals, url }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const id = parseInt(params.id!);
	if (isNaN(id)) return badRequest('ID inválido');

	const db = getDB(platform);
	const escala = await buscarEscala(db, id);
	if (!escala) return notFound('Escala');

	// Confidencialidade entre lotações: só admin, mesma lotação, ou DPC admin
	// com solicitação direcionada pode baixar o PDF assinado. Sem esta checagem,
	// qualquer usuário autenticado conseguiria PDF de escala de outra unidade
	// apenas trocando o [id] na URL — vazamento de PII e quebra do LGPD.
	const perm = await verificarPermissaoEscala(db, id, escala.lotacao, u);
	if (!perm.permitido) return forbidden(perm.motivo ?? 'Sem permissão para acessar esta escala.');

	const documento = await buscarDocumentoEscala(db, id);
	if (!documento) return notFound('Documento assinado');

	const querManifesto = url.searchParams.get('manifesto') === 'true';
	return responderPdfAssinado({
		platform,
		r2Key: documento.r2_key,
		verificacaoHash: documento.verificacao_hash ?? null,
		assinanteNome: documento.assinante_nome,
		querManifesto,
		podeManifesto: podeBaixarComManifesto(u),
		nomeManifesto: `escala_${id}_assinada_manifesto.pdf`,
		nomeConferencia: `conferencia_escala_${id}.pdf`,
		logContexto: 'escalas/documento-assinado',
		origin: url.origin,
		gerarRascunho: async () => {
			const policiais = await listarPoliciaisEscala(db, id);
			return gerarRascunhoEscalaPdf(escala, policiais, platform);
		}
	});
};

export const DELETE: RequestHandler = async ({ platform, params, locals }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const id = parseInt(params.id!);
	if (isNaN(id)) return badRequest('ID inválido');

	const db = getDB(platform);
	const escala = await buscarEscala(db, id);
	if (!escala) return notFound('Escala');

	// Somente quem pode assinar pode revogar (FLW-AUT-001). Mensagem genérica.
	const perm = await verificarPermissaoEscala(db, id, escala.lotacao, u);
	if (!perm.permitido || !podeAssinarEscala(u)) {
		return forbidden('Sem permissão para esta ação.');
	}
	const documento = await buscarDocumentoEscala(db, id);
	if (!documento) return notFound('Assinatura');

	// Deletar do R2 (blob assinado + cópia de conferência + selfie biométrica).
	// R2-3: a selfie (`selfie_key`) antes não era apagada na revogação.
	if (hasR2(platform)) {
		await limparR2DocumentoEscala(db, getR2(platform), id);
	}

	// Deletar do banco
	await excluirDocumentoEscala(db, id);

	await registrarAuditComContexto(db, {
		usuario: u,
		acao: 'revogar_assinatura',
		entidade: 'escala',
		entidade_id: id,
		detalhes: `Assinatura da escala ${id} revogada.`
	});

	return json({ success: true, message: 'Assinatura digital revogada com sucesso' });
};
