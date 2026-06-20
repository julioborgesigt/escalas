/**
 * POST /api/gise/[id]/assinar-simples
 *
 * Assinatura simples (confirmação administrativa) da escala GISE diária.
 * Gera PDF, salva no R2 e muda status para 'assinada'.
 * Permissão: Supervisor designado (DPC) com escala em 'aguardando_assinatura'.
 */

import type { RequestHandler } from './$types';
import { bytesToHex } from '$lib/crypto/hex';
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
import {
	getDB,
	buscarGiseEscala,
	buscarGiseDetalhado,
	salvarGiseDocumento,
	atualizarGiseEscala
} from '$lib/db';
import { assinarSimplesSchema } from '$lib/schemas';
import { validarEvidenciasAvancada } from '$lib/server/signature-service';
import {
	gerarPdfGise,
	toGisePdfData,
	giseDetalhadoComMatriculaSupervisorSessao
} from '$lib/server/export';
import { getBreveRelatorioEnvMergido } from '$lib/server/breve-relatorio-env';
import { adicionarRodapeSimples, adicionarPaginaAuditoria } from '$lib/server/pdf-signing';
import { selarPdfInstitucional, tipoCarimboPrevisto } from '$lib/server/server-seal';
import { gerarCodigoValidacao, getNowBR } from '$lib/utils';
import { getR2 } from '$lib/server/platform';
import { uploadSelfieDataUri } from '$lib/server/selfie-upload';

