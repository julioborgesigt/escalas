/**
 * POST /api/gise/[id]/finalizar-assinatura
 *
 * Finaliza a assinatura digital (PKCS#7) no PDF da GISE.
 * Salva o documento no R2 e registra no banco de dados.
 */

import type { RequestHandler } from './$types';
import { bytesToHex } from '$lib/crypto/hex';
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

export const POST: RequestHandler = async ({
	platform,
	params,
	locals,
	request,
	getClientAddress
}) => {
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
		serproCms,
		messageDigest,
		signingTimeISO,
		verificationHash,
		latitude,
		longitude,
		assinanteEmail
	} = validated.data;

	try {
		const gise = await buscarGiseEscala(db, id);
		if (!gise) return notFound('GISE');

		// Permissão de negócio: apenas supervisor designado ou admin.
		if (u.tipo !== 'admin' && gise.supervisor_id !== u.id) {
			return forbidden(
				'Apenas o supervisor designado ou administradores podem finalizar esta escala'
			);
		}

		// Delega ao serviço unificado: validação CPF token vs CPF logado
		// (sem bypass), embed do CMS, verificação CAdES-LT, OCSP e PAdES-LT.
		const result = await finalizarAssinaturaQualificada(
			u,
			{
				preparedPdf: new Uint8Array(Buffer.from(preparedPdf, 'base64')),
				serproCms,
				messageDigestHex: messageDigest,
				signingTimeISO
			},
			{ platform: p }
		);
		if (!('pdfFinal' in result)) {
			const code = result.status >= 500 ? ErrorCode.UPSTREAM : ErrorCode.VALIDATION;
			return apiError(result.error, result.status, code);
		}

		// arquivo_hash = hash do PDF FINAL assinado (o que vai pro R2 e que a
		// página /validar reconfere). Recalculado no servidor — não usamos o
		// `documentHash` enviado pelo cliente (A4), que é o hash do PDF ORIGINAL
		// e não bateria com o blob assinado.
		const hashBuffer = await crypto.subtle.digest('SHA-256', result.pdfFinal.slice());
		const arquivoHash = bytesToHex(new Uint8Array(hashBuffer));

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
			arquivoHash,
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
