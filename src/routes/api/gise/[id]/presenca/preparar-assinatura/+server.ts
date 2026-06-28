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
import { gerarTermoPresencaPdf } from '$lib/server/gise-termo-presenca';
import {
	prepararPdfParaAssinatura,
	adicionarPaginaAuditoria,
	adicionarRodapeUniversal,
	type AuditTrailOptions
} from '$lib/server/pdf-signing';
import { gerarCodigoValidacao } from '$lib/utils';
import { calcularHashBuffer } from '$lib/server/document-utils';
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

	// 2. Rodapé universal de verificação.
	const pdfComRodape = await adicionarRodapeUniversal(pdf, {
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

	// 4. Estampa a rubrica + carimbo na página do termo (índice 0).
	const pageW = 595.28;
	// A rubrica (manuscrito) assenta SOBRE a linha de assinatura, centrada na
	// faixa à esquerda; o carimbo ICP vai à DIREITA — assim a rubrica não se
	// sobrepõe ao selo. `prepararPdfParaAssinatura` desenha a rubrica com 100pt.
	const margin = 56;
	const rubW_pts = 100;
	const boxW_pts = 158; // largura do carimbo dentro de prepararPdfParaAssinatura
	const boxLeft_pts = pageW * 0.75 - boxW_pts / 2; // carimbo no modo 'right'
	// Centro da faixa livre entre a margem esquerda e a borda esquerda do carimbo.
	const rx_pts = (margin + boxLeft_pts - rubW_pts) / 2;
	const ry_pts = signatureLineY + 2; // assenta sobre a linha
	const boxY_pts = signatureLineY + 6; // carimbo logo acima da linha, à direita

	const prep = await prepararPdfParaAssinatura(
		pdfWithAudit,
		finalSignerName,
		'right',
		verificationHash,
		verificationUrl,
		boxY_pts,
		rubrica,
		rx_pts,
		ry_pts,
		0
	);

	const { signedAttrsHashHex, preparedPdf, messageDigest, signingTimeISO, dataToSignBase64 } = prep;

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
