/**
 * POST /api/gise/[id]/presenca/preparar-assinatura
 *
 * Prepara o "Termo de Confirmação de Presença" (entrada/saída) em PDF para
 * assinatura por Token A3 no computador. A rubrica usada é a CADASTRADA do
 * policial (lida no servidor) — o cliente não a envia. Valida vínculo na GISE e
 * horário liberado no servidor (o fluxo de tela só checa na UI).
 */

import type { RequestHandler } from './$types';
import { eq } from 'drizzle-orm';
import {
	getDB,
	buscarGiseEscala,
	resolverParticipacaoGisePolicial,
	horarioGiseLiberado
} from '$lib/db';
import { policiais } from '$lib/server/schema';
import { prepararPresencaSchema } from '$lib/schemas';
import {
	requireAuth,
	badRequest,
	notFound,
	forbidden,
	conflict,
	validateBody
} from '$lib/server/api';
import { gerarTermoPresencaPdf } from '$lib/server/gise/termo-presenca';
import {
	prepararPdfParaAssinatura,
	adicionarPaginaAuditoria,
	adicionarRodapeUniversal,
	estamparRubricaLimpa,
	type AuditTrailOptions
} from '$lib/server/assinatura/pdf-signing';
import { chaveConferencia } from '$lib/server/assinatura/copia-conferencia';
import { gerarCodigoValidacao } from '$lib/utils/formato';
import { calcularHashBuffer } from '$lib/server/assinatura/document-utils';
import { tryGetR2 } from '$lib/db';
import { logger } from '$lib/server/logger';
import { json } from '@sveltejs/kit';

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
	if (u.tipo !== 'policial') return forbidden('Apenas policiais confirmam presença.');

	const validated = await validateBody(request, prepararPresencaSchema);
	if (!validated.ok) return validated.response;
	const { signerName, signerCpf, latitude, longitude, tipo } = validated.data;

	const giseId = parseInt(params.id!);
	if (isNaN(giseId)) return badRequest('Parâmetro inválido');

	const db = getDB(platform);
	const gise = await buscarGiseEscala(db, giseId);
	if (!gise) return notFound('Escala GISE');

	// Vínculo na GISE (server-side).
	const part = await resolverParticipacaoGisePolicial(db, giseId, u.id);
	if (!part.participa) return forbidden('Você não participa desta escala GISE.');

	// Horário liberado (server-side).
	if (part.horarioPrevisto && part.dataInicio) {
		const hora = tipo === 'entrada' ? part.horarioPrevisto.inicio : part.horarioPrevisto.fim;
		if (!horarioGiseLiberado(part.dataInicio, hora)) {
			return conflict(
				`A confirmação de ${tipo === 'entrada' ? 'entrada' : 'saída'} ainda não está liberada (a partir das ${hora}).`
			);
		}
	}

	// Rubrica cadastrada — obrigatória no fluxo desktop.
	const row = await db
		.select({ rubrica: policiais.rubrica })
		.from(policiais)
		.where(eq(policiais.id, u.id))
		.get();
	const rubrica = row?.rubrica ?? null;
	if (!rubrica) {
		return badRequest('Cadastre sua rubrica antes de assinar pelo computador.');
	}

	const finalSignerName = signerName?.trim() || u.nome;
	const finalSignerCpf = signerCpf?.trim() || u.cpf || '';
	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	// 1. Gera o termo.
	const { pdf, signatureLineY } = await gerarTermoPresencaPdf({
		tipo,
		signerName: finalSignerName,
		signerCpf: finalSignerCpf,
		matricula: u.matricula,
		giseId,
		dataInicio: gise.data_inicio,
		unidadeNome: part.unidadeNome,
		timestampISO: new Date().toISOString()
	});

	const verificationHash = gerarCodigoValidacao();
	const verificationUrl = `${url.origin}/validar/${verificationHash}`;
	const documentHash = await calcularHashBuffer(pdf);

	// 2. Rodapé universal de verificação (+ bloco de identidade com QR).
	const pdfComRodape = await adicionarRodapeUniversal(pdf, {
		signerName: finalSignerName,
		signerMatricula: u.matricula,
		signedAtISO: new Date().toISOString(),
		documentHash,
		verificationUrl,
		verificationHash
	});

	// 3. Folha de auditoria (um signatário qualificado).
	const signers: AuditTrailOptions[] = [
		{
			signerName: finalSignerName,
			signerCpf: finalSignerCpf || undefined,
			signerEmail: u.email || undefined,
			signingTime: new Date(),
			verificationHash,
			verificationUrl,
			documentHash,
			ip: ip ?? undefined,
			userAgent: ua || undefined,
			latitude: latitude ?? undefined,
			longitude: longitude ?? undefined,
			token: crypto.randomUUID(),
			documentName: `Termo de Presença - GISE ${giseId}`,
			signatureLevel: 'qualificada',
			tipoCarimoTempo: (platform?.env as unknown as Record<string, string | undefined> | undefined)
				?.TSA_URL
				? 'tsa_externa'
				: 'servidor'
		}
	];
	const pdfWithAudit = await adicionarPaginaAuditoria(pdfComRodape, signers);

	// 4. Estampa SÓ a rubrica no campo de assinatura (estilo 'rubrica'), centrada
	//    sobre a linha — agora que o selo box saiu, a largura da linha fica livre.
	//    O QR + identidade ("Assinado digitalmente por…") vivem no rodapé.
	const boxY_pts = signatureLineY + 3; // campo logo acima da linha

	const prep = await prepararPdfParaAssinatura(
		pdfWithAudit,
		finalSignerName,
		'center',
		verificationHash,
		verificationUrl,
		boxY_pts,
		rubrica,
		undefined,
		undefined,
		0,
		'rubrica'
	);

	const { signedAttrsHashHex, preparedPdf, messageDigest, signingTimeISO, dataToSignBase64 } = prep;

	// Cópia de conferência IDÊNTICA (mesmos bytes: pdfComRodape + estamparRubricaLimpa
	// centrada sobre a linha, sem manifesto/placeholder), gravada no R2 sob a chave
	// plana `conferencia/<hash>.pdf`. Best-effort: nunca aborta a assinatura.
	const r2Conf = tryGetR2(platform);
	if (r2Conf) {
		try {
			const conferenciaPdf = await estamparRubricaLimpa(pdfComRodape, {
				alignment: 'center',
				customBoxY: boxY_pts,
				rubricBase64: rubrica,
				targetPageIndex: 0
			});
			await r2Conf.put(chaveConferencia(verificationHash), conferenciaPdf, {
				httpMetadata: { contentType: 'application/pdf' }
			});
		} catch (err) {
			logger.warn('[gise/presenca/preparar-assinatura] Falha ao gravar cópia de conferência', {
				gise_id: giseId,
				error: err instanceof Error ? err.message : String(err)
			});
		}
	}

	return json({
		signedAttrsHashHex,
		preparedPdf: Buffer.from(preparedPdf).toString('base64'),
		messageDigest,
		signingTimeISO,
		dataToSignBase64,
		verificationHash,
		documentHash,
		assinanteEmail: u.email
	});
};
