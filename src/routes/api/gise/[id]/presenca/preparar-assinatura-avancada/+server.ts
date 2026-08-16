/**
 * FASE 1 da presença avançada por passkey: grava a entrada/saída (o um-tiro da
 * form action recusa quando a flag exige chave) e devolve o hash do termo
 * para a cerimônia.
 */
import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import {
	getDB,
	buscarGiseEscala,
	resolverParticipacaoGisePolicial,
	salvarEntradaGise,
	salvarSaidaGise,
	sincronizarStatusGiseAposPresencaRelatorios,
	getR2,
	hasR2,
	tryGetR2
} from '$lib/db';
import { gisePresencas } from '$lib/server/schema';
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
import { assinarPresencaAvancadaSchema } from '$lib/schemas';
import { validarEvidenciasAvancada } from '$lib/server/assinatura/signature-service';
import { gateDePresenca } from '$lib/server/gise/presenca-gate';
import { invalidarPapelGise } from '$lib/server/gise/papel-cache';
import { criarIntencaoAssinatura } from '$lib/server/assinatura/intencao';
import { descreverVinculoCredencial } from '$lib/server/assinatura/webauthn/authenticator-data';
import { credencialDoUsuario } from '$lib/server/auth/credencial';
import { exigirChaveAtiva } from '$lib/server/assinatura/chave-assinatura';
import { bucketParaAssinatura } from '$lib/server/assinatura/blob-assinado';
import { prepararTermoPresencaAvancado } from '$lib/server/gise/termo-presenca';
import { uploadSelfieDataUri } from '$lib/server/assinatura/selfie-upload';
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
	if (u.tipo !== 'policial') return forbidden('Apenas policiais confirmam presença.');

	const ua = request.headers.get('user-agent') || '';
	const ip = getClientAddress();
	const giseId = parseInt(params.id!);
	if (isNaN(giseId)) return badRequest('ID inválido');

	const db = getDB(platform);
	const chave = await exigirChaveAtiva(db, credencialDoUsuario(u), ua);
	if ('recusa' in chave) return chave.recusa;
	const credencial = chave.credencial;

	const v = await validateBody(request, assinarPresencaAvancadaSchema);
	if (!v.ok) return v.response;
	const {
		tipo,
		rubrica,
		latitude,
		longitude,
		selfieBase64,
		codigoValidação,
		desafioId,
		livenessChallenge,
		reauthId
	} = v.data;

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

	const gise = await buscarGiseEscala(db, giseId);
	if (!gise) return notFound('Escala GISE');

	const part = await resolverParticipacaoGisePolicial(db, giseId, u.id);
	if (!part.participa) return forbidden('Você não participa desta escala GISE.');

	const gate = await gateDePresenca(db, { ...part, statusGise: gise.status }, giseId, u.id, tipo);
	if (!gate.ok) return gate.resposta;

	try {
		const bucketOk = bucketParaAssinatura(tryGetR2(platform));
		if (!bucketOk.ok) return bucketOk.resposta;

		let selfieKey: string | undefined;
		if (hasR2(platform) && evid.validated.selfieBase64) {
			const [yyyy, mm, dd] = gise.data_inicio.split('-');
			const r = await uploadSelfieDataUri(
				getR2(platform),
				`gise/${yyyy}-${mm}/${dd}/${giseId}/selfies`,
				evid.validated.selfieBase64
			);
			if (r.ok) selfieKey = r.key;
		}

		if (tipo === 'entrada') {
			await salvarEntradaGise(
				db,
				giseId,
				u.id,
				evid.validated.rubrica || rubrica || '',
				ip,
				ua,
				evid.validated.latitude ?? undefined,
				evid.validated.longitude ?? undefined,
				selfieKey
			);
		} else {
			const saida = await salvarSaidaGise(
				db,
				giseId,
				u.id,
				evid.validated.rubrica || rubrica || '',
				ip,
				ua,
				evid.validated.latitude ?? undefined,
				evid.validated.longitude ?? undefined,
				selfieKey
			);
			if (!saida.registrada) {
				return conflict(
					'Não há confirmação de ENTRADA registrada — a saída não pode ser assinada.'
				);
			}
		}

		await sincronizarStatusGiseAposPresencaRelatorios(db, giseId);
		await invalidarPapelGise(u.id);

		const linha = await db
			.select({ id: gisePresencas.id })
			.from(gisePresencas)
			.where(and(eq(gisePresencas.gise_id, giseId), eq(gisePresencas.policial_id, u.id)))
			.get();
		if (!linha) {
			return serverError('[presenca/preparar] linha de presença ausente após gravar', new Error());
		}

		const env = platform?.env as unknown as Record<string, string | undefined> | undefined;
		const { finalPdf, verificationHash } = await prepararTermoPresencaAvancado({
			tipo,
			presencaId: linha.id,
			giseId,
			dataInicio: gise.data_inicio,
			unidadeNome: part.unidadeNome,
			signerName: u.nome,
			signerCpf: u.cpf,
			matricula: u.matricula ?? null,
			rubricaBase64: evid.validated.rubrica || rubrica || '',
			selfieBase64: evid.validated.selfieBase64 ?? undefined,
			ip,
			userAgent: ua,
			latitude: evid.validated.latitude,
			longitude: evid.validated.longitude,
			origin: url.origin,
			env,
			passkey: {
				credentialId: credencial.credentialId,
				vinculo: descreverVinculoCredencial(credencial)
			}
		});

		const intencao = await criarIntencaoAssinatura(
			db,
			{
				recurso: 'gise_presenca',
				recursoId: giseId,
				escopoId: tipo === 'entrada' ? 1 : 2
			},
			{ id: u.id, tipo: u.tipo },
			finalPdf,
			verificationHash,
			{
				selfieKey: selfieKey ?? null,
				latitude: evid.validated.latitude,
				longitude: evid.validated.longitude
			}
		);

		return json({
			intencao,
			preparedPdf: bytesToBase64(finalPdf),
			documentHash: await calcularHashBuffer(finalPdf),
			credentialId: credencial.credentialId
		});
	} catch (err) {
		return serverError(`[presenca/preparar-assinatura-avancada] Falha (gise=${giseId})`, err);
	}
};
