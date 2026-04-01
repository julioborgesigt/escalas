import { eq, sql } from 'drizzle-orm';
import { escalaDocumentos, giseDocumentos } from '../server/schema';
import type * as schema from '../server/schema';
import type { Database } from './core';
import * as fullSchema from '../server/schema';

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
	arquivoHash?: string
) {
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
			ip_address: ipAddress,
			user_agent: userAgent,
			latitude,
			longitude
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
				ip_address: ipAddress,
				user_agent: userAgent,
				latitude,
				longitude,
				created_at: sql`datetime('now')`
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
	// 1. Escalas comuns
	const esc = await db
		.select()
		.from(escalaDocumentos)
		.where(eq(escalaDocumentos.verificacao_hash, hash))
		.get();
	if (esc) return { ...esc, tipo_doc: 'escala' as const };

	// 2. Escalas GISE (gerais)
	const gise = await db
		.select()
		.from(giseDocumentos)
		.where(eq(giseDocumentos.verificacao_hash, hash))
		.get();
	if (gise) return { ...gise, escala_id: gise.gise_id, tipo_doc: 'gise' as const };

	// 3. Relatórios GISE (extraordinário/produtividade)
	const rel = await db
		.select()
		.from(fullSchema.giseAssinaturasRelatorios)
		.where(eq(fullSchema.giseAssinaturasRelatorios.verification_hash, hash))
		.get();
	if (rel) {
		return {
			id: rel.id,
			escala_id: rel.gise_id,
			assinante_nome: rel.assinante_nome,
			assinante_cpf: rel.assinante_cpf,
			created_at: rel.created_at,
			tipo_doc: 'gise_relatorio' as const,
			rel_tipo: rel.tipo,
			seccional_id: rel.seccional_id,
			ip_address: rel.ip_address,
			user_agent: rel.user_agent,
			latitude: rel.latitude,
			longitude: rel.longitude
		};
	}

	return undefined;
}
