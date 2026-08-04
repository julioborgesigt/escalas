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
import { anonimizarIp } from '../audit';
import { parseUserAgent, reduzirPrecisaoGps } from '../../server/assinatura/document-utils';
import { cifrarCpfParaArmazenar, type CpfCriptoEnv } from '../../crypto/cpf-cripto';

/** Tipo usado só localmente (a origem, `$lib/db/documentos`, é quem os outros módulos importam). */
import type { AssinaturaCadesMetadata } from '../documentos';

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
	env?: CpfCriptoEnv
) {
	const meta = cadesMeta ?? {};
	// CPF cifrado em repouso (LGPD Fase 2).
	const cpfArmazenado = await cifrarCpfParaArmazenar(assinanteCpf, env);

	// Mesmos campos no INSERT e no UPDATE do upsert — montados uma vez só para
	// não haver o risco clássico de acrescentar coluna em um lado e esquecer o
	// outro. `gise_id` fica de fora: é o alvo do conflito.
	//
	// Campo opcional vira `null` EXPLÍCITO, nunca `undefined`: o drizzle omite
	// chave `undefined` do `.set()`, e aí a coluna da assinatura ANTERIOR
	// sobrevive à reassinatura (certificado, selfie e GPS de outra assinatura
	// colados no registro da nova).
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
		ip_address: anonimizarIp(ipAddress) ?? null,
		user_agent: userAgent ? parseUserAgent(userAgent) : null,
		user_agent_raw: userAgent ? userAgent.slice(0, 1024) : null,
		latitude: reduzirPrecisaoGps(latitude) ?? null,
		longitude: reduzirPrecisaoGps(longitude) ?? null,
		tipo_carimbo_tempo: tipoCarimboTempo || 'servidor',
		cert_issuer: meta.cert_issuer ?? null,
		cert_serial: meta.cert_serial ?? null,
		cert_valido_de: meta.cert_valido_de ?? null,
		cert_valido_ate: meta.cert_valido_ate ?? null,
		cms_sha256: meta.cms_sha256 ?? null,
		ocsp_response_b64: meta.ocsp_response_b64 ?? null,
		ocsp_consultado_em: meta.ocsp_consultado_em ?? null,
		tst_token_b64: meta.tst_token_b64 ?? null
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
