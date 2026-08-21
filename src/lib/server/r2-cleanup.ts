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
 * Todas as funções são best-effort: falha ao deletar um objeto NUNCA lança — a
 * remoção da linha no banco (fonte da verdade para /validar) não pode ficar
 * refém do storage.
 *
 * O que mudou em ago/2026 (FLW-R2-004) foi o PREÇO desse best-effort. A falha
 * era um `logger.warn` e o retorno dizia quantas chaves foram TENTADAS; o
 * chamador então apagava a linha que guardava o `r2_key`. Depois disso o objeto
 * existe no bucket e nada no sistema sabe que ele existe — irrastreável por
 * definição, porque a única referência acabou de ser apagada. E não é lixo
 * neutro: é PDF com manifesto forense (CPF, IP, GPS) e selfie biométrica (LGPD
 * art. 11).
 *
 * A política é a MESMA já decidida para a trilha de auditoria (FLW-AUDIT-001):
 * **pendência durável e segue**. A chave que resistiu vai para `r2_pendencias`
 * ANTES de a linha sumir, e `reprocessarPendenciasR2` tenta de novo no cron de
 * retenção. Por isso o retorno passou a distinguir `removidas` de `pendentes`:
 * "tentadas" é um número que não responde a pergunta que se faz a uma limpeza.
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
	escalaDocumentos,
	giseDocumentos,
	giseEquipes,
	giseMembros,
	gisePresencas,
	giseAssinaturasRelatorios,
	gisePresencaTermos,
	giseSeccionais,
	r2Pendencias
} from './schema';
import { chaveConferencia } from './assinatura/copia-conferencia';
import { logger } from './logger';
import type { Database } from '$lib/db';
import { mensagemDeErro } from '$lib/utils/erro';

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

/** O que a limpeza conseguiu, e o que ficou devendo. */
export interface ResultadoLimpezaR2 {
	/** Objetos que saíram do bucket. */
	removidas: number;
	/** Objetos que resistiram e viraram pendência durável, para nova tentativa. */
	pendentes: number;
}

const LIMITE_MOTIVO_R2 = 500;
const LOTE_REPROCESSAMENTO_R2 = 200;

/** `{ removidas: 0, pendentes: 0 }` — o resultado de não ter nada a fazer. */
export const LIMPEZA_R2_VAZIA: ResultadoLimpezaR2 = { removidas: 0, pendentes: 0 };

/**
 * Deleta um conjunto de chaves do R2. Ignora vazias/duplicadas. Nunca lança.
 *
 * O que não sair vira linha em `r2_pendencias`, com o motivo. `origem` é texto
 * livre de triagem ("exclusao-gise", "reassinatura-escala") e serve para o
 * operador saber de onde veio a chave que insiste em não sumir — a linha que
 * daria essa resposta costuma já ter sido apagada quando ele for olhar.
 */
export async function deletarChavesR2(
	db: Database,
	r2: R2CleanupBucket,
	chaves: Iterable<string | null | undefined>,
	origem = 'nao-informada'
): Promise<ResultadoLimpezaR2> {
	const lista = [...new Set([...chaves].filter((k): k is string => !!k))];
	if (lista.length === 0) return { ...LIMPEZA_R2_VAZIA };

	const resultados = await Promise.allSettled(lista.map((k) => r2.delete(k)));

	const falhas: { chave: string; motivo: string }[] = [];
	resultados.forEach((r, i) => {
		if (r.status === 'rejected') {
			const motivo = mensagemDeErro(r.reason);
			logger.warn('[r2-cleanup] Falha ao deletar objeto do R2 — vira pendência', {
				key: lista[i],
				origem,
				error: motivo
			});
			falhas.push({ chave: lista[i], motivo });
		}
	});

	if (falhas.length > 0) await registrarPendenciasR2(db, falhas, origem);

	// A chave que saiu do bucket não pode continuar pendente de uma tentativa
	// anterior: sem isto, uma falha transitória deixaria a pendência para sempre.
	const removidas = lista.filter((_, i) => resultados[i].status === 'fulfilled');
	if (removidas.length > 0) await esquecerPendenciasR2(db, removidas);

	return { removidas: removidas.length, pendentes: falhas.length };
}

