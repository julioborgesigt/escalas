/**
 * POST /api/gise/[id]/presenca/preparar-assinatura
 *
 * Prepara o "Termo de Confirmação de Presença" (entrada/saída) em PDF para
 * assinatura por Token A3 no computador. Valida vínculo na GISE e horário
 * liberado no servidor (o fluxo de tela só checa na UI).
 */

import type { RequestHandler } from './$types';
import { getDB, buscarGiseEscala, resolverParticipacaoGisePolicial } from '$lib/db';
import { gateDePresenca } from '$lib/server/gise/presenca-gate';
import { identidadeVisualAssinante } from '$lib/server/assinatura/identidade-sessao';
import { prepararPresencaSchema } from '$lib/schemas';
import { requireAuth, badRequest, notFound, forbidden, validateBody } from '$lib/server/api';
import { gerarTermoPresencaPdf } from '$lib/server/gise/termo-presenca';
import {
	adicionarPaginaAuditoria,
	adicionarRodapeUniversal,
	type AuditTrailOptions
} from '$lib/server/assinatura/pdf-signing';
import { gerarCodigoValidacao } from '$lib/utils/formato';
import {
	calcularHashBuffer,
	resolverTipoCarimboTempo
} from '$lib/server/assinatura/document-utils';
import { prepararAssinaturaPorToken } from '$lib/server/assinatura/preparar-ciclo';

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
	const { latitude, longitude, tipo } = validated.data;

	const giseId = parseInt(params.id!);
	if (isNaN(giseId)) return badRequest('Parâmetro inválido');

	const db = getDB(platform);
	const gise = await buscarGiseEscala(db, giseId);
	if (!gise) return notFound('Escala GISE');

	// Vínculo na GISE (server-side).
	const part = await resolverParticipacaoGisePolicial(db, giseId, u.id);
	if (!part.participa) return forbidden('Você não participa desta escala GISE.');

	// Janela de horário e, para saída, entrada já registrada. A mesma função
	// roda no finalizador — antes a janela existia só aqui, e quem guardasse um
	// `preparedPdf` passava por cima dela (FLW-GISE-008).
	const gate = await gateDePresenca(db, { ...part, statusGise: gise.status }, giseId, u.id, tipo);
	if (!gate.ok) return gate.resposta;

	const { signerName: finalSignerName, signerCpf: finalSignerCpf } = identidadeVisualAssinante(u);
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
			tipoCarimoTempo: resolverTipoCarimboTempo(platform)
		}
	];
	const pdfWithAudit = await adicionarPaginaAuditoria(pdfComRodape, signers);

	// 4. Campo de assinatura EM BRANCO (estilo 'campo-limpo'), ancorado sobre a
	//    linha. O QR + identidade ("Assinado digitalmente por…") vivem no rodapé.
	const boxY_pts = signatureLineY + 3; // campo logo acima da linha

	return prepararAssinaturaPorToken({
		db,
		platform,
		alvo: { recurso: 'gise_presenca', recursoId: giseId },
		ator: { id: u.id, tipo: u.tipo },
		pdfComAuditoria: pdfWithAudit,
		pdfComRodape,
		signerName: finalSignerName,
		assinanteEmail: u.email,
		documentHash,
		verificationHash,
		verificationUrl,
		campo: { alignment: 'center', boxY: boxY_pts, targetPageIndex: 0 },
		logTag: 'gise/presenca/preparar-assinatura',
		logFields: { gise_id: giseId }
	});
};
