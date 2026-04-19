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

export async function buscarAssinaturasRelatoriosGise(db: Database, giseId: number) {
	return db
		.select()
		.from(giseAssinaturasRelatorios)
		.where(eq(giseAssinaturasRelatorios.gise_id, giseId))
		.all();
}

export async function buscarAssinaturaRelatorioGise(
	db: Database,
	giseId: number,
	seccionalId: number,
	tipo: 'extraordinario' | 'produtividade'
) {
	return db
		.select({
			id: giseAssinaturasRelatorios.id,
			gise_id: giseAssinaturasRelatorios.gise_id,
			seccional_id: giseAssinaturasRelatorios.seccional_id,
			tipo: giseAssinaturasRelatorios.tipo,
			assinante_id: giseAssinaturasRelatorios.assinante_id,
			assinante_nome: giseAssinaturasRelatorios.assinante_nome,
			assinante_cpf: giseAssinaturasRelatorios.assinante_cpf,
			assinante_matricula: policiais.matricula,
			tipo_assinatura: giseAssinaturasRelatorios.tipo_assinatura,
			rubrica: giseAssinaturasRelatorios.rubrica,
			verification_hash: giseAssinaturasRelatorios.verification_hash,
			selfie_key: giseAssinaturasRelatorios.selfie_key,
			ip_address: giseAssinaturasRelatorios.ip_address,
			user_agent: giseAssinaturasRelatorios.user_agent,
			latitude: giseAssinaturasRelatorios.latitude,
			longitude: giseAssinaturasRelatorios.longitude,
			r2_key: giseAssinaturasRelatorios.r2_key,
			created_at: giseAssinaturasRelatorios.created_at
		})
		.from(giseAssinaturasRelatorios)
		.leftJoin(policiais, eq(giseAssinaturasRelatorios.assinante_id, policiais.id))
		.where(
			and(
				eq(giseAssinaturasRelatorios.gise_id, giseId),
				eq(giseAssinaturasRelatorios.seccional_id, seccionalId),
				eq(giseAssinaturasRelatorios.tipo, tipo)
			)
		)
		.orderBy(desc(giseAssinaturasRelatorios.created_at))
		.get();
}

export async function salvarAssinaturaRelatorioGise(
	db: Database,
	data: {
		gise_id: number;
		seccional_id: number;
		tipo: 'extraordinario' | 'produtividade';
		assinante_id?: number | null;
		assinante_nome: string;
		assinante_cpf?: string | null;
		tipo_assinatura: 'simples' | 'webpki' | 'serpro';
		rubrica?: string;
		verification_hash?: string;
		ip_address?: string;
		user_agent?: string;
		latitude?: number;
		longitude?: number;
		selfie_key?: string;
		arquivo_hash?: string;
		r2_key?: string | null;
		assinante_email?: string | null;
		tipo_carimbo_tempo?: string;
	}
) {
	return db
		.insert(giseAssinaturasRelatorios)
		.values({ ...data, assinante_id: data.assinante_id ?? null, assinante_cpf: data.assinante_cpf ?? '' })
		.onConflictDoUpdate({
			target: [
				giseAssinaturasRelatorios.gise_id,
				giseAssinaturasRelatorios.seccional_id,
				giseAssinaturasRelatorios.tipo
			],
			set: {
				assinante_id: data.assinante_id ?? null,
				assinante_nome: data.assinante_nome,
				assinante_cpf: data.assinante_cpf ?? '',
				tipo_assinatura: data.tipo_assinatura,
				rubrica: data.rubrica,
				verification_hash: data.verification_hash,
				ip_address: data.ip_address,
				user_agent: data.user_agent,
				latitude: data.latitude,
				longitude: data.longitude,
				selfie_key: data.selfie_key,
				arquivo_hash: data.arquivo_hash,
				r2_key: data.r2_key,
				assinante_email: data.assinante_email ?? null,
				tipo_carimbo_tempo: data.tipo_carimbo_tempo || 'servidor',
				created_at: sql`datetime('now', '-3 hours')`
			}
		});
}