/**
 * Grava as chaves que resistiram. NUNCA lança: se nem a pendência consegue
 * gravar, o objeto se perde de vez e só resta o log — limite honesto, igual ao
 * de `registrarPendenciaAudit`.
 */
async function registrarPendenciasR2(
	db: Database,
	falhas: { chave: string; motivo: string }[],
	origem: string
): Promise<void> {
	try {
		await db
			.insert(r2Pendencias)
			.values(
				falhas.map((f) => ({ chave: f.chave, origem, motivo: f.motivo.slice(0, LIMITE_MOTIVO_R2) }))
			)
			.onConflictDoUpdate({
				target: r2Pendencias.chave,
				set: {
					motivo: sql`excluded.motivo`,
					tentativas: sql`${r2Pendencias.tentativas} + 1`,
					ultima_tentativa_em: sql`datetime('now')`
				}
			});
	} catch (err) {
		logger.error('[r2-cleanup] Falha ao registrar PENDÊNCIA — objeto R2 perdido de vista', {
			chaves: falhas.map((f) => f.chave),
			error: mensagemDeErro(err)
		});
	}
}

/** Tira da fila as chaves que já saíram do bucket. Também não lança. */
async function esquecerPendenciasR2(db: Database, chaves: string[]): Promise<void> {
	try {
		await db.delete(r2Pendencias).where(inArray(r2Pendencias.chave, chaves));
	} catch (err) {
		logger.warn('[r2-cleanup] Falha ao limpar pendências já resolvidas', {
			error: mensagemDeErro(err)
		});
	}
}

/**
 * Tenta de novo apagar o que ficou pendente. Roda no cron de retenção, junto
 * com `reprocessarPendenciasAudit` — pelo mesmo motivo: pendência é rara e
 * assíncrona, e um agendador só para ela ficaria anos sem trabalho e seria o
 * primeiro a ser desligado sem ninguém notar.
 *
 * Não remove a pendência que falhou de novo: o `tentativas` crescendo é o sinal
 * de que aquela chave não é transitória e alguém precisa olhar.
 */
export async function reprocessarPendenciasR2(
	db: Database,
	r2: R2CleanupBucket | null
): Promise<ResultadoLimpezaR2> {
	if (!r2) return { ...LIMPEZA_R2_VAZIA };

	const pendentes = await db
		.select({ id: r2Pendencias.id, chave: r2Pendencias.chave, tentativas: r2Pendencias.tentativas })
		.from(r2Pendencias)
		.orderBy(asc(r2Pendencias.created_at), asc(r2Pendencias.id))
		.limit(LOTE_REPROCESSAMENTO_R2);

	let removidas = 0;
	let persistentes = 0;

	for (const linha of pendentes) {
		try {
			await r2.delete(linha.chave);
			await db.delete(r2Pendencias).where(eq(r2Pendencias.id, linha.id));
			removidas++;
		} catch (err) {
			persistentes++;
			await db
				.update(r2Pendencias)
				.set({
					tentativas: linha.tentativas + 1,
					ultima_tentativa_em: sql`datetime('now')`,
					motivo: mensagemDeErro(err).slice(0, LIMITE_MOTIVO_R2)
				})
				.where(eq(r2Pendencias.id, linha.id));
		}
	}

	if (persistentes > 0) {
		logger.error('[r2-cleanup] Objetos que resistiram de novo', { persistentes });
	}
	return { removidas, pendentes: persistentes };
}

