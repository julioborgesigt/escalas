/**
 * Limpeza unificada de objetos no R2 — fecha os achados R2-1..R2-4 da auditoria
 * de assinatura/R2 (2026-07-11).
 *
 * Motivação: vários caminhos (excluir escala, reabrir GISE, revogar documento,
 * re-assinar) removiam as LINHAS do banco mas deixavam os objetos no R2 órfãos —
 * inclusive selfies biométricas (LGPD art. 11) e PDFs com manifesto forense
 * (CPF/IP/GPS). Como o cascade da FK apaga a linha que guardava o `r2_key`, o
 * órfão fica irrastreável. Este módulo centraliza a coleta + deleção para que
 * TODOS os caminhos removam o mesmo conjunto completo de objetos.
 *
 * Conjuntos cobertos por documento:
 *   - blob assinado (`r2_key`);
 *   - cópia de conferência (`conferencia/<hash>.pdf` — prefixo PLANO, por isso
 *     NÃO é pega por varredura do prefixo `gise/...`; tem de ser adicionada
 *     explicitamente a partir do hash de verificação);
 *   - selfie(s) biométrica(s) (`selfie_key`, e nas presenças
 *     `entrada_selfie_key`/`saida_selfie_key`).
 *
 * Todas as funções são best-effort: falha ao deletar um objeto é logada e NUNCA
 * lança — a remoção da linha no banco (fonte da verdade para /validar) não pode
 * ficar refém do storage.
 */

import { eq } from 'drizzle-orm';
import {
	escalaDocumentos,
	giseDocumentos,
	gisePresencas,
	giseAssinaturasRelatorios,
	gisePresencaTermos
} from './schema';
import { chaveConferencia } from './copia-conferencia';
import { logger } from './logger';
import type { Database } from '$lib/db';

/**
 * Subset estrutural mínimo do binding R2 usado aqui — evita acoplar ao tipo
 * `R2Bucket` completo dos workers-types (que varia entre versões).
 */
export interface R2CleanupBucket {
	delete(keys: string | string[]): Promise<void>;
	list(options?: {
		prefix?: string;
		cursor?: string;
	}): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
}

/**
 * Deleta um conjunto de chaves do R2 (best-effort). Ignora vazias/duplicadas.
 * Nunca lança. Retorna quantas chaves distintas foram tentadas.
 */
export async function deletarChavesR2(
	r2: R2CleanupBucket,
	chaves: Iterable<string | null | undefined>
): Promise<number> {
	const lista = [...new Set([...chaves].filter((k): k is string => !!k))];
	if (lista.length === 0) return 0;
	const resultados = await Promise.allSettled(lista.map((k) => r2.delete(k)));
	resultados.forEach((r, i) => {
		if (r.status === 'rejected') {
			logger.warn('[r2-cleanup] Falha ao deletar objeto do R2', {
				key: lista[i],
				error: r.reason instanceof Error ? r.reason.message : String(r.reason)
			});
		}
	});
	return lista.length;
}

/** Documento com os campos R2 mínimos de uma assinatura de escala. */
interface DocR2Escala {
	r2_key?: string | null;
	verificacao_hash?: string | null;
	selfie_key?: string | null;
}

/**
 * Reúne as chaves R2 de UM documento de escala: blob + conferência + selfie.
 * Pura — não toca o banco nem o R2; o caller compõe/deleta.
 */
export function chavesR2DoDocumentoEscala(doc: DocR2Escala): Set<string> {
	const chaves = new Set<string>();
	if (doc.r2_key) chaves.add(doc.r2_key);
	if (doc.verificacao_hash) chaves.add(chaveConferencia(doc.verificacao_hash));
	if (doc.selfie_key) chaves.add(doc.selfie_key);
	return chaves;
}

/**
 * Remove do R2 todos os objetos do documento assinado de uma escala mensal
 * (blob + conferência + selfie). Use ANTES de excluir a escala/linha — depois
 * do cascade da FK o `r2_key` some e o órfão fica irrastreável (R2-1/R2-3).
 *
 * Retorna o número de objetos tentados (0 se não havia documento).
 */
export async function limparR2DocumentoEscala(
	db: Database,
	r2: R2CleanupBucket,
	escalaId: number
): Promise<number> {
	const doc = await db
		.select({
			r2_key: escalaDocumentos.r2_key,
			verificacao_hash: escalaDocumentos.verificacao_hash,
			selfie_key: escalaDocumentos.selfie_key
		})
		.from(escalaDocumentos)
		.where(eq(escalaDocumentos.escala_id, escalaId))
		.get();
	if (!doc) return 0;
	return deletarChavesR2(r2, chavesR2DoDocumentoEscala(doc));
}

/**
 * Após uma RE-ASSINATURA (novo `verificationHash` → nova key), apaga os objetos
 * do documento ANTERIOR que não fazem parte do novo conjunto (R2-4). O `onConflict`
 * de `salvarDocumentoEscala` sobrescreve a linha, então sem isto o blob/conferência/
 * selfie antigos ficariam órfãos.
 *
 * @param docAntigo documento carregado ANTES de gravar o novo (ou null/undefined).
 * @param chavesNovas chaves R2 que o novo documento passou a referenciar.
 */
