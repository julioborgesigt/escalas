/**
 * Miolo comum dos quatro `preparar-assinatura`.
 *
 * Cada rota gera o PDF do seu domínio (escala, GISE, termo, relatório); daí em
 * diante o caminho é o MESMO — abrir o placeholder PAdES, gravar a cópia de
 * conferência (best-effort) e registrar a intenção de uso único. Isso vivia
 * copiado byte a byte, e correção num lado (FLW-DOC-001) não chegava nos outros.
 *
 * `prepararAssinaturaPorToken` é o portão: `fecharPreparacaoAssinatura` NÃO é
 * exportado justamente para que uma rota não possa remontar a sequência à mão e
 * esquecer um dos dois passos. A rota diz ONDE o campo cai (alinhamento, altura
 * e página) e QUAL é o alvo; o resto não é decisão dela.
 *
 * Até ago/2026 a chamada a `prepararPdfParaAssinatura` ficava em cada rota,
 * porque as quatro divergiam nos argumentos da rubrica (imagem, X e Y). Com a
 * rubrica removida, os quatro call sites viraram o mesmo texto — e aí a
 * extração passou a ser possível.
 *
 * Não gera PDF de conteúdo. Não autoriza. O caller já recusou quem não podia.
 */
import { json } from '@sveltejs/kit';
import { tryGetR2 } from '$lib/db';
import type { Database } from '$lib/db';
import { logger } from '../logger';
import { chaveConferencia } from './copia-conferencia';
import { criarIntencaoAssinatura, type AlvoAssinatura, type AtorAssinatura } from './intencao';
import { prepararPdfParaAssinatura } from './pdf-signing-prepare';
import { mensagemDeErro } from '$lib/utils/erro';

type CamposPreparacaoAssinatura = {
	signedAttrsHashHex: string;
	messageDigest: string;
	signingTimeISO: string;
	dataToSignBase64: string;
	documentHash: string;
	assinanteEmail?: string | null;
};

/**
 * Fecha o ciclo de preparação: grava a cópia de conferência no R2 (se o
 * binding existir; falha aqui NUNCA aborta a assinatura) e registra a intenção
 * que o finalizar vai consumir.
 */
async function fecharPreparacaoAssinatura(opts: {
	db: Database;
	platform: App.Platform | undefined;
	alvo: AlvoAssinatura;
	ator: AtorAssinatura;
	preparedPdf: Uint8Array;
	verificationHash: string;
	campos: CamposPreparacaoAssinatura;
	conferencia: {
		pdfComRodape: Uint8Array;
		logTag: string;
		logFields?: Record<string, unknown>;
	};
}): Promise<Response> {
	const { db, platform, alvo, ator, preparedPdf, verificationHash, campos, conferencia } = opts;

	const r2 = tryGetR2(platform);
	if (r2) {
		try {
			await r2.put(chaveConferencia(verificationHash), conferencia.pdfComRodape, {
				httpMetadata: { contentType: 'application/pdf' }
			});
		} catch (err) {
			logger.warn(`[${conferencia.logTag}] Falha ao gravar cópia de conferência`, {
				...conferencia.logFields,
				error: mensagemDeErro(err)
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

/** Onde o campo de assinatura cai no PDF — a única coisa que varia entre os domínios. */
export type CampoAssinatura = {
	/** Escala e GISE ancoram à direita; termo e relatório, ao centro. */
	alignment: 'center' | 'right';
	/** Base do campo, em pontos a partir do pé da página. */
	boxY: number;
	/** Página que recebe o campo (0-based) — a última de CONTEÚDO, não a do manifesto. */
	targetPageIndex: number;
};

/**
 * Abre o placeholder PAdES no estilo `'campo-limpo'` e fecha o ciclo de
 * preparação. É por aqui que os quatro `preparar-assinatura` passam.
 *
 * `pdfComAuditoria` é o que recebe o placeholder (conteúdo + rodapé +
 * manifesto); `pdfComRodape` é o MESMO documento sem o manifesto, e é ele que
 * vira a cópia de conferência — trocar um pelo outro entrega ao conferente um
 * PDF que não corresponde ao assinado.
 */
export async function prepararAssinaturaPorToken(opts: {
	db: Database;
	platform: App.Platform | undefined;
	alvo: AlvoAssinatura;
	ator: AtorAssinatura;
	pdfComAuditoria: Uint8Array;
	pdfComRodape: Uint8Array;
	signerName: string;
	assinanteEmail?: string | null;
	documentHash: string;
	verificationHash: string;
	verificationUrl: string;
	campo: CampoAssinatura;
	logTag: string;
	logFields?: Record<string, unknown>;
}): Promise<Response> {
	const { preparedPdf, signedAttrsHashHex, messageDigest, signingTimeISO, dataToSignBase64 } =
		await prepararPdfParaAssinatura(
			opts.pdfComAuditoria,
			opts.signerName,
			opts.campo.alignment,
			opts.verificationHash,
			opts.verificationUrl,
			opts.campo.boxY,
			opts.campo.targetPageIndex,
			'campo-limpo'
		);

	return fecharPreparacaoAssinatura({
		db: opts.db,
		platform: opts.platform,
		alvo: opts.alvo,
		ator: opts.ator,
		preparedPdf,
		verificationHash: opts.verificationHash,
		campos: {
			signedAttrsHashHex,
			messageDigest,
			signingTimeISO,
			dataToSignBase64,
			documentHash: opts.documentHash,
			assinanteEmail: opts.assinanteEmail
		},
		conferencia: {
			pdfComRodape: opts.pdfComRodape,
			logTag: opts.logTag,
			logFields: opts.logFields
		}
	});
}