/** Quantos objetos seguem no bucket sem referência. Zero é o estado saudável. */
export async function contarPendenciasR2(db: Database): Promise<number> {
	const [r] = await db.select({ n: sql<number>`count(*)` }).from(r2Pendencias);
	return Number(r?.n ?? 0);
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
 */
export async function limparR2DocumentoEscala(
	db: Database,
	r2: R2CleanupBucket,
	escalaId: number
): Promise<ResultadoLimpezaR2> {
	const doc = await db
		.select({
			r2_key: escalaDocumentos.r2_key,
			verificacao_hash: escalaDocumentos.verificacao_hash,
			selfie_key: escalaDocumentos.selfie_key
		})
		.from(escalaDocumentos)
		.where(eq(escalaDocumentos.escala_id, escalaId))
		.get();
	if (!doc) return { ...LIMPEZA_R2_VAZIA };
	return deletarChavesR2(db, r2, chavesR2DoDocumentoEscala(doc), 'documento-escala');
}

/**
 * Após uma RE-ASSINATURA (novo `verificationHash` → nova key), apaga os objetos
 * do documento ANTERIOR que não fazem parte do novo conjunto (R2-4). Com o
 * UNIQUE fail-closed (SEC-32) o segundo INSERT não sobrescreve; este helper
 * cobre o caminho de revogar-e-assinar, se a linha antiga ainda estiver em
 * memória no caller.
 *
 * @param docAntigo documento carregado ANTES de gravar o novo (ou null/undefined).
 * @param chavesNovas chaves R2 que o novo documento passou a referenciar.
 */
export async function limparR2ObsoletoEscala(
	db: Database,
	r2: R2CleanupBucket,
	docAntigo: DocR2Escala | null | undefined,
	chavesNovas: Iterable<string | null | undefined>
): Promise<ResultadoLimpezaR2> {
	if (!docAntigo) return { ...LIMPEZA_R2_VAZIA };
	const obsoletas = chavesR2DoDocumentoEscala(docAntigo);
	for (const nova of chavesNovas) if (nova) obsoletas.delete(nova);
	return deletarChavesR2(db, r2, obsoletas, 'reassinatura-escala');
}

/**
 * Chaves do documento CONSOLIDADO de uma GISE — o PDF da escala, sua cópia de
 * conferência e a selfie de quem assinou.
 *
 * É o conjunto que some quando alguém mexe na composição de uma escala já
 * assinada. Existe separado de `coletarChavesR2DaGise` porque aquele varre a
 * GISE inteira (relatórios, termos, presenças): usá-lo aqui apagaria blobs de
 * documentos que a invalidação NÃO derruba.
 */
export async function coletarChavesR2DoDocumentoGise(
	db: Database,
	giseId: number
): Promise<Set<string>> {
	const docs = await db
		.select({
			r2: giseDocumentos.r2_key,
			selfie: giseDocumentos.selfie_key,
			hash: giseDocumentos.verificacao_hash
		})
		.from(giseDocumentos)
		.where(eq(giseDocumentos.gise_id, giseId))
		.all();

	const chaves = new Set<string>();
	docs.forEach((d) => {
		if (d.r2) chaves.add(d.r2);
		if (d.selfie) chaves.add(d.selfie);
		if (d.hash) chaves.add(chaveConferencia(d.hash));
	});
	return chaves;
}

/**
 * Chaves de tudo que `revogarAssinaturasSeccional` vai deixar sem linha:
 * relatórios de extra assinados pela seccional, selfies de presença dos seus
 * membros e o documento consolidado da escala.
 *
 * Espelha PASSO A PASSO o que aquela função apaga, e é por isso que recebe o id
 * da PARTICIPAÇÃO (`gise_seccionais.id`) e não o da unidade — a mesma distinção
 * que custou FLW-GISE-011. Se as duas divergirem, ou sobra órfão no bucket ou
 * some blob de documento que continua valendo.
 *
 * Chame ANTES da revogação: depois, as linhas que dizem quais objetos existem
 * já foram apagadas.
 */
export async function coletarChavesR2DaRevogacaoSeccional(
	db: Database,
	giseId: number,
	giseSeccionalId: number
): Promise<Set<string>> {
	const chaves = await coletarChavesR2DoDocumentoGise(db, giseId);

	const participacao = await db
		.select({ seccional_id: giseSeccionais.seccional_id })
		.from(giseSeccionais)
		.where(and(eq(giseSeccionais.id, giseSeccionalId), eq(giseSeccionais.gise_id, giseId)))
		.get();
	if (!participacao) return chaves;

	const [relatorios, presencas] = await Promise.all([
		db
			.select({
				r2: giseAssinaturasRelatorios.r2_key,
				selfie: giseAssinaturasRelatorios.selfie_key,
				hash: giseAssinaturasRelatorios.verification_hash
			})
			.from(giseAssinaturasRelatorios)
			.where(
				and(
					eq(giseAssinaturasRelatorios.gise_id, giseId),
					eq(giseAssinaturasRelatorios.seccional_id, participacao.seccional_id)
				)
			)
			.all(),
		db
			.select({
				entrada: gisePresencas.entrada_selfie_key,
				saida: gisePresencas.saida_selfie_key
			})
			.from(gisePresencas)
			.innerJoin(giseMembros, eq(gisePresencas.policial_id, giseMembros.policial_id))
			.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
			.where(
				and(eq(gisePresencas.gise_id, giseId), eq(giseEquipes.gise_seccional_id, giseSeccionalId))
			)
			.all()
	]);

	relatorios.forEach((r) => {
		if (r.r2) chaves.add(r.r2);
		if (r.selfie) chaves.add(r.selfie);
		if (r.hash) chaves.add(chaveConferencia(r.hash));
	});
	presencas.forEach((p) => {
		if (p.entrada) chaves.add(p.entrada);
		if (p.saida) chaves.add(p.saida);
	});

	return chaves;
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
			error: mensagemDeErro(e)
		});
	}

	return chaves;
}

