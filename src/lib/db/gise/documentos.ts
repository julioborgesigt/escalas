import { eq, sql } from 'drizzle-orm';
import { giseDocumentos } from '../../server/schema';
import type * as schema from '../../server/schema';
import type { Database } from '../core';
import { anonimizarIp } from '../audit';
import { parseUserAgent } from '../../server/document-utils';

function gps2(v?: number): number | undefined {
	return v !== undefined ? Math.round(v * 100) / 100 : undefined;
}

/** Reexportado de '../documentos' para uso pelos endpoints. */
import type { AssinaturaCadesMetadata } from '../documentos';

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
	cadesMeta?: AssinaturaCadesMetadata
) {
	const meta = cadesMeta ?? {};
	return db
		.insert(giseDocumentos)
		.values({
			gise_id: giseId,
			r2_key: r2Key,
			assinante_id: assinanteId,
			assinante_nome: assinanteNome,
			assinante_cpf: assinanteCpf,
			assinante_email: assinanteEmail ?? null,
			verificacao_hash: verificacaoHash,
			selfie_key: selfieKey,
			arquivo_hash: arquivoHash,
			rubrica: rubrica || null,
			ip_address: anonimizarIp(ipAddress) ?? undefined,
			user_agent: userAgent ? parseUserAgent(userAgent) : undefined,
			user_agent_raw: userAgent ? userAgent.slice(0, 1024) : undefined,
			latitude: gps2(latitude),
			longitude: gps2(longitude),
			tipo_carimbo_tempo: tipoCarimboTempo || 'servidor',
			cert_issuer: meta.cert_issuer ?? null,
			cert_serial: meta.cert_serial ?? null,
			cert_valido_de: meta.cert_valido_de ?? null,
			cert_valido_ate: meta.cert_valido_ate ?? null,
			cms_sha256: meta.cms_sha256 ?? null,
			ocsp_response_b64: meta.ocsp_response_b64 ?? null,
			ocsp_consultado_em: meta.ocsp_consultado_em ?? null,
			tst_token_b64: meta.tst_token_b64 ?? null
		})
		.onConflictDoUpdate({
			target: [giseDocumentos.gise_id],
			set: {
				r2_key: r2Key,
				assinante_id: assinanteId,
				assinante_nome: assinanteNome,
				assinante_cpf: assinanteCpf,
				assinante_email: assinanteEmail ?? null,
				verificacao_hash: verificacaoHash,
				selfie_key: selfieKey,
				arquivo_hash: arquivoHash,
				rubrica: rubrica || null,
				ip_address: anonimizarIp(ipAddress) ?? undefined,
				user_agent: userAgent ? parseUserAgent(userAgent) : undefined,
				user_agent_raw: userAgent ? userAgent.slice(0, 1024) : undefined,
				latitude: gps2(latitude),
				longitude: gps2(longitude),
				tipo_carimbo_tempo: tipoCarimboTempo || 'servidor',
				cert_issuer: meta.cert_issuer ?? null,
				cert_serial: meta.cert_serial ?? null,
				cert_valido_de: meta.cert_valido_de ?? null,
				cert_valido_ate: meta.cert_valido_ate ?? null,
				cms_sha256: meta.cms_sha256 ?? null,
				ocsp_response_b64: meta.ocsp_response_b64 ?? null,
				ocsp_consultado_em: meta.ocsp_consultado_em ?? null,
				tst_token_b64: meta.tst_token_b64 ?? null,
				created_at: sql`datetime('now', '-3 hours')`
			}
		});
}

export async function buscarGiseDocumento(
	db: Database,
	giseId: number
): Promise<schema.GiseDocumento | undefined> {
	return db.select().from(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId)).get();
}
