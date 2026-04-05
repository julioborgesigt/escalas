/**
 * POST /api/gise/[id]/preparar-assinatura
 *
 * Prepara o PDF da escala GISE diária com placeholder de assinatura digital.
 * Retorna hash dos SignedAttributes para assinatura via Web PKI ou SERPRO.
 * Permissão: Supervisor designado (DPC).
 */

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getDB, buscarGiseEscala, buscarGiseDetalhado } from '$lib/db';
import { gerarPdfGise } from '$lib/export';
import { prepararPdfParaAssinatura, adicionarPaginaAuditoria } from '$lib/server/pdf-signing';
import { PDFDocument } from 'pdf-lib';
import { gerarCodigoValidacao } from '$lib/utils';

export const POST = async ({ platform, params, locals, url, request, getClientAddress }: RequestEvent) => {
	const u = locals.usuario;
	if (!u || u.tipo !== 'policial') {
		return json({ error: 'Não autorizado' }, { status: 401 });
	}

	const { signerName, signerCpf, rubrica, latitude, longitude } = await request.json();
	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const id = parseInt(params.id!);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const gise = await buscarGiseEscala(db, id);
	if (!gise) return json({ error: 'Escala GISE não encontrada' }, { status: 404 });

	if (gise.status !== 'aguardando_assinatura' && gise.status !== 'em_andamento') {
		return json({ error: 'A escala não está pronta para assinatura' }, { status: 400 });
	}

	if (gise.supervisor_id !== u.id) {
		return json({ error: 'Apenas o Supervisor designado pode assinar esta escala' }, { status: 403 });
	}

	const giseDetalhado = await buscarGiseDetalhado(db, id);
	if (!giseDetalhado) return json({ error: 'Erro ao carregar dados da escala' }, { status: 500 });

	const result = gerarPdfGise(giseDetalhado);
	const pdfBytes = result.pdf;
	const sigY = result.finalY;

	const verificationHash = gerarCodigoValidacao();
	const verificationUrl = `${url.origin}/validar/${verificationHash}`;

	const finalSignerName = signerName && signerName.trim() ? signerName : u.nome;
	const finalSignerCpf = signerCpf && signerCpf.trim() ? signerCpf : '';

	// Conta páginas do PDF de conteúdo antes de adicionar a folha de auditoria
	const origDoc = await PDFDocument.load(pdfBytes);
	const contentPageIndex = origDoc.getPageCount() - 1;

	// Adicionar folha de auditoria ANTES de assinar (preserva a validade da assinatura)
	const pdfWithAudit = await adicionarPaginaAuditoria(pdfBytes, {
		signerName: finalSignerName,
		signerCpf: finalSignerCpf || undefined,
		signingTime: new Date(),
		verificationHash,
		verificationUrl,
		ip: ip ?? undefined,
		userAgent: ua || undefined,
		latitude: latitude ?? undefined,
		longitude: longitude ?? undefined,
		token: crypto.randomUUID(),
		documentName: `Escala de Serviço GISE - ${gise.data_inicio}`,
		signatureLevel: 'qualificada'
	});

	const boxY_pts = (210 - sigY) * 2.8346 + 1.5;

	// Use default positions for rubrica so it goes directly above the PKI box.
	const prepResult = await prepararPdfParaAssinatura(
		pdfWithAudit,
		finalSignerName,
		finalSignerCpf,
		'right',
		verificationHash,
		verificationUrl,
		boxY_pts,
		rubrica || undefined,
		undefined,
		undefined,
		contentPageIndex
	);

	const { preparedPdf, signedAttrsHashHex, messageDigest, signingTimeISO, dataToSignBase64 } = prepResult;
	const preparedPdfBase64 = Buffer.from(preparedPdf).toString('base64');

	return json({
		signedAttrsHashHex,
		preparedPdf: preparedPdfBase64,
		messageDigest,
		signingTimeISO,
		dataToSignBase64,
		verificationHash
	});
};
