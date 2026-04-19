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

import { getNowBR } from '../../utils';

export async function buscarPresencaGise(db: Database, giseId: number, policialId: number) {
	return db
		.select()
		.from(gisePresencas)
		.where(and(eq(gisePresencas.gise_id, giseId), eq(gisePresencas.policial_id, policialId)))
		.get();
}

export async function salvarEntradaGise(
	db: Database,
	giseId: number,
	policialId: number,
	rubrica: string,
	ipAddress?: string,
	userAgent?: string,
	latitude?: number,
	longitude?: number,
	selfieKey?: string
) {
	const now = getNowBR().toISOString();
	return db
		.insert(gisePresencas)
		.values({
			gise_id: giseId,
			policial_id: policialId,
			entrada_timestamp: now,
			entrada_rubrica: rubrica,
			entrada_selfie_key: selfieKey,
			ip_address: ipAddress,
			user_agent: userAgent,
			latitude,
			longitude,
			updated_at: sql`datetime('now', '-3 hours')`
		})
		.onConflictDoUpdate({
			target: [gisePresencas.gise_id, gisePresencas.policial_id],
			set: {
				entrada_timestamp: now,
				entrada_rubrica: rubrica,
				entrada_selfie_key: selfieKey,
				ip_address: ipAddress,
				user_agent: userAgent,
				latitude,
				longitude,
				updated_at: sql`datetime('now', '-3 hours')`
			}
		});
}

export async function salvarSaidaGise(
	db: Database,
	giseId: number,
	policialId: number,
	rubrica: string,
	ipAddress?: string,
	userAgent?: string,
	latitude?: number,
	longitude?: number,
	selfieKey?: string
) {
	return db
		.update(gisePresencas)
		.set({
			saida_timestamp: getNowBR().toISOString(),
			saida_rubrica: rubrica,
			saida_selfie_key: selfieKey,
			ip_address: ipAddress,
			user_agent: userAgent,
			latitude,
			longitude,
			updated_at: sql`datetime('now', '-3 hours')`
		})
		.where(and(eq(gisePresencas.gise_id, giseId), eq(gisePresencas.policial_id, policialId)));
}

export async function isDailyGiseSigned(db: Database, giseId: number) {
	const doc = await db
		.select({ id: giseDocumentos.id })
		.from(giseDocumentos)
		.where(eq(giseDocumentos.gise_id, giseId))
		.get();
	return !!doc;
}

export async function buscarPresencasGise(db: Database, giseId: number) {
	return db
		.select({
			id: gisePresencas.id,
			gise_id: gisePresencas.gise_id,
			policial_id: gisePresencas.policial_id,
			policial_nome: policiais.nome,
			policial_matricula: policiais.matricula,
			policial_cpf: policiais.cpf,
			entrada_timestamp: gisePresencas.entrada_timestamp,
			entrada_rubrica: gisePresencas.entrada_rubrica,
			entrada_selfie_key: gisePresencas.entrada_selfie_key,
			saida_timestamp: gisePresencas.saida_timestamp,
			saida_rubrica: gisePresencas.saida_rubrica,
			saida_selfie_key: gisePresencas.saida_selfie_key,
			ip_address: gisePresencas.ip_address,
			user_agent: gisePresencas.user_agent,
			latitude: gisePresencas.latitude,
			longitude: gisePresencas.longitude
		})
		.from(gisePresencas)
		.innerJoin(policiais, eq(gisePresencas.policial_id, policiais.id))
		.where(eq(gisePresencas.gise_id, giseId))
		.all();
}
