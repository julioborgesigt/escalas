/**
 * POST /api/gise/[id]/relatorios/[seccionalId]/finalizar-assinatura
 *
 * Finaliza a assinatura digital (PKCS#7) no PDF do Relatório Extraordinário (GISE).
 * Retorna o PDF assinado como bytes binários.
 */

import type { RequestHandler } from './$types';
import { bytesToHex } from '$lib/crypto/hex';
import {
	getDB,
	salvarAssinaturaRelatorioGise,
	buscarGiseEscala,
	tentarPromoverGiseProntaParaFinalizar,
	auditar,
	contextoDeEvento
} from '$lib/db';
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

export const POST: RequestHandler = async (event) => {
	const { platform, params, locals, request, getClientAddress } = event;
	const p = platform as App.Platform | undefined;
	const db = getDB(p);
	const u = requireAuth(locals);
	if (u instanceof Response) return u;
	if (u.tipo !== 'policial' && u.tipo !== 'admin') {
		return forbidden('Somente policiais supervisores ou administradores podem assinar');
	}

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const id = parseInt(params.id!);
	const secIdNum = parseInt(params.seccionalId!);

	if (isNaN(id) || isNaN(secIdNum)) return badRequest('Parâmetros inválidos');

	// Permissão de negócio: admin geral ou supervisor designado.
	const giseAuth = await buscarGiseEscala(db, id);
	if (!giseAuth) return notFound('GISE');
	if (u.tipo !== 'admin' && giseAuth.supervisor_id !== u.id) {
		return forbidden(
			'Apenas o supervisor designado ou administradores podem assinar este relatório'
		);
	}

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
		rubrica,
		assinanteEmail
	} = validated.data;

	try {
		// Delega ao serviço unificado.
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

		const type = 'serpro' as const;

		// Hash do PDF assinado (para controle no banco).
		const hashBuffer = await crypto.subtle.digest('SHA-256', result.pdfFinal.slice());
		const arquivo_hash = bytesToHex(new Uint8Array(hashBuffer));

		const gise = giseAuth;
		const [yyyy, mm, dd_escala] = gise.data_inicio.split('-');
		const mesAno = `${yyyy}-${mm}`;
		const folder = `gise/${mesAno}/${dd_escala}/${id}/relatorios_extra`;

		const r2Key = `${folder}/gise_rel_${id}_sec_${secIdNum}_${verificationHash}_assinada.pdf`;
		const filename = `relatorio_extraordinario_gise_${id}_sec_${secIdNum}.pdf`;

		const r2 = getR2(p);
		if (r2) {
			await r2.put(r2Key, result.pdfFinal, { contentType: 'application/pdf' });
		}

		await salvarAssinaturaRelatorioGise(
			db,
			{
				gise_id: id,
				seccional_id: secIdNum,
				tipo: 'extraordinario',
				assinante_id: u.tipo === 'policial' ? u.id : null,
				assinante_nome: result.signerName,
				assinante_cpf: result.signerCpf || null,
				tipo_assinatura: type,
				rubrica: rubrica,
				verification_hash: verificationHash,
				ip_address: ip,
				user_agent: ua,
				latitude,
				longitude,
				selfie_key: undefined,
				r2_key: r2Key,
				// arquivo_hash = hash do PDF FINAL assinado (o que a /validar reconfere);
				// não usamos o documentHash enviado pelo cliente (A4).
				arquivo_hash,
				assinante_email: assinanteEmail ?? u.email,
				tipo_carimbo_tempo: result.tipoCarimboTempo,
				cert_issuer: result.metadata.cert_issuer,
				cert_serial: result.metadata.cert_serial,
				cert_valido_de: result.metadata.cert_valido_de,
				cert_valido_ate: result.metadata.cert_valido_ate,
				cms_sha256: result.metadata.cms_sha256,
				ocsp_response_b64: result.metadata.ocsp_response_b64,
				ocsp_consultado_em: result.metadata.ocsp_consultado_em,
				tst_token_b64: result.metadata.tst_token_b64
			},
			platform?.env
		);

		await tentarPromoverGiseProntaParaFinalizar(db, id);

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'assinar_relatorio_gise',
				usuario: u,
				entidade: 'gise',
				entidade_id: id,
				alvo_tipo: 'seccional',
				alvo_id: secIdNum,
				detalhes: `Relatório extraordinário da GISE ${id} assinado com certificado digital (qualificada, seccional ${secIdNum})`,
				metadados: {
					tipo_assinatura: 'qualificada',
					verification_hash: verificationHash,
					arquivo_hash,
					tipo_carimbo_tempo: result.tipoCarimboTempo
				},
				...contexto
			},
			{ env }
		);

		return new Response(result.pdfFinal as unknown as BodyInit, {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': contentDisposition(filename)
			}
		});
	} catch (err) {
		return serverError(
			`[gise/relatorios/finalizar-assinatura] Falha (gise_id=${id}, seccional_id=${secIdNum})`,
			err
		);
	}
};
