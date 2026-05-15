import { eq, sql } from 'drizzle-orm';
import { escalaDocumentos, giseDocumentos } from '../server/schema';
import type * as schema from '../server/schema';
import type { Database } from './core';
import * as fullSchema from '../server/schema';
import { anonimizarIp } from './audit';
import { parseUserAgent } from '../server/document-utils';

/** Reduz a precisão de coordenada GPS para ~1 km (2 casas decimais). */
function gps2(v?: number): number | undefined {
	return v !== undefined ? Math.round(v * 100) / 100 : undefined;
}

/**
 * Metadados criptográficos persistidos junto com a assinatura (CAdES-LT).
 * Campos opcionais; signatures avançadas/simples passam undefined.
 */
export interface AssinaturaCadesMetadata {
	cert_issuer?: string;
	cert_serial?: string;
	cert_valido_de?: string;
	cert_valido_ate?: string;
	cms_sha256?: string;
	ocsp_response_b64?: string;
	ocsp_consultado_em?: string;
	tst_token_b64?: string;
}

export async function salvarDocumentoEscala(
	db: Database,
	escalaId: number,
	r2Key: string,
	assinanteNome: string,
	assinanteCpf?: string,
	verificacaoHash?: string,
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
		.insert(escalaDocumentos)
		.values({
			escala_id: escalaId,
			r2_key: r2Key,
			assinante_nome: assinanteNome,
			assinante_cpf: assinanteCpf || '',
			verificacao_hash: verificacaoHash,
			selfie_key: selfieKey,
			arquivo_hash: arquivoHash,
			ip_address: anonimizarIp(ipAddress) ?? undefined,
			user_agent: userAgent ? parseUserAgent(userAgent) : undefined,
			latitude: gps2(latitude),
			longitude: gps2(longitude),
			assinante_email: assinanteEmail ?? null,
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
			target: escalaDocumentos.escala_id,
			set: {
				r2_key: r2Key,
				assinante_nome: assinanteNome,
				assinante_cpf: assinanteCpf || '',
				verificacao_hash: verificacaoHash,
				selfie_key: selfieKey,
				arquivo_hash: arquivoHash,
				ip_address: anonimizarIp(ipAddress) ?? undefined,
				user_agent: userAgent ? parseUserAgent(userAgent) : undefined,
				latitude: gps2(latitude),
				longitude: gps2(longitude),
				assinante_email: assinanteEmail ?? null,
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

export async function buscarDocumentoEscala(
	db: Database,
	escalaId: number
): Promise<schema.EscalaDocumento | undefined> {
	return db.select().from(escalaDocumentos).where(eq(escalaDocumentos.escala_id, escalaId)).get();
}

export async function excluirDocumentoEscala(db: Database, escalaId: number) {
	return db.delete(escalaDocumentos).where(eq(escalaDocumentos.escala_id, escalaId));
}

export async function buscarDocumentoPorHash(db: Database, hash: string) {
	// Query all 3 tables in parallel instead of sequentially
	const [esc, gise, rel] = await Promise.all([
		db.select().from(escalaDocumentos).where(eq(escalaDocumentos.verificacao_hash, hash)).get(),
		db.select().from(giseDocumentos).where(eq(giseDocumentos.verificacao_hash, hash)).get(),
		db.select().from(fullSchema.giseAssinaturasRelatorios).where(eq(fullSchema.giseAssinaturasRelatorios.verification_hash, hash)).get()
	]);

	if (esc) return { ...esc, tipo_doc: 'escala' as const };
	if (gise) return { ...gise, escala_id: gise.gise_id, r2_key: gise.r2_key, tipo_doc: 'gise' as const };
	if (rel) {
		return {
			id: rel.id,
			escala_id: rel.gise_id,
			assinante_nome: rel.assinante_nome,
			assinante_cpf: rel.assinante_cpf,
			created_at: rel.created_at,
			tipo_doc: 'gise_relatorio' as const,
			rel_tipo: rel.tipo,
			tipo_assinatura: rel.tipo_assinatura,
			seccional_id: rel.seccional_id,
			ip_address: rel.ip_address,
			user_agent: rel.user_agent,
			latitude: rel.latitude,
			longitude: rel.longitude,
			r2_key: rel.r2_key,
			arquivo_hash: rel.arquivo_hash,
			tipo_carimbo_tempo: rel.tipo_carimbo_tempo,
			cert_issuer: rel.cert_issuer,
			cert_serial: rel.cert_serial,
			cert_valido_de: rel.cert_valido_de,
			cert_valido_ate: rel.cert_valido_ate,
			cms_sha256: rel.cms_sha256,
			ocsp_response_b64: rel.ocsp_response_b64,
			ocsp_consultado_em: rel.ocsp_consultado_em,
			tst_token_b64: rel.tst_token_b64
		};
	}

	return undefined;
}
