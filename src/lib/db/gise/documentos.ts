import { eq, and, or, ne, isNotNull, desc, asc, inArray, sql } from 'drizzle-orm';
import {
	giseEscalas,
	giseSeccionais,
	giseEquipes,
	giseMembros,
	giseDocumentos,
	gisePresencas,
	giseModeloFormulario,
	giseRespostasFormulario,
	giseAssinaturasRelatorios,
	giseSeccionalUnidades,
	policiais,
	unidades
} from '../../server/schema';
import type * as schema from '../../server/schema';
import type { Database } from '../core';

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
	tipoCarimboTempo?: string
) {
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
			ip_address: ipAddress,
			user_agent: userAgent,
			latitude,
			longitude,
			tipo_carimbo_tempo: tipoCarimboTempo || 'servidor'
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
				ip_address: ipAddress,
				user_agent: userAgent,
				latitude,
				longitude,
				tipo_carimbo_tempo: tipoCarimboTempo || 'servidor',
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
