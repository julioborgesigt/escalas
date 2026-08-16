/**
 * FASE 1 da assinatura avançada por passkey da escala GISE.
 *
 * Espelho do `preparar-assinatura-avancada` da escala mensal: monta o PDF com
 * o manifesto já nomeando a chave, devolve o hash como desafio, não persiste
 * o documento. Selfie e cópia de conferência sobem aqui.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, buscarGiseEscala, buscarGiseDetalhado, tryGetR2 } from '$lib/db';
import {
	apiError,
	ErrorCode,
	badRequest,
	notFound,
	forbidden,
	serverError,
	requireAuth,
	validateBody
} from '$lib/server/api';
import { assinarSimplesSchema } from '$lib/schemas';
import { validarEvidenciasAvancada } from '$lib/server/assinatura/signature-service';
import { giseDetalhadoComMatriculaSupervisorSessao } from '$lib/server/export';
import { getBreveRelatorioEnvMergido } from '$lib/server/gise/breve-relatorio-env';
import { carregarLogosGise } from '$lib/server/gise/logos';
import { criarIntencaoAssinatura } from '$lib/server/assinatura/intencao';
import { descreverVinculoCredencial } from '$lib/server/assinatura/webauthn/authenticator-data';
import { credencialDoUsuario } from '$lib/server/auth/credencial';
import { exigirChaveAtiva } from '$lib/server/assinatura/chave-assinatura';
import { bucketParaAssinatura } from '$lib/server/assinatura/blob-assinado';
import { montarPdfGiseAssinado, subirSelfieGise } from '$lib/server/gise/assinatura-gise';
import { chaveConferencia } from '$lib/server/assinatura/copia-conferencia';
import { calcularHashBuffer } from '$lib/server/assinatura/document-utils';
import { bytesToBase64 } from '$lib/crypto/bin';
import { logger } from '$lib/server/logger';

export const POST: RequestHandler = async ({
	platform,
	params,
	locals,
	url,
	request,
	cookies,
	getClientAddress
}) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';
	const id = parseInt(params.id!);
	if (isNaN(id)) return badRequest('ID inválido');

	const db = getDB(platform);
	const gise = await buscarGiseEscala(db, id);
	if (!gise) return notFound('Escala GISE');
	if (gise.status !== 'aguardando_assinatura' && gise.status !== 'em_andamento') {
		return badRequest('A escala não está pronta para assinatura');
	}
	if (u.tipo !== 'admin' && gise.supervisor_id !== u.id) {
		return forbidden('Apenas o supervisor designado ou administradores podem assinar');
	}

	const chave = await exigirChaveAtiva(db, credencialDoUsuario(u), ua);
	if ('recusa' in chave) return chave.recusa;
	const credencial = chave.credencial;

	const validated = await validateBody(request, assinarSimplesSchema);
	if (!validated.ok) return validated.response;
	const {
		rubrica,
		latitude,
		longitude,
		selfieBase64,
		codigoValidação,
		desafioId,
		livenessChallenge,
		reauthId
	} = validated.data;

	const evid = await validarEvidenciasAvancada(
		db,
		u,
		{
			rubrica,
			latitude,
			longitude,
			selfieBase64,
			codigoValidação,
			desafioId,
			livenessChallenge,
			userAgent: ua,
			reauthId
		},
		{ platform, sessaoToken: cookies.get('session_token') }
	);
	if (!evid.ok) return apiError(evid.error, evid.status, evid.code ?? ErrorCode.VALIDATION);
	const validatedEv = evid.validated;

	try {
		const giseDetalhado = await buscarGiseDetalhado(db, id);
		if (!giseDetalhado) {
			return serverError(
				'[gise/preparar-assinatura-avancada] buscarGiseDetalhado retornou null',
				new Error('GISE_DETALHADO_NULL')
			);
		}

		const bucketOk = bucketParaAssinatura(tryGetR2(platform));
		if (!bucketOk.ok) return bucketOk.resposta;

		const { esq, dir } = await carregarLogosGise(platform);
		const env = platform?.env as unknown as Record<string, string | undefined> | undefined;
		const montado = await montarPdfGiseAssinado({
			gise: { id, data_inicio: gise.data_inicio },
			gisePdf: giseDetalhadoComMatriculaSupervisorSessao(giseDetalhado, u),
			brEnv: await getBreveRelatorioEnvMergido(db, giseDetalhado.operacao_id),
			logos: { esq, dir },
			assinante: { nome: u.nome, cpf: u.cpf, email: u.email },
			evidencias: {
				rubrica: validatedEv.rubrica,
				latitude: validatedEv.latitude,
				longitude: validatedEv.longitude,
				selfieBase64: validatedEv.selfieBase64,
				livenessChallenge: validatedEv.livenessChallenge,
				politicaDispositivoMovel: validatedEv.politicaDispositivoMovel,
				passkey: {
					credentialId: credencial.credentialId,
					vinculo: descreverVinculoCredencial(credencial)
				}
			},
			ip: ip ?? undefined,
			userAgent: ua,
			origin: url.origin,
			env
		});

		const selfieKey = await subirSelfieGise(
			bucketOk.r2,
			{ id, data_inicio: gise.data_inicio },
			validatedEv.selfieBase64
		);
		try {
			await bucketOk.r2.put(chaveConferencia(montado.verificationHash), montado.pdfComRodape, {
				httpMetadata: { contentType: 'application/pdf' }
			});
		} catch (err) {
			logger.warn('[gise/preparar-assinatura-avancada] Falha ao gravar cópia de conferência', {
				gise_id: id,
				error: err instanceof Error ? err.message : String(err)
			});
		}

		const intencao = await criarIntencaoAssinatura(
			db,
			{ recurso: 'gise', recursoId: id },
			{ id: u.id, tipo: u.tipo },
			montado.finalPdf,
			montado.verificationHash,
			{ selfieKey, latitude: validatedEv.latitude, longitude: validatedEv.longitude }
		);

		return json({
			intencao,
			preparedPdf: bytesToBase64(montado.finalPdf),
			documentHash: await calcularHashBuffer(montado.finalPdf),
			credentialId: credencial.credentialId
		});
	} catch (err) {
		return serverError(`[gise/preparar-assinatura-avancada] Falha (giseId=${id})`, err);
	}
};
