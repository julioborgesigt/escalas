/**
 * Documento assinado de uma GISE (um por escala, relação 1:1).
 *
 * Guarda o ponteiro para o PDF no R2 e todo o dossiê da assinatura — quem
 * assinou, rubrica, prova de vida, GPS, metadados do certificado A3 e resposta
 * OCSP — que a página `/validar` usa para conferir o arquivo depois.
 */
import { eq, sql } from 'drizzle-orm';
import { giseDocumentos } from '../../server/schema';
import type * as schema from '../../server/schema';
import type { Database } from '../core';
import { cifrarCpfParaArmazenar, type CpfCriptoEnv } from '../../crypto/cpf-cripto';

/** Tipo usado só localmente (a origem, `$lib/db/documentos`, é quem os outros módulos importam). */
import type { AssinaturaCadesMetadata, AssinaturaPasskeyMetadata } from '../documentos';
import { montarCamposMinimizados } from '../documentos';

/** Insere o documento assinado ou substitui o anterior (upsert por `gise_id`). */
export async function salvarGiseDocumento(
	db: Database,
	giseId: number,
	r2Key: string,
	assinanteId: number,
	assinanteNome: string,
	assinanteCpf: string,
	verificacaoHash: string,
	rubrica?: string,
	ipAddress?: string,
	userAgent?: string,
	latitude?: number,
	longitude?: number,
	selfieKey?: string,
	arquivoHash?: string,
	assinanteEmail?: string,
	tipoCarimboTempo?: string,
	cadesMeta?: AssinaturaCadesMetadata,
	env?: CpfCriptoEnv,
	// Depois de `env`, como em `salvarDocumentoEscala`: a lista posicional já
	// está no limite. Quem usa passkey passa os dois últimos explicitamente.
	passkeyMeta?: AssinaturaPasskeyMetadata
) {
	// CPF cifrado em repouso (LGPD Fase 2).
	const cpfArmazenado = await cifrarCpfParaArmazenar(assinanteCpf, env);

	// Mesmos campos no INSERT e no UPDATE do upsert — montados uma vez só para
	// não haver o risco clássico de acrescentar coluna em um lado e esquecer o
	// outro. `gise_id` fica de fora: é o alvo do conflito.
	const dados = {
		r2_key: r2Key,
		assinante_id: assinanteId,
		assinante_nome: assinanteNome,
		assinante_cpf: cpfArmazenado ?? '',
		assinante_email: assinanteEmail ?? null,
		verificacao_hash: verificacaoHash,
		selfie_key: selfieKey ?? null,
		arquivo_hash: arquivoHash ?? null,
		rubrica: rubrica || null,
		...montarCamposMinimizados({
			ipAddress,
			userAgent,
			latitude,
			longitude,
			tipoCarimboTempo,
			cadesMeta,
			passkeyMeta
		})
	};

	return db
		.insert(giseDocumentos)
		.values({ gise_id: giseId, ...dados })
		.onConflictDoUpdate({
			target: [giseDocumentos.gise_id],
			// Reassinatura substitui o documento anterior por inteiro, inclusive o
			// carimbo de criação — o que vale é a assinatura vigente.
			set: { ...dados, created_at: sql`datetime('now', '-3 hours')` }
		});
}

/**
 * A assinatura vigente da escala GISE, ou `undefined` se ainda não foi assinada
 * — há no máximo uma por GISE (`gise_id` é o alvo do conflito no upsert).
 * `assinante_cpf` sai cifrado.
 */
export async function buscarGiseDocumento(
	db: Database,
	giseId: number
): Promise<schema.GiseDocumento | undefined> {
	return db.select().from(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId)).get();
}
