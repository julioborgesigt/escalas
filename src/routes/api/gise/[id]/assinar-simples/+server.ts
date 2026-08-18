/**
 * POST /api/gise/[id]/assinar-simples
 *
 * Assinatura avançada de UM TIRO da escala GISE. Com a flag de chave ligada,
 * este caminho morre (403) — o titular usa preparar/finalizar. O miolo do PDF
 * vive em `assinatura-gise.ts`, compartilhado com as duas fases.
 */
import type { RequestHandler } from './$types';
import { carregarLogosGise } from '$lib/server/gise/logos';
import {
	apiError,
	ErrorCode,
	contentDisposition,
	requireAuth,
	serverError,
	validateBody
} from '$lib/server/api';
import { getDB, buscarGiseDetalhado, auditar, contextoDeEvento, tryGetR2 } from '$lib/db';
import { assinarSimplesSchema } from '$lib/schemas';
import { validarEvidenciasAvancada } from '$lib/server/assinatura/signature-service';
import { giseDetalhadoComMatriculaSupervisorSessao } from '$lib/server/export';
import { getBreveRelatorioEnvMergido } from '$lib/server/gise/breve-relatorio-env';
import { bucketParaAssinatura } from '$lib/server/assinatura/blob-assinado';
import {
	montarPdfGiseAssinado,
	persistirGiseAssinada,
	subirSelfieGise
} from '$lib/server/gise/assinatura-gise';
import { carregarGiseParaAssinatura } from '$lib/server/gise/permissao';

export const POST: RequestHandler = async (event) => {
	const { platform, params, locals, url, request, cookies, getClientAddress } = event;
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

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

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const db = getDB(platform);
	const portao = await carregarGiseParaAssinatura(db, params.id, u);
	if (portao.recusa) return portao.recusa;
	const { gise, id } = portao;

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
		{
			platform,
			sessaoToken: cookies.get('session_token'),
			recusarSePasskeyExigida: true
		}
	);
	if (!evid.ok) return apiError(evid.error, evid.status, evid.code ?? ErrorCode.VALIDATION);
	const validatedEv = evid.validated;

	try {
		const giseDetalhado = await buscarGiseDetalhado(db, id);
		if (!giseDetalhado) {
			return serverError(
				'[gise/assinar-simples] buscarGiseDetalhado retornou null',
				new Error('GISE_DETALHADO_NULL')
			);
		}

		const bucketOk = bucketParaAssinatura(tryGetR2(platform));
		if (!bucketOk.ok) return bucketOk.resposta;

		const { esq: logoJpgBytes, dir: logoCearaBytes } = await carregarLogosGise(platform);
		const gisePdf = giseDetalhadoComMatriculaSupervisorSessao(giseDetalhado, u);
		const brEnv = await getBreveRelatorioEnvMergido(db, giseDetalhado.operacao_id);
		const env = platform?.env as unknown as Record<string, string | undefined> | undefined;

		const montado = await montarPdfGiseAssinado({
			gise: { id, data_inicio: gise.data_inicio },
			gisePdf,
			brEnv,
			logos: { esq: logoJpgBytes, dir: logoCearaBytes },
			assinante: { nome: u.nome, cpf: u.cpf, email: u.email },
			evidencias: {
				rubrica: validatedEv.rubrica,
				latitude: validatedEv.latitude,
				longitude: validatedEv.longitude,
				selfieBase64: validatedEv.selfieBase64,
				livenessChallenge: validatedEv.livenessChallenge,
				politicaDispositivoMovel: validatedEv.politicaDispositivoMovel
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

		const persistido = await persistirGiseAssinada({
			db,
			r2: bucketOk.r2,
			gise: { id, data_inicio: gise.data_inicio },
			assinante: { id: u.id, nome: u.nome },
			montado,
			rubrica: validatedEv.rubrica,
			selfieKey,
			ip: ip ?? undefined,
			userAgent: ua,
			latitude: validatedEv.latitude,
			longitude: validatedEv.longitude,
			env
		});
		if (!persistido.ok) return persistido.resposta;

		const { contexto, env: envAudit } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'assinar_gise',
				usuario: u,
				entidade: 'gise',
				entidade_id: id,
				alvo_tipo: 'gise',
				alvo_id: id,
				detalhes: `GISE ${id} assinada (assinatura simples)`,
				metadados: {
					tipo: 'simples',
					verificationHash: montado.verificationHash,
					data_inicio: gise.data_inicio,
					arquivo_hash: persistido.arquivoHash
				},
				...contexto
			},
			{ env: envAudit }
		);

		const filename = `gise_${gise.data_inicio}_confirmada.pdf`;
		return new Response((persistido.pdfComRodape ?? montado.pdfComRodape) as unknown as BodyInit, {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': contentDisposition(filename)
			}
		});
	} catch (e) {
		return serverError(`[gise/assinar-simples] Falha (giseId=${id})`, e);
	}
};
