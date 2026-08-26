/**
 * Cópia de conferência (A2 da auditoria — minimização de PII / LGPD).
 *
 * O PDF assinado armazenado no R2 contém a página de **manifesto forense**
 * (CPF, IP, GPS, selfie) e é o artefato legal incontestável. Esse blob NUNCA é
 * mutado nem recortado — remover qualquer byte invalidaria a assinatura CMS.
 *
 * Todos os usuários recebem por padrão uma **cópia de conferência**: a escala/relatório
 * regenerado a partir do rascunho (sem manifesto forense), acrescido de um
 * rodapé + QR apontando para `/validar/[hash]`. A confiança vem do portal
 * público `/validar` (que já minimiza PII), não da assinatura embutida.
 *
 * Administradores podem solicitar o PDF forense íntegro passando `?manifesto=true`
 * nos endpoints de download.
 */

import { type UsuarioLogado } from '$lib/auth';
import { getR2, hasR2 } from '$lib/db';
import { contentDisposition, notFound, serverError } from '../api';
import { adicionarRodapeSimples } from './pdf-signing-visual';
import { logger } from '../logger';

/**
 * Quem pode baixar o blob forense pelo portal `/validar` (rota semi-pública,
 * indexada só pelo hash): SOMENTE Super Admin — mais restrito que o
 * `podeBaixarComManifesto` dos endpoints autenticados de download.
 */
export function podeBaixarForense(u: UsuarioLogado | null): boolean {
	return u?.isSuperAdmin === true;
}

// Regra de acesso ao manifesto: definida em $lib/manifesto (módulo client-safe)
// para que a UI esconda o botão "C/ manifesto" com a MESMA regra que o servidor
// aplica aqui nos endpoints de download.
export { podeBaixarComManifesto } from '$lib/manifesto';

/**
 * Chave R2 da CÓPIA DE CONFERÊNCIA, indexada pelo código de verificação. Fonte
 * ÚNICA usada por quem GRAVA a cópia (no `preparar-assinatura`), por quem a SERVE
 * (downloads de escala/GISE e portal `/validar`) e por quem a REMOVE (revogação).
 *
 * Namespace plano (`conferencia/<hash>.pdf`) de propósito: desacopla a cópia da
 * estrutura de chave do documento assinado — que difere entre escala, GISE diária,
 * relatório e presença — de modo que todos os fluxos gravem e leiam do MESMO lugar
 * conhecendo apenas o `verificationHash` (que já é único, é a chave de `/validar`).
 *
 * A cópia é gerada a partir dos MESMOS bytes (base + rodapé universal)
 * que compõem o documento assinado, ficando idêntica por construção. É um artefato
 * de conveniência (não-probatório): a fé pública continua no blob assinado + `/validar`.
 */
export function chaveConferencia(verificationHash: string): string {
	return `conferencia/${verificationHash}.pdf`;
}

interface CopiaConferenciaOpts {
	/** Rascunho já gerado pelo caller (gerarPdf / gerarPdfGise / relatório) — SEM manifesto. */
	pdfRascunho: Uint8Array;
	assinanteNome: string;
	/** Hash de verificação (`/validar/[hash]`). Sem ele, não há rodapé de validação. */
	verificationHash?: string | null;
	verificationUrl?: string;
}

/**
 * Compõe a cópia de conferência: rodapé/QR de validação sobre o rascunho regenerado.
 * NÃO adiciona página de manifesto (`adicionarPaginaAuditoria`) nem marca d'água.
 *
 * Quando `verificationHash`/`verificationUrl` faltam (registro legado sem hash),
 * devolve o rascunho sem rodapé de validação.
 */
export async function gerarCopiaConferencia(opts: CopiaConferenciaOpts): Promise<Uint8Array> {
	const { pdfRascunho, assinanteNome, verificationHash, verificationUrl } = opts;

	if (!verificationHash || !verificationUrl) {
		logger.warn(
			'[copia-conferencia] sem verificationHash/url — servindo rascunho sem rodapé de validação'
		);
		return pdfRascunho;
	}

	return adicionarRodapeSimples(pdfRascunho, assinanteNome, {
		verificationHash,
		verificationUrl
	});
}

function pdfAssinadoResponse(body: BodyInit, filename: string): Response {
	return new Response(body, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': contentDisposition(filename),
			'Cache-Control': 'private, no-store'
		}
	});
}

/**
 * GET de documento assinado: manifesto forense (se pedido e autorizado) →
 * cópia de conferência no R2 → regeneração a partir do rascunho.
 *
 * Permissão e lookup do registro ficam no caller (escala e GISE divergem).
 * O pipeline de bytes era idêntico nos dois `documento-assinado/+server.ts`.
 */
export async function responderPdfAssinado(opts: {
	platform: App.Platform | undefined;
	r2Key: string;
	verificacaoHash: string | null;
	assinanteNome: string;
	querManifesto: boolean;
	podeManifesto: boolean;
	nomeManifesto: string;
	nomeConferencia: string;
	logContexto: string;
	origin: string;
	gerarRascunho: () => Promise<Uint8Array | Response>;
}): Promise<Response> {
	const {
		platform,
		r2Key,
		verificacaoHash,
		assinanteNome,
		querManifesto,
		podeManifesto,
		nomeManifesto,
		nomeConferencia,
		logContexto,
		origin,
		gerarRascunho
	} = opts;

	if (querManifesto && podeManifesto) {
		if (!hasR2(platform)) {
			return serverError(`[${logContexto}] R2 não configurado`, new Error('R2_NOT_CONFIGURED'));
		}
		const object = await getR2(platform).get(r2Key);
		if (!object) return notFound('Arquivo PDF no Storage');
		return pdfAssinadoResponse(object.body as unknown as BodyInit, nomeManifesto);
	}

	if (hasR2(platform) && verificacaoHash) {
		const confObj = await getR2(platform).get(chaveConferencia(verificacaoHash));
		if (confObj) {
			return pdfAssinadoResponse(confObj.body as unknown as BodyInit, nomeConferencia);
		}
	}

	const rascunho = await gerarRascunho();
	if (rascunho instanceof Response) return rascunho;
	const hash = verificacaoHash ?? undefined;
	const buffer = await gerarCopiaConferencia({
		pdfRascunho: rascunho,
		assinanteNome,
		verificationHash: hash,
		verificationUrl: hash ? `${origin}/validar/${hash}` : undefined
	});
	return pdfAssinadoResponse(buffer as unknown as BodyInit, nomeConferencia);
}
