/**
 * FASE 1 da assinatura avançada por passkey do relatório extraordinário.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, buscarGiseDetalhado, verificarSaidaCompletaSeccional, tryGetR2 } from '$lib/db';
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
import { giseSignatureSchema } from '$lib/schemas';
import { validarEvidenciasAvancada } from '$lib/server/assinatura/signature-service';
import {
	giseAutorizaSeccionalRelatorioExtra,
	secIdEhSupervisaoExtra
} from '$lib/server/gise/supervisao-extra';
import { criarIntencaoAssinatura } from '$lib/server/assinatura/intencao';
import { descreverVinculoCredencial } from '$lib/server/assinatura/webauthn/authenticator-data';
import { credencialDoUsuario } from '$lib/server/auth/credencial';
import { exigirChaveAtiva } from '$lib/server/assinatura/chave-assinatura';
import { bucketParaAssinatura } from '$lib/server/assinatura/blob-assinado';
import { montarPdfExtraAssinado, subirSelfieExtra } from '$lib/server/gise/assinatura-extra';
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
	if (u.tipo !== 'policial' && u.tipo !== 'admin') {
		return forbidden('Somente policiais supervisores ou administradores podem assinar');
	}

	const ua = request.headers.get('user-agent') || '';
	const ip = getClientAddress();
	const giseIdNum = parseInt(params.id!);
	const secIdNum = parseInt(params.seccionalId!);
	if (isNaN(giseIdNum) || isNaN(secIdNum)) return badRequest('ID inválido');

	const db = getDB(platform);
	const gise = await buscarGiseDetalhado(db, giseIdNum);
	if (!gise) return notFound('Escala');
	if (u.tipo !== 'admin' && gise.supervisor_id !== u.id) {
		return forbidden(
			'Apenas o supervisor designado ou administradores podem assinar este relatório.'
		);
	}
	if (!(await giseAutorizaSeccionalRelatorioExtra(db, giseIdNum, secIdNum))) {
		return badRequest('Seccional inválida para esta GISE.');
	}
	const isSupExtraGate = await secIdEhSupervisaoExtra(db, secIdNum);
	if (!(await verificarSaidaCompletaSeccional(db, giseIdNum, secIdNum, isSupExtraGate))) {
		return badRequest(
			'Todos os participantes precisam confirmar a saída (rubrica) antes de assinar o relatório.'
		);
	}

	const chave = await exigirChaveAtiva(db, credencialDoUsuario(u), ua);
	if ('recusa' in chave) return chave.recusa;
	const credencial = chave.credencial;

	const v = await validateBody(request, giseSignatureSchema);
	if (!v.ok) return v.response;
	const {
		rubrica,
		signerName,
		signerCpf,
		latitude,
		longitude,
		selfieBase64,
		codigoValidação,
		desafioId,
		livenessChallenge,
		reauthId,
		hash: inputHash
	} = v.data;

	const evid = await validarEvidenciasAvancada(
		db,
		u,
		{
			rubrica,
			latitude: latitude ?? undefined,
			longitude: longitude ?? undefined,
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

	const hash =
		inputHash ||
		crypto.randomUUID().slice(0, 8).toUpperCase() +
			'-' +
			crypto.randomUUID().slice(0, 8).toUpperCase();

	try {
		const bucketOk = bucketParaAssinatura(tryGetR2(platform));
		if (!bucketOk.ok) return bucketOk.resposta;
		const env = platform?.env as unknown as Record<string, string | undefined> | undefined;

		const montado = await montarPdfExtraAssinado({
			db,
			gise,
			giseId: giseIdNum,
			secId: secIdNum,
			assinante: {
				nome: signerName || u.nome,
				cpf: signerCpf || u.cpf,
				matricula: u.tipo === 'policial' ? u.matricula : null
			},
			evidencias: {
				rubrica: evid.validated.rubrica,
				latitude: evid.validated.latitude,
				longitude: evid.validated.longitude,
				selfieBase64: evid.validated.selfieBase64,
				livenessChallenge: evid.validated.livenessChallenge,
				politicaDispositivoMovel: evid.validated.politicaDispositivoMovel,
				passkey: {
					credentialId: credencial.credentialId,
					vinculo: descreverVinculoCredencial(credencial)
				}
			},
			ip: ip ?? undefined,
			userAgent: ua,
			origin: url.origin,
			env,
			platform,
			verificationHash: hash
		});

		const selfieKey = await subirSelfieExtra(
			bucketOk.r2,
			{ id: giseIdNum, data_inicio: gise.data_inicio },
			secIdNum,
			hash,
			evid.validated.selfieBase64
		);
		try {
			await bucketOk.r2.put(chaveConferencia(hash), montado.pdfComRodape, {
				httpMetadata: { contentType: 'application/pdf' }
			});
		} catch (err) {
			logger.warn('[extra/preparar-assinatura-avancada] Falha na cópia de conferência', {
				error: err instanceof Error ? err.message : String(err)
			});
		}

		const intencao = await criarIntencaoAssinatura(
			db,
			{ recurso: 'gise_relatorio', recursoId: giseIdNum, escopoId: secIdNum },
			{ id: u.id, tipo: u.tipo },
			montado.finalPdf,
			montado.verificationHash,
			{ selfieKey, latitude: evid.validated.latitude, longitude: evid.validated.longitude }
		);

		return json({
			intencao,
			preparedPdf: bytesToBase64(montado.finalPdf),
			documentHash: await calcularHashBuffer(montado.finalPdf),
			credentialId: credencial.credentialId
		});
	} catch (err) {
		return serverError(
			`[extra/preparar-assinatura-avancada] Falha (gise=${giseIdNum}, sec=${secIdNum})`,
			err
		);
	}
};
