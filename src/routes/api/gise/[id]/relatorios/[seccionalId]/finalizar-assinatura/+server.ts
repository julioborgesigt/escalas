/**
 * POST /api/gise/[id]/relatorios/[seccionalId]/finalizar-assinatura
 *
 * Finaliza a assinatura digital (PKCS#7) no PDF do Relatório Extraordinário (GISE).
 * Retorna o PDF assinado como bytes binários.
 */

import type { RequestHandler } from './$types';
import {
	getDB,
	salvarAssinaturaRelatorioGise,
	buscarGiseEscala,
	tentarPromoverGiseProntaParaFinalizar,
	auditar,
	contextoDeEvento
} from '$lib/db';
import { finalizarAssinaturaGiseSchema } from '$lib/schemas';
import {
	finalizarQualificadaDoPayload,
	respostaPdfAssinado
} from '$lib/server/assinatura/signature-service';
import { tryGetR2 } from '$lib/db';
import {
	bucketParaAssinatura,
	guardarPdfAssinado,
	recusarPorDocumentoJaGravado
} from '$lib/server/assinatura/blob-assinado';
import {
	requireAuth,
	badRequest,
	notFound,
	forbidden,
	serverError,
	validateBody
} from '$lib/server/api';
import {
	consumirIntencaoAssinatura,
	mensagemRecusaIntencao
} from '$lib/server/assinatura/intencao';

export const POST: RequestHandler = async (event) => {
	const { platform, params, locals, request, getClientAddress } = event;
	const p = platform as App.Platform | undefined;
	const db = getDB(p);
	const u = requireAuth(locals);
	if (u instanceof Response) return u;
	if (u.tipo !== 'policial') {
		return forbidden('Apenas o supervisor designado pode assinar este relatório.');
	}

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const id = parseInt(params.id!);
	const secIdNum = parseInt(params.seccionalId!);

	if (isNaN(id) || isNaN(secIdNum)) return badRequest('Parâmetros inválidos');

	// Permissão de negócio: admin geral ou supervisor designado.
	const giseAuth = await buscarGiseEscala(db, id);
	if (!giseAuth) return notFound('GISE');
	if (giseAuth.supervisor_id !== u.id) {
		return forbidden('Apenas o supervisor designado pode assinar este relatório');
	}

	const validated = await validateBody(request, finalizarAssinaturaGiseSchema);
	if (!validated.ok) return validated.response;
	const {
		intencao,
		preparedPdf,
		serproCms,
		messageDigest,
		signingTimeISO,
		latitude,
		longitude,
		rubrica,
		assinanteEmail
	} = validated.data;

	// Consome a preparação: prova que ESTE pdf foi preparado por ESTE usuário
	// para ESTE alvo, uma vez só (FLW-DOC-001). O código público de validação
	// vem daqui, não do corpo da requisição.
	// ANTES de consumir o token: sem onde guardar o PDF, a assinatura é
	// recusada em vez de virar linha apontando para o vazio (FLW-R2-003).
	const bucketOk = bucketParaAssinatura(tryGetR2(p));
	if (!bucketOk.ok) return bucketOk.resposta;
	const bucket = bucketOk.r2;

	const consumo = await consumirIntencaoAssinatura(
		db,
		intencao,
		{ recurso: 'gise_relatorio', recursoId: id, escopoId: secIdNum },
		{ id: u.id, tipo: u.tipo },
		Uint8Array.from(Buffer.from(preparedPdf, 'base64'))
	);
	if (!consumo.ok) return badRequest(mensagemRecusaIntencao());
	const { verificacaoHash: verificationHash } = consumo;

	try {
		// Delega ao serviço unificado (inclui o hash do PDF assinado).
		const result = await finalizarQualificadaDoPayload(
			u,
			{ preparedPdf, serproCms, messageDigestHex: messageDigest, signingTimeISO },
			{ platform: p }
		);
		if (!result.ok) return result.response;
		const { arquivoHash: arquivo_hash } = result;

		const type = 'serpro' as const;

		const gise = giseAuth;
		const [yyyy, mm, dd_escala] = gise.data_inicio.split('-');
		const mesAno = `${yyyy}-${mm}`;
		const folder = `gise/${mesAno}/${dd_escala}/${id}/relatorios_extra`;

		const r2Key = `${folder}/gise_rel_${id}_sec_${secIdNum}_${verificationHash}_assinada.pdf`;
		const filename = `relatorio_extraordinario_gise_${id}_sec_${secIdNum}.pdf`;

		const guardado = await guardarPdfAssinado(bucket, r2Key, result.pdfFinal, 'gise-relatorio');
		if (!guardado.ok) return guardado.resposta;

		const { gravado } = await salvarAssinaturaRelatorioGise(
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
		if (!gravado) {
			return recusarPorDocumentoJaGravado(db, bucket, [r2Key], 'gise-relatorio');
		}

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

		return respostaPdfAssinado(result.pdfFinal, filename);
	} catch (err) {
		return serverError(
			`[gise/relatorios/finalizar-assinatura] Falha (gise_id=${id}, seccional_id=${secIdNum})`,
			err
		);
	}
};
