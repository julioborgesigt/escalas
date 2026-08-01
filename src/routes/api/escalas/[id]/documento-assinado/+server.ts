import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getDB,
	getR2,
	hasR2,
	buscarDocumentoEscala,
	excluirDocumentoEscala,
	buscarEscala,
	listarPoliciaisEscala,
	buscarRubricaAssinante
} from '$lib/db';
import { registrarAuditComContexto } from '$lib/db';
import {
	contentDisposition,
	requireAuth,
	badRequest,
	notFound,
	forbidden,
	serverError
} from '$lib/server/api';
import { verificarPermissaoEscala } from '$lib/server/escalas/permissao';
import {
	podeBaixarComManifesto,
	gerarCopiaConferencia,
	chaveConferencia
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

	// Admin com ?manifesto=true: blob forense íntegro (com CPF/IP/GPS/selfie) do R2.
	if (querManifesto && podeBaixarComManifesto(u)) {
		if (!hasR2(platform)) {
			return serverError(
				'[escalas/documento-assinado] R2 não configurado',
				new Error('R2_NOT_CONFIGURED')
			);
		}
		const bucket = getR2(platform);
		const object = await bucket.get(documento.r2_key);
		if (!object) return notFound('Arquivo PDF no Storage');
		return new Response(object.body as unknown as BodyInit, {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': contentDisposition(`escala_${id}_assinada_manifesto.pdf`),
				'Cache-Control': 'private, no-store'
			}
		});
	}

	// Padrão: cópia de conferência (sem manifesto forense). Preferimos a cópia
	// IDÊNTICA já gravada no R2 no momento da assinatura (gerada dos mesmos bytes do
	// documento assinado). Só recorremos à regeneração legada quando ela não existe
	// (documentos assinados antes desta mudança, ou falha de escrita na preparação).
	if (hasR2(platform) && documento.verificacao_hash) {
		const confObj = await getR2(platform).get(chaveConferencia(documento.verificacao_hash));
		if (confObj) {
			return new Response(confObj.body as unknown as BodyInit, {
				headers: {
					'Content-Type': 'application/pdf',
					'Content-Disposition': contentDisposition(`conferencia_escala_${id}.pdf`),
					'Cache-Control': 'private, no-store'
				}
			});
		}
	}

	// Fallback legado: regenera a cópia de conferência a partir do rascunho. Desenha
	// a rubrica do signatário acima da linha, buscando-a pelo cadastro do assinante —
	// sem rubrica, o campo fica vazio como antes.
	const policiais = await listarPoliciaisEscala(db, id);
	const rubricaAss = await buscarRubricaAssinante(db, documento.assinante_cpf, platform?.env);
	const rascunho = await gerarRascunhoEscalaPdf(escala, policiais, platform, rubricaAss);
	const hash = documento.verificacao_hash ?? undefined;
	const buffer = await gerarCopiaConferencia({
		pdfRascunho: rascunho,
		assinanteNome: documento.assinante_nome,
		verificationHash: hash,
		verificationUrl: hash ? `${url.origin}/validar/${hash}` : undefined
	});
	return new Response(buffer as unknown as BodyInit, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': contentDisposition(`conferencia_escala_${id}.pdf`),
			'Cache-Control': 'private, no-store'
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

	// Somente admin, dono da lotação ou DPC admin com solicitação pode revogar.
	// Mensagem genérica para não vazar quem TEM permissão (anti-enumeração).
	const perm = await verificarPermissaoEscala(db, id, escala.lotacao, u);
	if (!perm.permitido) return forbidden('Sem permissão para esta ação.');

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
