/**
 * Assinatura EM TELA do relatório de serviço extraordinário de uma seccional
 * (ou do quadro de supervisão) — assinatura avançada, sem certificado.
 *
 * Com a flag de chave ligada, este um-tiro morre (403); o titular usa o par
 * preparar/finalizar. O miolo do PDF vive em `assinatura-extra.ts`.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getDB,
	buscarGiseDetalhado,
	verificarSaidaCompletaSeccional,
	auditar,
	contextoDeEvento,
	tryGetR2
} from '$lib/db';
import {
	giseAutorizaSeccionalRelatorioExtra,
	secIdEhSupervisaoExtra
} from '$lib/server/gise/supervisao-extra';
import { giseSignatureSchema } from '$lib/schemas';
import { validarEvidenciasAvancada } from '$lib/server/assinatura/signature-service';
import { bucketParaAssinatura } from '$lib/server/assinatura/blob-assinado';
import {
	montarPdfExtraAssinado,
	persistirExtraAssinado,
	subirSelfieExtra
} from '$lib/server/gise/assinatura-extra';
import type { EvidenciasMontagem } from '$lib/server/escalas/assinatura-escala';
import {
	apiError,
	ErrorCode,
	requireAuth,
	badRequest,
	notFound,
	forbidden,
	serverError,
	validateBody
} from '$lib/server/api';

export const POST: RequestHandler = async (event) => {
	const { locals, params, request, platform, cookies, getClientAddress, url } = event;
	const u = requireAuth(locals);
	if (u instanceof Response) return u;
	if (u.tipo !== 'policial' && u.tipo !== 'admin') {
		return forbidden('Somente policiais supervisores ou administradores podem assinar');
	}

	const { id, seccionalId } = params;
	const v = await validateBody(request, giseSignatureSchema);
	if (!v.ok) return v.response;

	const {
		rubrica,
		type,
		hash: inputHash,
		signerName,
		signerCpf,
		latitude,
		longitude,
		selfieBase64,
		codigoValidação,
		desafioId,
		livenessChallenge,
		reauthId
	} = v.data;

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';
	const hash =
		inputHash ||
		crypto.randomUUID().slice(0, 8).toUpperCase() +
			'-' +
			crypto.randomUUID().slice(0, 8).toUpperCase();

	const db = getDB(platform);

	try {
		const giseIdNum = parseInt(id!);
		const secIdNum = parseInt(seccionalId!);

		const gise = await buscarGiseDetalhado(db, giseIdNum);
		if (!gise) return notFound('Escala');

		if (u.tipo !== 'admin' && gise.supervisor_id !== u.id) {
			return forbidden(
				'Apenas o supervisor designado ou administradores podem assinar este relatório.'
			);
		}

		const secOk = await giseAutorizaSeccionalRelatorioExtra(db, giseIdNum, secIdNum);
		if (!secOk) return badRequest('Seccional inválida para esta GISE.');

		const isSupExtraGate = await secIdEhSupervisaoExtra(db, secIdNum);
		const saidaCompleta = await verificarSaidaCompletaSeccional(
			db,
			giseIdNum,
			secIdNum,
			isSupExtraGate
		);
		if (!saidaCompleta) {
			return badRequest(
				'Todos os participantes precisam confirmar a saída (rubrica) antes de assinar o relatório.'
			);
		}

		let evidenciasMontagem: EvidenciasMontagem = {};
		if (type !== 'serpro') {
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
				{
					platform,
					sessaoToken: cookies.get('session_token'),
					recusarSePasskeyExigida: true
				}
			);
			if (!evid.ok) return apiError(evid.error, evid.status, evid.code ?? ErrorCode.VALIDATION);
			evidenciasMontagem = {
				rubrica: evid.validated.rubrica,
				latitude: evid.validated.latitude,
				longitude: evid.validated.longitude,
				selfieBase64: evid.validated.selfieBase64,
				livenessChallenge: evid.validated.livenessChallenge,
				politicaDispositivoMovel: evid.validated.politicaDispositivoMovel
			};
		} else {
			evidenciasMontagem = { rubrica: rubrica || '', politicaDispositivoMovel: false };
		}

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
			evidencias: evidenciasMontagem,
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
			evidenciasMontagem.selfieBase64
		);

		const persistido = await persistirExtraAssinado({
			db,
			r2: bucketOk.r2,
			giseId: giseIdNum,
			secId: secIdNum,
			assinante: {
				id: u.tipo === 'policial' ? u.id : null,
				nome: signerName || u.nome,
				cpf: signerCpf || u.cpf
			},
			montado,
			rubrica: evidenciasMontagem.rubrica,
			selfieKey,
			ip: ip ?? undefined,
			userAgent: ua,
			latitude: evidenciasMontagem.latitude,
			longitude: evidenciasMontagem.longitude,
			env
		});
		if (!persistido.ok) return persistido.resposta;

		const { contexto, env: envAudit } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'assinar_relatorio_gise',
				usuario: u,
				entidade: 'gise',
				entidade_id: giseIdNum,
				alvo_tipo: 'seccional',
				alvo_id: secIdNum,
				detalhes: `Relatório extraordinário da GISE ${id} assinado (seccional ${seccionalId})`,
				metadados: { tipo_assinatura: type ?? 'simples', verification_hash: hash },
				...contexto
			},
			{ env: envAudit }
		);

		return json({ success: true });
	} catch (e) {
		return serverError(
			`[gise/relatorios/assinar] Falha ao salvar assinatura (gise_id=${id}, seccional_id=${seccionalId})`,
			e
		);
	}
};