export const POST: RequestHandler = async ({
	platform,
	params,
	locals,
	url,
	request,
	getClientAddress
}) => {
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
		livenessChallenge
	} = validated.data;

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

	// Validação unificada de evidências (mesma lógica de escalas e relatórios extra).
	const evid = await validarEvidenciasAvancada(
		db,
		u,
		{ rubrica, latitude, longitude, selfieBase64, codigoValidação, desafioId, livenessChallenge },
		{ platform }
	);
	if (!evid.ok) return apiError(evid.error, evid.status, ErrorCode.VALIDATION);
	const validatedEv = evid.validated;

	try {
		const giseDetalhado = await buscarGiseDetalhado(db, id);
		if (!giseDetalhado) {
			return serverError(
				'[gise/assinar-simples] buscarGiseDetalhado retornou null',
				new Error('GISE_DETALHADO_NULL')
			);
		}

		const r2Logo = getR2(platform);
		let logoJpgBytes: Uint8Array | undefined;
		let logoCearaBytes: Uint8Array | undefined;
		if (r2Logo) {
			try {
				const [logoObj, cearaObj] = await Promise.all([
					r2Logo.get('assets/logogise.jpg'),
					r2Logo.get('assets/logo_ceara.jpg')
				]);
				if (logoObj) logoJpgBytes = new Uint8Array(await logoObj.arrayBuffer());
				if (cearaObj) logoCearaBytes = new Uint8Array(await cearaObj.arrayBuffer());
			} catch {
				/* logo optional */
			}
		}
		const gisePdf = giseDetalhadoComMatriculaSupervisorSessao(giseDetalhado, u);
		const brEnv = await getBreveRelatorioEnvMergido(db);
		const result = await gerarPdfGise(toGisePdfData(gisePdf, brEnv), logoJpgBytes, logoCearaBytes);
		const pdfBytes = result.pdf;
		const sigY = result.finalY;

		const verificationHash = gerarCodigoValidacao();
		const verificationUrl = `${url.origin}/validar/${verificationHash}`;

		const rubW_pts = 130;
		const rx_pts = 222.75 * 2.8346 - rubW_pts / 2;
		const ry_pts = (210 - sigY + 2) * 2.8346;

		const pdfComRodape = await adicionarRodapeSimples(pdfBytes, u.nome, {
			verificationHash,
			verificationUrl,
			rubricBase64: validatedEv.rubrica ?? undefined,
			customRubricX: rx_pts,
			customRubricY: ry_pts,
			ip,
			latitude: validatedEv.latitude,
			longitude: validatedEv.longitude
		});

		// Calcular Hash do original (Integridade)
		const originalHashBuffer = await crypto.subtle.digest('SHA-256', pdfComRodape.slice());
		const documentHash = bytesToHex(new Uint8Array(originalHashBuffer));

		// Adicionar folha de auditoria (Manifesto) profissional
		const pdfFinal = await adicionarPaginaAuditoria(pdfComRodape, {
			signerName: u.nome,
			signerCpf: u.cpf ?? undefined,
			signingTime: getNowBR(),
			verificationHash,
			verificationUrl: `${url.origin}/validar/${verificationHash}`,
			ip,
			userAgent: ua,
			latitude: validatedEv.latitude ?? undefined,
			longitude: validatedEv.longitude ?? undefined,
			selfieBase64: validatedEv.selfieBase64 ?? undefined,
			rubricBase64: validatedEv.rubrica ?? undefined,
			documentHash,
			token: crypto.randomUUID(),
			documentName: `Escala de Serviço GISE - ${gise.data_inicio}`,
			signatureLevel: 'avancada',
			tipoCarimoTempo: tipoCarimboPrevisto(
				platform?.env as unknown as Record<string, string | undefined> | undefined
			),
			livenessChallenge: validatedEv.livenessChallenge
				? {
						tipo: validatedEv.livenessChallenge.tipo,
						cumprido: validatedEv.livenessChallenge.cumprido,
						tentativas: validatedEv.livenessChallenge.tentativas,
						duracaoMs: validatedEv.livenessChallenge.duracaoMs
					}
				: null
		});

		// Selo institucional (avançada, Lei 14.063/2020 art. 4º II) + carimbo de tempo
		// grátis. Sem SELO_INSTITUCIONAL_PEM, mantém o rodapé honesto (pdfFinal).
		const selado = await selarPdfInstitucional(pdfFinal, u.nome, {
			env: platform?.env as unknown as Record<string, string | undefined> | undefined
		});
		const pdfParaSalvar = selado.ok ? selado.pdf : pdfFinal;

		const hashBuffer = await crypto.subtle.digest('SHA-256', pdfParaSalvar.slice());
		const arquivo_hash = bytesToHex(new Uint8Array(hashBuffer));

		const r2 = getR2(platform);
		const [yyyy, mm, dd] = gise.data_inicio.split('-');
		const mesAno = `${yyyy}-${mm}`;
		const folder = `gise/${mesAno}/${dd}/${id}/escala`;
		const prefixBase = `${folder}/gise_${id}_${verificationHash}`;

		const documentKey = `${prefixBase}_assinada.pdf`;
		let selfieKey: string | undefined = undefined;

		if (r2) {
			await r2.put(documentKey, pdfParaSalvar, { contentType: 'application/pdf' });

			if (validatedEv.selfieBase64) {
				// Helper compartilhado: valida magic bytes, limita 5 MB e gera
				// chave com UUID aleatório (não-enumerável).
				const r = await uploadSelfieDataUri(r2, `${folder}/selfies`, validatedEv.selfieBase64);
				if (r.ok) selfieKey = r.key;
			}
		}

		await Promise.all([
			salvarGiseDocumento(
				db,
				id,
				documentKey,
				u.id,
				u.nome,
				'',
				verificationHash,
				validatedEv.rubrica ?? undefined,
				ip,
				ua,
				validatedEv.latitude ?? undefined,
				validatedEv.longitude ?? undefined,
				selfieKey,
				arquivo_hash
			),
			atualizarGiseEscala(db, id, { status: 'em_andamento' })
		]);

		const filename = `gise_${gise.data_inicio}_confirmada.pdf`;
		return new Response(pdfParaSalvar as unknown as BodyInit, {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': contentDisposition(filename)
			}
		});
	} catch (e) {
		return serverError(`[gise/assinar-simples] Falha (giseId=${id})`, e);
	}
};
