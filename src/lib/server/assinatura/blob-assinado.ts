/**
 * Guardar o PDF assinado é PARTE do ato de assinar — FLW-R2-003.
 *
 * Os seis finalizadores (escala GISE, relatório de extra, termo de presença, e
 * as duas variantes de escala mensal) tratavam o R2 como opcional:
 *
 *     const r2 = tryGetR2(p);
 *     if (r2) await r2.put(chave, pdf);
 *     await salvarDocumento(db, ..., chave, hash, ...);   // sempre
 *
 * Sem bucket, a linha era gravada do mesmo jeito, com uma `r2_key` apontando
 * para nada. O certificado foi consumido, o hash de verificação foi emitido e
 * impresso, e `/validar` passa a resolver esse hash para um documento que não
 * existe. Do lado de quem confere, é indistinguível de um documento adulterado.
 *
 * A regra que este módulo impõe é a inversa: **sem onde guardar, não assina.**
 * Recusar antes é reversível — a pessoa tenta de novo em dez minutos. Assinar e
 * não guardar não é: o ato aconteceu e o documento não existe.
 *
 * A outra ponta é a compensação. O `put` vem antes das escritas no D1 (é o que
 * garante que a linha nunca aponte para o vazio), então uma falha no D1 deixa o
 * blob órfão no bucket — e `compensarBlobAssinado` o remove, caindo na
 * pendência durável de `deletarChavesR2` se nem isso funcionar.
 */
import { apiError, ErrorCode, serverError } from '../api';
import { deletarChavesR2, type R2CleanupBucket } from '../r2-cleanup';
import { logger } from '../logger';
import type { Database } from '$lib/db';
import { mensagemDeErro } from '$lib/utils/erro';

/** Binding R2 mínimo para gravar um documento assinado. */
export interface R2ParaAssinatura extends R2CleanupBucket {
	put(
		key: string,
		value: ArrayBuffer | Uint8Array,
		options?: { httpMetadata?: { contentType?: string } }
	): Promise<unknown>;
}

/**
 * O bucket, ou a resposta que RECUSA a assinatura por não haver onde guardar.
 *
 * Chame ANTES de consumir o certificado/token de intenção. Depois disso a
 * recusa já custou o ato.
 */
export function bucketParaAssinatura(
	r2: R2ParaAssinatura | undefined | null
): { ok: true; r2: R2ParaAssinatura } | { ok: false; resposta: Response } {
	if (r2) return { ok: true, r2 };
	logger.error('[assinatura] R2 indisponível — assinatura RECUSADA', {});
	return {
		ok: false,
		resposta: apiError(
			'Armazenamento de documentos indisponível. A assinatura não foi realizada — ' +
				'tente novamente em alguns minutos.',
			503,
			ErrorCode.UPSTREAM
		)
	};
}

/**
 * Grava o PDF assinado. Falha vira recusa, não sucesso silencioso.
 *
 * O `put` do R2 pode falhar mesmo com o binding presente (rede, quota), e o
 * `if (r2)` anterior não cobria esse caso — a exceção subia para o `catch`
 * genérico do endpoint, que devolvia 500 DEPOIS de a linha já ter sido gravada
 * em alguns dos caminhos.
 */
export async function guardarPdfAssinado(
	r2: R2ParaAssinatura,
	chave: string,
	bytes: ArrayBuffer | Uint8Array,
	contexto: string
): Promise<{ ok: true } | { ok: false; resposta: Response }> {
	try {
		await r2.put(chave, bytes, { httpMetadata: { contentType: 'application/pdf' } });
		return { ok: true };
	} catch (err) {
		logger.error('[assinatura] Falha ao gravar PDF assinado no R2', {
			contexto,
			chave,
			error: mensagemDeErro(err)
		});
		return { ok: false, resposta: serverError(`gravar PDF assinado (${contexto})`, err) };
	}
}

/**
 * O D1 falhou depois de o blob já estar no bucket: remove o órfão.
 *
 * Best-effort por construção — `deletarChavesR2` não lança e o que resistir
 * vira pendência durável (FLW-R2-004). O erro que o usuário recebe é o da
 * persistência, não o da faxina.
 */
export async function compensarBlobAssinado(
	db: Database,
	r2: R2ParaAssinatura,
	chaves: (string | null | undefined)[],
	contexto: string
): Promise<void> {
	logger.error('[assinatura] Persistência falhou; removendo blob assinado órfão', {
		contexto,
		chaves: chaves.filter(Boolean)
	});
	await deletarChavesR2(db, r2, chaves, `compensacao-${contexto}`);
}
