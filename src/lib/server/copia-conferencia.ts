/**
 * Cópia de conferência (A2 da auditoria — minimização de PII / LGPD).
 *
 * O PDF assinado armazenado no R2 contém a página de **manifesto forense**
 * (CPF, IP, GPS, selfie) e é o artefato legal incontestável. Esse blob NUNCA é
 * mutado nem recortado — remover qualquer byte invalidaria a assinatura CMS.
 *
 * Usuários NÃO privilegiados (todos que não são Admin Geral / Super Admin)
 * recebem em vez dele uma **cópia de conferência**: a escala/relatório
 * regenerado a partir do rascunho (sem manifesto forense), acrescido de um
 * rodapé + QR apontando para `/validar/[hash]`. A confiança vem do portal
 * público `/validar` (que já minimiza PII), não da assinatura embutida.
 */

import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { isAdminGeral, type UsuarioLogado } from '$lib/auth';
import { adicionarRodapeSimples } from './pdf-signing-visual';
import { logger } from './logger';

/**
 * Quem pode baixar o PDF forense íntegro (com manifesto: CPF/IP/GPS/selfie).
 * Restrito a Admin Geral + Super Admin — ambos `tipo === 'admin'`, capturado
 * por `isAdminGeral`. Admin Seccional/Unidade são `tipo === 'policial'` e NÃO
 * são privilegiados. Ponto único da regra: para incluir outro papel no futuro,
 * altere apenas aqui.
 */
export function podeBaixarForense(u: UsuarioLogado | null): boolean {
	return isAdminGeral(u);
}

export interface CopiaConferenciaOpts {
	/** Rascunho já gerado pelo caller (gerarPdf / gerarPdfGise / relatório) — SEM manifesto. */
	pdfRascunho: Uint8Array;
	assinanteNome: string;
	/** Hash de verificação (`/validar/[hash]`). Sem ele, não há rodapé de validação. */
	verificationHash?: string | null;
	verificationUrl?: string;
	rubricBase64?: string;
}

/** Marca d'água diagonal em todas as páginas, deixando claro que não é o original forense. */
async function aplicarMarcaConferencia(pdfBytes: Uint8Array): Promise<Uint8Array> {
	const pdfDoc = await PDFDocument.load(pdfBytes);
	const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
	const texto = 'CÓPIA DE CONFERÊNCIA';
	for (const page of pdfDoc.getPages()) {
		const { width, height } = page.getSize();
		page.drawText(texto, {
			x: width * 0.1,
			y: height * 0.42,
			size: 38,
			font,
			color: rgb(0.6, 0.6, 0.65),
			rotate: degrees(35),
			opacity: 0.16
		});
	}
	return pdfDoc.save();
}

/**
 * Compõe a cópia de conferência: marca d'água + rodapé/QR de validação sobre o
 * rascunho regenerado. NÃO adiciona página de manifesto (`adicionarPaginaAuditoria`).
 *
 * Quando `verificationHash`/`verificationUrl` faltam (registro legado sem hash),
 * devolve o rascunho apenas com a marca d'água — não há o que validar.
 */
export async function gerarCopiaConferencia(opts: CopiaConferenciaOpts): Promise<Uint8Array> {
	const { pdfRascunho, assinanteNome, verificationHash, verificationUrl, rubricBase64 } = opts;

	const comMarca = await aplicarMarcaConferencia(pdfRascunho);

	if (!verificationHash || !verificationUrl) {
		logger.warn(
			'[copia-conferencia] sem verificationHash/url — servindo rascunho sem rodapé de validação'
		);
		return comMarca;
	}

	return adicionarRodapeSimples(comMarca, assinanteNome, {
		verificationHash,
		verificationUrl,
		rubricBase64
	});
}
