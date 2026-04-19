/**
 * POST /api/gise/[id]/relatorios/[seccionalId]/preparar-assinatura
 *
 * Prepara o PDF do Relatório Extraordinário (GISE) com placeholder de assinatura digital.
 * A folha de auditoria é adicionada aqui (antes da assinatura) para preservar a validade da assinatura.
 */

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getDB, buscarGiseDetalhado, buscarPresencasGise, buscarGiseSeccionalMembros } from '$lib/db';
import { prepararAssinaturaSchema } from '$lib/schemas';
import { validateBody } from '$lib/server/api';
import { gerarRelatorioExtraordinarioPdf, toGisePdfData } from '$lib/export';
import { prepararPdfParaAssinatura, adicionarPaginaAuditoria, type AuditTrailOptions, adicionarRodapeUniversal } from '$lib/server/pdf-signing';
import { PDFDocument } from 'pdf-lib';
import { gerarCodigoValidacao } from '$lib/utils';
import { getR2 } from '$lib/server/platform';
import { calcularHashBuffer } from '$lib/server/document-utils';

export const POST = async ({ platform, params, locals, url, request, getClientAddress }: RequestEvent) => {
	const u = locals.usuario;
	if (!u || (u.tipo !== 'policial' && u.tipo !== 'admin')) {
		return json({ error: 'Não autorizado' }, { status: 401 });
	}

	const validated = await validateBody(request, prepararAssinaturaSchema);
	if (!validated.ok) return validated.response;
	const { signerName, signerCpf, rubrica, latitude, longitude } = validated.data;
	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const id = parseInt(params.id!);
	const secIdNum = parseInt(params.seccionalId!);

	if (isNaN(id) || isNaN(secIdNum)) {
		return json({ error: 'Parâmetros inválidos' }, { status: 400 });
	}

	const db = getDB(platform);
	const gise = await buscarGiseDetalhado(db, id);
	if (!gise) return json({ error: 'Escala GISE não encontrada' }, { status: 404 });

	// Apenas o supervisor designado ou administradores podem assinar relatórios desta GISE
	if (u.tipo !== 'admin' && gise.supervisor_id !== u.id) {
		return json({ error: 'Apenas o supervisor designado ou administradores podem assinar este relatório.' }, { status: 403 });
	}

	const presencas = await buscarPresencasGise(db, id);

	const finalSignerName = signerName && signerName.trim() ? signerName : u.nome;
	const finalSignerCpf = signerCpf && signerCpf.trim() ? signerCpf : u.cpf || '';

	const mockSignature = {
		assinante_nome: finalSignerName,
		assinante_matricula: u.matricula || '—'
	};

	const result = await gerarRelatorioExtraordinarioPdf(toGisePdfData(gise), presencas, secIdNum, url.origin, mockSignature, undefined, true);
	const pdfBytes = result.pdf;
	const sigY = result.finalY;

	const verificationHash = gerarCodigoValidacao();
	const verificationUrl = `${url.origin}/validar/${verificationHash}`;

	// CALCULAR HASH SHA-256 DO PDF ORIGINAL (Antes de carimbos/assinatura)
	// Isso garante a integridade jurídica do conteúdo
	const documentHash = await calcularHashBuffer(pdfBytes);

	// INJETAR RODAPÉ UNIVERSAL EM TODAS AS PÁGINAS DE CONTEÚDO
	const pdfComRodape = await adicionarRodapeUniversal(pdfBytes, {
		documentHash,
		verificationUrl,
		verificationHash
	});

	// Usar o PDF com rodapé para os próximos passos
	const pdfBase = pdfComRodape;

	// Construir lista de assinantes para a folha de auditoria
	const signers: AuditTrailOptions[] = [];

	const membrosSec = await buscarGiseSeccionalMembros(db, id, secIdNum);
	const idsMembros = new Set(membrosSec.map((m: any) => m.policial_id));
	const presencasFiltradas = presencas.filter((p: any) => idsMembros.has(p.policial_id));

	const r2 = getR2(platform as App.Platform | undefined);

	// Buscar selfies em paralelo
	const selfieKeys: Array<{ key: string; type: 'entrada' | 'saida'; prId: number }> = [];
	for (const pr of presencasFiltradas) {
		if (pr.entrada_rubrica && pr.entrada_selfie_key && r2) {
			selfieKeys.push({ key: pr.entrada_selfie_key, type: 'entrada', prId: pr.id });
		}
		if (pr.saida_rubrica && pr.saida_selfie_key && r2) {
			selfieKeys.push({ key: pr.saida_selfie_key, type: 'saida', prId: pr.id });
		}
	}

	const selfieResults = await Promise.all(
		selfieKeys.map(async ({ key, type, prId }) => {
			try {
				const obj = await r2!.get(key);
				if (obj) {
					const buf = await obj.arrayBuffer();
					return { prId, type, data: `data:image/jpeg;base64,${Buffer.from(buf).toString('base64')}` };
				}
			} catch { }
			return { prId, type, data: undefined };
		})
	);

	const selfieMap = new Map<string, string | undefined>();
	for (const r of selfieResults) {
		selfieMap.set(`${r.prId}-${r.type}`, r.data);
	}

	for (const pr of presencasFiltradas) {
		if (pr.entrada_rubrica) {
			signers.push({
				signerName: `${pr.policial_nome} (ENTRADA)`,
				signerCpf: pr.policial_cpf ?? undefined,
				signingTime: new Date(pr.entrada_timestamp || Date.now()),
				verificationHash: `PRES-${pr.id}-E`,
				verificationUrl: `${url.origin}/validar/PRES-${pr.id}-E`,
				ip: pr.ip_address ?? undefined,
				userAgent: pr.user_agent ?? undefined,
				latitude: pr.latitude ?? undefined,
				longitude: pr.longitude ?? undefined,
				rubricBase64: pr.entrada_rubrica ?? undefined,
				selfieBase64: selfieMap.get(`${pr.id}-entrada`),
				signatureLevel: 'avancada',
				documentName: `Relatório Extraordinário - GISE ${id}`,
				documentHash
			});
		}
		if (pr.saida_rubrica) {
			signers.push({
				signerName: `${pr.policial_nome} (SAÍDA)`,
				signerCpf: pr.policial_cpf ?? undefined,
				signingTime: new Date(pr.saida_timestamp || Date.now()),
				verificationHash: `PRES-${pr.id}-S`,
				verificationUrl: `${url.origin}/validar/PRES-${pr.id}-S`,
				ip: pr.ip_address ?? undefined,
				userAgent: pr.user_agent ?? undefined,
				latitude: pr.latitude ?? undefined,
				longitude: pr.longitude ?? undefined,
				rubricBase64: pr.saida_rubrica ?? undefined,
				selfieBase64: selfieMap.get(`${pr.id}-saida`),
				signatureLevel: 'avancada',
				documentName: `Relatório Extraordinário - GISE ${id}`,
				documentHash
			});
		}
	}

	// Assinatura do Supervisor (qualificada via token A3)
	signers.push({
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
		documentName: `Relatório Extraordinário - GISE ${id}`,
		signatureLevel: 'qualificada',
		tipoCarimoTempo: 'servidor' // Será atualizado no finalizar se for SERPRO com ICP
	});

	// Conta páginas do PDF de conteúdo antes de adicionar a folha de auditoria
	const origDoc = await PDFDocument.load(pdfBytes);
	const contentPageIndex = origDoc.getPageCount() - 1;

	// Adicionar folha de auditoria ANTES de assinar (preserva a validade da assinatura)
	const pdfWithAudit = await adicionarPaginaAuditoria(pdfBase, signers);

	// Conversão de mm (jsPDF) para pts (pdf-lib)
	const mmToPts = 2.8346;
	const rubW_pts = 130;
	const rx_pts = (297 / 2 - (rubW_pts / mmToPts) / 2) * mmToPts; // Centralizado

	// A linha de assinatura está em sigY (mm do topo).
	// Em pdf-lib (pts da base):
	const sigY_pts = (210 - sigY) * mmToPts;

	// Queremos a rubrica logo acima da linha
	const ry_pts = sigY_pts + (2 * mmToPts);

	// O carimbo (box azul) deve ficar acima da linha também.
	const boxY_pts = sigY_pts + (5 * mmToPts);

	const prepResult = await prepararPdfParaAssinatura(
		pdfWithAudit,
		finalSignerName,
		finalSignerCpf,
		'center',
		verificationHash,
		verificationUrl,
		boxY_pts,
		rubrica || undefined,
		rx_pts,
		ry_pts,
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
		verificationHash,
		documentHash,
		assinanteEmail: u.email
	});
};
