/**
 * Documento assinado de uma GISE (um por escala, relação 1:1).
 *
 * Guarda o ponteiro para o PDF no R2 e todo o dossiê da assinatura — quem
 * assinou, prova de vida, GPS, metadados do certificado A3 e resposta OCSP —
 * que a página `/validar` usa para conferir o arquivo depois.
 */
import { eq } from 'drizzle-orm';
import { giseDocumentos } from '../../server/schema';
import type * as schema from '../../server/schema';
import type { Database } from '../core';
import { linhasAfetadas } from '../core';
import { cifrarCpfParaArmazenar } from '../../crypto/cpf-cripto';

// `CircunstanciaAssinatura` traz junto CPF-env, CAdES e passkey — os três tipos
// que este módulo importava um a um antes de a circunstância virar um tipo só.
import { montarCamposMinimizados, type CircunstanciaAssinatura } from '../documentos';

/**
 * O que se grava numa assinatura de escala GISE. NOMEADO — ver o porquê no
 * `DocumentoEscalaEntrada` de `$lib/db/documentos`: eram 19 posicionais, e o
 * call site do `finalizar-assinatura` passava `undefined` nus, sem nem um
 * comentário ao lado.
 *
 * Difere da entrada da escala em três campos, e a diferença é real: aqui
 * `assinanteId`, `assinanteCpf` e `verificacaoHash` são OBRIGATÓRIOS. É por
 * isso que as duas não viram uma função só — o que de fato compartilhavam (a
 * minimização LGPD) já está em `montarCamposMinimizados`.
 */
export interface DocumentoGiseEntrada extends CircunstanciaAssinatura {
	giseId: number;
	r2Key: string;
	assinanteId: number;
	assinanteNome: string;
	assinanteCpf: string;
	verificacaoHash: string;
}

/** Insere o documento assinado. UNIQUE em `gise_id` recusa o segundo (SEC-32). */
export async function salvarGiseDocumento(db: Database, entrada: DocumentoGiseEntrada) {
	const {
		giseId,
		r2Key,
		assinanteId,
		assinanteNome,
		assinanteCpf,
		verificacaoHash,
		selfieKey,
		arquivoHash,
		assinanteEmail
	} = entrada;

	// CPF cifrado em repouso (LGPD Fase 2).
	const cpfArmazenado = await cifrarCpfParaArmazenar(assinanteCpf, entrada.env);

	const dados = {
		r2_key: r2Key,
		assinante_id: assinanteId,
		assinante_nome: assinanteNome,
		assinante_cpf: cpfArmazenado ?? '',
		assinante_email: assinanteEmail ?? null,
		verificacao_hash: verificacaoHash,
		selfie_key: selfieKey ?? null,
		arquivo_hash: arquivoHash ?? null,
		// `entrada` já é uma `CircunstanciaAssinatura` — o objeto inteiro vai, e a
		// lista de campos não se repete entre esta gravação e a da escala.
		...montarCamposMinimizados(entrada)
	};

	const r = await db
		.insert(giseDocumentos)
		.values({ gise_id: giseId, ...dados })
		.onConflictDoNothing();
	return { gravado: linhasAfetadas(r) > 0 };
}

/**
 * A assinatura vigente da escala GISE, ou `undefined` se ainda não foi assinada
 * — há no máximo uma por GISE (`gise_id` unique). `assinante_cpf` sai cifrado.
 */
export async function buscarGiseDocumento(
	db: Database,
	giseId: number
): Promise<schema.GiseDocumento | undefined> {
	return db.select().from(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId)).get();
}
