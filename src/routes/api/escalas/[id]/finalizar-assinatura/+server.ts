/**
 * POST /api/escalas/[id]/finalizar-assinatura
 *
 * Consome a intenção (FLW-DOC-001), embute o CMS no PDF preparado e grava o
 * documento assinado. Permissão de leitura + `podeAssinarEscala`.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAuth, badRequest, serverError, validateBody } from '$lib/server/api';
import {
	getDB,
	getR2,
	hasR2,
	buscarDocumentoEscala,
	salvarDocumentoEscala,
	registrarAuditComContexto
} from '$lib/db';
import { finalizarAssinaturaEscalasSchema } from '$lib/schemas';
import { finalizarQualificadaDoPayload } from '$lib/server/assinatura/signature-service';
import { carregarEscalaParaAssinatura } from '$lib/server/escalas/permissao';
import { limparR2ObsoletoEscala } from '$lib/server/r2-cleanup';
import { chaveConferencia } from '$lib/server/assinatura/copia-conferencia';
import { recusarPorDocumentoJaGravado } from '$lib/server/assinatura/blob-assinado';
import {
	consumirIntencaoAssinatura,
	mensagemRecusaIntencao
} from '$lib/server/assinatura/intencao';

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
		intencao,
		preparedPdf,
		serproCms,
		signingTimeISO,
		messageDigestHex,
		assinanteEmail,
		latitude,
		longitude
	} = validated.data;

	const db = getDB(platform);
	const portao = await carregarEscalaParaAssinatura(
		db,
		params.id,
		u,
		'Revogue a assinatura existente antes de finalizar nova assinatura'
	);
	if (portao.recusa) return portao.recusa;
	const { id } = portao;

	// Consome a preparação: prova que ESTE pdf foi preparado por ESTE usuário
	// para ESTA escala, uma vez só (FLW-DOC-001). O `verificationHash` vem
	// daqui, não do corpo — era o cliente que escolhia a chave R2 e o código
	// público do /validar.
	const consumo = await consumirIntencaoAssinatura(
		db,
		intencao,
		{ recurso: 'escala', recursoId: id },
		{ id: u.id, tipo: u.tipo },
		Uint8Array.from(Buffer.from(preparedPdf, 'base64'))
	);
	if (!consumo.ok) return badRequest(mensagemRecusaIntencao());
	const { verificacaoHash: verificationHash } = consumo;

	try {
		// Delega TODO o fluxo criptográfico ao serviço unificado: validação de
		// propriedade do token (CPF do cert vs CPF logado, sem bypass para
		// admin), embed do CMS, verificação CAdES-LT, OCSP, PAdES-LT e hash
		// do PDF final.
		const result = await finalizarQualificadaDoPayload(
			u,
			{ preparedPdf, serproCms, messageDigestHex, signingTimeISO },
			{ platform }
		);
		if (!result.ok) return result.response;
		const { arquivoHash } = result;

		if (!hasR2(platform)) {
			return serverError(
				'[finalizar-assinatura] R2 não configurado',
				new Error('R2_NOT_CONFIGURED')
			);
		}

		const bucket = getR2(platform);
		// SEC-32: INSERT fail-closed. Se já houver documento, o unique recusa
		// e o blob novo é compensado. `docAntigo` só serve ao caminho
		// revogar-e-assinar, quando a linha antiga ainda está em memória.
		const docAntigo = await buscarDocumentoEscala(db, id);
		const r2Key = `escalas/${new Date().getFullYear()}/${id}_${verificationHash}.pdf`;
		await bucket.put(r2Key, result.pdfFinal, {
			httpMetadata: { contentType: 'application/pdf' }
		});

		const { gravado } = await salvarDocumentoEscala(db, {
			escalaId: id,
			r2Key,
			assinanteNome: result.signerName,
			assinanteCpf: result.signerCpf,
			verificacaoHash: verificationHash,
			ipAddress: ip ?? undefined,
			userAgent: ua || undefined,
			latitude: latitude ?? undefined,
			longitude: longitude ?? undefined,
			arquivoHash,
			assinanteEmail: assinanteEmail ?? undefined,
			tipoCarimboTempo: result.tipoCarimboTempo,
			cadesMeta: result.metadata,
			env: platform?.env
		});
		if (!gravado) {
			return recusarPorDocumentoJaGravado(
				db,
				bucket,
				[r2Key, chaveConferencia(verificationHash)],
				'escala-qualificada'
			);
		}

		// R2-4: remove os objetos do documento anterior que a re-assinatura tornou
		// obsoletos (blob/conferência/selfie de hash antigo). No-op se era 1ª assinatura.
		await limparR2ObsoletoEscala(db, bucket, docAntigo, [
			r2Key,
			chaveConferencia(verificationHash)
		]);

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