/** O que a exclusão de uma GISE vai destruir, para a tela de confirmação. */
export interface ImpactoExclusaoGise {
	/** Documentos ASSINADOS no D1: escala, relatórios de seccional e termos de presença. */
	documentosAssinados: number;
	/** Objetos no R2: PDFs assinados, cópias de conferência e selfies. */
	arquivosR2: number;
	detalhe: {
		documentoEscala: number;
		relatorios: number;
		termosPresenca: number;
	};
}

/**
 * Conta o que a exclusão destruiria, SEM destruir nada.
 *
 * Existe porque "excluir GISE" não é uma operação reversível nem recuperável: o
 * blob assinado sai do R2 e a linha que prova o ato de assinar sai do D1. Quem
 * confirma precisa ver o número antes, não a palavra "irreversível" — que todo
 * mundo já leu mil vezes e ninguém mais lê.
 *
 * Reaproveita `coletarChavesR2DaGise` de propósito: se a contagem usasse regra
 * própria, ela e a limpeza divergiriam, e o aviso passaria a mentir — o número
 * exibido tem de vir exatamente da mesma varredura que apaga.
 */
export async function contarImpactoExclusaoGise(
	db: Database,
	r2: R2CleanupBucket | null,
	gise: GiseParaLimpeza
): Promise<ImpactoExclusaoGise> {
	const [docs, relatorios, termos] = await Promise.all([
		db
			.select({ id: giseDocumentos.id })
			.from(giseDocumentos)
			.where(eq(giseDocumentos.gise_id, gise.id))
			.all(),
		db
			.select({ id: giseAssinaturasRelatorios.id })
			.from(giseAssinaturasRelatorios)
			.where(eq(giseAssinaturasRelatorios.gise_id, gise.id))
			.all(),
		db
			.select({ id: gisePresencaTermos.id })
			.from(gisePresencaTermos)
			.where(eq(gisePresencaTermos.gise_id, gise.id))
			.all()
	]);

	const arquivosR2 = r2 ? (await coletarChavesR2DaGise(db, r2, gise)).size : 0;

	return {
		documentosAssinados: docs.length + relatorios.length + termos.length,
		arquivosR2,
		detalhe: {
			documentoEscala: docs.length,
			relatorios: relatorios.length,
			termosPresenca: termos.length
		}
	};
}

/**
 * Remove do R2 todos os objetos de uma GISE (blobs + conferências + selfies).
 * Use na EXCLUSÃO total e também ao REABRIR (R2-2/R2-3), ANTES de apagar as
 * linhas do banco — depois delas, o que resistir não teria como ser encontrado
 * de novo, e é exatamente esse o caso em que a pendência salva a chave.
 */
export async function limparR2DaGise(
	db: Database,
	r2: R2CleanupBucket,
	gise: GiseParaLimpeza,
	origem = 'gise'
): Promise<ResultadoLimpezaR2> {
	const chaves = await coletarChavesR2DaGise(db, r2, gise);
	return deletarChavesR2(db, r2, chaves, origem);
}