export async function limparR2ObsoletoEscala(
	r2: R2CleanupBucket,
	docAntigo: DocR2Escala | null | undefined,
	chavesNovas: Iterable<string | null | undefined>
): Promise<number> {
	if (!docAntigo) return 0;
	const obsoletas = chavesR2DoDocumentoEscala(docAntigo);
	for (const nova of chavesNovas) if (nova) obsoletas.delete(nova);
	return deletarChavesR2(r2, obsoletas);
}

/** GISE mínima para derivar o prefixo de storage. */
interface GiseParaLimpeza {
	id: number;
	data_inicio: string;
}

/**
 * Reúne TODAS as chaves R2 de uma GISE, combinando duas fontes:
 *
 *  1. Varredura do prefixo `gise/<YYYY-MM>/<DD>/<id>/` — pega blobs assinados
 *     (escala/relatórios/termos de presença) e selfies, que vivem sob ele.
 *  2. Coleta explícita das cópias de CONFERÊNCIA (`conferencia/<hash>.pdf`),
 *     que ficam num prefixo PLANO e por isso escapam da varredura acima — o
 *     furo que deixava conferências órfãs mesmo na exclusão total.
 *
 * Também adiciona explicitamente `r2_key`/`selfie_key` das tabelas (defesa em
 * profundidade caso algum objeto tenha sido gravado fora do prefixo esperado).
 */
export async function coletarChavesR2DaGise(
	db: Database,
	r2: R2CleanupBucket,
	gise: GiseParaLimpeza
): Promise<Set<string>> {
	const chaves = new Set<string>();

	const [docs, presencas, assRelat, termos] = await Promise.all([
		db
			.select({
				r2: giseDocumentos.r2_key,
				selfie: giseDocumentos.selfie_key,
				hash: giseDocumentos.verificacao_hash
			})
			.from(giseDocumentos)
			.where(eq(giseDocumentos.gise_id, gise.id))
			.all(),
		db
			.select({
				entrada: gisePresencas.entrada_selfie_key,
				saida: gisePresencas.saida_selfie_key
			})
			.from(gisePresencas)
			.where(eq(gisePresencas.gise_id, gise.id))
			.all(),
		db
			.select({
				selfie: giseAssinaturasRelatorios.selfie_key,
				r2: giseAssinaturasRelatorios.r2_key,
				hash: giseAssinaturasRelatorios.verification_hash
			})
			.from(giseAssinaturasRelatorios)
			.where(eq(giseAssinaturasRelatorios.gise_id, gise.id))
			.all(),
		db
			.select({
				r2: gisePresencaTermos.r2_key,
				hash: gisePresencaTermos.verification_hash
			})
			.from(gisePresencaTermos)
			.where(eq(gisePresencaTermos.gise_id, gise.id))
			.all()
	]);

	const add = (v: string | null | undefined) => {
		if (v) chaves.add(v);
	};
	const addConf = (hash: string | null | undefined) => {
		if (hash) chaves.add(chaveConferencia(hash));
	};

	docs.forEach((d) => {
		add(d.r2);
		add(d.selfie);
		addConf(d.hash);
	});
	presencas.forEach((p) => {
		add(p.entrada);
		add(p.saida);
	});
	assRelat.forEach((a) => {
		add(a.selfie);
		add(a.r2);
		addConf(a.hash);
	});
	termos.forEach((t) => {
		add(t.r2);
		addConf(t.hash);
	});

	// Varredura por prefixo (blobs + selfies sob gise/.../<id>/).
	try {
		const [yyyy, mm, dd] = gise.data_inicio.split('-');
		const prefix = `gise/${yyyy}-${mm}/${dd}/${gise.id}/`;
		let listed = await r2.list({ prefix });
		listed.objects.forEach((obj) => chaves.add(obj.key));
		while (listed.truncated) {
			listed = await r2.list({ prefix, cursor: listed.cursor });
			listed.objects.forEach((obj) => chaves.add(obj.key));
		}
	} catch (e) {
		logger.warn('[r2-cleanup] Falha ao listar prefixo R2 da GISE', {
			gise_id: gise.id,
			error: e instanceof Error ? e.message : String(e)
		});
	}

	return chaves;
}

/**
 * Remove do R2 todos os objetos de uma GISE (blobs + conferências + selfies).
 * Use na EXCLUSÃO total e também ao REABRIR (R2-2/R2-3), antes/depois de apagar
 * as linhas do banco. Retorna quantos objetos foram tentados.
 */
export async function limparR2DaGise(
	db: Database,
	r2: R2CleanupBucket,
	gise: GiseParaLimpeza
): Promise<number> {
	const chaves = await coletarChavesR2DaGise(db, r2, gise);
	return deletarChavesR2(r2, chaves);
}
