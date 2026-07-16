/**
 * Fluxo compartilhado de assinatura com certificado digital em três etapas:
 * preparar (gera o PDF e o digest no servidor) → assinar (provider externo,
 * ex.: Assinador SERPRO) → finalizar (embute o CMS no PDF).
 *
 * Centraliza a orquestração que era duplicada entre PainelAssinaturaToken,
 * useAssinaturaEscala e a assinatura em lote dos relatórios de extra da GISE
 * — correções de robustez entravam num lugar e não nos outros.
 */
import { apiFetch, apiFetchResponse } from '$lib/api-fetch';

/** Campos comuns devolvidos pelos endpoints de preparar-assinatura. */
export interface PreparacaoAssinatura {
	preparedPdf: string;
	messageDigest: string;
	signingTimeISO: string;
	verificationHash: string;
	/** Presentes apenas em alguns endpoints; repassados ao finalizar quando existirem. */
	signedAttrsHashHex?: string;
	documentHash?: string;
	assinanteEmail?: string;
}

/** Converte o messageDigest hex para o base64 que o assinador espera em sign(). */
export function digestHexParaBase64(hex: string): string {
	// O hex vem dos endpoints de preparar-assinatura e é sempre um hex
	// válido de tamanho par, então match() nunca retorna null aqui.
	return btoa(
		hex
			.match(/.{2}/g)!
			.map((h) => String.fromCharCode(parseInt(h, 16)))
			.join('')
	);
}

/**
 * Executa um ciclo completo preparar → assinar → finalizar.
 *
 * Devolve a Response crua do finalizar porque o corpo de sucesso varia por
 * endpoint (PDF para download, JSON de confirmação) — o chamador decide como
 * consumir. Qualquer etapa que falhe lança Error com a mensagem do servidor
 * (incluindo `errorId` quando presente).
 */
export async function executarFluxoAssinaturaToken(opts: {
	prepararUrl: string;
	finalizarUrl: string;
	/** Body do POST de preparar (signerName/CPF, coordenadas, extras...). */
	payloadPreparar: Record<string, unknown>;
	/**
	 * Assina o digest preparado (ex.: client.sign do SERPRO) e devolve os
	 * campos de assinatura a incluir no finalizar (serproCms, rawSignature...).
	 */
	obterAssinatura: (prep: PreparacaoAssinatura) => Promise<Record<string, unknown>>;
	/** Campos adicionais do POST de finalizar (signerName/CPF, coordenadas, extras...). */
	payloadFinalizar?: Record<string, unknown>;
	/** Chamado ao iniciar o finalizar (para atualizar o loading do chamador). */
	onFinalizando?: () => void;
}): Promise<Response> {
	const prep = await apiFetch<PreparacaoAssinatura>(opts.prepararUrl, {
		method: 'POST',
		body: JSON.stringify(opts.payloadPreparar)
	});

	const assinatura = await opts.obterAssinatura(prep);

	opts.onFinalizando?.();
	// documentHash/assinanteEmail só existem em alguns endpoints; undefined
	// é descartado pelo JSON.stringify, então repassar sempre é inócuo.
	return apiFetchResponse(opts.finalizarUrl, {
		method: 'POST',
		body: JSON.stringify({
			preparedPdf: prep.preparedPdf,
			...assinatura,
			messageDigest: prep.messageDigest,
			signingTimeISO: prep.signingTimeISO,
			verificationHash: prep.verificationHash,
			documentHash: prep.documentHash,
			assinanteEmail: prep.assinanteEmail,
			...opts.payloadFinalizar
		})
	});
}
