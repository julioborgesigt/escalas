import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	requireAuth,
	badRequest,
	notFound,
	forbidden,
	conflict,
	serverError,
	validateBody
} from '$lib/server/api';
import {
	getDB,
	getR2,
	hasR2,
	buscarEscala,
	buscarDocumentoEscala,
	salvarDocumentoEscala,
	registrarAuditComContexto
} from '$lib/db';
import { finalizarAssinaturaEscalasSchema } from '$lib/schemas';
import { finalizarQualificadaDoPayload } from '$lib/server/assinatura/signature-service';
import { verificarPermissaoEscala, podeAssinarEscala } from '$lib/server/escalas/permissao';
import { limparR2ObsoletoEscala } from '$lib/server/r2-cleanup';
import { chaveConferencia } from '$lib/server/assinatura/copia-conferencia';
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

	const id = parseInt(params.id!);
	if (isNaN(id)) return badRequest('ID inválido');

	const db = getDB(platform);
	const escala = await buscarEscala(db, id);
	if (!escala) return notFound('Escala');

	// Leitura + quem pode assinar (FLW-AUT-001); documento existente bloqueia (FLW-AUT-004).
	const perm = await verificarPermissaoEscala(db, id, escala.lotacao, u);
	if (!perm.permitido) return forbidden(perm.motivo ?? 'Sem permissão para assinar esta escala');
	if (!podeAssinarEscala(u)) {
		return forbidden('Apenas Admin Geral ou DPC com papel administrativo pode assinar esta escala');
	}
	if (escala.tipo === 'fds') {
		return badRequest('Escala de fim de semana não admite assinatura digital — use o fluxo por e-mail');
	}
	const docExistente = await buscarDocumentoEscala(db, id);
	if (docExistente) {
		return conflict('Revogue a assinatura existente antes de finalizar nova assinatura');
	}

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
		// R2-4: se esta escala já tinha um documento assinado (re-assinatura), o
		// onConflict de salvarDocumentoEscala sobrescreve a linha. Capturamos o
		// documento anterior ANTES de gravar para apagar seus objetos R2 obsoletos.
		const docAntigo = await buscarDocumentoEscala(db, id);
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
			arquivoHash,
			assinanteEmail ?? undefined,
			result.tipoCarimboTempo,
			result.metadata,
			platform?.env
		);

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
