/**
 * FASE 1 da assinatura avançada por passkey da escala.
 *
 * Monta o PDF completo — inclusive a folha de manifesto, já nomeando a
 * credencial que vai assinar — e devolve o hash dele como desafio da cerimônia
 * biométrica. É esse hash que transforma "esta pessoa se autenticou" em "esta
 * pessoa afirmou ESTE documento".
 *
 * O manifesto sai COMPLETO aqui porque só existe uma credencial ativa por
 * pessoa (ver `lib/db/webauthn.ts`): o servidor sabe de antemão qual vai
 * assinar. Com N credenciais, ou a linha do manifesto ficaria vaga ou teria de
 * ser escrita depois do hash já assinado — e aí a asserção não cobriria o
 * documento final.
 *
 * Nada é persistido em `escala_documentos` nesta fase. Abandonar entre as duas
 * fases deixa a intenção expirar em 15 min; o PDF preparado nunca chega a ser
 * documento assinado. A selfie e a cópia de conferência VÃO ao R2 aqui (o
 * `finalizar` não as tem mais), e a chave da selfie viaja pela INTENÇÃO, nunca
 * pelo corpo do cliente — é chave de bucket, e deixá-la voltar do cliente
 * permitiria apontar o documento para a foto de outra pessoa.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getDB,
	buscarEscala,
	buscarDocumentoEscala,
	listarPoliciaisEscala,
	getR2,
	hasR2
} from '$lib/db';
import {
	apiError,
	ErrorCode,
	badRequest,
	notFound,
	forbidden,
	conflict,
	serverError,
	requireAuth,
	validateBody
} from '$lib/server/api';
import { assinarSimplesSchema } from '$lib/schemas';
import { validarEvidenciasAvancada } from '$lib/server/assinatura/signature-service';
import {
	montarPdfEscalaAssinada,
	subirSelfieEscala,
	gravarCopiaConferencia
} from '$lib/server/escalas/assinatura-escala';
import { criarIntencaoAssinatura } from '$lib/server/assinatura/intencao';
import { descreverVinculoCredencial } from '$lib/server/assinatura/webauthn/authenticator-data';
import { credencialDoUsuario } from '$lib/server/auth/credencial';
import { exigirChaveAtiva } from '$lib/server/assinatura/chave-assinatura';
import { verificarPermissaoEscala, podeAssinarEscala } from '$lib/server/escalas/permissao';
import { calcularHashBuffer } from '$lib/server/assinatura/document-utils';
import { bytesToBase64 } from '$lib/crypto/bin';

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
	const escala = await buscarEscala(db, id);
	if (!escala) return notFound('Escala');

	// Mesmas recusas do `assinar-simples`, e pela mesma razão: a preparação já
	// monta o documento e sobe artefatos ao R2. Recusar só no finalizar deixaria
	// lixo gravado por quem nunca poderia assinar.
	const perm = await verificarPermissaoEscala(db, id, escala.lotacao, u);
	if (!perm.permitido) return forbidden(perm.motivo ?? 'Sem permissão para assinar esta escala');
	if (!podeAssinarEscala(u)) {
		return forbidden('Apenas Admin Geral ou DPC com papel administrativo pode assinar esta escala');
	}
	if (escala.tipo === 'fds') {
		return badRequest(
			'Escala de fim de semana não admite assinatura digital — use o fluxo por e-mail'
		);
	}
	if (await buscarDocumentoEscala(db, id)) {
		return conflict('Revogue a assinatura existente antes de assinar novamente');
	}

	const policiais = await listarPoliciaisEscala(db, id);
	if (!policiais || policiais.length === 0) {
		return badRequest('A escala está vazia e não pode ser assinada');
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
		const vinculo = descreverVinculoCredencial(credencial);
		const montado = await montarPdfEscalaAssinada({
			escala,
			policiais,
			assinante: { nome: u.nome, cpf: u.cpf, email: u.email },
			evidencias: {
				rubrica: validatedEv.rubrica,
				latitude: validatedEv.latitude,
				longitude: validatedEv.longitude,
				selfieBase64: validatedEv.selfieBase64,
				livenessChallenge: validatedEv.livenessChallenge,
				politicaDispositivoMovel: validatedEv.politicaDispositivoMovel,
				passkey: { credentialId: credencial.credentialId, vinculo }
			},
			ip: ip ?? undefined,
			userAgent: ua || undefined,
			origin: url.origin,
			env: platform?.env as unknown as Record<string, string | undefined> | undefined
		});

		if (!hasR2(platform)) {
			return serverError(
				'[preparar-assinatura-avancada] R2 não configurado',
				new Error('R2_NOT_CONFIGURED')
			);
		}
		const bucket = getR2(platform);

		const selfieKey = await subirSelfieEscala(bucket, id, validatedEv.selfieBase64);
		await gravarCopiaConferencia(bucket, montado.verificationHash, montado.pdfComRodape, id);

		const intencao = await criarIntencaoAssinatura(
			db,
			{ recurso: 'escala', recursoId: id },
			{ id: u.id, tipo: u.tipo },
			montado.finalPdf,
			montado.verificationHash,
			{ selfieKey, latitude: validatedEv.latitude, longitude: validatedEv.longitude }
		);

		return json({
			intencao,
			preparedPdf: bytesToBase64(montado.finalPdf),
			// O desafio da cerimônia. É o MESMO valor que a intenção guardou como
			// `documento_hash`, e é o que o finalizar reconfere.
			documentHash: await calcularHashBuffer(montado.finalPdf),
			credentialId: credencial.credentialId
		});
	} catch (err) {
		return serverError(`[preparar-assinatura-avancada] Falha ao preparar (escala_id=${id})`, err);
	}
};
