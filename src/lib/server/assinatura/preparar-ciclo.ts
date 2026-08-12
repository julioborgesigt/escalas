/**
 * Miolo comum dos quatro `preparar-assinatura`.
 *
 * Cada rota gera o PDF do seu domínio (escala, GISE, termo, relatório) e
 * posiciona o placeholder. O que vinha DEPOIS — gravar a cópia de conferência
 * (best-effort) e registrar a intenção de uso único — estava copiado byte a
 * byte. Correção num lado (FLW-DOC-001) não chegava nos outros.
 *
 * Não gera PDF. Não autoriza. O caller já recusou quem não podia.
 */
import { json } from '@sveltejs/kit';
import { tryGetR2 } from '$lib/db';
import type { Database } from '$lib/db';
import { logger } from '../logger';
import { chaveConferencia } from './copia-conferencia';
import { criarIntencaoAssinatura, type AlvoAssinatura, type AtorAssinatura } from './intencao';
import { estamparRubricaLimpa } from './pdf-signing-prepare';

type StampConferencia = Parameters<typeof estamparRubricaLimpa>[1];

export type CamposPreparacaoAssinatura = {
	signedAttrsHashHex: string;
	messageDigest: string;
	signingTimeISO: string;
	dataToSignBase64: string;
	documentHash: string;
	assinanteEmail?: string | null;
};

/**
 * Fecha o ciclo de preparação: estampa a cópia de conferência no R2 (se o
 * binding existir; falha aqui NUNCA aborta a assinatura) e grava a intenção
 * que o finalizar vai consumir.
 */
export async function fecharPreparacaoAssinatura(opts: {
	db: Database;
	platform: App.Platform | undefined;
	alvo: AlvoAssinatura;
	ator: AtorAssinatura;
	preparedPdf: Uint8Array;
	verificationHash: string;
	campos: CamposPreparacaoAssinatura;
	conferencia: {
		pdfComRodape: Uint8Array;
		stamp: StampConferencia;
		logTag: string;
		logFields?: Record<string, unknown>;
	};
}): Promise<Response> {
	const { db, platform, alvo, ator, preparedPdf, verificationHash, campos, conferencia } = opts;

	const r2 = tryGetR2(platform);
	if (r2) {
		try {
			const conferenciaPdf = await estamparRubricaLimpa(
				conferencia.pdfComRodape,
				conferencia.stamp
			);
			await r2.put(chaveConferencia(verificationHash), conferenciaPdf, {
				httpMetadata: { contentType: 'application/pdf' }
			});
		} catch (err) {
			logger.warn(`[${conferencia.logTag}] Falha ao gerar/gravar cópia de conferência`, {
				...conferencia.logFields,
				error: err instanceof Error ? err.message : String(err)
			});
		}
	}

	const intencao = await criarIntencaoAssinatura(db, alvo, ator, preparedPdf, verificationHash);

	return json({
		intencao,
		signedAttrsHashHex: campos.signedAttrsHashHex,
		preparedPdf: Buffer.from(preparedPdf).toString('base64'),
		messageDigest: campos.messageDigest,
		signingTimeISO: campos.signingTimeISO,
		dataToSignBase64: campos.dataToSignBase64,
		verificationHash,
		documentHash: campos.documentHash,
		assinanteEmail: campos.assinanteEmail ?? undefined
	});
}
