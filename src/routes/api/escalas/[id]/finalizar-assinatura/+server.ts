import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	apiError,
	ErrorCode,
	requireAuth,
	badRequest,
	notFound,
	forbidden,
	serverError,
	validateBody
} from '$lib/server/api';
import {
	getDB,
	getR2,
	hasR2,
	buscarEscala,
	salvarDocumentoEscala,
	registrarAuditComContexto
} from '$lib/db';
import { finalizarAssinaturaEscalasSchema } from '$lib/schemas';
import { finalizarAssinaturaQualificada } from '$lib/server/signature-service';
import { verificarPermissaoEscala } from '$lib/server/escala-permissao';

export const POST: RequestHandler = async ({
	platform,
	params,
	locals,
	request,
	getClientAddress
}) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const validated = await validateBody(request, finalizarAssinaturaEscalasSchema);
	if (!validated.ok) return validated.response;
	const {
		preparedPdf,
		serproCms,
		verificationHash,
		signingTimeISO,
		messageDigestHex,
		documentHash,
		assinanteEmail,
		latitude,
		longitude
	} = validated.data;

	const id = parseInt(params.id!);
	if (isNaN(id)) return badRequest('ID inválido');

	const db = getDB(platform);
	const escala = await buscarEscala(db, id);
	if (!escala) return notFound('Escala');

	// Permissão de negócio: admin geral, dono da lotação ou DPC admin com solicitação direcionada.
	const perm = await verificarPermissaoEscala(db, id, escala.lotacao, u);
	if (!perm.permitido) return forbidden(perm.motivo ?? 'Sem permissão para assinar esta escala');

	try {
		// Delega TODO o fluxo criptográfico ao serviço unificado: validação de
		// propriedade do token (CPF do cert vs CPF logado, sem bypass para
		// admin), embed do CMS, verificação CAdES-LT, OCSP e PAdES-LT.
		const result = await finalizarAssinaturaQualificada(
			u,
			{
				preparedPdf: new Uint8Array(Buffer.from(preparedPdf, 'base64')),
				serproCms,
				messageDigestHex,
				signingTimeISO
			},
			{ platform }
		);
		if (!('pdfFinal' in result)) {
			const code = result.status >= 500 ? ErrorCode.UPSTREAM : ErrorCode.VALIDATION;
			return apiError(result.error, result.status, code);
		}

		if (!hasR2(platform)) {
			return serverError(
				'[finalizar-assinatura] R2 não configurado',
				new Error('R2_NOT_CONFIGURED')
			);
		}

		const bucket = getR2(platform);
		const r2Key = `escalas/${new Date().getFullYear()}/${id}_${verificationHash}.pdf`;
		await bucket.put(r2Key, result.pdfFinal, {
			httpMetadata: { contentType: 'application/pdf' }
		});

		await salvarDocumentoEscala(
			db,
			id,
			r2Key,
			result.signerName,
			result.signerCpf,
			verificationHash,
			ip ?? undefined,
			ua || undefined,
			latitude ?? undefined,
			longitude ?? undefined,
			undefined, // selfieKey
			documentHash ?? undefined,
			assinanteEmail ?? undefined,
			result.tipoCarimboTempo,
			result.metadata
		);

		await registrarAuditComContexto(db, {
			usuario: u,
			acao: 'assinar_escala',
			entidade: 'escala',
			entidade_id: id,
			detalhes: `Escala ${id} assinada por ${result.signerName} (${result.signerCpf})`
		});

		return json({ success: true, message: 'Escala assinada digitalmente com sucesso' });
	} catch (err) {
		return serverError(`[finalizar-assinatura] Falha (escala_id=${id})`, err);
	}
};
