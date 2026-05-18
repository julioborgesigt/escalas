/**
 * POST /api/gise/[id]/finalizar-assinatura
 *
 * Finaliza a assinatura digital (PKCS#7) no PDF da GISE.
 * Salva o documento no R2 e registra no banco de dados.
 */

import type { RequestHandler } from './$types';
import { getDB, buscarGiseEscala, salvarGiseDocumento, atualizarGiseEscala } from '$lib/db';
import { finalizarAssinaturaGiseSchema } from '$lib/schemas';
import { finalizarAssinaturaQualificada } from '$lib/server/signature-service';
import { getR2 } from '$lib/server/platform';
import {
	apiError,
	ErrorCode,
	contentDisposition,
	requireAuth,
	badRequest,
	notFound,
	forbidden,
	serverError,
	validateBody
} from '$lib/server/api';

export const POST: RequestHandler = async ({ platform, params, locals, request, getClientAddress }) => {
	const p = platform as App.Platform | undefined;
	const db = getDB(p);
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const id = parseInt(params.id!);
	if (isNaN(id)) return badRequest('ID inválido');

	const validated = await validateBody(request, finalizarAssinaturaGiseSchema);
	if (!validated.ok) return validated.response;
	const {
		preparedPdf,
		rawSignature,
		serproCms,
		certificateBase64,
		messageDigest,
		signingTimeISO,
		verificationHash,
		latitude,
		longitude,
		documentHash: documentHashOriginal,
		assinanteEmail
	} = validated.data;

	try {
		const gise = await buscarGiseEscala(db, id);
		if (!gise) return notFound('GISE');

		// Permissão de negócio: apenas supervisor designado ou admin.
		if (u.tipo !== 'admin' && gise.supervisor_id !== u.id) {
			return forbidden('Apenas o supervisor designado ou administradores podem finalizar esta escala');
		}

		// Delega ao serviço unificado: validação CPF token vs CPF logado
		// (sem bypass), embed do CMS, verificação CAdES-LT, OCSP e PAdES-LT.
		const result = await finalizarAssinaturaQualificada(u, {
			preparedPdf: new Uint8Array(Buffer.from(preparedPdf, 'base64')),
			serproCms,
			rawSignature,
			certificateBase64,
			messageDigestHex: messageDigest,
			signingTimeISO
		});
		if (!('pdfFinal' in result)) {
			const code = result.status >= 500 ? ErrorCode.UPSTREAM : ErrorCode.VALIDATION;
			return apiError(result.error, result.status, code);
		}

		// Hash do PDF assinado (controle de integridade no banco — pode ser
		// recalculado a partir do r2_key, mas guardamos para auditoria forense).
		const hashBuffer = await crypto.subtle.digest('SHA-256', result.pdfFinal.slice());
		const documentHash = Array.from(new Uint8Array(hashBuffer))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');

		const [yyyy, mm, dd_escala] = gise.data_inicio.split('-');
		const mesAno = `${yyyy}-${mm}`;
		const folder = `gise/${mesAno}/${dd_escala}/${id}/escala`;

		const documentKey = `${folder}/gise_${id}_${verificationHash}_assinada.pdf`;
		const r2 = getR2(p);
		if (r2) {
			await r2.put(documentKey, result.pdfFinal, {
				contentType: 'application/pdf'
			});
		}

		await salvarGiseDocumento(
			db,
			id,
			documentKey,
			u.id,
			result.signerName,
			result.signerCpf,
			verificationHash,
			undefined,
			ip,
			ua,
			latitude,
			longitude,
			undefined, // selfieKey
			// Hash do PDF original (recebido do preparar-assinatura)
			documentHashOriginal || documentHash,
			assinanteEmail,
			result.tipoCarimboTempo,
			result.metadata
		);

		await atualizarGiseEscala(db, id, { status: 'em_andamento' });

		return new Response(result.pdfFinal as unknown as BodyInit, {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': contentDisposition(documentKey)
			}
		});
	} catch (err) {
		return serverError(`[gise/finalizar-assinatura] Falha (giseId=${id})`, err);
	}
};
